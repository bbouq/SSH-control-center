//! Master backup and restore: one passphrase-encrypted file that moves a Master to a fresh install.
//! The restored machine becomes the same Master (node ID, label, roles, tenant keys and fleet), so Targets
//! accept it unchanged. The Owner and execution mode stay as this machine's installer set them.
//! Owner-only and local-only: the service never routes these methods through a bridge or relay.
use crate::{config::{self, Config}, folders, protocol::Request, security};
use anyhow::{bail, ensure, Context, Result};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD, Engine};
use chacha20poly1305::{
    aead::{rand_core::RngCore, Aead, KeyInit, OsRng, Payload as Sealed},
    XChaCha20Poly1305, XNonce,
};
use rusqlite::{types::Value as Sql, Connection, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

/// The payload format this Master writes. Older files are migrated on restore; newer ones are refused.
pub const FORMAT_VERSION: u16 = 1;
pub const MIN_PASSPHRASE: usize = 12;
const MAGIC: &[u8; 8] = b"SSHCCBAK";
const HEADER: usize = 8 + 2 + 12 + 16 + 24;
const MAX_FILE: usize = 4 * 1024 * 1024;
/// Argon2id cost for new files; files carry their own, bounded on read.
const KDF: (u32, u32, u32) = (64 * 1024, 3, 1);
/// Fleet tables that travel, with their columns. Jobs, terminals, health, dispatches and pairing
/// requests stay behind.
const TABLES: &[(&str, &[&str])] = &[
    ("targets", &["id", "document"]),
    ("masters", &["id", "document", "revoked"]),
    ("tenant_keys", &["tenant", "public_key"]),
    ("relays", &["master_id", "label", "joined_at", "last_used_at", "revoked"]),
    ("merges", &["target_id", "document"]),
    ("folders", &["id", "master", "name", "created_at"]),
    ("folder_members", &["target_id", "folder_id"]),
    ("datacenters", &["id", "name", "created_at"]),
    ("datacenter_members", &["master", "datacenter_id"]),
];

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Contents {
    created_at: String,
    node_id: String,
    label: String,
    roles: Vec<String>,
    os: String,
    data_dir: String,
    /// File name inside the keys directory → base64 bytes.
    keys: BTreeMap<String, String>,
    tables: BTreeMap<String, Vec<Map<String, Value>>>,
}

/// Last backup and restore times, kept beside the fleet and never part of a backup.
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    last_backup_at: Option<String>,
    restored_at: Option<String>,
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}
fn record_path(state: &Path) -> PathBuf {
    state.join("backup.json")
}
fn read_record(state: &Path) -> Result<Record> {
    match fs::read(record_path(state)) {
        Ok(bytes) => Ok(serde_json::from_slice(&bytes)?),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Record::default()),
        Err(error) => Err(error.into()),
    }
}
fn write_record(state: &Path, record: &Record) -> Result<()> {
    let path = record_path(state);
    let tmp = state.join(format!(".backup-{}.tmp", uuid::Uuid::new_v4()));
    fs::write(&tmp, serde_json::to_vec_pretty(record)?)?;
    security::protect(&tmp, false)?;
    security::replace(&tmp, &path)?;
    Ok(())
}

fn passphrase(p: &Value) -> Result<&str> {
    let value = p.get("passphrase").and_then(Value::as_str).context("E_ARGUMENT: missing passphrase")?;
    ensure!(
        value.chars().count() >= MIN_PASSPHRASE,
        "E_BACKUP_PASSPHRASE_SHORT: the passphrase must be at least {MIN_PASSPHRASE} characters"
    );
    Ok(value)
}
fn file(p: &Value) -> Result<Vec<u8>> {
    let text = p.get("file").and_then(Value::as_str).context("E_ARGUMENT: missing file")?;
    ensure!(text.len() <= MAX_FILE * 4 / 3 + 4, "E_BACKUP_NOT_A_BACKUP: the file is too large to be a backup");
    STANDARD.decode(text).context("E_ARGUMENT: file must be base64")
}
fn derive(passphrase: &str, salt: &[u8], (memory, passes, lanes): (u32, u32, u32)) -> Result<[u8; 32]> {
    let params = Params::new(memory, passes, lanes, Some(32)).map_err(|e| anyhow::anyhow!("E_BACKUP_NOT_A_BACKUP: {e}"))?;
    let mut key = [0u8; 32];
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(passphrase.as_bytes(), salt, &mut key)
        .map_err(|e| anyhow::anyhow!("E_BACKUP_NOT_A_BACKUP: {e}"))?;
    Ok(key)
}

fn seal(contents: &Contents, passphrase: &str) -> Result<Vec<u8>> {
    let mut salt = [0u8; 16];
    let mut nonce = [0u8; 24];
    OsRng.fill_bytes(&mut salt);
    OsRng.fill_bytes(&mut nonce);
    let mut header = Vec::with_capacity(HEADER);
    header.extend_from_slice(MAGIC);
    header.extend_from_slice(&FORMAT_VERSION.to_be_bytes());
    for value in [KDF.0, KDF.1, KDF.2] {
        header.extend_from_slice(&value.to_be_bytes());
    }
    header.extend_from_slice(&salt);
    header.extend_from_slice(&nonce);
    let key = derive(passphrase, &salt, KDF)?;
    let body = serde_json::to_vec(contents)?;
    let sealed = XChaCha20Poly1305::new(&key.into())
        .encrypt(XNonce::from_slice(&nonce), Sealed { msg: &body, aad: &header })
        .map_err(|_| anyhow::anyhow!("E_BACKUP: encryption failed"))?;
    header.extend_from_slice(&sealed);
    Ok(header)
}

/// The header is read before the passphrase is tried, so "not a backup" and "newer" are told apart from
/// "wrong passphrase or damaged" (the AEAD cannot tell those two apart, by design).
fn open(bytes: &[u8], passphrase: &str) -> Result<(u16, Contents)> {
    ensure!(
        bytes.len() > HEADER && bytes.len() <= MAX_FILE && &bytes[..8] == MAGIC,
        "E_BACKUP_NOT_A_BACKUP: this file is not an SSH Control Center backup"
    );
    let version = u16::from_be_bytes([bytes[8], bytes[9]]);
    ensure!(version >= 1, "E_BACKUP_NOT_A_BACKUP: this file is not an SSH Control Center backup");
    ensure!(
        version <= FORMAT_VERSION,
        "E_BACKUP_NEWER: this backup comes from a newer Master (format {version}); update this Master first"
    );
    let number = |at: usize| u32::from_be_bytes(bytes[at..at + 4].try_into().unwrap());
    let kdf = (number(10), number(14), number(18));
    ensure!(
        (8 * 1024..=1024 * 1024).contains(&kdf.0) && (1..=16).contains(&kdf.1) && (1..=16).contains(&kdf.2),
        "E_BACKUP_NOT_A_BACKUP: this file is not an SSH Control Center backup"
    );
    let (salt, nonce) = (&bytes[22..38], &bytes[38..HEADER]);
    let key = derive(passphrase, salt, kdf)?;
    let body = XChaCha20Poly1305::new(&key.into())
        .decrypt(XNonce::from_slice(nonce), Sealed { msg: &bytes[HEADER..], aad: &bytes[..HEADER] })
        .map_err(|_| anyhow::anyhow!("E_BACKUP_BAD_PASSPHRASE_OR_DAMAGED: the passphrase is wrong or the file is damaged"))?;
    let contents = migrate(version, serde_json::from_slice(&body).context("E_BACKUP_BAD_PASSPHRASE_OR_DAMAGED: the backup contents are damaged")?)?;
    Ok((version, contents))
}

/// Brings an older payload up to the current format. Format 1 is the first, so there is nothing to change yet;
/// a later format adds its step here (for example Tags, roadmap entry 4).
fn migrate(version: u16, payload: Value) -> Result<Contents> {
    let _ = version;
    serde_json::from_value(payload).context("E_BACKUP_BAD_PASSPHRASE_OR_DAMAGED: the backup contents are damaged")
}

fn sql_to_json(value: Sql) -> Result<Value> {
    Ok(match value {
        Sql::Null => Value::Null,
        Sql::Integer(n) => json!(n),
        Sql::Text(text) => json!(text),
        Sql::Real(_) | Sql::Blob(_) => bail!("E_BACKUP: unexpected column type"),
    })
}
fn json_to_sql(value: &Value) -> Result<Sql> {
    Ok(match value {
        Value::Null => Sql::Null,
        Value::Number(n) => Sql::Integer(n.as_i64().context("E_BACKUP_BAD_PASSPHRASE_OR_DAMAGED: invalid number")?),
        Value::String(text) => Sql::Text(text.clone()),
        Value::Bool(flag) => Sql::Integer(i64::from(*flag)),
        _ => bail!("E_BACKUP_BAD_PASSPHRASE_OR_DAMAGED: invalid column value"),
    })
}
fn dump(db: &Connection) -> Result<BTreeMap<String, Vec<Map<String, Value>>>> {
    let mut tables = BTreeMap::new();
    for (table, columns) in TABLES {
        let mut stmt = db.prepare(&format!("SELECT {} FROM {table} ORDER BY rowid", columns.join(",")))?;
        let mut rows = stmt.query([])?;
        let mut out = Vec::new();
        while let Some(row) = rows.next()? {
            let mut object = Map::new();
            for (i, column) in columns.iter().enumerate() {
                object.insert((*column).into(), sql_to_json(row.get(i)?)?);
            }
            out.push(object);
        }
        tables.insert((*table).into(), out);
    }
    Ok(tables)
}
fn count(db: &Connection, table: &str) -> Result<i64> {
    Ok(db.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get(0))?)
}
/// Empty: no hosts, Merges or folders. Allowed Masters, relays and keys from a fresh install are replaced.
fn is_empty(db: &Connection) -> Result<bool> {
    Ok(count(db, "targets")? + count(db, "merges")? + count(db, "folders")? == 0)
}
fn key_name(name: &str) -> Result<()> {
    ensure!(
        !name.is_empty() && name.len() <= 128 && !name.starts_with('.')
            && name.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.')),
        "E_BACKUP_BAD_PASSPHRASE_OR_DAMAGED: invalid key file name"
    );
    Ok(())
}

fn role(config: &Config) -> Result<()> {
    ensure!(config.roles.iter().any(|r| r == "master"), "E_ROLE: master role is required");
    Ok(())
}

pub fn create(state: &Path, config: &Config, passphrase: &str) -> Result<Vec<u8>> {
    role(config)?;
    let db = folders::database(state)?;
    let mut keys = BTreeMap::new();
    let folder = state.join("keys");
    if folder.is_dir() {
        for entry in fs::read_dir(&folder)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if entry.file_type()?.is_file() && key_name(&name).is_ok() {
                keys.insert(name, STANDARD.encode(fs::read(entry.path())?));
            }
        }
    }
    let contents = Contents {
        created_at: now(),
        node_id: config.node_id.clone(),
        label: config.label.clone(),
        roles: config.roles.clone(),
        os: std::env::consts::OS.into(),
        data_dir: state.to_string_lossy().into_owned(),
        keys,
        tables: dump(&db)?,
    };
    let bytes = seal(&contents, passphrase)?;
    let mut record = read_record(state)?;
    record.last_backup_at = Some(contents.created_at);
    write_record(state, &record)?;
    Ok(bytes)
}

fn summary(version: u16, contents: &Contents) -> Value {
    let rows = |table: &str| contents.tables.get(table).map_or(0, Vec::len);
    json!({"formatVersion":version,"createdAt":contents.created_at,"nodeId":contents.node_id,"label":contents.label,
        "os":contents.os,"hosts":rows("targets"),"merges":rows("merges"),"folders":rows("folders")})
}

pub fn inspect(bytes: &[u8], passphrase: &str) -> Result<Value> {
    let (version, contents) = open(bytes, passphrase)?;
    Ok(summary(version, &contents))
}

/// Writes everything or nothing: the fleet rows go in one transaction, the key files are staged first and
/// put back if anything later fails, and config.json is replaced last.
pub fn restore(state: &Path, config: &Config, bytes: &[u8], passphrase: &str) -> Result<Value> {
    role(config)?;
    let mut db = folders::database(state)?;
    ensure!(
        is_empty(&db)?,
        "E_RESTORE_NOT_EMPTY: this Master already has hosts; restore only works on a fresh install"
    );
    let (version, contents) = open(bytes, passphrase)?;
    for name in contents.keys.keys() {
        key_name(name)?;
    }
    let keys = contents
        .keys
        .iter()
        .map(|(name, data)| Ok((name.clone(), STANDARD.decode(data).context("E_BACKUP_BAD_PASSPHRASE_OR_DAMAGED: invalid key data")?)))
        .collect::<Result<Vec<_>>>()?;

    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    for (table, columns) in TABLES {
        tx.execute(&format!("DELETE FROM {table}"), [])?;
        let insert = format!(
            "INSERT INTO {table}({}) VALUES({})",
            columns.join(","),
            (1..=columns.len()).map(|i| format!("?{i}")).collect::<Vec<_>>().join(",")
        );
        for row in contents.tables.get(*table).into_iter().flatten() {
            let values = columns
                .iter()
                .map(|column| json_to_sql(row.get(*column).unwrap_or(&Value::Null)))
                .collect::<Result<Vec<_>>>()?;
            tx.execute(&insert, rusqlite::params_from_iter(values))?;
        }
    }

    let folder = state.join("keys");
    fs::create_dir_all(&folder)?;
    security::protect(&folder, true)?;
    let stage = folder.join(format!(".restore-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&stage)?;
    security::protect(&stage, true)?;
    let previous_config = fs::read(state.join("config.json"))?;
    let mut moved: Vec<(PathBuf, Option<PathBuf>)> = Vec::new();
    let result = (|| -> Result<()> {
        for (name, data) in &keys {
            let staged = stage.join(name);
            fs::write(&staged, data)?;
            security::protect(&staged, false)?;
        }
        for (name, _) in &keys {
            let path = folder.join(name);
            let kept = if path.exists() {
                let old = stage.join(format!("{name}.previous"));
                fs::rename(&path, &old)?;
                Some(old)
            } else {
                None
            };
            moved.push((path.clone(), kept));
            fs::rename(stage.join(name), &path)?;
        }
        config::adopt(state, &contents.node_id, &contents.label, &contents.roles)?;
        Ok(())
    })()
    .and_then(|()| tx.commit().map_err(Into::into));
    if let Err(error) = result {
        for (path, kept) in moved.iter().rev() {
            let _ = fs::remove_file(path);
            if let Some(old) = kept {
                let _ = fs::rename(old, path);
            }
        }
        let _ = fs::write(state.join("config.json"), &previous_config);
        let _ = fs::remove_dir_all(&stage);
        return Err(error);
    }
    let _ = fs::remove_dir_all(&stage);
    write_record(state, &Record { last_backup_at: Some(contents.created_at.clone()), restored_at: Some(now()) })?;
    let mut result = summary(version, &contents);
    result["restartRequired"] = json!(true);
    Ok(result)
}

pub fn status(state: &Path, owner: bool) -> Result<Value> {
    let record = read_record(state)?;
    let db = folders::database(state)?;
    Ok(json!({"lastBackupAt":record.last_backup_at,"restoredAt":record.restored_at,"empty":is_empty(&db)?,"owner":owner}))
}

/// Service entry point; `owner` is true when the local caller is this Master's Owner (or the system).
pub fn handle(state: &Path, config: &Config, req: &Request, owner: bool) -> Result<Option<Value>> {
    if !req.method.starts_with("backup.") {
        return Ok(None);
    }
    let p = &req.params;
    if req.method == "backup.status" {
        return status(state, owner).map(Some);
    }
    ensure!(owner, "E_BACKUP_NOT_OWNER: only this Master's Owner can back up or restore it");
    Ok(Some(match req.method.as_str() {
        "backup.create" => json!({"file": STANDARD.encode(create(state, config, passphrase(p)?)?)}),
        "backup.inspect" => inspect(&file(p)?, required(p)?)?,
        "backup.restore" => restore(state, config, &file(p)?, required(p)?)?,
        _ => bail!("E_ARGUMENT: unknown backup method"),
    }))
}
/// Opening a file takes whatever passphrase was set; the length rule is for new backups only.
fn required(p: &Value) -> Result<&str> {
    p.get("passphrase").and_then(Value::as_str).context("E_ARGUMENT: missing passphrase")
}
