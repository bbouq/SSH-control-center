// Isolated browser fixture. Never connects to a service or a real SSH Target.
// Scenario flags (comma-separated, env SSHCC_FIXTURE_SCENARIO or POST /scenario {"flags":[…]}):
//   empty            start as a Master with no hosts, folders, Merges or relays
//   new-host-master  every host paired through the fixture is itself a Master (merges.discover/fleet.health say so)
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
let flags, s, content, firstStart;
/** All mutable fixture state; `reset` rebuilds it for a scenario. */
function reset(list) {
  flags = new Set(list.filter(Boolean)); calls.length = 0; content = "Example text\n"; firstStart = true;
  const empty = flags.has("empty");
  s = {
    targets: empty ? [] : [{ schemaVersion: 2, id: "ui-test", nodeId: "ui-test-node", label: "UI test target", tenant: "test-only", os: "linux", user: "sshcc-bridge", routes: [{ kind: "lan", address: "192.0.2.20", port: 22 }], hostKeys: ["ssh-ed25519 TEST-FIXTURE-ONLY"], bridgePath: "/usr/bin/sshcc", runnerInstalled: true }],
    jobs: [], pairings: [], folders: [], folderMembers: {}, datacenters: [], datacenterMembers: {}, merges: [], masters: empty ? [] : [{ id: MASTER_ID, label: MASTER_LABEL, publicKey: "TEST", revoked: false }], relays: [], masterHosts: new Set()
  };
}
reset((process.env.SSHCC_FIXTURE_SCENARIO || "").split(","));
const now = () => new Date().toISOString();
const sha = () => crypto.createHash("sha256").update(content).digest("hex");
const slug = text => String(text || "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "host";
const need = (value, name) => { if (value === undefined || value === null || value === "") throw new Error("E_ARGUMENT: missing " + name); return value; };
const pairingView = p => ({ requestId: p.requestId, targetId: p.targetId, label: p.label, tenant: p.tenant, os: p.os, state: p.state, createdAt: p.createdAt, updatedAt: p.updatedAt,
  envelope: { requestId: p.requestId, targetLabel: p.label, bundle: { targetId: p.targetId, tenant: p.tenant, os: p.os, user: p.user, routes: p.routes, master: { id: MASTER_ID, label: MASTER_LABEL } } }, diagnostics: p.diagnostics || null });
const pairing = id => s.pairings.find(p => p.requestId === id) || (() => { throw new Error("E_PAIRING_REQUEST: unknown setup request"); })();
const isMasterHost = id => s.masterHosts.has(id);
const children = id => [1, 2, 3].map(n => ({ id: id + "/child-" + n, label: "Child " + n + " of " + id, tenant: "lab", os: n === 1 ? "windows" : "linux", nodeId: crypto.randomUUID() }));
const healthRow = t => ({ targetId: t.id, online: true, checkedAt: now(), error: null, failures: 0, isMaster: isMasterHost(t.id), version: "test" });
/** The code the new host shows after Approve: `SSHCC1.fixture.<masterId>.<requestId>`. */
const pairingCode = (requestId, master = MASTER_ID) => "SSHCC1.fixture." + master + "." + requestId;
function completePairing({ code }) {
  const m = /^SSHCC1\.fixture\.([^.]+)\.([^.]+)$/.exec(String(need(code, "code")).trim());
  if (!m) throw new Error("E_PAIRING_CODE: damaged pairing code");
  if (m[1] !== MASTER_ID) throw new Error("E_PAIRING_MASTER: code belongs to another Master");
  const p = pairing(m[2]);
  const target = { schemaVersion: 2, id: p.targetId, nodeId: crypto.randomUUID(), label: p.label, tenant: p.tenant, os: p.os, user: p.user, routes: p.routes, hostKeys: ["ssh-ed25519 FIXTURE-" + p.targetId], bridgePath: p.os === "windows" ? "C:\\Program Files\\SSHCC\\sshcc.exe" : "/usr/bin/sshcc", runnerInstalled: true };
  s.targets = s.targets.filter(t => t.id !== p.targetId).concat(target);
  if (flags.has("new-host-master")) s.masterHosts.add(p.targetId);
  Object.assign(p, { state: "ready", updatedAt: now(), diagnostics: { targetId: p.targetId, ok: true, stages: [{ name: "fixture", ok: true, message: "Isolated UI test only" }] } });
  return pairingView(p);
}
function mergeAdd(targetId) {
  const t = s.targets.find(row => row.id === targetId) || (() => { throw new Error("E_TARGET: unknown target " + targetId); })();
  if (!isMasterHost(targetId)) throw new Error("E_MERGE: " + targetId + " is not a Master");
  const previous = s.merges.find(row => row.targetId === targetId);
  const merge = { targetId, label: t.label, status: "merged", error: null, syncedAt: now(), children: previous?.children || children(targetId), reverse: previous?.reverse || null };
  s.merges = s.merges.filter(row => row.targetId !== targetId).concat(merge);
  return merge;
}
function rpc(method, p = {}) {
  switch (method) {
    case "system.status": return { label: "UI fixture (no real service)", nodeId: "fixture", roles: ["master", "target"], version: "test", uptimeSeconds: 120 };
    case "targets.list": return s.targets;
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
      const row = { requestId: crypto.randomUUID(), targetId, label, tenant: p.tenant || "lab", os: need(p.os, "os"), user: p.user || "sshcc-bridge", routes, state: "awaiting_approval", createdAt: now(), updatedAt: now() };
      s.pairings.unshift(row); return pairingView(row);
    }
    case "pairing.status":
      if (!p.requestId) return s.pairings.map(pairingView);
      if (p.routes) { const row = pairing(p.requestId), t = s.targets.find(item => item.id === row.targetId); if (t) t.routes = p.routes; row.routes = p.routes; row.state = "ready"; row.updatedAt = now(); }
      return pairingView(pairing(p.requestId));
    case "pairing.complete": return completePairing(p);
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
  if (name === "save_setup") {
    const row = pairing(need(args.requestId, "requestId")), ext = row.os === "windows" ? "exe" : "deb";
    return { path: "/fixture/Downloads/sshcc-client-" + row.targetId + "." + ext, sha256: "0".repeat(64), size: 1, requestId: row.requestId, os: row.os };
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
    if (url.pathname === "/pairing-code") { const row = url.searchParams.get("requestId") ? pairing(url.searchParams.get("requestId")) : s.pairings.find(p => p.state === "awaiting_approval") || pairing(null); return json(res, { code: pairingCode(row.requestId, url.searchParams.get("master") === "other" ? "other-master" : MASTER_ID) }); }
    if (url.pathname === "/rpc" && req.method === "POST") {
      const { command: name, args = {} } = await body(req);
      calls.push({ command: name, ...args });
      return json(res, command(name, args));
    }
    const files = { "/": "index.html", "/app.css": "app.css", "/app.js": "app.js" };
    if (url.pathname === "/fixture.js") { res.setHeader("content-type", "application/javascript"); return res.end(bootstrap); }
    const file = files[url.pathname]; if (!file) { res.statusCode = 404; return res.end(); }
    const types = { ".html": "text/html", ".css": "text/css", ".js": "application/javascript" };
    let page = fs.readFileSync(path.join(ui, file), "utf8");
    if (file === "index.html") page = page.replace('<script src="app.js"', '<script src="/fixture.js"></script><script src="app.js"');
    res.setHeader("content-type", types[path.extname(file)] + "; charset=utf-8"); res.end(page);
  } catch (error) { res.statusCode = error.status || 400; json(res, { error: error.message }); }
});
server.listen(Number(process.env.SSHCC_UI_TEST_PORT || 42197), "127.0.0.1", () => console.log("SSHCC isolated UI fixture: http://127.0.0.1:" + server.address().port));
