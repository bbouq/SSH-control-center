//! Master backup and restore (roadmap entry 3): one encrypted file moves a Master to a fresh install.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use sshcc_core::{backup, config, fleet, folders, jobs::Jobs, protocol::Request, security, service::Service};
use std::{
    fs,
    path::Path,
    sync::{atomic::AtomicBool, Arc},
};
use uuid::Uuid;

const PASSPHRASE: &str = "correct horse battery";

fn key(seed: u8) -> String {
    let mut wire = Vec::new();
    wire.extend_from_slice(&11u32.to_be_bytes());
    wire.extend_from_slice(b"ssh-ed25519");
    wire.extend_from_slice(&32u32.to_be_bytes());
    wire.extend_from_slice(&[seed; 32]);
    format!("ssh-ed25519 {}", STANDARD.encode(wire))
}
fn call(state: &Path, config: &config::Config, method: &str, params: Value) -> Value {
    let request = Request { method: method.into(), params };
    fleet::handle(state, config, &request)
        .unwrap()
        .unwrap_or_else(|| panic!("{method} unhandled"))
}
fn folders_call(state: &Path, config: &config::Config, method: &str, params: Value) -> Value {
    folders::handle(state, config, &Request { method: method.into(), params }).unwrap().unwrap()
}
fn backup_call(state: &Path, config: &config::Config, method: &str, params: Value) -> anyhow::Result<Value> {
    backup::handle(state, config, &Request { method: method.into(), params }, true).map(|value| value.unwrap())
}
fn fresh(dir: &Path, label: &str) -> config::Config {
    config::init(dir, "both", &security::current_principal().unwrap(), label, &[]).unwrap()
}
fn host(id: &str, address: &str) -> Value {
    json!({"schemaVersion":2,"id":id,"nodeId":Uuid::new_v4().to_string(),"label":id,"tenant":"company","os":"linux",
        "user":"sshcc-bridge","hostKeys":[key(1)],"routes":[{"kind":"lan","address":address,"port":22}],
        "bridgePath":"/usr/bin/sshcc","runnerInstalled":true})
}

/// A Master with two hosts (one a Master it merged), a tenant key, an allowed Master, a relay, a folder and a
/// datacenter, plus state that must not travel: a job, health and an unfinished pairing request.
fn old_master(dir: &Path) -> config::Config {
    let cfg = fresh(dir, "Old Master");
    config::set_execution_mode(dir, "service").unwrap();
    let keys = dir.join("keys");
    fs::create_dir_all(&keys).unwrap();
    fs::write(keys.join("company.ed25519"), "PRIVATE KEY company").unwrap();
    fs::write(keys.join("company.ed25519.pub"), key(7) + " sshcc-service\n").unwrap();
    fs::write(keys.join("jump.ed25519"), "PRIVATE KEY jump").unwrap();
    call(dir, &cfg, "enrollment.export", json!({"targetId":"web-1","tenant":"company","os":"linux","user":"sshcc-bridge",
        "routes":[{"kind":"lan","address":"10.0.0.1","port":22}]}));
    call(dir, &cfg, "targets.import", json!({"registration":host("web-1","10.0.0.1")}));
    call(dir, &cfg, "targets.import", json!({"registration":host("branch","10.0.0.2")}));
    fleet::record_merge(dir, "branch", &json!({"nodeId":fleet_node(dir, &cfg, "branch"),"label":"Branch","targets":[
        {"id":"child","label":"Child","tenant":"lab","os":"linux","nodeId":Uuid::new_v4().to_string()}]})).unwrap();
    let allowed = Uuid::new_v4().to_string();
    fleet::register_master(dir, &json!({"id":allowed,"label":"Peer Master","publicKey":key(3)})).unwrap();
    fleet::relay_join(dir, &cfg, &allowed).unwrap();
    let folder = folders_call(dir, &cfg, "folders.create", json!({"name":"Web"}));
    folders_call(dir, &cfg, "folders.assign", json!({"targetId":"web-1","folderId":folder["id"]}));
    let site = folders_call(dir, &cfg, "datacenters.create", json!({"name":"Bangkok"}));
    folders_call(dir, &cfg, "datacenters.assign", json!({"master":"local","datacenterId":site["id"]}));
    Jobs::open(dir).unwrap();
    cfg
}
fn fleet_node(dir: &Path, cfg: &config::Config, id: &str) -> String {
    call(dir, cfg, "targets.list", json!({})).as_array().unwrap().iter()
        .find(|row| row["id"] == id).unwrap()["nodeId"].as_str().unwrap().into()
}
fn backup_file(dir: &Path, cfg: &config::Config) -> Vec<u8> {
    let made = backup_call(dir, cfg, "backup.create", json!({"passphrase":PASSPHRASE})).unwrap();
    STANDARD.decode(made["file"].as_str().unwrap()).unwrap()
}
fn restore(dir: &Path, cfg: &config::Config, file: &[u8], passphrase: &str) -> anyhow::Result<Value> {
    backup_call(dir, cfg, "backup.restore", json!({"file":STANDARD.encode(file),"passphrase":passphrase}))
}
fn error<T: std::fmt::Debug>(result: anyhow::Result<T>) -> String {
    format!("{:#}", result.unwrap_err())
}
fn ids(value: &Value, field: &str) -> Vec<String> {
    let mut ids: Vec<String> = value.as_array().unwrap().iter().map(|row| row[field].as_str().unwrap().to_owned()).collect();
    ids.sort();
    ids
}

#[test]
fn restore_moves_the_master_to_a_fresh_install() {
    let old = tempfile::tempdir().unwrap();
    let old_cfg = old_master(old.path());
    let file = backup_file(old.path(), &old_cfg);
    assert!(!String::from_utf8_lossy(&file).contains("PRIVATE KEY"), "the file must be encrypted");

    let new = tempfile::tempdir().unwrap();
    let new_cfg = fresh(new.path(), "New install");
    let result = restore(new.path(), &new_cfg, &file, PASSPHRASE).unwrap();
    assert_eq!(result["hosts"], 2);
    assert_eq!(result["restartRequired"], true);

    let restored = config::load(new.path()).unwrap();
    assert_eq!(restored.node_id, old_cfg.node_id);
    assert_eq!(restored.label, "Old Master");
    assert_eq!(restored.roles, old_cfg.roles);
    // The new machine's installer chose its Owner and execution mode; the backup never carries them.
    assert_eq!(restored.owner, new_cfg.owner);
    assert_eq!(restored.execution_mode, "owner-session");

    assert_eq!(fs::read_to_string(new.path().join("keys/company.ed25519")).unwrap(), "PRIVATE KEY company");
    assert_eq!(fs::read_to_string(new.path().join("keys/jump.ed25519")).unwrap(), "PRIVATE KEY jump");
    assert!(fs::read_to_string(new.path().join("keys/company.ed25519.pub")).unwrap().starts_with(&key(7)));

    let list = |method: &str| call(new.path(), &restored, method, json!({}));
    let old_list = |method: &str| call(old.path(), &old_cfg, method, json!({}));
    assert_eq!(list("targets.list"), old_list("targets.list"));
    assert_eq!(ids(&list("masters.list"), "id"), ids(&old_list("masters.list"), "id"));
    assert_eq!(ids(&list("relays.list"), "masterId"), ids(&old_list("relays.list"), "masterId"));
    assert_eq!(ids(&list("merges.list"), "targetId"), vec!["branch"]);
    assert_eq!(folders_call(new.path(), &restored, "folders.list", json!({})), folders_call(old.path(), &old_cfg, "folders.list", json!({})));
    assert_eq!(folders_call(new.path(), &restored, "datacenters.list", json!({})), folders_call(old.path(), &old_cfg, "datacenters.list", json!({})));
    // Enrolling another host keeps using the restored tenant key, not a new one.
    let bundle = call(new.path(), &restored, "enrollment.export", json!({"targetId":"web-2","tenant":"company","os":"linux",
        "user":"sshcc-bridge","routes":[{"kind":"lan","address":"10.0.0.3","port":22}]}));
    assert_eq!(bundle["master"]["publicKey"], key(7));
    assert_eq!(bundle["master"]["id"], old_cfg.node_id.as_str());
    // Job history stays behind.
    assert!(!new.path().join("jobs.sqlite").exists());
}

#[test]
fn inspect_and_status_describe_without_writing() {
    let old = tempfile::tempdir().unwrap();
    let cfg = old_master(old.path());
    let before = backup_call(old.path(), &cfg, "backup.status", json!({})).unwrap();
    assert_eq!(before["lastBackupAt"], Value::Null);
    assert_eq!(before["empty"], false);
    let file = backup_file(old.path(), &cfg);
    let after = backup_call(old.path(), &cfg, "backup.status", json!({})).unwrap();
    assert!(after["lastBackupAt"].is_string());

    let new = tempfile::tempdir().unwrap();
    let new_cfg = fresh(new.path(), "New install");
    assert_eq!(backup_call(new.path(), &new_cfg, "backup.status", json!({})).unwrap()["empty"], true);
    let summary = backup_call(new.path(), &new_cfg, "backup.inspect", json!({"file":STANDARD.encode(&file),"passphrase":PASSPHRASE})).unwrap();
    assert_eq!(summary["label"], "Old Master");
    assert_eq!(summary["hosts"], 2);
    assert_eq!(summary["formatVersion"], backup::FORMAT_VERSION);
    assert!(summary["createdAt"].is_string());
    assert_eq!(config::load(new.path()).unwrap().node_id, new_cfg.node_id);
}

#[test]
fn every_failure_has_its_own_code_and_writes_nothing() {
    let old = tempfile::tempdir().unwrap();
    let cfg = old_master(old.path());
    let file = backup_file(old.path(), &cfg);
    let new = tempfile::tempdir().unwrap();
    let new_cfg = fresh(new.path(), "New install");
    let untouched = |dir: &Path| {
        assert_eq!(config::load(dir).unwrap().node_id, new_cfg.node_id);
        assert!(!dir.join("keys/company.ed25519").exists());
    };

    assert!(error(backup_call(old.path(), &cfg, "backup.create", json!({"passphrase":"short pass"}))).contains("E_BACKUP_PASSPHRASE_SHORT"));
    assert!(error(backup::handle(old.path(), &cfg, &Request { method: "backup.create".into(), params: json!({"passphrase":PASSPHRASE}) }, false))
        .contains("E_BACKUP_NOT_OWNER"));
    assert!(error(backup::handle(new.path(), &new_cfg, &Request { method: "backup.restore".into(),
        params: json!({"file":STANDARD.encode(&file),"passphrase":PASSPHRASE}) }, false)).contains("E_BACKUP_NOT_OWNER"));

    assert!(error(restore(new.path(), &new_cfg, &file, "wrong passphrase!")).contains("E_BACKUP_BAD_PASSPHRASE_OR_DAMAGED"));
    let mut damaged = file.clone();
    let last = damaged.len() - 1;
    damaged[last] ^= 1;
    assert!(error(restore(new.path(), &new_cfg, &damaged, PASSPHRASE)).contains("E_BACKUP_BAD_PASSPHRASE_OR_DAMAGED"));
    assert!(error(restore(new.path(), &new_cfg, b"{\"not\":\"a backup\"}", PASSPHRASE)).contains("E_BACKUP_NOT_A_BACKUP"));
    let mut newer = file.clone();
    newer[8..10].copy_from_slice(&(backup::FORMAT_VERSION + 1).to_be_bytes());
    assert!(error(restore(new.path(), &new_cfg, &newer, PASSPHRASE)).contains("E_BACKUP_NEWER"));
    untouched(new.path());

    // A Master that already has hosts refuses, before the passphrase is even tried.
    assert!(error(restore(old.path(), &cfg, &file, "wrong passphrase!")).contains("E_RESTORE_NOT_EMPTY"));
}

#[test]
fn backup_and_restore_never_cross_a_bridge_or_relay() {
    let dir = tempfile::tempdir().unwrap();
    let owner = security::current_principal().unwrap();
    config::init(dir.path(), "both", &owner, "Test", &[]).unwrap();
    let service = Service::new(dir.path().into(), Arc::new(AtomicBool::new(false))).unwrap();
    // An enrolled Master, so the refusal comes from the method list and not from authentication.
    let peer = Uuid::new_v4().to_string();
    fleet::register_master(dir.path(), &json!({"id":peer,"label":"Peer","publicKey":key(3)})).unwrap();
    let fingerprint = fleet::public_key_fingerprint(&key(3)).unwrap();
    for method in ["backup.create", "backup.restore", "backup.inspect", "backup.status"] {
        let bridged = Request { method: "bridge.request".into(), params: json!({"masterId":peer,"masterKey":fingerprint,
            "expectedTargetId":service.config.node_id,"request":{"method":method,"params":{"passphrase":PASSPHRASE}}}) };
        assert!(error(service.handle(&bridged, &owner)).contains("not available over bridge"), "{method} over a bridge");
        let relayed = fleet::relay_request(dir.path(), &service.config, &Uuid::new_v4().to_string(),
            &json!({"targetId":"child","method":method,"params":{}}));
        assert!(format!("{:#}", relayed.unwrap_err()).contains("E_PERMISSION"), "{method} over a relay");
    }
    let status = service.handle(&Request { method: "backup.status".into(), params: json!({}) }, &owner).unwrap();
    assert_eq!(status["empty"], true);
}
