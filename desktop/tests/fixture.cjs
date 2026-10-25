// Isolated browser fixture. Never connects to a service or a real SSH Target.
// Scenario flags (comma-separated, env SSHCC_FIXTURE_SCENARIO or POST /scenario {"flags":[…]}):
//   empty            start as a Master with no hosts, folders, Merges or relays
//   new-host-master  every host paired through the fixture is itself a Master (merges.discover/fleet.health say so)
//   merge-fails      merges.add / merges.sync fail (the remote Master does not answer)
//   needs-attention  completing a pairing fails the connection check; an address retry (pairing.status routes) passes
//   masters-page     adds two hosts that are Masters (one merged, one not) and a Master that controls this one both
//                    directly and through a Merge, plus one that only merged this Master (merging disabled)
//   backed-up        this Master has a last backup date
//   two-way-merge    with masters-page: the Merge with branch-master is two-way (it shows as a relay here too)
// Backups: save_backup "writes" to /fixture/Backups and keeps the file in memory (across scenario resets), so a test can
// back up, POST /scenario {"flags":["empty"]} and restore it. POST /next-backup {"kind":"good"|"newer"|"damaged"|"other"} makes the
// next open_backup return that kind of file instead (once).
// Test-only endpoints: GET /calls (every request the page sent), POST /scenario (reset state, clears /calls),
// GET /pairing-code[?requestId=…][&master=other] (the code the new host would show after Approve; default: the
// newest request awaiting approval; master=other gives a code made for another Master).
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const ui = path.join(__dirname, "..", "ui");
const MASTER_ID = "fixture-master", MASTER_LABEL = "UI fixture Master";
const calls = [];
let flags, s, content, firstStart, savedBackup = null, nextBackup = "";
/** All mutable fixture state; `reset` rebuilds it for a scenario. */
function reset(list) {
  flags = new Set(list.filter(Boolean)); calls.length = 0; content = "Example text\n"; firstStart = true;
  const empty = flags.has("empty");
  s = {
    targets: empty ? [] : [{ schemaVersion: 2, id: "ui-test", nodeId: "ui-test-node", label: "UI test target", tenant: "test-only", os: "linux", user: "sshcc-bridge", routes: [{ kind: "lan", address: "192.0.2.20", port: 22 }], hostKeys: ["ssh-ed25519 TEST-FIXTURE-ONLY"], bridgePath: "/usr/bin/sshcc", runnerInstalled: true }],
    jobs: [], pairings: [], folders: [], folderMembers: {}, datacenters: [], datacenterMembers: {}, merges: [], masters: empty ? [] : [{ id: MASTER_ID, label: MASTER_LABEL, publicKey: "TEST", revoked: false }], relays: [], masterHosts: new Set(),
    backup: { lastBackupAt: flags.has("backed-up") ? "2026-10-20T09:30:00Z" : null, restoredAt: null }
  };
  if (flags.has("masters-page")) {
    const host = (id, label, address) => ({ schemaVersion: 2, id, nodeId: id + "-node", label, tenant: "test-only", os: "linux", user: "sshcc-bridge", routes: [{ kind: "lan", address, port: 22 }], hostKeys: ["ssh-ed25519 TEST-FIXTURE-ONLY"], bridgePath: "/usr/bin/sshcc", runnerInstalled: true });
    s.targets.push(host("hq-master", "HQ Master", "192.0.2.41"), host("branch-master", "Branch Master", "192.0.2.42"));
    s.masterHosts = new Set(["hq-master", "branch-master"]);
    s.merges.push({ targetId: "branch-master", label: "Branch Master", status: "merged", error: null, syncedAt: now(), children: children("branch-master"), reverse: null });
    s.masters.push({ id: "peer-both", label: "Peer Master", publicKey: "TEST", revoked: false });
    s.relays.push({ masterId: "peer-both", label: "Peer Master", lastUsedAt: now(), revoked: false }, { masterId: "peer-relay", label: "Relay-only Master", lastUsedAt: now(), revoked: true });
    if (flags.has("two-way-merge")) {
      s.merges[0].reverse = { status: "two-way", error: null };
      s.relays.push({ masterId: "branch-master-node", label: "Branch Master", lastUsedAt: now(), revoked: false });
    }
  }
}
const now = () => new Date().toISOString();
const sha = () => crypto.createHash("sha256").update(content).digest("hex");
const slug = text => String(text || "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "host";
const need = (value, name) => { if (value === undefined || value === null || value === "") throw new Error("E_ARGUMENT: missing " + name); return value; };
const pairingView = p => ({ requestId: p.requestId, targetId: p.targetId, label: p.label, tenant: p.tenant, os: p.os, state: p.state, createdAt: p.createdAt, updatedAt: p.updatedAt,
  envelope: { requestId: p.requestId, targetLabel: p.label, bundle: { targetId: p.targetId, tenant: p.tenant, os: p.os, user: p.user, routes: p.routes, master: { id: MASTER_ID, label: MASTER_LABEL } } }, diagnostics: p.diagnostics || null, sibling: p.sibling || null });
// Like the Master: a request cancelled because its sibling was answered first says so.
const pairing = id => s.pairings.find(p => p.requestId === id) || (() => { throw new Error(s.pairings.some(p => p.sibling === id && p.state !== "awaiting_approval")
  ? "E_PAIRING_REPLACED: unknown setup request on this Master; the other installer of the pair was used first" : "E_PAIRING_REQUEST: unknown setup request"); })();
const isMasterHost = id => s.masterHosts.has(id);
const children = id => [1, 2, 3].map(n => ({ id: "child-" + n, label: "Child " + n + " of " + id, tenant: "lab", os: n === 1 ? "windows" : "linux", nodeId: crypto.randomUUID() }));
/** A Merge's hosts, listed by targets.list as `<master>/<child>` (as the real Master does). */
const relayedTargets = () => s.merges.flatMap(m => (m.children || []).map(c => ({ schemaVersion: 2, id: m.targetId + "/" + c.id, nodeId: c.nodeId, label: c.label, tenant: c.tenant, os: c.os, relayed: true, via: m.targetId, viaLabel: m.label, routes: [], hostKeys: [], runnerInstalled: true })));
const healthRow = t => ({ targetId: t.id, online: true, checkedAt: now(), error: null, failures: 0, isMaster: isMasterHost(t.id), version: "test" });
// After the helpers: the masters-page scenario uses `now` and `children`.
reset((process.env.SSHCC_FIXTURE_SCENARIO || "").split(","));
/** The code the new host shows after Approve: `SSHCC1.fixture.<masterId>.<requestId>`. */
const pairingCode = (requestId, master = MASTER_ID) => "SSHCC1.fixture." + master + "." + requestId;
/** Validation shared by preview and complete (as on the real Master): the request the code answers. */
function codeRequest(code) {
  const m = /^SSHCC1\.fixture\.([^.]+)\.([^.]+)$/.exec(String(need(code, "code")).trim());
  if (!m) throw new Error("E_PAIRING_CODE: damaged pairing code");
  if (m[1] !== MASTER_ID) throw new Error("E_PAIRING_MASTER: code belongs to another Master");
  return pairing(m[2]);
}
const hostKeySha256 = p => "SHA256:" + crypto.createHash("sha256").update("FIXTURE-" + p.targetId).digest("base64").replace(/=+$/, "");
/** Read only: the review card's facts; saves nothing. */
function previewPairing({ code }) {
  const p = codeRequest(code);
  return { requestId: p.requestId, targetId: p.targetId, label: p.label, hostName: "fixture-" + p.os + "-pc", os: p.os, hostKeySha256: hostKeySha256(p) };
}
function completePairing({ code, label }) {
  const p = codeRequest(code);
  if (p.state !== "awaiting_approval") return pairingView(p);
  if (label) p.label = label;
  const target = { schemaVersion: 2, id: p.targetId, nodeId: crypto.randomUUID(), label: p.label, tenant: p.tenant, os: p.os, user: p.user, routes: p.routes, hostKeys: ["ssh-ed25519 FIXTURE-" + p.targetId], bridgePath: p.os === "windows" ? "C:\\Program Files\\SSHCC\\sshcc.exe" : "/usr/bin/sshcc", runnerInstalled: true };
  s.targets = s.targets.filter(t => t.id !== p.targetId).concat(target);
  if (flags.has("new-host-master")) s.masterHosts.add(p.targetId);
  if (p.sibling) s.pairings = s.pairings.filter(row => !(row.requestId === p.sibling && row.state === "awaiting_approval"));
  const failed = flags.has("needs-attention");
  Object.assign(p, { state: failed ? "needs_attention" : "ready", updatedAt: now(), diagnostics: failed
    ? { targetId: p.targetId, ok: false, stages: [{ name: "connect", ok: false, message: "No SSH answer at " + p.routes[0].address + ":" + p.routes[0].port }] }
    : { targetId: p.targetId, ok: true, stages: [{ name: "fixture", ok: true, message: "Isolated UI test only" }] } });
  return pairingView(p);
}
function mergeAdd(targetId) {
  const t = s.targets.find(row => row.id === targetId) || (() => { throw new Error("E_TARGET: unknown target " + targetId); })();
  if (!isMasterHost(targetId)) throw new Error("E_MERGE: " + targetId + " is not a Master");
  if (flags.has("merge-fails")) throw new Error("E_MERGE: remote Master " + targetId + " did not answer");
  const previous = s.merges.find(row => row.targetId === targetId);
  const merge = { targetId, label: t.label, status: "merged", error: null, syncedAt: now(), children: previous?.children || children(targetId), reverse: previous?.reverse || null };
  s.merges = s.merges.filter(row => row.targetId !== targetId).concat(merge);
  return merge;
}
// `pairing.check` stand-in: SSH answers only at the addresses below; every other address does not answer
// (a fresh Windows machine). SLOW_ADDRESS answers after 1.5 s, to test that late answers are ignored.
const BANNERS = { "192.0.2.33": "SSH-2.0-OpenSSH_for_Windows_9.5", "192.0.2.32": "SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.5", "192.0.2.99": "SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.5" };
const SLOW_ADDRESS = "192.0.2.99";
async function checkAddress(address, port, own) {
  if (address === SLOW_ADDRESS) await new Promise(done => setTimeout(done, 1500));
  const same = r => r.address.toLowerCase() === address.toLowerCase() && Number(r.port || 22) === port;
  const mine = p => own && (p.requestId === own || p.sibling === own); // a request's own sibling is not "already added"
  const target = s.targets.find(t => t.routes.some(same)), request = !target && s.pairings.find(p => !mine(p) && p.state === "awaiting_approval" && p.routes.some(same));
  const banner = port === 22 && BANNERS[address] || null;
  return { address, port, reachable: Boolean(banner), banner, os: banner ? (banner.includes("Windows") ? "windows" : "linux") : null,
    alreadyAs: target?.label || request?.label || null, alreadyTargetId: target?.id || null, alreadyRequestId: request?.requestId || null };
}
/* Backup files are base64 JSON: the passphrase and a copy of the fleet. The real format is tested in Rust. */
const FLEET_KEYS = ["targets", "folders", "folderMembers", "datacenters", "datacenterMembers", "merges", "masters", "relays"];
const isEmpty = () => !s.targets.length && !s.merges.length && !s.folders.length;
function makeBackup(passphrase) {
  if ([...String(passphrase || "")].length < 12) throw new Error("E_BACKUP_PASSPHRASE_SHORT: the passphrase must be at least 12 characters");
  const fleet = Object.fromEntries(FLEET_KEYS.map(key => [key, structuredClone(s[key])]));
  return Buffer.from(JSON.stringify({ fixtureBackup: 1, formatVersion: 1, passphrase, createdAt: now(), fleet })).toString("base64");
}
function openBackup(file, passphrase) {
  let backup;
  try { backup = JSON.parse(Buffer.from(String(file), "base64").toString("utf8")); } catch { backup = null; }
  if (!backup?.fixtureBackup) throw new Error("E_BACKUP_NOT_A_BACKUP: this file is not an SSH Control Center backup");
  if (backup.formatVersion > 1) throw new Error("E_BACKUP_NEWER: this backup comes from a newer Master (format " + backup.formatVersion + "); update this Master first");
  if (backup.damaged || backup.passphrase !== passphrase) throw new Error("E_BACKUP_BAD_PASSPHRASE_OR_DAMAGED: the passphrase is wrong or the file is damaged");
  return backup;
}
const backupSummary = b => ({ formatVersion: 1, createdAt: b.createdAt, nodeId: "fixture", label: MASTER_LABEL, os: "linux", hosts: b.fleet.targets.length, merges: b.fleet.merges.length, folders: b.fleet.folders.length });
function restoreBackup({ file, passphrase }) {
  if (!isEmpty()) throw new Error("E_RESTORE_NOT_EMPTY: this Master already has hosts; restore only works on a fresh install");
  const backup = openBackup(file, passphrase);
  Object.assign(s, structuredClone(backup.fleet));
  s.backup = { lastBackupAt: backup.createdAt, restoredAt: now() };
  // As the Master does: two-way Merges come back one-way, and the Masters that reach this one are listed.
  const twoWayAgain = s.merges.filter(m => m.reverse?.status === "two-way").map(m => ({ targetId: m.targetId, label: m.label }));
  for (const merge of s.merges) merge.reverse = null;
  const reached = new Map();
  for (const m of s.masters.filter(m => !m.revoked && m.id !== MASTER_ID)) reached.set(m.id, { masterId: m.id, label: m.label, ways: ["direct"] });
  for (const r of s.relays.filter(r => !r.revoked)) { const row = reached.get(r.masterId) || { masterId: r.masterId, label: r.label, ways: [] }; row.ways.push("merge"); reached.set(r.masterId, row); }
  return { ...backupSummary(backup), restartRequired: true, reachedBy: [...reached.values()], twoWayAgain, checkPaths: [] };
}
function rpc(method, p = {}) {
  switch (method) {
    case "system.status": return { label: "UI fixture (no real service)", nodeId: "fixture", roles: ["master", "target"], version: "test", uptimeSeconds: 120 };
    case "backup.status": return { ...s.backup, empty: isEmpty(), owner: true };
    case "backup.create": { const file = makeBackup(p.passphrase); s.backup.lastBackupAt = now(); return { file }; }
    case "backup.inspect": return backupSummary(openBackup(p.file, p.passphrase));
    case "backup.restore": return restoreBackup(p);
    case "targets.list": return [...s.targets, ...relayedTargets()];
    case "targets.doctor": return { targetId: p.targetId, ok: true, stages: [{ name: "fixture", ok: true, message: "Isolated UI test only" }] };
    case "targets.update": { const t = s.targets.find(row => row.id === p.target?.id); Object.assign(t, p.target); return t; }
    case "jobs.list": return s.jobs;
    case "jobs.start": {
      let job = s.jobs.find(row => row.id === p.jobId);
      if (!job) { job = { id: p.jobId, masterId: MASTER_ID, script: p.script, cwd: p.cwd, shell: p.shell, status: "running", createdAt: now(), startedAt: now(), exitCode: null }; s.jobs.unshift(job); }
      if (firstStart) { firstStart = false; const error = new Error("Simulated timeout AFTER acceptance. Retry same form."); error.status = 504; throw error; }
      return job;
    }
    case "jobs.status": return s.jobs.find(job => job.id === p.jobId);
    case "jobs.logs": { const log = p.stream === "stderr" ? "Fixture stderr\n" : "Fixture output <script>escaped</script>\n"; return { content: log.slice(p.offset || 0), nextOffset: log.length, eof: true }; }
    case "jobs.cancel": { const job = s.jobs.find(row => row.id === p.jobId); job.status = "cancelled"; return job; }
    case "files.list": return [{ name: "example.txt", path: "/tmp/example.txt", isDirectory: false, isSymlink: false, size: Buffer.byteLength(content) }];
    case "files.read": return { contentBase64: Buffer.from(content).toString("base64"), size: Buffer.byteLength(content), sha256: sha(), nextOffset: Buffer.byteLength(content), eof: true };
    case "files.write":
      if (p.expectedSha256 !== sha()) throw new Error("optimistic write precondition missing");
      content = Buffer.from(p.contentBase64, "base64").toString("utf8"); return { sha256: sha() };
    case "enrollment.export": return { schemaVersion: 2, ...p, master: { id: MASTER_ID, label: "Fixture", publicKey: "TEST PUBLIC KEY" } };
    case "fleet.health": return s.targets.map(healthRow);
    // Pairing (Master side). A request is "approved" when the test reads its code from GET /pairing-code.
    case "pairing.create": {
      const label = need(p.label, "label"), address = need(p.address, "address"), port = Number(p.port || 22);
      const targetId = p.targetId || slug(label) + "-" + crypto.randomBytes(2).toString("hex");
      const routes = p.routes || [{ kind: p.routeKind || "lan", address, port }];
      const make = os => ({ requestId: crypto.randomUUID(), targetId, label, tenant: p.tenant || "lab", os, user: p.user || "sshcc-bridge", routes, state: "awaiting_approval", createdAt: now(), updatedAt: now() });
      if (need(p.os, "os") !== "unknown") { const row = make(p.os); s.pairings.unshift(row); return pairingView(row); }
      // Unknown OS: a Windows and an Ubuntu request for the same host, linked as siblings.
      const pair = [make("windows"), make("linux")]; pair[0].sibling = pair[1].requestId; pair[1].sibling = pair[0].requestId;
      s.pairings.unshift(...pair); return pair.map(pairingView);
    }
    case "pairing.status":
      if (!p.requestId) return s.pairings.map(pairingView);
      if (p.routes) { const row = pairing(p.requestId), t = s.targets.find(item => item.id === row.targetId); if (t) t.routes = p.routes; row.routes = p.routes; row.state = "ready"; row.updatedAt = now(); }
      return pairingView(pairing(p.requestId));
    case "pairing.preview": return previewPairing(p);
    case "pairing.complete": return completePairing(p);
    case "pairing.check": return checkAddress(need(p.address, "address").trim(), Number(p.port || 22), p.requestId);
    case "pairing.cancel": { const row = pairing(need(p.requestId, "requestId")); s.pairings = s.pairings.filter(item => item !== row); return { requestId: row.requestId, cancelled: true }; }
    // Folders and datacenters (tree organisation only).
    case "folders.list": return { folders: s.folders, members: s.folderMembers };
    case "folders.create": { const folder = { id: crypto.randomUUID(), master: p.master || "local", name: need(p.name, "name") }; s.folders.push(folder); return folder; }
    case "folders.rename": { const folder = s.folders.find(row => row.id === p.id); folder.name = need(p.name, "name"); return { id: p.id, name: p.name }; }
    case "folders.delete": s.folders = s.folders.filter(row => row.id !== p.id); for (const [k, v] of Object.entries(s.folderMembers)) if (v === p.id) delete s.folderMembers[k]; return { id: p.id, deleted: true };
    case "folders.assign":
      if (p.folderId) { if (!s.folders.some(row => row.id === p.folderId)) throw new Error("E_ARGUMENT: unknown folder"); s.folderMembers[need(p.targetId, "targetId")] = p.folderId; }
      else delete s.folderMembers[p.targetId];
      return { targetId: p.targetId, folderId: p.folderId || null };
    case "datacenters.list": return { datacenters: s.datacenters, members: s.datacenterMembers };
    case "datacenters.create": { const site = { id: crypto.randomUUID(), name: need(p.name, "name") }; s.datacenters.push(site); return site; }
    case "datacenters.assign": if (p.datacenterId) s.datacenterMembers[p.master] = p.datacenterId; else delete s.datacenterMembers[p.master]; return { master: p.master, datacenterId: p.datacenterId || null };
    // Merges (this Master controls another Master's hosts) and relays (other Masters that merged this one).
    case "merges.list": return s.merges;
    case "merges.discover": return s.targets.filter(t => !p.targetId || t.id === p.targetId).map(t => ({ targetId: t.id, label: t.label, isMaster: isMasterHost(t.id), version: "test" }));
    case "merges.add": case "merges.sync": return mergeAdd(need(p.targetId, "targetId"));
    case "merges.remove": s.merges = s.merges.filter(row => row.targetId !== p.targetId); return { targetId: p.targetId, removed: true };
    case "relays.list": return s.relays;
    case "relays.revoke": case "relays.allow": { const relay = s.relays.find(row => row.masterId === p.masterId); relay.revoked = method === "relays.revoke"; return relay; }
    // Allowed Masters (Masters that may control this host directly).
    case "masters.list": return s.masters;
    case "masters.revoke": { const master = s.masters.find(row => row.id === p.masterId); master.revoked = true; return master; }
    case "enrollment.accept": { const master = { id: need(p.bundle?.master?.id, "bundle.master.id"), label: p.bundle.master.label || p.bundle.master.id, publicKey: p.bundle.master.publicKey || "TEST", revoked: false }; s.masters = s.masters.filter(row => row.id !== master.id).concat(master); return master; }
    default: throw new Error("Unsupported fixture method: " + method);
  }
}
/** Native (Tauri) commands other than "rpc". */
function command(name, args) {
  if (name === "open_shell") return !args.ownerSessionId && process.env.SSHCC_FIXTURE_SINGLE_SESSION !== "1"
    ? { needsSession: true, sessions: [{ id: "3", account: "fixture-owner", state: "active" }, { id: "7", account: "fixture-owner", state: "online" }] }
    : { opened: true, pid: 999, targetId: args.targetId, ownerSessionId: args.ownerSessionId || "3" };
  if (name === "open_json" || name === "save_json") return null;
  // Stands in for the native save dialog: always "saves" to a fixed folder, never writes a file.
  // A sibling pair asks for a folder once and "writes" both installers there.
  if (name === "save_setup") {
    const row = pairing(need(args.requestId, "requestId")), folder = "/fixture/Downloads";
    const file = r => ({ path: folder + "/sshcc-client-" + r.targetId + "." + (r.os === "windows" ? "exe" : "deb"), sha256: "0".repeat(64), size: 1, requestId: r.requestId, os: r.os });
    if (!row.sibling) return file(row);
    const files = [row, pairing(row.sibling)].sort((a, b) => (a.os === "windows" ? -1 : 1) - (b.os === "windows" ? -1 : 1)).map(file);
    return { folder, paths: files.map(f => f.path), files };
  }
  // Two-way: the other Master enrolls this one and merges it back; it shows as a relay here.
  if (name === "merge_two_way") {
    const merge = s.merges.find(row => row.targetId === need(args.targetId, "targetId")), t = s.targets.find(row => row.id === args.targetId);
    merge.reverse = { status: "two-way", error: null };
    s.relays = s.relays.filter(row => row.masterId !== t.nodeId).concat({ masterId: t.nodeId, label: t.label, lastUsedAt: now(), revoked: false });
    return { status: "two-way", children: s.targets.length };
  }
  // Stands in for the native save dialog: "saves" to /fixture/Backups under the default name.
  if (name === "save_backup") {
    const file = rpc("backup.create", { passphrase: args.passphrase }).file, path = "/fixture/Backups/" + need(args.name, "name");
    savedBackup = { name: args.name, file }; return path;
  }
  // Stands in for the native open dialog: the last saved backup, or the kind asked for with POST /next-backup.
  if (name === "open_backup") {
    const kind = nextBackup; nextBackup = "";
    if (kind === "other") return { name: "notes.sshccbak", file: Buffer.from("not a backup").toString("base64") };
    // "good": a backup of this fixture's default fleet, passphrase "fixture passphrase".
    if (kind) { const base = JSON.parse(Buffer.from(makeBackup("fixture passphrase"), "base64").toString("utf8")); if (kind === "newer") base.formatVersion = 2; if (kind === "damaged") base.damaged = true; return { name: kind + ".sshccbak", file: Buffer.from(JSON.stringify(base)).toString("base64") }; }
    return savedBackup ? { ...savedBackup } : null;
  }
  if (name === "rpc") return rpc(args.method, args.params || {});
  throw new Error("Unsupported fixture command: " + name);
}
const bootstrap = 'window.__TAURI__={core:{invoke:async(command,args)=>{const r=await fetch("/rpc",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({command,args})});const data=await r.json();if(!r.ok)throw new Error(data.error);return data;}}};';
const json = (res, value) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(value === undefined ? null : value)); };
const body = async req => { let text = ""; for await (const chunk of req) text += chunk; return text ? JSON.parse(text) : {}; };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://fixture");
    if (url.pathname === "/calls") return json(res, calls);
    if (url.pathname === "/scenario" && req.method === "POST") { reset((await body(req)).flags || []); return json(res, { flags: [...flags] }); }
    if (url.pathname === "/next-backup" && req.method === "POST") { nextBackup = (await body(req)).kind || ""; return json(res, { kind: nextBackup }); }
    if (url.pathname === "/pairing-code") { const row = url.searchParams.get("requestId") ? pairing(url.searchParams.get("requestId")) : s.pairings.find(p => p.state === "awaiting_approval") || pairing(null); return json(res, { code: pairingCode(row.requestId, url.searchParams.get("master") === "other" ? "other-master" : MASTER_ID) }); }
    if (url.pathname === "/rpc" && req.method === "POST") {
      const { command: name, args = {} } = await body(req);
      calls.push({ command: name, ...args });
      return json(res, await command(name, args));
    }
    const files = { "/": "index.html", "/app.css": "app.css", "/app.js": "app.js", "/strings.js": "strings.js" };
    if (url.pathname === "/fixture.js") { res.setHeader("content-type", "application/javascript"); return res.end(bootstrap); }
    // Bundled fonts (Latin and the Thai faces), so screenshots show the real type.
    const font = /^\/fonts\/([a-z0-9-]+\.woff2)$/.exec(url.pathname);
    if (font && fs.existsSync(path.join(ui, "fonts", font[1]))) { res.setHeader("content-type", "font/woff2"); return res.end(fs.readFileSync(path.join(ui, "fonts", font[1]))); }
    const file = files[url.pathname]; if (!file) { res.statusCode = 404; return res.end(); }
    const types = { ".html": "text/html", ".css": "text/css", ".js": "application/javascript" };
    let page = fs.readFileSync(path.join(ui, file), "utf8");
    if (file === "index.html") page = page.replace('<script src="app.js"', '<script src="/fixture.js"></script><script src="app.js"');
    res.setHeader("content-type", types[path.extname(file)] + "; charset=utf-8"); res.end(page);
  } catch (error) { res.statusCode = error.status || 400; json(res, { error: error.message }); }
});
server.listen(Number(process.env.SSHCC_UI_TEST_PORT || 42197), "127.0.0.1", () => console.log("SSHCC isolated UI fixture: http://127.0.0.1:" + server.address().port));
