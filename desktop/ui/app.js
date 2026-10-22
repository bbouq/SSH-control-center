const $ = (selector, parent = document) => parent.querySelector(selector);
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pretty = value => JSON.stringify(value, null, 2);
document.documentElement.dataset.theme = "dark";
const titles = { datacenter: "Inventory", fleet: "All hosts", enroll: "Add host", masters: "Masters", service: "Local service" };
const state = {
  page: "datacenter", targets: [], masters: [], service: null, serviceError: "", selected: null,
  tab: "overview", query: "", group: "", status: "", diagnostics: new Map(), jobs: [], jobsError: "",
  job: null, stream: "stdout", log: "", offset: 0, eof: true, polling: false, newJob: false,
  export: null, pendingJob: null, file: null, files: null, pairing: null, pairings: [], saved: new Map(), add: null,
  merges: [], relays: [], merging: new Set(), masterCheck: new Map(),
  view: localStorage.getItem("sshcc.fleetView") === "table" ? "table" : "graph",
  health: new Map(), healthError: "", healthLoading: false, healthAt: null, healthStarted: 0, flipped: new Set(), twoWay: new Map(),
  clientLinks: [], clientLinksError: "",
  // Datacenter: tree selection, collapsed branches and on-demand container data per machine ("local" = this Master).
  dc: { node: "dc", tab: "summary", query: "", collapsed: new Set(), seen: new Set(), filter: "running", adding: null, editing: null, ctView: "containers",
    monInterval: Number(localStorage.getItem("sshcc.monitorInterval")) || 5000, monPaused: false },
  monitor: new Map(),
  containers: new Map(), ctLogs: null, folders: { folders: [], members: {} }, datacenters: { datacenters: [], members: {} }
};
addReset();
const native = (command, args = {}) => {
  if (!window.__TAURI__?.core?.invoke) throw new Error("Open the SSH Control Center app to connect to the local service");
  return window.__TAURI__.core.invoke(command, args);
};
const rpc = (method, params = {}) => native("rpc", { method, params });
const target = () => state.targets.find(item => item.id === state.selected);
const isWindows = item => /win/i.test(item?.os || "");
const osName = os => ({ windows: "Windows", linux: "Linux" })[os] || os || "";
const timestamp = value => {
  if (!value) return "—";
  const date = new Date(typeof value === "number" ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });
};
const formatSize = bytes => {
  if (bytes == null || Number.isNaN(Number(bytes))) return "—";
  let value = Number(bytes), unit = 0;
  const units = ["B", "KB", "MB", "GB", "TB"];
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return (unit && value < 10 ? value.toFixed(1) : Math.round(value)) + " " + units[unit];
};
const formatUptime = seconds => {
  const minutes = Math.floor((seconds || 0) / 60), hours = Math.floor(minutes / 60), days = Math.floor(hours / 24);
  if (days) return days + "d " + (hours % 24) + "h";
  if (hours) return hours + "h " + (minutes % 60) + "m";
  return minutes + "m";
};
const svg = paths => '<svg class="i" viewBox="0 0 16 16" aria-hidden="true">' + paths + "</svg>";
const icons = {
  graph: svg('<circle cx="3.5" cy="8" r="2"/><circle cx="12.5" cy="3.5" r="2"/><circle cx="12.5" cy="12.5" r="2"/><path d="M5.5 8h2.5M8 3.5v9M8 3.5h2.5M8 12.5h2.5"/>'),
  table: svg('<rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5"/><path d="M1.75 6.25h12.5M1.75 9.75h12.5M6 6.25v7"/>'),
  shell: svg('<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M4.5 6.5 6.5 8.25 4.5 10M8 10.25h3.5"/>'),
  both: svg('<path d="M2.5 5.5h10M10 3l2.5 2.5L10 8M13.5 10.5h-10M6 8l-2.5 2.5L6 13"/>'),
  one: svg('<path d="M2.5 8h10M10 5.5 12.5 8 10 10.5"/>'),
  plus: svg('<path d="M8 3v10M3 8h10"/>'),
  search: svg('<circle cx="7" cy="7" r="4.25"/><path d="m10.25 10.25 3.25 3.25"/>'),
  refresh: svg('<path d="M13.25 8A5.25 5.25 0 1 1 11.7 4.3"/><path d="M13.25 2.25v3.5h-3.5"/>'),
  back: svg('<path d="M13 8H3.5M7.5 4 3.5 8l4 4"/>'),
  more: svg('<circle cx="8" cy="3.5" r="1.1"/><circle cx="8" cy="8" r="1.1"/><circle cx="8" cy="12.5" r="1.1"/>'),
  up: svg('<path d="M8 13V3.5M4 7.5l4-4 4 4"/>'),
  chevron: svg('<path d="m6 3.5 4.5 4.5L6 12.5"/>'),
  folder: svg('<path d="M1.75 4.25c0-.7.55-1.25 1.25-1.25h3l1.5 1.75H13c.7 0 1.25.55 1.25 1.25v6c0 .7-.55 1.25-1.25 1.25H3c-.7 0-1.25-.55-1.25-1.25Z"/>'),
  file: svg('<path d="M4 1.75h5l3.25 3.25v8c0 .7-.55 1.25-1.25 1.25H4c-.7 0-1.25-.55-1.25-1.25V3c0-.7.55-1.25 1.25-1.25Z"/><path d="M9 1.75V5h3.25"/>'),
  copy: svg('<rect x="5.25" y="5.25" width="8.5" height="8.5" rx="1.5"/><path d="M10.75 5.25V3.5c0-.7-.55-1.25-1.25-1.25H3.5c-.7 0-1.25.55-1.25 1.25v6c0 .7.55 1.25 1.25 1.25h1.75"/>'),
  check: svg('<path d="m3.25 8.25 3 3 6.5-6.5"/>'),
  alert: svg('<path d="M8 2 1.5 13.5h13Z"/><path d="M8 6.5v3.25M8 11.75h.01"/>'),
  info: svg('<circle cx="8" cy="8" r="6.25"/><path d="M8 7.25v4M8 4.75h.01"/>'),
  pulse: svg('<path d="M1.5 8.5h3l1.75-4.5 3.5 8 1.75-3.5h3"/>'),
  close: svg('<path d="m4 4 8 8M12 4l-8 8"/>')
};
const chip = text => '<span class="chip">' + esc(text) + "</span>";
function notify(message, error = false) {
  const notice = $("#notice");
  $("#notice-text").textContent = String(message); notice.classList.toggle("error", error); notice.hidden = false;
}
function clearNotice() { $("#notice").hidden = true; }
async function copyText(text, message = "Copied") {
  try { await navigator.clipboard.writeText(String(text ?? "")); }
  catch { throw new Error("Could not copy. Select the text and press Ctrl+C"); }
  notify(message);
}
async function openShell(targetId, ownerSessionId) {
  const item = state.targets.find(row => row.id === targetId);
  if (!item) throw new Error("This target host is not in the registry");
  const result = await native("open_shell", { targetId, ownerSessionId: ownerSessionId || null });
  if (result.needsSession) {
    $("#shell-machine").textContent = item.label || item.id;
    $("#shell-target").value = item.id;
    $("#shell-session").innerHTML = '<option value="">Choose a session</option>' + result.sessions.map(session => '<option value="' + esc(session.id) + '">' + esc(session.account) + ' · session ' + esc(session.id) + ' · ' + esc(session.state) + '</option>').join("");
    $("#shell-dialog").showModal();
    return;
  }
  notify("Opened a terminal for " + (item.label || item.id) + " in a Terminal window");
}
const jobLabels = { succeeded: "Succeeded", failed: "Failed", interrupted: "Interrupted", cancelled: "Cancelled", running: "Running", queued: "Queued" };
function badge(status) {
  const styles = { succeeded: "good", failed: "bad", interrupted: "bad", cancelled: "", running: "running", queued: "pending" };
  return '<span class="badge ' + (styles[status] || "") + '" title="' + esc(status) + '">' + esc(jobLabels[status] || status) + "</span>";
}
async function busy(button, work) {
  if (button?.disabled) return;
  if (button) button.disabled = true;
  clearNotice();
  try { return await work(); }
  catch (error) { notify(state.page === "enroll" || state.dc.adding ? pairingError(error) : friendlyError(error), true); }
  finally { if (button?.isConnected) button.disabled = false; }
}
function renderHeader() {
  $("#fleet-count").textContent = String(hostCount());
  // Always say which Master this window operates from; merged Masters are reached through it.
  $("#service-label").textContent = state.service ? state.service.label : "Service unavailable";
  if (state.service?.version && $("#app-version")) $("#app-version").textContent = "v" + state.service.version;
  $("#service-dot").className = "dot " + (state.service ? "good" : "bad");
  $("#dc-tree").hidden = state.dc.treeHidden === true;
  $(".tree-toggle").setAttribute("aria-expanded", String(state.dc.treeHidden !== true));
  document.querySelectorAll("[data-page]").forEach(button => {
    const active = button.dataset.page === state.page;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
  });
}
async function refreshLocal() {
  try { state.service = await rpc("system.status"); state.serviceError = ""; }
  catch (error) { state.service = null; state.serviceError = String(error); }
  try {
    const links = await native("client_links");
    state.clientLinks = Array.isArray(links) ? links : [];
    state.clientLinksError = "";
  } catch (error) {
    state.clientLinks = [];
    state.clientLinksError = String(error?.message || error);
  }
  renderHeader();
}
async function refreshFleet() {
  const [rows, merges, relays, folders, datacenters] = await Promise.all([
    rpc("targets.list"), rpc("merges.list").catch(() => []), rpc("relays.list").catch(() => []), rpc("folders.list").catch(() => null), rpc("datacenters.list").catch(() => null)
  ]);
  if (folders) state.folders = folders;
  if (datacenters) state.datacenters = datacenters;
  if (!Array.isArray(rows)) throw new Error("The service returned Targets in an unsupported format");
  state.targets = rows; state.merges = merges; state.relays = relays;
  if (state.selected && !target()) state.selected = null;
  renderHeader();
}
async function refreshMasters() {
  [state.masters, state.relays, state.merges] = await Promise.all([
    rpc("masters.list"), rpc("relays.list").catch(() => []), rpc("merges.list").catch(() => [])
  ]);
}
const HEALTH_INTERVAL = 60000;
async function refreshHealth(refresh = false) {
  if (state.healthLoading) return;
  state.healthLoading = true; state.healthStarted = Date.now();
  try {
    const rows = await rpc("fleet.health", { refresh });
    state.flipped = new Set(rows.filter(row => state.health.has(row.targetId) && state.health.get(row.targetId).online !== row.online).map(row => row.targetId));
    state.health = new Map(rows.map(row => [row.targetId, row]));
    state.healthError = ""; state.healthAt = new Date();
  } catch (error) { state.healthError = String(error?.message || error); }
  finally { state.healthLoading = false; }
  if ($("#fleet-table")) $("#fleet-table").innerHTML = renderFleetView();
  // Re-render only read-only summaries; a machine page may hold an open form.
  $("#dc-tree").innerHTML = renderDcTree();
  // The Masters page lists hosts whose health says they are Masters.
  if (state.page === "masters") $("#main").innerHTML = renderMasters();
  if (state.page === "datacenter" && state.dc.tab === "summary" && state.dc.node !== "dc" && !holdsForm() && !state.dc.adding) $("#dc-panel").innerHTML = renderDcPanel();
  if ($("#inv-summary")) $("#inv-summary").outerHTML = renderSummaryLine();
}
function refreshHealthIfDue() {
  const showsHealth = state.page === "datacenter";
  if (!showsHealth || document.hidden || !document.hasFocus()) return;
  if (Date.now() - state.healthStarted >= HEALTH_INTERVAL - 1000) void refreshHealth();
}
async function navigate(page) {
  state.page = page; clearNotice(); render();
  if (page === "datacenter") {
    try { await refreshFleet(); if (state.page === page) render(); } catch (error) { notify(error, true); }
    void refreshHealth();
    void loadContainersIfShown(); void loadFilesIfShown();
  }
  if (page === "masters") {
    try { await refreshMasters(); if (state.page === page) render(); } catch (error) { notify(error, true); }
    if (!state.health.size) void refreshHealth();
  }
  if (page === "service") { await refreshLocal(); if (state.page === page) render(); }
  if (page === "enroll") { try { await refreshPairings(); if (state.page === page) render(); } catch (error) { notify(pairingError(error), true); } }
}
function render() {
  renderHeader();
  const main = $("#main");
  $("#dc-tree").innerHTML = renderDcTree();
  if (state.page === "datacenter") main.innerHTML = '<section class="dc-main" id="dc-panel">' + renderDcPanel() + "</section>";
  if (state.page === "enroll") main.innerHTML = renderAddHost();
  if (state.page === "masters") main.innerHTML = renderMasters();
  if (state.page === "service") main.innerHTML = renderService();
  if (state.page === "enroll" || state.dc.adding) focusAddStep();
}
function heading(title, description, actions = "") {
  return '<div class="page-heading"><div><h1>' + esc(title) + "</h1>" + (description ? "<p>" + esc(description) + "</p>" : "") + "</div>" + (actions ? '<div class="page-actions">' + actions + "</div>" : "") + "</div>";
}
function renderFleetTools() {
  return '<div id="fleet-table">' + renderFleetView() + "</div>" +
    '<details class="fleet-hint"><summary>How online status is checked</summary><div><ul><li>The SSH port is probed every minute while this window is open</li><li>Refresh runs a full check over SSH</li><li>Use “Check connection” on a host for a detailed check</li><li>Up to 50 Targets per Master</li></ul></div></details>';
}
function renderFleetView() {
  if (!state.targets.length) return renderFleetRows();
  return renderGraph();
}
const stateLabels = { online: "Online", offline: "Offline", checking: "Checking…", unknown: "Unknown", legacy: "Service not installed" };
const stateStyles = { online: "good", offline: "bad", checking: "pending", legacy: "pending" };
function nodeState(item) {
  if (item.runnerInstalled === false) return "legacy";
  const row = state.health.get(item.id);
  if (!row) return state.healthError ? "unknown" : "checking";
  return row.online === true ? "online" : row.online === false ? "offline" : "unknown";
}
const HOT = 85;
/** Every host this window can open: the current Master plus every Target (merged Masters included). */
const hostCount = () => state.targets.length + 1;
const hostsOnline = () => state.targets.filter(item => nodeState(item) === "online").length + (state.service ? 1 : 0);
function hostRole(item) {
  if (!item) return "Master · current";
  if (state.merges.some(merge => merge.targetId === item.id)) return "Master · merged";
  return state.masterCheck.get(item.id) || state.health.get(item.id)?.isMaster ? "Master" : "Target host";
}
/** Every host page — target host or Master — has the same tabs. */
const HOST_PAGE_TABS = [["summary", "Summary"], ["jobs", "Jobs & logs"], ["files", "Files"], ["containers", "Containers"], ["monitoring", "Monitoring"]];
/** This Master registered as a target host of itself (needed for its own jobs, files and terminal). */
const selfTarget = () => state.service ? state.targets.find(item => !item.relayed && item.nodeId === state.service.nodeId) : null;
/** The target host behind the open page: the host itself, a merged Master, or this Master's self registration. */
function pageTarget() {
  const node = state.dc.node || "";
  if (node.startsWith("node:")) return state.targets.find(item => item.id === node.slice(5)) || null;
  if (node === "master:local") return selfTarget() || null;
  if (node.startsWith("master:")) return state.targets.find(item => item.id === node.slice(7)) || null;
  return null;
}
function resetHostState(id) {
  state.selected = id || null; state.job = null; state.jobs = []; state.jobsError = "";
  state.files = null; state.filesError = ""; state.file = null; state.pendingJob = null; state.newJob = false;
}
/** Pages whose open form or editor must not be redrawn by background refreshes. */
const holdsForm = () => state.dc.node.startsWith("node:") || ["jobs", "files"].includes(state.dc.tab);
function sampledMem(id) {
  const samples = state.monitor.get(id)?.samples;
  return samples?.length > 1 ? monitorSeries(samples.slice(-2))[0]?.memory ?? null : null;
}
const memCell = item => { const mem = sampledMem(item.id); return mem == null ? '<span class="muted">—</span>' : '<span class="num">' + Math.round(mem) + "%</span>"; };
function hostSite(item) {
  if (!item) return siteOf("local")?.name || "—";
  if (state.merges.some(merge => merge.targetId === item.id)) return siteOf(item.id)?.name || "—";
  return siteOf(item.relayed ? item.id.split("/")[0] : "local")?.name || "—";
}
function hostAddress(item) {
  const route = item.routes?.[0];
  return item.relayed ? '<span class="muted">Via ' + esc(item.viaLabel || item.via) + "</span>"
    : route ? '<code title="' + esc(route.kind || "") + '">' + esc(route.address) + (route.port && route.port !== 22 ? ":" + esc(route.port) : "") + "</code>" : "—";
}
const terminalButton = item => item ? '<button class="small" data-action="open-shell" data-id="' + esc(item.id) + '" aria-label="Open terminal on ' + esc(item.label || item.id) + '"' + (!item.runnerInstalled ? ' disabled title="Install the Target service first"' : ' title="Open terminal"') + ">" + icons.shell + '<span class="btn-label">Open terminal</span></button>' : "";
const HOST_HEAD = "<thead><tr><th>Host</th><th>Role</th><th>Address</th><th>CPU</th><th>MEM</th><th>Status</th><th></th></tr></thead>";
/** One row per host; only the name links to its page. */
function hostRow(item) {
  if (!item) return '<tr data-host="local"><td><button class="row-button" data-action="dc-select" data-node="master:local">' + esc(state.service?.label || "This Master") + "</button><small>this window</small></td><td>Master · current</td>" +
    '<td><span class="muted">—</span></td><td>' + cpuCell({ id: "local" }) + "</td><td>" + memCell({ id: "local" }) + "</td><td>" + localStatus() + '</td><td class="actions">' + terminalButton(selfTarget()) + "</td></tr>";
  const check = state.diagnostics.get(item.id);
  const status = !item.runnerInstalled ? '<span class="badge pending">Service not installed</span>' : check ? '<span class="badge ' + (check.ok ? "good" : "bad") + '">' + (check.ok ? "Connected" : "Problem found") + "</span><small>Checked " + esc(timestamp(check.checkedAt)) + "</small>" : statusBadge(item);
  return '<tr data-host="' + esc(item.id) + '"><td><button class="row-button" data-action="dc-select" data-node="node:' + esc(item.id) + '">' + esc(item.label || item.id) + "</button><small>" + esc(osName(item.os)) + "</small></td><td>" + esc(hostRole(item)) + "</td><td>" + hostAddress(item) + "</td><td>" + cpuCell(item) + "</td><td>" + memCell(item) + "</td><td>" + status + '</td><td class="actions">' + terminalButton(item) + "</td></tr>";
}
const localStatus = () => '<span class="badge ' + (state.service ? "good" : "bad") + '">' + (state.service ? "Online" : "Unavailable") + "</span>";
/** Latest CPU % from the Monitoring tab's own samples, or null when the machine was never watched. */
function sampledCpu(id) {
  const samples = state.monitor.get(id)?.samples;
  return samples?.length > 1 ? monitorSeries(samples.slice(-2))[0]?.cpu ?? null : null;
}
const isHot = item => nodeState(item) === "online" && (sampledCpu(item.id) ?? 0) >= HOT;
const cpuCell = item => { const cpu = sampledCpu(item.id); return cpu == null ? '<span class="muted">—</span>' : '<span class="num' + (cpu >= HOT ? " hot-text" : "") + '">' + Math.round(cpu) + "%</span>"; };
const statusBucket = item => ({ online: "online", offline: "offline" })[nodeState(item)] || "other";
function statusBadge(item) {
  const status = nodeState(item), error = state.health.get(item.id)?.error;
  if (isHot(item)) return '<span class="badge hot" title="CPU ' + Math.round(sampledCpu(item.id)) + '% in the last Monitoring sample">High load</span>';
  return '<span class="badge ' + (stateStyles[status] || "") + '"' + (error ? ' title="' + esc(error) + '"' : "") + ">" + esc(stateLabels[status]) + "</span>";
}
function renderStatusBar() {
  const pool = state.targets.filter(item => matchesFilter(item, true));
  const count = bucket => pool.filter(item => statusBucket(item) === bucket).length;
  // The current Master is listed too (first row) whenever no search or tenant filter hides it.
  const local = !state.query && state.service ? 1 : 0;
  const filters = [["", "All", pool.length + local, ""], ["online", "Online", count("online") + local, "good"], ["offline", "Offline", count("offline"), "bad"], ["other", "Unknown", count("other"), "pending"]]
    .filter(([id, , total]) => id !== "other" || total || state.status === "other");
  const meta = state.healthError
    ? '<span class="status-meta error" title="' + esc(state.healthError) + '">' + icons.alert + "Status check failed (hover for the reason)</span>"
    : '<span class="status-meta">' + (state.healthAt ? "Last checked " + esc(timestamp(state.healthAt)) : "Checking every host…") + "</span>";
  return '<div class="status-bar"><div class="status-filters" role="group" aria-label="Filter by status">' +
    filters.map(([id, label, total, dot]) => '<button class="status-filter" data-action="status-filter" data-status="' + id + '" aria-pressed="' + (state.status === id) + '">' + (dot ? '<span class="dot ' + dot + '"></span>' : "") + label + " <strong>" + total + "</strong></button>").join("") +
    "</div>" + meta + "</div>";
}
function pcIcon(master) {
  const monitor = '<rect class="pc-body" x="2" y="4" width="44" height="30" rx="3"/><rect class="pc-screen" x="5" y="7" width="38" height="24" rx="1.5"/>' +
    '<path class="pc-glare" d="M9 29 27 9h7L16 29Z"/><rect class="pc-line" x="9" y="12" width="13" height="2.5" rx="1"/><rect class="pc-line pc-type" x="9" y="18" width="22" height="2.5" rx="1"/>' +
    '<rect class="pc-cursor" x="9" y="24" width="4" height="2.5" rx=".5"/><path class="pc-stand" d="M20 34h8l1.5 6h-11ZM14 40h20a1.5 1.5 0 0 1 0 3H14a1.5 1.5 0 0 1 0-3Z"/>';
  const tower = '<rect class="pc-body" x="50" y="7" width="12" height="36" rx="2"/><rect class="pc-bay" x="52.5" y="11" width="7" height="2" rx=".5"/><rect class="pc-bay" x="52.5" y="15" width="7" height="2" rx=".5"/><circle class="pc-led" cx="56" cy="37" r="1.6"/>';
  return '<svg class="pc" viewBox="0 0 64 46" aria-hidden="true">' + (master ? monitor + tower : '<g transform="translate(7 0)">' + monitor + "</g>") + "</svg>";
}
function graphNode(item, options = {}) {
  const status = options.status || nodeState(item), row = state.health.get(item.id), name = item.label || item.id, route = item.routes?.[0];
  const hint = status === "offline" || status === "unknown" ? row?.error || "" : status === "online" && row?.checkedAt ? "Checked " + timestamp(row.checkedAt) : "";
  const sub = options.sub || [osName(item.os), !item.relayed && route?.address ? route.address : ""].filter(Boolean).join(" · ");
  const main = pcIcon(options.master) + '<span class="node-info"><span class="node-label">' + esc(name) +
    (options.alsoDirect ? ' <span class="node-tag">Also direct</span>' : "") + '</span><span class="node-sub">' + esc(sub) + "</span>" +
    '<span class="node-state"><span class="dot"></span>' + esc(stateLabels[status]) + "</span></span>";
  return '<div class="node is-' + status + (options.master ? " is-master" : "") + (options.root ? " is-root" : "") + (state.flipped.has(item.id) ? " just-changed" : "") + '">' +
    (options.static ? '<div class="node-main">' + main + "</div>" : '<button class="node-main" data-action="select-target" data-id="' + esc(item.id) + '"' + (hint ? ' title="' + esc(hint) + '"' : "") + ">" + main + "</button>") +
    (options.static || item.runnerInstalled === false ? "" : '<button class="node-shell" data-action="open-shell" data-id="' + esc(item.id) + '" aria-label="Open terminal on ' + esc(name) + '" title="Open terminal">' + icons.shell + "</button>") + "</div>";
}
function matchesFilter(item, ignoreStatus = false) {
  const search = state.query.toLowerCase();
  return (ignoreStatus || !state.status || statusBucket(item) === state.status) &&
    [item.id, item.label, item.tenant, item.viaLabel, ...(item.routes || []).map(route => route.address)].some(value => String(value || "").toLowerCase().includes(search));
}
function isTwoWay(merge) {
  const peer = state.targets.find(item => item.id === merge?.targetId);
  return merge?.reverse?.status === "two-way" && state.relays.some(relay => relay.masterId === peer?.nodeId && !relay.revoked);
}
const noMatch = '<div class="empty"><h2>No matching hosts</h2><p>Try another name or IP, or clear the status filter</p><button data-action="clear-filter">Clear filters</button></div>';
/* Topology: columns are hops from this window. Solid lines are SSH from this Master; dashed lines are
   requests relayed through a merged Master. Nodes open the machine (or Master) page. */
/** Topology, top-down: this Master on top, then one group for hosts it reaches directly and one per merged Master. */
function renderGraph() {
  const masters = dcModel(), local = masters[0], peers = masters.slice(1), peerIds = new Set(peers.map(master => master.id));
  const online = entries => entries.filter(entry => nodeState(entry.item) === "online").length;
  const card = (item, options = {}) => {
    const status = item ? nodeState(item) : state.service ? "online" : "offline", name = item ? item.label || item.id : local.label;
    const sub = item ? [options.role, osName(item.os), item.relayed ? "" : item.routes?.[0]?.address].filter(Boolean) : ["This window · current Master"];
    return '<div class="topo-card is-' + status + (options.wide ? " is-wide" : "") + (item && state.flipped.has(item.id) ? " just-changed" : "") + '" data-host="' + esc(item ? item.id : "local") + '">' +
      '<span class="topo-dot" aria-hidden="true"></span><div class="topo-text"><button class="row-button" data-action="dc-select" data-node="' + (item ? "node:" + esc(item.id) : "master:local") + '">' + esc(name) + "</button>" +
      "<small>" + esc(sub.join(" · ")) + '</small><span class="topo-status">' + esc(stateLabels[status] || status) + (options.alsoDirect ? " · also direct" : "") + "</span></div>" +
      (item ? terminalButton(item) : "") + "</div>";
  };
  const group = (title, entries, extra = "", head = "") => '<section class="topo-group"><header><h3>' + title + '</h3><span class="topo-meta">' + online(entries) + "/" + entries.length + " online" + extra + "</span></header>" +
    head + (entries.length ? '<div class="topo-cards">' + entries.map(entry => card(entry.item, { alsoDirect: entry.alsoDirect })).join("") + "</div>" : '<p class="help">No hosts match</p>') + "</section>";
  const direct = local.machines.filter(entry => !peerIds.has(entry.item.id) && matchesFilter(entry.item));
  const groups = [group("Direct from " + esc(local.label), direct)];
  for (const peer of peers) {
    const children = peer.machines.filter(entry => matchesFilter(entry.item));
    groups.push(group("Through " + esc(peer.label), children, " · " + (peer.twoWay ? "two-way" : "one-way") + ' <button class="text-button" data-page="masters">Manage merge</button>',
      '<div class="topo-cards is-head' + (online(children) ? " is-live" : "") + '">' + card(peer.item, { role: "Master · " + peer.machines.length + " target hosts", wide: true }) + "</div>"));
  }
  if (!direct.length && !peers.length) return '<div class="empty"><h2>No hosts to draw</h2><p>Add a target host, or clear the filters</p></div>';
  const live = state.service ? "is-live" : "", peerOnline = peers.some(peer => online(peer.machines));
  return '<div class="topo-tree"><div class="topo-root">' + card(null) + '</div><span class="topo-stem ' + live + '" aria-hidden="true"></span>' +
    '<span class="topo-bus" aria-hidden="true"><i class="to-left' + (live && online(direct) ? " is-live" : "") + '"></i><i class="to-right' + (live && peerOnline ? " is-live" : "") + '"></i></span>' +
    '<div class="topo-groups">' + groups.join("") + "</div></div>";
}
function renderFleetRows() {
  const rows = state.targets.filter(item => matchesFilter(item));
  if (!state.targets.length && !state.service) return '<div class="empty"><h2>Connect your first target host</h2><p>Use “+ Add host” at the top right</p></div>';
  const showLocal = !state.query && (!state.status || state.status === "online");
  if (!rows.length && !showLocal) return noMatch;
  return '<div class="table-wrap"><table>' + HOST_HEAD + "<tbody>" + (showLocal ? hostRow(null) : "") + rows.map(hostRow).join("") + "</tbody></table></div>";
}
function stat(label, value, sub = "") {
  return '<div class="stat"><span class="stat-label">' + esc(label) + '</span><div class="stat-value">' + value + "</div>" + (sub ? "<small>" + esc(sub) + "</small>" : "") + "</div>";
}
const routeKinds = { lan: "LAN", tailscale: "Tailscale", public: "Public IP" };
function healthStat(item) {
  const row = state.health.get(item.id), status = nodeState(item);
  return stat("Last status", '<span class="dot ' + (stateStyles[status] || "") + '"></span>' + esc(stateLabels[status]), row?.checkedAt ? "Checked " + timestamp(row.checkedAt) : "");
}
function renderOverview(item) {
  if (item.relayed) {
    return '<div class="stat-grid">' + stat("Connected via Master", esc(item.viaLabel || item.via)) + stat("Permissions", "Uses that Master’s rights") + healthStat(item) + "</div>" +
      '<div class="disclosure-list"><details><summary>Technical details <small class="muted">Master ID, Node ID</small></summary><div><dl class="facts"><dt>Master ID</dt><dd><code>' + esc(item.via) + "</code></dd><dt>Node ID</dt><dd><code>" + esc(item.nodeId) + '</code></dd></dl><p class="help mt">Commands go through that Master. Change routes or remove this target host on Master ' + esc(item.viaLabel || item.via) + " · Remove the merge on the Masters page</p></div></details></div>";
  }
  const routes = item.routes || [], primary = routes[0];
  return '<div class="stat-grid">' +
    stat("Primary address", primary ? "<code>" + esc(primary.address) + ":" + esc(primary.port || 22) + "</code>" : "—", primary ? (primary.proxyJump ? "Via " + primary.proxyJump.address : routeKinds[primary.kind] || primary.kind || "") : "") +
    stat("Fallback routes", routes.length > 1 ? String(routes.length - 1) : "None") +
    healthStat(item) +
    stat("Target service", item.runnerInstalled ? '<span class="dot good"></span>Installed' : '<span class="dot pending"></span>Not installed') +
    "</div>" +
    '<div class="disclosure-list">' +
    '<details><summary>Technical details <small class="muted">Node ID, SSH user, all routes, host keys</small></summary><div><dl class="facts"><dt>Node ID</dt><dd><code>' + esc(item.nodeId || "Awaiting new registration") + "</code></dd><dt>SSH user</dt><dd>" + esc(item.user) + "</dd><dt>Bridge</dt><dd><code>" + esc(item.bridgePath || "—") + "</code></dd><dt>Target ID</dt><dd><code>" + esc(item.id) + "</code></dd></dl>" +
    '<div class="table-wrap mt"><table><thead><tr><th>Order</th><th>Type</th><th>Destination</th><th>Jump host</th></tr></thead><tbody>' +
    routes.map((route, i) => '<tr><td class="num">' + (i + 1) + "</td><td>" + esc(routeKinds[route.kind] || route.kind) + "</td><td><code>" + esc(route.address) + ":" + esc(route.port || 22) + "</code></td><td>" + (route.proxyJump?.address ? "<code>" + esc(route.proxyJump.address) + "</code>" : '<span class="muted">Direct</span>') + "</td></tr>").join("") +
    '</tbody></table></div><h3 class="mt">Pinned host keys</h3><div class="output light mt"><pre>' + esc((item.hostKeys || []).join("\n") || "—") + "</pre></div></div></details>" +
    '<details><summary>Edit name and routes</summary><form id="edit-target"><div class="form-grid"><label class="full">Host name<input name="label" required value="' + esc(item.label || item.id) + '"></label><label class="full">Routes JSON<textarea class="mono" name="routes" rows="7" required spellcheck="false">' + esc(pretty(routes)) + '</textarea><small>Routes are tried in order · ProxyJump needs hostKeys and identityFile</small></label></div><div class="form-actions"><button type="submit" class="primary">Save</button></div><p class="help">To change the tenant, remove the target host and enroll it again so it uses that tenant’s key</p></form></details>' +
    '<details><summary>Remove this target host from this Master</summary><div><p class="help">Only removes the record on this Master; jobs and data on the host stay. To revoke access, use the Masters page on that host</p><button class="danger" data-action="remove-target">Remove ' + esc(item.label || item.id) + "</button></div></details>" +
    "</div>";
}
/* Connection check result, shown right under the host heading on every tab: one clear verdict, then each step. */
const CHECK_STEPS = {
  "local-registration": "Registered on this Master",
  "local-key": "SSH key on this Master",
  "runner-installed": "Target service installed",
  "ssh-runner": "SSH to the host · host key and Target service",
  executor: "Ready to run jobs"
};
function renderCheckPanel(item) {
  const check = state.diagnostics.get(item.id), running = state.checking === item.id;
  if (!running && (!check || state.checkHidden?.has(item.id))) return "";
  const close = '<button class="icon-button" data-action="check-close" aria-label="Hide the check result" title="Hide">' + icons.close + "</button>";
  if (running) return '<section class="check-panel is-running" role="status" aria-live="polite"><span class="check-mark" aria-hidden="true">…</span><div class="check-head"><h2>Checking connection…</h2>' +
    "<p>Registration, SSH key, SSH to the host and the Target service · no job is started</p></div></section>";
  const stages = check.stages || [], passed = stages.filter(stage => stage.ok).length;
  const raw = stage => stage.message || (stage.executor ? (stage.executor.reason || "Not ready") : "");
  const where = stage => stage.route?.address ? stage.route.address + ":" + (stage.route.port || 22) : "the host";
  // Plain words for the failures people meet most; the original text stays underneath.
  const plain = stage => {
    const text = raw(stage);
    if (text === "TARGET_IDENTITY_MISMATCH" || /host key|REMOTE HOST IDENTIFICATION/i.test(text)) return "The host answered with a different identity than the one pinned at pairing. Don’t continue until you know why";
    if (/timed out|timeout/i.test(text)) return "No answer from " + where(stage) + " in time. Is the host on, and is SSH reachable from this Master?";
    if (/refused/i.test(text)) return where(stage) + " refused the connection. SSH may be stopped, or on another port";
    if (/could not resolve|Name or service not known|nodename nor servname/i.test(text)) return "The name " + (stage.route?.address || "of the host") + " could not be found. Check the address";
    if (/no route|unreachable/i.test(text)) return "This Master has no network path to " + where(stage);
    if (/permission denied|publickey/i.test(text)) return "The host rejected this Master’s SSH key. It may have been removed on the host";
    if (/E_OWNER_NOT_LOGGED_IN/.test(text)) return friendlyError(text);
    return "";
  };
  const why = stage => { const text = plain(stage), detail = raw(stage); return text ? esc(text) + (detail && detail !== text ? '<small class="check-detail">' + esc(detail) + "</small>" : "") : esc(detail); };
  const label = stage => (CHECK_STEPS[stage.name] || stage.name) + (stage.route?.address ? " (" + stage.route.address + ")" : "");
  const selected = check.result?.executor?.selected || stages.find(stage => stage.name === "executor")?.executor?.selected;
  const steps = stages.map(stage => '<li class="' + (stage.ok ? "is-ok" : "is-bad") + '"><span class="step-mark" aria-hidden="true">' + (stage.ok ? "✓" : "✕") + "</span><div><strong>" + esc(label(stage)) + "</strong>" +
    (stage.ok ? "" : "<p>" + why(stage) + "</p>") + "</div></li>").join("");
  return '<section class="check-panel ' + (check.ok ? "is-ok" : "is-bad") + '" role="status" aria-live="polite"><span class="check-mark" aria-hidden="true">' + (check.ok ? "✓" : "!") + "</span>" +
    '<div class="check-head"><h2>' + (check.ok ? "Connection OK" : "Connection problem") + "</h2><p>" + passed + " of " + stages.length + " checks passed · " + esc(timestamp(check.checkedAt)) +
    (selected?.ownerSessionId ? " · Owner session " + esc(selected.ownerSessionId) : "") + '</p></div><div class="check-actions"><button class="small" data-action="diagnose">' + icons.refresh + "Check again</button>" + close + "</div>" +
    '<ol class="check-steps">' + steps + "</ol>" +
    '<details class="check-raw"><summary>Raw result</summary><div><button class="small" data-action="copy-diagnostics">' + icons.copy + "Copy check JSON</button></div></details></section>";
}
function renderJobs(item) {
  const disabled = !item.runnerInstalled ? ' disabled title="Install the Target service first"' : "";
  return (state.newJob ? renderNewJob(item) : "") +
    '<section class="section"><div class="section-heading"><h2>Jobs on this host</h2><div class="page-actions">' +
    (state.newJob ? "" : '<button class="primary" data-action="toggle-new-job"' + disabled + ">" + icons.plus + "New job</button>") +
    '<button data-action="refresh-jobs">' + icons.refresh + 'Refresh</button></div></div><div class="job-layout"><div class="job-list" id="job-list">' + renderJobRows() + '</div><div class="job-detail" id="job-detail">' + renderJobDetail() + "</div></div></section>";
}
function renderNewJob(item) {
  const windows = isWindows(item);
  return '<form id="start-job" class="surface new-job"><h2>New job</h2><div class="form-grid">' +
    '<label class="full">Working directory<input name="cwd" required class="mono" placeholder="' + (windows ? "C:\\projects\\my-app" : "/srv/my-app") + '"></label>' +
    '<label class="full">Command or script<textarea name="script" required rows="6" class="mono" spellcheck="false" placeholder="' + (windows ? "Get-Location" : "pwd") + '"></textarea></label></div>' +
    '<details><summary>Advanced options</summary><div class="form-grid"><label>Shell<select name="shell"><option value="' + (windows ? "powershell" : "bash") + '">' + (windows ? "PowerShell" : "Bash") + "</option></select></label>" +
    '<label>Owner session ID<input name="ownerSessionId" placeholder="Leave empty to pick automatically"></label>' +
    (!windows ? '<label class="check-label full"><input type="checkbox" name="asAdmin">Run as admin (root)</label>' : "") +
    '<label class="full">Environment JSON <small>Variables for this job only</small><textarea name="env" rows="2" class="mono" spellcheck="false">{}</textarea></label></div></details>' +
    '<div class="form-actions"><button type="submit" class="primary"' + (!item.runnerInstalled ? " disabled" : "") + ">Start job</button>" +
    '<button type="button" data-action="toggle-new-job">Cancel</button><span class="help">Jobs keep running if you close the window · Resending after a timeout reuses the job ID and never runs twice</span></div></form>';
}
function renderJobRows() {
  if (state.jobsError) return '<div class="error-inline">' + esc(state.jobsError) + "</div>";
  if (!state.jobs.length) return '<div class="empty-inline">No jobs on this host yet<br>Press “New job” to send a command</div>';
  return state.jobs.map(job => '<button class="job-row ' + (state.job?.id === job.id ? "active" : "") + '" data-action="select-job" data-id="' + esc(job.id) + '"><div>' + badge(job.status) + "<small>" + esc(timestamp(job.createdAt)) + "</small></div><code>" + esc(job.script) + "</code></button>").join("");
}
function renderJobDetail() {
  const job = state.job;
  if (!job) return '<div class="empty-inline">Select a job to see its output<br><small>stdout, stderr and exit code are stored on the host</small></div>';
  const running = ["running", "queued"].includes(job.status);
  return '<div class="job-head"><h3>Job <code title="Job ID ' + esc(job.id) + " · Master " + esc(job.masterId) + '">' + esc(job.id.slice(0, 8)) + "</code></h3>" + badge(job.status) +
    (job.exitCode != null ? '<span class="chip">Exit ' + esc(job.exitCode) + "</span>" : "") +
    (running ? '<button class="danger small right" data-action="cancel-job">Cancel job</button>' : "") + "</div>" +
    '<div class="output light"><pre>' + esc(job.script) + "</pre></div>" +
    '<div class="job-meta"><span>' + icons.folder + "<code>" + esc(job.cwd) + "</code></span><span>" + esc(timestamp(job.startedAt || job.createdAt)) + "</span></div>" +
    '<div class="console"><div class="console-bar"><div class="segmented" role="group" aria-label="Log stream">' +
    ["stdout", "stderr"].map(stream => '<button data-action="log-stream" data-stream="' + stream + '" aria-pressed="' + (state.stream === stream) + '">' + stream + "</button>").join("") +
    '</div><button class="small" data-action="read-logs">' + (state.eof ? "Load more" : "Next page") + '</button><button class="small" data-action="copy-log">' + icons.copy + "Copy</button>" +
    (running ? '<small><span class="dot good"></span>Updates every 5 seconds</small>' : "") +
    '</div><div class="output" id="log-output" tabindex="0" aria-label="Job logs"><pre>' + esc(state.log || "No output yet") + "</pre></div></div>";
}
const joinPath = (folder, name) => folder.replace(/[\\/]+$/, "") + (/^[A-Za-z]:/.test(folder) ? "\\" : "/") + name;
/** Delete safety layers: right-click only, a dialog naming host and full path, typing the exact name, and the service refusing non-empty folders. */
function openDeleteDialog(path, name, isDirectory) {
  const host = state.targets.find(row => row.id === state.selected);
  $("#delete-kind").textContent = isDirectory ? "folder" : "file";
  $("#delete-name").textContent = name;
  $("#delete-path").textContent = path;
  $("#delete-host").textContent = host ? host.label || host.id : "this host";
  $("#delete-note").textContent = isDirectory ? "Only an empty folder can be deleted. This cannot be undone." : "This cannot be undone.";
  const form = $("#confirm-delete");
  form.reset(); form.dataset.path = path; form.dataset.name = name;
  form.querySelector('[type="submit"]').disabled = true;
  $("#delete-dialog").showModal();
  form.querySelector('[name="confirm"]').focus();
}
function parentPath(path) {
  const value = String(path || "").trim().replace(/[\\/]+$/, "");
  if (/^[A-Za-z]:$/.test(value)) return value + "\\";
  const index = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
  if (index < 0) return value || "/";
  if (index === 0) return value[0];
  const parent = value.slice(0, index);
  return /^[A-Za-z]:$/.test(parent) ? parent + "\\" : parent;
}
/** WinSCP-like browser: path box with a folder dropdown, Up, New folder, Upload; drop files to upload; right-click to delete. */
function renderFiles(item) {
  const path = state.files?.path || "~";
  return '<div class="section-heading"><div><h2>Files on this host</h2><p class="help">Click a folder to open it, a file to edit it · drop files to upload · ⋮ to download or delete</p></div></div>' +
    '<div class="file-bar"><button type="button" class="icon-button" data-action="parent-folder" aria-label="Up one folder" title="Up one folder"' + (state.files ? "" : " disabled") + ">" + icons.up + "</button>" +
    '<form id="browse-files" class="path-pick"><input name="path" id="file-path" aria-label="Folder path · press Enter to open" class="mono" required value="' + esc(path) + '">' +
    '<button type="button" class="icon-button" data-action="path-menu" aria-label="Choose a folder" title="Choose a folder">' + icons.chevron + "</button></form>" +
    '<div class="search file-search"><svg class="i" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3.5 3.5"/></svg><input id="file-filter" type="search" aria-label="Search this folder" placeholder="Search this folder…" value="' + esc(state.fileQuery || "") + '"' + (state.files ? "" : " disabled") + "></div>" +
    '<button type="button" data-action="mkdir"' + (state.files ? "" : " disabled") + ">" + icons.plus + 'New folder</button><button type="button" class="accent" data-action="upload-pick"' + (state.files ? "" : " disabled") + ">" + icons.up + 'Upload…</button><input type="file" id="upload-input" multiple hidden></div>' +
    '<div id="upload-status">' + renderUploadStatus() + '</div><div id="files-output" class="file-drop">' + renderFileList() + '</div><div id="file-editor">' + renderFileEditor() + "</div>";
}
const fileTime = seconds => seconds ? new Date(seconds * 1000).toLocaleString("en-GB", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
function renderFileList() {
  if (!state.files && state.filesError) return '<div class="callout pending">' + icons.alert + "<div><strong>Can’t open files yet</strong><p>" + esc(state.filesError) + "</p></div></div>";
  if (!state.files) return '<div class="empty-inline">Reading folders…</div>';
  const query = (state.fileQuery || "").trim().toLowerCase();
  const entries = [...state.files.entries].filter(entry => !query || String(entry.name).toLowerCase().includes(query)).sort((a, b) => (b.isDirectory ? 1 : 0) - (a.isDirectory ? 1 : 0) || String(a.name).localeCompare(String(b.name)));
  const up = parentPath(state.files.path), atRoot = up === state.files.path;
  const parent = atRoot ? "" : '<tr><td><button class="row-button file-name folder" data-action="open-folder" data-path="' + esc(up) + '">' + icons.up + '..</button></td><td class="num muted">—</td><td class="muted">Parent folder</td><td></td></tr>';
  return '<div class="table-wrap"><table class="file-table"><thead><tr><th>Name</th><th>Size</th><th>Modified</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>' + parent +
    entries.map(entry => '<tr data-file="' + esc(entry.path) + '" data-name="' + esc(entry.name) + '" data-dir="' + (entry.isDirectory ? "1" : "") + '"><td><button class="row-button file-name' + (entry.isDirectory ? " folder" : "") + '" data-action="' + (entry.isDirectory ? "open-folder" : "open-file") + '" data-path="' + esc(entry.path) + '">' + (entry.isDirectory ? icons.folder : icons.file) + esc(entry.name) + "</button>" + (entry.isSymlink ? " " + chip("link") : "") +
      '</td><td class="num muted" title="' + esc(entry.size ?? "") + ' bytes">' + (entry.isDirectory ? "—" : esc(formatSize(entry.size))) + '</td><td class="muted">' + esc(fileTime(entry.modified)) + '</td><td class="row-more-cell"><button type="button" class="icon-button row-more" data-action="file-more" aria-haspopup="menu" aria-label="More actions for ' + esc(entry.name) + '" title="More actions">' + icons.more + "</button></td></tr>").join("") +
    (entries.length ? "" : '<tr><td colspan="4" class="muted">' + (query ? "Nothing here matches “" + esc(state.fileQuery.trim()) + "”" : "This folder is empty · drop files here to upload") + "</td></tr>") + "</tbody></table></div>";
}
function renderFileEditor() {
  if (!state.file) return "";
  return '<div class="file-editor surface"><div class="section-heading"><h3><code>' + esc(state.file.path) + '</code></h3><button class="icon-button" data-action="close-file" aria-label="Close file" title="Close file">' + icons.close + "</button></div>" +
    '<form id="save-file"><textarea name="content" aria-label="File content" class="mono" rows="14" spellcheck="false"' + (!state.file.editable ? " readonly" : "") + ">" + esc(state.file.content) + '</textarea><div class="form-actions"><button type="submit" class="primary"' + (!state.file.editable ? " disabled" : "") + '>Save file</button><span class="help">' + (state.file.editable ? "SHA-256 is checked before saving so changes made elsewhere are not overwritten" : "Partial or not UTF-8 · use the CLI for large or binary files") + "</span></div></form></div>";
}
function pairingState(item) {
  return addText.states[item?.state] || addText.preparing;
}
/** Plain-language versions of errors people can act on; anything else is shown as is. */
function friendlyError(error) {
  const text = String(error?.message || error);
  const host = state.targets.find(row => row.id === state.selected), name = host ? host.label || host.id : "this host";
  if (text.includes("E_OWNER_NOT_LOGGED_IN")) return "Nobody is logged in as the Owner on " + name + ". Files, jobs and the terminal run in the Owner’s login session · log in on that host (at its screen or over SSH), then try again";
  if (text.includes("E_OWNER_NOT_ADMIN")) return "The Owner on " + name + " is logged in without administrator rights · log in with an administrator session, then try again";
  return text;
}
function pairingError(error) {
  const text = String(error?.message || error);
  return addText.errors.find(([code]) => text.includes(code))?.[1] || text;
}
async function refreshPairings() {
  const rows = await rpc("pairing.status");
  if (!Array.isArray(rows)) throw new Error("Could not read pairing requests");
  state.pairings = rows;
  if (state.pairing) state.pairing = rows.find(item => item.requestId === state.pairing.requestId) || state.pairing;
}
/* Add flow ("+ Add host"): every on-screen string in one place for the language switch (roadmap entry 2). */
const addText = {
  title: "Add host", close: "Close", cancel: "Cancel",
  lead: "Type the new host’s address, save the installer, then paste the code the new host shows",
  inFolder: name => "Folder " + name, inSite: name => "Datacenter " + name + " · used if the new host is a Master",
  steps: ["Where is the new host?", "Install on the new host", "Paste the code", "Check and finish"],
  address: "IP or host name", addressPlaceholder: "e.g. 192.0.2.20 or a Tailscale name", addressHelp: "An address this Master can reach · with Tailscale, sign in on the new host first",
  checking: "Checking the address…", sshAnswers: os => "SSH answers" + (os ? " · " + os : ""), osNames: { windows: "Windows", linux: "Ubuntu or Debian" },
  noSsh: "No SSH answer yet. That is normal for a new Windows machine: the installer turns SSH on", alreadyAs: "Already added as", openIt: "Open it", resumeIt: "Resume it",
  os: "Operating system", osWindows: "Windows / Windows Server", osLinux: "Ubuntu 24.04 — Desktop or Server",
  optional: "Optional", name: "Name", namePlaceholder: "Shown as its address if left empty", folder: "Folder", none: "None", newFolder: "+ New folder…", newFolderName: "New folder name",
  advanced: "Advanced", group: "Key group", groupHelp: "Hosts in the same key group share one SSH key on this Master. Keep the default unless you separate keys per group or team",
  hostId: "Host ID", generated: "Generated automatically", port: "SSH port", network: "Network type", detect: "Detect from address", lan: "LAN", tailscale: "Tailscale", publicIp: "Public IP",
  bridge: "Bridge account", routes: "Fallback routes / ProxyJump", routesPlaceholder: "Leave empty for the default", routesHelp: "For administrators: routes JSON in the existing format",
  save: "Save installer…", saveHelp: "The installer holds only public data. This Master can control the new host only after someone clicks Approve there",
  haveInstaller: "I already have the installer", cancelRequest: "Cancel request",
  open: file => "Open <strong>" + esc(file) + "</strong> on the new host and click <strong>Approve</strong>", openAny: "Open the installer on the new host and click <strong>Approve</strong>",
  savedTo: "Saved to", serverHint: "Ubuntu Server without a desktop?", serverCommand: file => "sudo apt install --no-install-recommends ./" + file + " && sshcc-setup",
  code: "Code from the new host", codeHelp: "After Approve, the new host shows a code that starts with SSHCC1. Copy all of it and paste it here",
  codeIdle: "Checked the moment you paste", codeChecking: "Checking…", codeDone: "Code accepted",
  hostName: "Host name", osName: "OS", shownAs: "Shown as", hostKey: "Host key (SHA-256)",
  reviewHelp: "Read from the code. Nothing is added until you press Finish", finish: "Finish",
  readyTitle: "Service and host identity verified", readyText: "Agents can use this host now", openHost: "Open this host", another: "Add another host", done: "Done",
  attentionTitle: "Installed, but the connection check failed", attentionText: "No need to reinstall. Fix the address and check again",
  retryHelp: "Only the address changes; identity and host key stay the same", retry: "Check again", back: "Back",
  unfinished: "Unfinished", refresh: "Refresh", host: "Host", status: "Status", resume: "Resume",
  states: { awaiting_approval: "Waiting for Approve on the new host", needs_attention: "Installed · connection check failed", ready: "Ready" }, preparing: "Preparing",
  cancelConfirm: "Cancel this request? An installer already sent for it will no longer work.", cancelled: "Request cancelled",
  notMasterTitle: "Added, but it is not a Master", notMasterText: site => "So it was not filed under datacenter " + site + ". Only Masters are filed under a datacenter",
  merged: n => "Merged · " + n + " hosts added to the tree", mergedThrough: name => "This Master reaches them through " + name,
  alsoMaster: name => name + " is also a Master", mergeGloss: "Merge it to see and control its hosts from here. Requests go through it; nothing changes on its hosts", merge: "Merge",
  addedMaster: (name, n) => "Added Master " + name + " · " + n + " hosts merged into the tree",
  admin: "For administrators (import from a file)",
  // Plain sentences for errors people can act on; the first matching code wins, anything else is shown as is.
  errors: [
    ["SETUP_TEMPLATES_MISSING", "Installer templates are missing. Install or update this Master with the full package, then save the installer again"],
    ["SETUP_TEMPLATE_MISMATCH", "The installer template does not match the verified release. Reinstall the Master package"],
    ["HOST_KEY_MISMATCH", "The host key differs from the pinned one, so the connection was stopped. Confirm it is the same host first"],
    ["E_PAIRING_MASTER", "This code was made for a different Master. Paste it on the Master whose installer you used"],
    ["E_PAIRING_CODE", "This code is damaged or incomplete. Copy all of it again from the new host, starting with SSHCC1."],
    ["E_PAIRING_DIGEST: pairing code", "This code is damaged or incomplete. Copy all of it again from the new host, starting with SSHCC1."],
    ["E_PAIRING_VERSION", "This is not a code from the new host. Copy all of it again, starting with SSHCC1."],
    ["unknown setup request", "This code belongs to a request that no longer exists on this Master. Save a new installer and run it on the new host"],
    ["E_PAIRING_CONFLICT", "A different host already answered this request. Save a new installer for this host"],
    ["PAIRING", "This code does not match the request. Check that you copied all of it from the host you just installed, on the right Master"],
    ["64 KiB", "The code is too long. Copy only the code"],
  ]
};
/** The add column's current step, from the request, whether its installer was saved and the pasted code:
 *  no request → 1; request not saved → 1 (Save installer… is in step 1); saved → 3; code previewed (nothing
 *  saved yet) → 4 "review"; after Finish (ready / needs_attention) → 4 "result". Step 2 is never current: it is
 *  done once the installer is saved. */
function addStep({ request, saved, previewed }) {
  if (request && ["ready", "needs_attention"].includes(request.state)) return { n: 4, phase: "result" };
  if (request && previewed) return { n: 4, phase: "review" };
  if (request && saved) return { n: 3, phase: "paste" };
  return { n: 1, phase: request ? "save" : "where" };
}
function addReset() { state.add = { code: "", checked: "", error: "", preview: null, focused: null, skipped: state.add?.skipped || new Set() }; }
function renderAddHost(options = {}) {
  const request = state.pairing, saved = request ? state.saved.get(request.requestId) : null;
  const preview = state.add.preview?.requestId === request?.requestId ? state.add.preview : null;
  const now = addStep({ request, saved: Boolean(saved || state.add.skipped.has(request?.requestId)), previewed: Boolean(preview) });
  const folders = (state.folders.folders || []).filter(folder => folder.master === "local");
  const folder = folders.find(row => row.id === options.folder), site = (state.datacenters.datacenters || []).find(row => row.id === options.site);
  const card = (n, body) => {
    const status = n === now.n ? "is-now" : n < now.n ? "is-done" : "is-later";
    return '<section class="add-step ' + status + '" data-step="' + n + '"' + (status === "is-now" ? ' aria-current="step" data-phase="' + now.phase + '"' : "") + '><div class="add-n">' + (status === "is-done" ? "✓" : n) + "</div>" +
      '<div class="add-body"><h2>' + addText.steps[n - 1] + "</h2>" + (n <= now.n ? body : "") + "</div></section>";
  };
  const requests = state.pairings.filter(item => item.state !== "ready");
  return '<div id="add-host" class="add-flow">' + heading(addText.title, [folder && addText.inFolder(folder.name), site && addText.inSite(site.name), addText.lead].filter(Boolean).join(" · "), '<button data-action="enroll-close">' + icons.close + addText.close + "</button>") +
    '<div class="add-column">' + card(1, addWhere(request, now, options, folders)) + card(2, addInstall(request, saved)) + card(3, addPaste(now)) + card(4, now.phase === "review" ? addReview(preview, folders) : request ? addResult(request) : "") + "</div>" +
    addUnfinished(requests) + "</div>" +
    '<details class="mt"><summary>' + addText.admin + '</summary><div><p class="help">Import a registration or a v1 registry; host keys are still checked as usual</p><div class="page-actions"><button data-action="import-registration">Import registration file…</button><button data-action="import-v1-registry">Import v1 registry…</button></div><form id="paste-registration" class="mt"><label>Registration JSON<textarea name="document" class="mono" rows="4" required spellcheck="false"></textarea></label><div class="form-actions"><button type="submit">Import</button></div></form></div></details>';
}
/** Step 1: the address up front; name and folder under "Optional"; today's fields under "Advanced". */
function addWhere(request, now, options, folders) {
  if (request) {
    const address = (request.envelope?.bundle?.routes || [])[0]?.address || "";
    return '<dl class="facts"><dt>' + addText.address + "</dt><dd>" + esc(address) + "</dd><dt>" + addText.name + "</dt><dd>" + esc(request.label || request.targetId) + "</dd></dl>" +
      (now.phase === "save" ? '<div class="form-actions"><button class="primary" data-action="save-setup" data-focus>' + addText.save + '</button><button data-action="add-skip-save">' + addText.haveInstaller + '</button><button class="danger" data-action="pairing-cancel" data-id="' + esc(request.requestId) + '">' + addText.cancelRequest + "</button></div>" : "");
  }
  const groups = [...new Set(state.targets.map(item => item.tenant).filter(Boolean))], tenant = groups[0] || "lab";
  const option = (value, text, selected) => '<option value="' + esc(value) + '"' + (selected ? " selected" : "") + ">" + esc(text) + "</option>";
  return '<form id="create-pairing" class="add-where">' +
    '<label>' + addText.address + '<input id="add-address" class="add-big" name="address" required autocomplete="off" spellcheck="false" placeholder="' + addText.addressPlaceholder + '" value="' + (options.self ? "127.0.0.1" : "") + '" data-focus><small>' + addText.addressHelp + "</small></label>" +
    '<p class="add-check" id="add-address-check" aria-live="polite"></p>' +
    '<label>' + addText.os + '<select name="os">' + option("windows", addText.osWindows) + option("linux", addText.osLinux) + "</select></label>" +
    "<details><summary>" + addText.optional + '</summary><div class="form-grid"><label>' + addText.name + '<input name="label" maxlength="256" placeholder="' + addText.namePlaceholder + '" value="' + (options.self ? esc(state.service?.label || "") : "") + '"></label>' +
    '<label>' + addText.folder + '<select name="folder" id="pairing-folder">' + option("", addText.none) + folders.map(row => option(row.id, row.name, options.folder === row.id)).join("") + option("__new__", addText.newFolder) +
    '</select><input name="newFolder" id="pairing-new-folder" maxlength="64" placeholder="' + addText.newFolderName + '" hidden></label></div></details>' +
    "<details><summary>" + addText.advanced + '</summary><div class="form-grid">' +
    '<label>' + addText.group + '<input name="tenant" required value="' + esc(tenant) + '" list="pairing-groups" pattern="[A-Za-z0-9_\\-]+" maxlength="64"><datalist id="pairing-groups">' + groups.map(group => '<option value="' + esc(group) + '"></option>').join("") + "</datalist><small>" + addText.groupHelp + "</small></label>" +
    '<label>' + addText.hostId + '<input name="targetId" pattern="[A-Za-z0-9_\\-]+" maxlength="64" placeholder="' + addText.generated + '"></label><label>' + addText.port + '<input name="port" type="number" value="22" min="1" max="65535" required></label>' +
    '<label>' + addText.network + '<select name="routeKind">' + option("", addText.detect) + option("lan", addText.lan) + option("tailscale", addText.tailscale) + option("public", addText.publicIp) + "</select></label>" +
    '<label>' + addText.bridge + '<input name="user" value="sshcc-bridge" required></label><label class="full">' + addText.routes + '<textarea name="routes" rows="4" class="mono" placeholder="' + addText.routesPlaceholder + '"></textarea><small>' + addText.routesHelp + "</small></label></div></details>" +
    '<div class="form-actions"><button type="submit" class="primary">' + addText.save + '</button></div><p class="help">' + addText.saveHelp + "</p></form>";
}
/** Step 1 live check: `pairing.check` after a ~400 ms pause; only the answer for the current address/port is shown. */
let whereTimer = 0;
const whereKey = form => form.address.value.trim() + ":" + (Number(form.port.value) || 22);
function onWhereInput(form) {
  clearTimeout(whereTimer); setWhereCheck(form, "");
  if (form.address.value.trim()) whereTimer = setTimeout(() => void checkWhere(form), 400);
}
function setWhereCheck(form, html, tone = "", duplicate = false) {
  const line = $("#add-address-check", form);
  line.innerHTML = html; line.className = "add-check" + (tone ? " " + tone : "");
  $('button[type="submit"]', form).disabled = duplicate;
}
async function checkWhere(form) {
  const key = whereKey(form), address = form.address.value.trim(), port = Number(form.port.value) || 22;
  setWhereCheck(form, esc(addText.checking));
  let result;
  try { result = await rpc("pairing.check", { address, port }); } catch { result = null; }
  // Resume needs the request in the list; it may have been made elsewhere since the list was read.
  if (result?.alreadyRequestId && !state.pairings.some(item => item.requestId === result.alreadyRequestId)) await refreshPairings().catch(() => {});
  if (!form.isConnected || whereKey(form) !== key) return; // a newer value is being checked
  if (!result) return setWhereCheck(form, "");
  if (result.alreadyAs) {
    const link = result.alreadyTargetId ? '<button type="button" class="small" data-action="open-paired-target" data-id="' + esc(result.alreadyTargetId) + '">' + addText.openIt + "</button>"
      : result.alreadyRequestId ? '<button type="button" class="small" data-action="resume-pairing" data-id="' + esc(result.alreadyRequestId) + '">' + addText.resumeIt + "</button>" : "";
    return setWhereCheck(form, icons.alert + "<span>" + addText.alreadyAs + " <strong>" + esc(result.alreadyAs) + "</strong></span>" + link, "bad", true);
  }
  if (!result.reachable) return setWhereCheck(form, icons.info + "<span>" + esc(addText.noSsh) + "</span>");
  if (result.os) form.os.value = result.os;
  setWhereCheck(form, icons.check + "<span>" + esc(addText.sshAnswers(addText.osNames[result.os])) + "</span>", "good");
}
/** Step 2: one line; done as soon as the installer is saved. The Ubuntu Server command is folded under it. */
function addInstall(request, saved) {
  const file = saved?.path ? saved.path.split(/[\\/]/).pop() : "";
  return "<p>" + (file ? addText.open(file) : addText.openAny) + "</p>" + (saved?.path ? '<p class="help wrap">' + addText.savedTo + " " + esc(saved.path) + "</p>" : "") +
    (request?.os === "linux" ? "<details><summary>" + addText.serverHint + "</summary><div>" + copyRow(addText.serverCommand(file || "FILE.deb")) + "</div></details>" : "");
}
/** Step 3: the code is checked on paste, once per distinct value; no submit button. */
function addPaste(now) {
  if (now.n > 3) return '<p class="add-check">' + icons.check + addText.codeDone + "</p>";
  const error = state.add.error;
  return '<label>' + addText.code + '<textarea id="add-code" class="mono" rows="3" maxlength="65536" autocomplete="off" spellcheck="false" placeholder="SSHCC1.…" data-focus>' + esc(state.add.code) + "</textarea></label>" +
    '<p class="add-check' + (error ? " bad" : "") + '" id="add-code-check" aria-live="polite">' + esc(error || addText.codeIdle) + '</p><p class="help">' + addText.codeHelp + "</p>";
}
/** Save installer…: the native save dialog; once saved, step 2 is done and the flow moves to step 3. */
async function saveInstaller() {
  const request = state.pairing;
  if (!request) return;
  const saved = await native("save_setup", { requestId: request.requestId });
  if (saved) state.saved.set(request.requestId, saved);
  render();
}
function setCodeCheck(text, tone = "") { const line = $("#add-code-check"); if (line) { line.textContent = text; line.className = "add-check" + (tone ? " " + tone : ""); } }
let codeTimer = 0;
/** A paste is checked at once; typing waits for a pause. Each distinct value is sent once. */
function onCodeInput(box, pasted) {
  state.add.code = box.value; clearTimeout(codeTimer);
  codeTimer = setTimeout(() => void checkCode(box.value.trim()), pasted ? 0 : 500);
}
/** Previews the code (read only); a good code opens the review card, nothing is saved until Finish. */
async function checkCode(code) {
  if (!code || code === state.add.checked) return;
  state.add.checked = code; state.add.error = ""; setCodeCheck(addText.codeChecking);
  try {
    const result = await rpc("pairing.preview", { code });
    if (state.add.checked !== code) return;
    // A code for another unfinished request moves the column to that request.
    if (result.requestId !== state.pairing?.requestId) state.pairing = state.pairings.find(item => item.requestId === result.requestId) || state.pairing;
    state.add.preview = { ...result, code }; render();
  } catch (error) {
    if (state.add.checked !== code) return; // a newer value is being checked
    state.add.error = pairingError(error); setCodeCheck(state.add.error, "bad");
  }
}
/** Step 4 review: facts read from the code, with name and folder editable; Finish saves. */
function addReview(preview, folders) {
  const current = state.folders.members?.[preview.targetId] || "", address = (state.pairing?.envelope?.bundle?.routes || [])[0]?.address || "";
  const option = (value, text) => '<option value="' + esc(value) + '"' + (value === current ? " selected" : "") + ">" + esc(text) + "</option>";
  return '<form id="finish-pairing" class="add-where"><dl class="facts"><dt>' + addText.hostName + "</dt><dd>" + esc(preview.hostName || "—") + "</dd><dt>" + addText.address + "</dt><dd>" + esc(address) +
    "</dd><dt>" + addText.osName + "</dt><dd>" + esc({ windows: addText.osWindows, linux: addText.osLinux }[preview.os] || preview.os) + "</dd><dt>" + addText.hostKey + '</dt><dd><code class="wrap">' + esc(preview.hostKeySha256) + "</code></dd></dl>" +
    '<div class="form-grid"><label>' + addText.shownAs + '<input name="label" maxlength="256" required value="' + esc(preview.label) + '"></label>' +
    '<label>' + addText.folder + '<select name="folder" id="pairing-folder">' + option("", addText.none) + folders.map(row => option(row.id, row.name)).join("") + option("__new__", addText.newFolder) +
    '</select><input name="newFolder" id="pairing-new-folder" maxlength="64" placeholder="' + addText.newFolderName + '" hidden></label></div>' +
    '<div class="form-actions"><button type="submit" class="primary" data-focus>' + addText.finish + '</button></div><p class="help">' + addText.reviewHelp + "</p></form>";
}
/** Step 4 result after Finish: ready / needs-attention, in the same card. */
function addResult(item) {
  const registered = state.targets.find(row => row.id === item.targetId);
  const routes = registered?.routes || item.envelope?.bundle?.routes || [];
  const failed = (item.diagnostics?.stages || []).filter(stage => !stage.ok);
  if (item.state === "ready") {
    const offer = pairedMasterOffer(item);
    return '<div class="callout good">' + icons.check + '<div><strong class="ready-message">' + addText.readyTitle + "</strong><p>" + addText.readyText + "</p></div></div>" + offer +
      '<div class="form-actions"><button class="' + (offer ? "" : "primary") + '" data-action="open-paired-target" data-id="' + esc(item.targetId) + '" data-focus>' + addText.openHost + '</button><button data-action="new-pairing">' + icons.plus + addText.another + '</button><button data-action="enroll-close">' + addText.done + "</button></div>";
  }
  return '<div class="callout pending">' + icons.alert + "<div><strong>" + addText.attentionTitle + "</strong><p>" + addText.attentionText + "</p>" + (failed.length ? "<ul>" + failed.map(stage => "<li>" + esc(pairingError(stage.message)) + "</li>").join("") + "</ul>" : "") + "</div></div>" +
    '<form id="retry-pairing"><label>' + addText.address + '<input name="address" required value="' + esc(routes[0]?.address || "") + '" data-focus><small>' + addText.retryHelp + '</small></label><div class="form-actions"><button type="submit" class="primary">' + addText.retry + '</button><button type="button" data-action="pairing-back">' + icons.back + addText.back + "</button></div></form>";
}
function addUnfinished(requests) {
  if (!requests.length) return "";
  return '<section class="section add-unfinished"><div class="section-heading"><h2>' + addText.unfinished + '</h2><button class="small" data-action="refresh-pairings">' + icons.refresh + addText.refresh + "</button></div>" +
    '<div class="table-wrap"><table><thead><tr><th>' + addText.host + "</th><th>" + addText.status + "</th><th></th></tr></thead><tbody>" + requests.map(item => "<tr><td><strong>" + esc(item.label || item.targetId) + "</strong><small>" + esc(timestamp(item.createdAt)) + "</small></td>" +
      '<td><span class="badge pending">' + esc(pairingState(item)) + '</span></td><td class="actions"><div class="target-actions"><button class="small" data-action="resume-pairing" data-id="' + esc(item.requestId) + '">' + addText.resume + "</button>" +
      (item.state === "awaiting_approval" ? '<button class="small danger" data-action="pairing-cancel" data-id="' + esc(item.requestId) + '">' + addText.cancel + "</button>" : "") + "</div></td></tr>").join("") + "</tbody></table></div></section>";
}
/** Move focus to the current step's main control when the step changes. */
function focusAddStep() {
  const now = $('#add-host [aria-current="step"]');
  if (!now) return;
  const key = (state.pairing?.requestId || "") + ":" + now.dataset.step + ":" + now.dataset.phase;
  // Same step after a re-render: put focus back only if the re-render dropped it.
  if (state.add.focused === key && document.activeElement && document.activeElement !== document.body) return;
  state.add.focused = key; now.querySelector("[data-focus]")?.focus();
}
/** A newly paired host that is itself a Master: one click merges its hosts into this tree. */
function pairedMasterOffer(item) {
  const site = state.dc.adding?.site && (state.datacenters.datacenters || []).find(row => row.id === state.dc.adding.site);
  if (site && state.masterCheck.get(item.targetId) === false && state.pairedMaster?.targetId !== item.targetId)
    return '<div class="callout">' + icons.info + "<div><strong>" + addText.notMasterTitle + "</strong><p>" + esc(addText.notMasterText(site.name)) + "</p></div></div>";
  if (state.pairedMaster?.targetId !== item.targetId) return "";
  const merge = state.merges.find(row => row.targetId === item.targetId), name = item.label || item.targetId;
  if (merge) return '<div class="callout good">' + icons.check + "<div><strong>" + esc(addText.merged((merge.children || []).length)) + "</strong><p>" + esc(addText.mergedThrough(name)) + "</p></div></div>";
  return '<div class="callout">' + icons.info + "<div><strong>" + esc(addText.alsoMaster(name)) + "</strong><p>" + addText.mergeGloss + "</p>" +
    '<div class="form-actions"><button class="primary" data-action="merge-master" data-id="' + esc(item.targetId) + '"' + (state.merging.has(item.targetId) ? " disabled" : "") + ">" + addText.merge + "</button></div></div></div>";
}
/** After pairing: ask only the new host whether it is a Master (no fleet-wide probe). */
async function checkPairedMaster(pairing) {
  state.pairedMaster = null;
  if (pairing?.state !== "ready" || !state.service?.roles?.includes("master")) return;
  try {
    const [row] = await rpc("merges.discover", { targetId: pairing.targetId });
    if (row && !row.error) state.masterCheck.set(row.targetId, row.isMaster);
    if (row?.isMaster) state.pairedMaster = { targetId: pairing.targetId };
  } catch { /* the offer is optional; the Masters page can still merge */ }
  // Opened from a datacenter: a Master is merged right away and filed under it.
  const adding = state.dc.adding;
  if (!adding?.site || state.pairedMaster?.targetId !== pairing.targetId) return;
  const merge = await rpc("merges.add", { targetId: pairing.targetId });
  await rpc("datacenters.assign", { master: pairing.targetId, datacenterId: adding.site }); await refreshDatacenters();
  await refreshMasters();
  notify(addText.addedMaster(merge.label || pairing.targetId, (merge.children || []).length));
}
function renderMasters() {
  return heading("Masters", "Merge another Master to see and control its hosts from here, and choose which Masters may control this one", '<button data-action="refresh-masters">' + icons.refresh + "Refresh</button>") +
    '<div class="stack">' + (state.service?.roles?.includes("master") ? renderMerges() : "") + renderRelays() + "</div>";
}
function mergeStatus(targetId) {
  if (state.merging.has(targetId)) return '<span class="badge running">Merging…</span>';
  const merge = state.merges.find(row => row.targetId === targetId);
  if (!merge) return '<span class="badge">Not merged</span>';
  const count = (merge.children || []).length;
  const labels = { merged: ["good", "Merged · " + count + " hosts"], outdated: ["bad", "Remote Master needs an upgrade"], "not-master": ["bad", "Not a Master"], disabled: ["bad", "Remote Master disabled merging"], error: ["bad", "Error"] };
  const [style, text] = labels[merge.status] || ["bad", merge.status];
  const detail = merge.status === "merged" ? "Last sync " + timestamp(merge.syncedAt) : (merge.error || "") + (count ? " · still using the previous list of " + count : "");
  return '<span class="badge ' + style + '">' + esc(text) + '</span><small class="wrap">' + esc(detail) + "</small>";
}
function reverseStatus(merge) {
  const running = state.twoWay.get(merge.targetId);
  if (running) return '<span class="badge running">Enabling two-way…</span><small class="wrap">' + esc(running.message) + "</small>";
  const reverse = merge.reverse, peer = state.targets.find(item => item.id === merge.targetId);
  const relay = state.relays.find(row => row.masterId === peer?.nodeId);
  if (isTwoWay(merge)) return '<span class="badge good">Two-way</span><small>' + esc(merge.label || merge.targetId) + " can control this Master’s hosts</small>";
  if (reverse?.status === "two-way" && relay?.revoked) return '<span class="badge">One-way</span><small>Merging is disabled on this host</small>';
  const labels = { "two-way": ["pending", "Waiting for merge back"], "needs-attention": ["bad", "Paired, but merge back failed"], error: ["bad", "Two-way setup failed"], pending: ["pending", "Unfinished"] };
  const [style, text] = labels[reverse?.status] || ["", "One-way"];
  return '<span class="badge ' + style + '">' + text + "</span>" + (reverse?.error ? '<small class="wrap">' + esc(reverse.error) + "</small>" : !reverse ? "<small>This Master controls that Master’s hosts one way only</small>" : "");
}
/** Outgoing: every Merge, plus every host whose health says it is a Master and that is not merged yet. */
function renderMerges() {
  const unmerged = state.targets.filter(item => !item.relayed && state.health.get(item.id)?.isMaster && !state.merges.some(merge => merge.targetId === item.id));
  const ids = [...state.merges.map(row => row.targetId), ...unmerged.map(item => item.id)];
  const name = id => state.merges.find(row => row.targetId === id)?.label || state.targets.find(row => row.id === id)?.label || id;
  return '<section class="surface"><div class="card-head"><div><h2>Controlled from here</h2><p>Masters merged into this one · Merge: see and control its hosts from here</p></div></div>' +
    (ids.length ? '<div class="table-wrap"><table><thead><tr><th>Master</th><th>Status</th><th>Direction</th><th></th></tr></thead><tbody>' +
      ids.map(id => {
        const merge = state.merges.find(row => row.targetId === id), busyRow = state.merging.has(id) || state.twoWay.has(id);
        const canPair = merge?.status === "merged" && !isTwoWay(merge) && !(merge.reverse?.status === "two-way" && state.relays.some(row => row.masterId === state.targets.find(item => item.id === id)?.nodeId && row.revoked));
        const pair = canPair ? '<button class="primary small" data-action="open-two-way" data-id="' + esc(id) + '"' + (busyRow ? " disabled" : !/Windows/.test(navigator.userAgent) ? ' disabled title="Currently supported only on Windows Masters"' : "") + ">" + (merge.reverse ? "Try again" : "Enable two-way") + "</button>" : "";
        const actions = merge ? pair + '<button class="small" data-action="sync-merge" data-id="' + esc(id) + '"' + (busyRow ? " disabled" : "") + '>Sync</button><button class="danger small" data-action="remove-merge" data-id="' + esc(id) + '"' + (busyRow ? " disabled" : "") + ">Remove merge</button>" : '<button class="primary small" data-action="merge-master" data-id="' + esc(id) + '" title="See and control its hosts from here"' + (busyRow ? " disabled" : "") + ">Merge</button>";
        return "<tr><td><strong>" + esc(name(id)) + "</strong><small><code>" + esc(id) + "</code></small></td><td>" + mergeStatus(id) + "</td><td>" + (merge ? reverseStatus(merge) : '<span class="muted">—</span>') + '</td><td class="actions"><div class="target-actions">' + actions + "</div></td></tr>";
      }).join("") + "</tbody></table></div>"
      : '<div class="empty-inline">No Masters yet · a host you add that is itself a Master shows up here</div>') +
    '<details><summary>How merging works</summary><p class="help">Merged hosts appear under All hosts with IDs like <code>master/machine</code> · Commands go through that Master with its rights<br>Enable two-way so that Master can also control this Master’s hosts</p></details></section>';
}
/** Incoming: allowed Masters and relays joined on the Master ID, one row per Master. */
function renderRelays() {
  const masters = Array.isArray(state.masters) ? state.masters : [], ids = [...new Set([...masters.map(row => row.id), ...state.relays.map(row => row.masterId)])];
  const rows = ids.map(id => ({ id, direct: masters.find(row => row.id === id), relay: state.relays.find(row => row.masterId === id) }));
  const badges = ({ direct, relay }) =>
    (direct ? '<span class="badge ' + (direct.revoked ? "bad" : "good") + '">Direct</span>' + (direct.revoked ? "<small>Revoked</small>" : "") : "") +
    (relay ? '<span class="badge ' + (relay.revoked ? "bad" : "good") + '">Through merge</span>' + (relay.revoked ? "<small>Merging disabled</small>" : "<small>Last used " + esc(timestamp(relay.lastUsedAt)) + "</small>") : "");
  const actions = ({ id, direct, relay }) =>
    (direct && !direct.revoked ? '<button class="danger small" data-action="revoke-master" data-id="' + esc(id) + '">Revoke</button>' : "") +
    (relay ? (relay.revoked ? '<button class="small" data-action="allow-relay" data-id="' + esc(id) + '">Allow again</button>' : '<button class="danger small" data-action="revoke-relay" data-id="' + esc(id) + '">Disable merging</button>') : "");
  return '<section class="surface"><div class="card-head"><div><h2>This Master is controlled by</h2><p>Masters that reach this one directly, or through a Merge (they see and control its hosts from there)</p></div><button data-action="accept-enrollment" title="Choose a public enrollment bundle from another Master">' + icons.plus + "Allow another Master…</button></div>" +
    (rows.length ? '<div class="table-wrap"><table><thead><tr><th>Master</th><th>Reaches this Master</th><th></th></tr></thead><tbody>' +
      rows.map(row => "<tr><td><strong>" + esc(row.direct?.label || row.relay?.label || row.id) + "</strong><small><code>" + esc(row.id) + '</code></small></td><td><div class="reach-badges">' + badges(row) + '</div></td><td class="actions"><div class="target-actions">' + actions(row) + "</div></td></tr>").join("") +
      "</tbody></table></div>" : '<div class="empty-inline">No other Master controls this one</div>') +
    '<p class="help mt">Revoke and Disable merging affect new requests; cancel running jobs separately from the Jobs tab</p></section>';
}
function copyRow(command) {
  return '<div class="copy-row"><code>' + esc(command) + '</code><button class="icon-button" data-action="copy" data-copy="' + esc(command) + '" aria-label="Copy ' + esc(command) + '" title="Copy">' + icons.copy + "</button></div>";
}
function linkBadge(status) {
  const styles = { connected: "good", pathMismatch: "pending", disconnected: "", missingClient: "" };
  const labels = { connected: "Connected", pathMismatch: "Path mismatch", disconnected: "Not connected", missingClient: "Not installed" };
  return '<span class="badge ' + (styles[status] || "") + '">' + esc(labels[status] || status) + "</span>";
}
function renderClientLink(link) {
  const canConnect = link.detected && link.status === "disconnected";
  const canUpdate = link.detected && link.status === "pathMismatch";
  const actions =
    (canConnect ? '<button class="primary small" data-action="connect-client" data-id="' + esc(link.id) + '">Connect</button>' : "") +
    (canUpdate ? '<button class="small" data-action="update-client-path" data-id="' + esc(link.id) + '">Update path</button>' : "") +
    (link.status === "connected" ? '<span class="help">' + icons.check + "Ready</span>" : "") +
    (!link.detected ? '<button class="primary small" disabled title="Not installed on this host">Connect</button>' : "");
  return '<article class="client-link surface">' +
    '<div class="card-head"><div><h3>' + esc(link.label) + "</h3><p>" + esc(link.message) + "</p></div>" + linkBadge(link.status) + "</div>" +
    '<dl class="facts"><dt>Config</dt><dd><code>' + esc(link.configPath) + "</code></dd>" +
    (link.command ? "<dt>Current command</dt><dd><code>" + esc(link.command) + "</code></dd>" : "") +
    "<dt>Expected command</dt><dd><code>" + esc(link.expectedCommand) + "</code></dd></dl>" +
    '<div class="form-actions">' + actions + "</div>" +
    "<details><summary>Copy snippet</summary><div>" + copyRow(link.snippet) + "</div></details>" +
    "</article>";
}
function renderClientLinks() {
  const body = state.clientLinksError
    ? '<div class="callout bad">' + icons.alert + "<div><strong>Could not read MCP client status</strong><p>" + esc(state.clientLinksError) + "</p></div></div>"
    : (state.clientLinks.length
      ? '<div class="client-link-grid">' + state.clientLinks.map(renderClientLink).join("") + "</div>"
      : '<p class="help">Checking Cursor, Claude Code and Codex…</p>');
  return '<section class="section mt"><div class="section-heading"><div><h2>Connect AI clients</h2><p class="help">Registers the user-level MCP server <code>ssh_control_center</code> · uses the same local service through <code>sshcc mcp</code></p></div></div>' +
    body +
    '<details class="mt"><summary>General CLI</summary><div><p class="help">Check the service directly without an AI client</p>' +
    copyRow("sshcc request system.status") + copyRow("sshcc mcp") + "</div></details></section>";
}
function renderService() {
  const service = state.service;
  const head = heading("Local service", "The service starts at boot and runs independently of this window", '<button data-action="refresh-service">' + icons.refresh + "Check again</button>");
  if (!service) {
    return head + '<div class="callout bad">' + icons.alert + "<div><strong>Cannot reach the service</strong><p>Check that SSH Control Center is installed and the tray runs as the Owner chosen during install</p><ul><li>Windows: look for the SSHControlCenter service in Services</li><li>Linux: <code>systemctl status sshcc</code></li></ul></div></div>" +
      '<details><summary>Error message</summary><div class="output light"><pre>' + esc(state.serviceError || "—") + "</pre></div></details>" +
      renderClientLinks();
  }
  return head + '<div class="stat-grid">' +
    stat("Status", '<span class="dot good"></span>Ready') +
    stat("Host name", esc(service.label)) +
    stat("Roles", esc(service.roles?.join(" + ") || "—")) +
    stat("Uptime", esc(formatUptime(service.uptimeSeconds)), service.version ? "Version " + service.version : "") +
    "</div>" +
    '<div class="disclosure-list"><details><summary>More details <small class="muted">Node ID, connection</small></summary><div><dl class="facts"><dt>Node ID</dt><dd><code>' + esc(service.nodeId) + "</code></dd><dt>Connection</dt><dd>Local named pipe / Unix socket</dd><dt>This window</dt><dd>Close the window to free WebView memory, or quit the tray icon to close only the tray</dd></dl></div></details></div>" +
    renderClientLinks();
}
/* Inventory: optional Datacenters → Masters (current or merged) → optional folders → machines. Built from the same
   targets/merges data as the graph; containers are fetched only for the opened machine. */
const dcKey = item => item ? item.id : "local";
function dcModel() {
  const direct = state.targets.filter(item => !item.relayed), byNode = new Map(direct.map(item => [item.nodeId, item]));
  const peers = state.merges.map(merge => ({ merge, peer: direct.find(item => item.id === merge.targetId) })).filter(entry => entry.peer);
  const masters = [{ id: "local", label: state.service?.label || "This host", current: true, item: null, machines: direct.map(item => ({ item })) }];
  for (const { merge, peer } of peers) {
    const machines = (merge.children || []).map(child => byNode.has(child.nodeId)
      ? { item: byNode.get(child.nodeId), alsoDirect: true }
      : { item: state.targets.find(item => item.id === peer.id + "/" + child.id) }).filter(entry => entry.item);
    masters.push({ id: peer.id, label: peer.label || peer.id, current: false, item: peer, merge, twoWay: isTwoWay(merge), machines });
  }
  const members = state.folders.members || {};
  for (const master of masters) {
    master.folders = (state.folders.folders || []).filter(folder => folder.master === master.id)
      .map(folder => ({ ...folder, machines: master.machines.filter(entry => !entry.alsoDirect && members[entry.item.id] === folder.id) }));
    const filed = new Set(master.folders.flatMap(folder => folder.machines.map(entry => entry.item.id)));
    master.loose = master.machines.filter(entry => !filed.has(entry.item.id) || entry.alsoDirect);
  }
  return masters;
}
function dcLookup(node) {
  const [kind, ...rest] = node.split(":"), masters = dcModel();
  if (kind === "master") { const master = masters.find(row => row.id === rest.join(":")); return master && { kind, master, label: master.label }; }
  if (kind === "site") { const site = (state.datacenters.datacenters || []).find(row => row.id === rest.join(":")); return site && { kind, site, label: site.name, masters: masters.filter(master => siteOf(master.id)?.id === site.id) }; }
  if (kind === "folder") {
    for (const master of masters) {
      const folder = master.folders.find(row => row.id === rest.join(":"));
      if (folder) return { kind, master, folder, label: folder.name };
    }
    return null;
  }
  if (kind === "node") { const item = state.targets.find(row => row.id === rest.join(":")); return item && { kind, item, label: item.label || item.id }; }
  return null;
}
/** Master branch a machine belongs to for folders: "peer" for "peer/child", otherwise this Master. */
const dcBranch = id => id.includes("/") ? id.split("/")[0] : "local";
const siteOf = masterId => (state.datacenters.datacenters || []).find(site => site.id === (state.datacenters.members || {})[masterId]);
const siteIcon = svg('<path d="M2.5 14V4.5l5-2.5v12M7.5 14V6.5l6 2V14M1.5 14h13M4.5 6h1M4.5 8.5h1M4.5 11h1M10 10h1M10 12h1"/>');
const dcFolderOf = id => (state.folders.folders || []).find(folder => folder.id === (state.folders.members || {})[id]);
const dcOnline = entries => entries.filter(entry => nodeState(entry.item) === "online").length;
function dcPath(item, master) {
  if (!item.relayed) return "SSH from " + (state.service?.label || "this Master");
  return "Through " + (item.viaLabel || master?.label || item.via);
}
function dcMatches(item) {
  const search = state.dc.query.toLowerCase();
  return !search || [item.id, item.label, item.tenant, item.viaLabel, ...(item.routes || []).map(route => route.address)].some(value => String(value || "").toLowerCase().includes(search));
}
function dcRow(node, depth, content, options = {}) {
  const selected = state.page === "datacenter" && state.dc.node === node;
  const toggle = options.branch
    ? '<button class="dc-toggle" data-action="dc-toggle" data-node="' + esc(node) + '" aria-label="' + (options.open ? "Collapse" : "Expand") + '" aria-expanded="' + options.open + '">' + icons.chevron + "</button>"
    : '<span class="dc-toggle-space"></span>';
  const drop = (options.drop ? ' data-drop="' + esc(options.drop) + '" data-drop-folder="' + esc(options.dropFolder || "") + '"' : "") +
    (options.dropSite ? ' data-drop-site="' + esc(options.dropSite) + '"' : "");
  const drag = options.drag ? ' draggable="true" data-drag="' + esc(options.drag) + '"' : options.dragMaster ? ' draggable="true" data-drag-master="' + esc(options.dragMaster) + '"' : "";
  return '<li class="dc-row' + (selected ? " is-selected" : "") + (options.open ? " is-open" : "") + " depth-" + Math.min(depth, 5) + '"' + drop + ">" + toggle +
    '<button class="dc-item" data-action="dc-select" data-node="' + esc(node) + '"' + drag + (selected ? ' aria-current="true"' : "") + ">" + content + "</button></li>";
}
function dcEditRow(depth, value, label, icon = icons.folder) {
  return '<li class="dc-row is-editing depth-' + Math.min(depth, 5) + '"><span class="dc-toggle-space"></span><span class="dc-icon">' + icon +
    '</span><input id="dc-edit" class="dc-edit" maxlength="64" aria-label="' + esc(label) + '" value="' + esc(value) + '" placeholder="' + esc(label) + '"></li>';
}
function dcMachineRow(entry, depth) {
  const item = entry.item, isMaster = state.merges.some(merge => merge.targetId === item.id);
  const cpu = sampledCpu(item.id), hot = isHot(item);
  return dcRow("node:" + item.id, depth, '<span class="dot ' + (hot ? "hot" : stateStyles[nodeState(item)] || "") + '"></span><span class="dc-name">' + esc(item.label || item.id) + "</span>" +
    (isMaster ? '<span class="dc-tag">Master</span>' : "") + (entry.alsoDirect ? '<span class="dc-tag" title="Also connected directly from this Master">also direct</span>' : "") +
    (cpu == null ? '<span class="dc-os">' + esc(osName(item.os)) + "</span>" : '<span class="dc-os' + (hot ? " is-hot" : "") + '" title="' + esc(osName(item.os)) + '">' + Math.round(cpu) + "%</span>"), { drag: entry.alsoDirect ? "" : item.id });
}
function dcMasterRows(master, depth, rows, open) {
  const node = "master:" + master.id, editing = state.dc.editing;
  // Masters start folded so the sidebar opens short; after that the person's choice sticks.
  if (!state.dc.seen.has(node)) { state.dc.seen.add(node); state.dc.collapsed.add(node); }
  if (state.dc.query && !master.machines.some(entry => dcMatches(entry.item))) return;
  const tag = master.current ? '<span class="dc-tag is-current">current</span>' : "";
  const status = master.current ? (state.service ? "good" : "bad") : stateStyles[nodeState(master.item)] || "";
  rows.push(dcRow(node, depth, '<span class="dot ' + status + '"></span><span class="dc-name">' + esc(master.label) + "</span>" + tag + '<span class="dc-count">' + dcOnline(master.machines) + "/" + master.machines.length + "</span>",
    { branch: true, open: open(node) || editing?.master === master.id, drop: master.id }));
  if (!open(node) && editing?.master !== master.id) return;
  if (editing?.mode === "new" && editing.master === master.id) rows.push(dcEditRow(depth + 1, "", "New folder name"));
  for (const folder of master.folders) {
    const folderNode = "folder:" + folder.id, machines = folder.machines.filter(entry => dcMatches(entry.item));
    if (state.dc.query && !machines.length) continue;
    if (editing?.mode === "rename" && editing.id === folder.id) rows.push(dcEditRow(depth + 1, folder.name, "Rename folder"));
    else rows.push(dcRow(folderNode, depth + 1, '<span class="dc-icon">' + icons.folder + '</span><span class="dc-name">' + esc(folder.name) + '</span><span class="dc-count">' + dcOnline(folder.machines) + "/" + folder.machines.length + "</span>",
      { branch: folder.machines.length > 0, open: open(folderNode), drop: master.id, dropFolder: folder.id }));
    if (open(folderNode)) for (const entry of machines) rows.push(dcMachineRow(entry, depth + 2));
  }
  for (const entry of master.loose.filter(entry => dcMatches(entry.item))) rows.push(dcMachineRow(entry, depth + 1));
}
function renderDcTree() {
  const rows = [], open = node => !state.dc.collapsed.has(node) || Boolean(state.dc.query);
  for (const master of dcModel()) dcMasterRows(master, 0, rows, open);
  return rows.length ? '<ul class="dc-list" role="tree">' + rows.join("") + "</ul>" : '<p class="help tree-empty">No hosts match</p>';
}
function dcTabs(tabs) {
  if (!tabs.some(([id]) => id === state.dc.tab)) state.dc.tab = tabs[0][0];
  return '<div class="tabs" role="tablist" aria-label="Sections">' + tabs.map(([id, label]) => '<button role="tab" aria-selected="' + (id === state.dc.tab) + '" class="tab ' + (id === state.dc.tab ? "active" : "") + '" data-action="dc-tab" data-tab="' + id + '">' + label + "</button>").join("") + "</div>";
}
/** Every host in a datacenter: each Master followed by its target hosts, each host once. */
function siteHostTable(masters) {
  const seen = new Set(), rows = [];
  for (const master of masters) {
    const key = master.item ? master.item.id : "local";
    if (!seen.has(key)) { seen.add(key); rows.push(hostRow(master.item)); }
    for (const { item } of master.machines) if (!seen.has(item.id)) { seen.add(item.id); rows.push(hostRow(item)); }
  }
  return '<div class="table-wrap"><table>' + HOST_HEAD + "<tbody>" + rows.join("") + "</tbody></table></div>";
}
function dcMachineTable(entries) {
  if (!entries.length) return '<div class="empty-inline">No target hosts</div>';
  return '<div class="table-wrap"><table>' + HOST_HEAD + "<tbody>" + entries.map(({ item }) => hostRow(item)).join("") + "</tbody></table></div>";
}
/** The engraved host-key seal; clicking it sweeps a light across once. */
function foilSticker(item) {
  const key = (item.hostKeys || [])[0];
  if (!key) return "";
  const type = String(key).split(/\s+/).find(part => /^(ssh-|ecdsa-|sk-)/.test(part)) || "ssh";
  const short = type.replace(/^ssh-|^sk-/, "").replace(/^ecdsa-sha2-/, "").replace(/@.*$/, "").toUpperCase();
  return '<div class="foil-sticker" data-egg="foil" tabindex="0" role="img" aria-label="Host key pinned · ' + esc(short) + '"><b>HOST KEY</b><span>Pinned</span><span>' + esc(short) + "</span></div>";
}
/** The header scene as a thin banner over the topology: its circle is the logo ring, its towers light up for hovered hosts. */
function renderBanner() {
  const lights = [0, 1, 2, 3, 4, 5].map(i => '<b class="scene-light t' + i + '" data-light="t' + i + '"></b>').join("") + [0, 1, 2, 3].map(i => '<b class="scene-light f' + i + '" data-light="f' + i + '"></b>').join("");
  return '<div class="scene-banner"><div class="logo" data-egg="ring" tabindex="0" role="img" aria-label="SSH Control Center"><i class="header-scene" aria-hidden="true">' + lights +
    '</i><i class="ring" aria-hidden="true"></i><span>SSH</span><span>CONTROL</span></div></div>';
}
/** One line instead of a stats strip: either all is well, or the hosts that need a look, each a link. */
function renderSummaryLine() {
  const problems = state.targets.filter(item => isHot(item) || ["offline", "unknown", "legacy"].includes(nodeState(item)));
  const checking = state.targets.filter(item => nodeState(item) === "checking").length;
  const when = state.healthError ? '<span class="status-meta error" title="' + esc(state.healthError) + '">' + icons.alert + "Status check failed</span>"
    : '<span class="status-meta">' + (state.healthAt ? "Checked " + esc(timestamp(state.healthAt)) : "Checking…") + "</span>";
  const why = item => isHot(item) ? "high load" : nodeState(item) === "legacy" ? "service not installed" : (stateLabels[nodeState(item)] || "").toLowerCase();
  const body = problems.length
    ? '<span class="summary-icon is-bad" aria-hidden="true">!</span><strong>' + problems.length + " of " + hostCount() + " hosts need a look</strong>" +
      problems.map(item => '<button class="text-button" data-action="dc-select" data-node="node:' + esc(item.id) + '">' + esc(item.label || item.id) + " · " + esc(why(item)) + "</button>").join("")
    : checking ? '<span class="summary-icon" aria-hidden="true">…</span><strong>Checking ' + checking + " hosts</strong>"
    : '<span class="summary-icon is-good" aria-hidden="true">✓</span><strong>All ' + hostCount() + " hosts online</strong>";
  return '<div id="inv-summary" class="inv-summary" role="status">' + body + when + '<button class="icon-button" data-action="refresh-fleet" aria-label="Check every host again" title="Check every host over SSH again">' + icons.refresh + "</button></div>";
}
function renderDcPanel() {
  if (state.dc.adding) return renderAddHost(state.dc.adding);
  const node = state.dc.node, found = node === "dc" ? null : dcLookup(node);
  if (node !== "dc" && !found) { state.dc.node = "dc"; return renderDcPanel(); }
  if (!found) {
    state.view = "graph";
    return renderBanner() + renderSummaryLine() + renderFleetTools();
  }
  if (found.kind === "master") {
    const master = found.master, target = pageTarget();
    const tabs = dcTabs(HOST_PAGE_TABS);
    const actions = target ? terminalButton(target).replace('class="small"', 'class="primary"') : "";
    const head = heading(master.label, (master.current ? "Current Master · this window operates from here" : "Merged Master · this window reaches its target hosts through it"), actions);
    const needsSelf = '<div class="callout">' + icons.info + "<div><strong>Make this Master a target host of itself</strong><p>Jobs, files and the terminal run through the same secure target-host path as every other host. Pair this Master with itself once (address 127.0.0.1) to use them here</p>" +
      '<div class="form-actions"><button class="primary" data-action="dc-add" data-self="1">Set up…</button></div></div></div>';
    const body = state.dc.tab === "summary"
      ? '<div class="stat-grid">' + stat("Role", master.current ? "Current Master" : "Merged Master") + stat("Target hosts", String(master.machines.length)) + stat("Online", String(dcOnline(master.machines))) + "</div>" +
        '<section class="section mt"><div class="section-heading"><h2>Target hosts</h2></div>' + dcMachineTable(master.machines) + "</section>"
      : state.dc.tab === "jobs" ? (target ? renderJobs(target) : needsSelf)
      : state.dc.tab === "files" ? (target ? renderFiles(target) : needsSelf)
      : state.dc.tab === "monitoring" ? renderMonitorTab(dcKey(master.item), master.label) : renderContainerTab(dcKey(master.item), master.label);
    return head + tabs + body;
  }
  if (found.kind === "site") {
    const { site, masters } = found, machines = masters.flatMap(master => master.machines);
    return heading(site.name, "Datacenter · groups Masters for organizing only; drag Masters in or out in the tree",
      '<button data-action="site-rename" data-id="' + esc(site.id) + '">Rename</button><button class="danger" data-action="site-delete" data-id="' + esc(site.id) + '">Delete datacenter</button>') +
      '<div class="stat-grid">' + stat("Masters", String(masters.length)) + stat("Target hosts", String(machines.length)) + stat("Online", String(dcOnline(machines))) + "</div>" +
      '<section class="section mt"><div class="section-heading"><h2>Hosts</h2></div>' + (masters.length ? siteHostTable(masters)
        : '<div class="empty-inline">No Masters yet · drag a Master here from the tree</div>') + "</section>";
  }
  if (found.kind === "folder") {
    const { folder, master } = found;
    const actions = '<button data-action="folder-rename" data-id="' + esc(folder.id) + '">Rename</button><button class="danger" data-action="folder-delete" data-id="' + esc(folder.id) + '">Delete folder</button>';
    return heading(folder.name, "Folder on " + master.label + " · for organizing only; drag machines in or out in the tree", actions) +
      '<div class="stat-grid">' + stat("Master", esc(master.label)) + stat("Target hosts", String(folder.machines.length)) + stat("Online", String(dcOnline(folder.machines))) + "</div>" +
      '<section class="section mt">' + (folder.machines.length ? dcMachineTable(folder.machines) : '<div class="empty-inline">Empty folder · drag target hosts here from the tree</div>') + "</section>";
  }
  const item = found.item;
  const head = '<div class="page-heading"><div class="target-title"><span class="live-label">● ' + esc(dcPath(item)) + "</span><h1>" + esc(item.label || item.id) + '</h1><div class="meta-row">' + statusBadge(item) + (item.os ? chip(osName(item.os)) : "") + "</div></div>" +
    '<div class="target-actions">' + foilSticker(item) + '<button class="primary" data-action="open-shell" data-id="' + esc(item.id) + '"' + (!item.runnerInstalled ? ' disabled title="Install the Target service first"' : "") + ">" + icons.shell + 'Open terminal</button><button data-action="diagnose">' + icons.pulse + "Check connection</button></div></div>" +
    (!item.runnerInstalled ? '<div class="callout pending">' + icons.alert + "<div><strong>Imported with a v1 registry</strong><p>Install the Target service and import a new registration to run jobs on this host</p></div></div>" : "");
  const tabs = '<div id="check-slot">' + renderCheckPanel(item) + "</div>" + dcTabs([["summary", "Summary"], ["jobs", "Jobs & logs"], ["files", "Files"], ["containers", "Containers"], ["monitoring", "Monitoring"]]);
  const body = state.dc.tab === "summary" ? renderOverview(item) : state.dc.tab === "jobs" ? renderJobs(item) : state.dc.tab === "files" ? renderFiles(item)
    : state.dc.tab === "monitoring" ? renderMonitorTab(item.id, item.label || item.id) : renderContainerTab(item.id, item.label || item.id);
  return head + tabs + body;
}
function ctBadge(state) {
  const styles = { running: "good", exited: "", created: "pending", paused: "pending", restarting: "running", dead: "bad", removing: "pending" };
  return '<span class="badge ' + (styles[state] || "") + '">' + esc(state || "unknown") + "</span>";
}
function renderContainerTab(key, label) {
  const entry = state.containers.get(key), data = entry?.data;
  const view = '<div class="segmented" role="group" aria-label="Show">' + [["containers", "Containers"], ["images", "Images"]].map(([id, text]) => '<button data-action="ct-view" data-view="' + id + '" aria-pressed="' + (state.dc.ctView === id) + '">' + text + "</button>").join("") + "</div>";
  const bar = '<div class="toolbar">' + view + (state.dc.ctView === "containers"
    ? '<div class="segmented" role="group" aria-label="Filter containers">' + [["running", "Running"], ["all", "All"]].map(([id, text]) => '<button data-action="ct-filter" data-filter="' + id + '" aria-pressed="' + (state.dc.filter === id) + '">' + text + "</button>").join("") + "</div>"
    : "") + (data?.runtime ? chip(data.runtime) : "") + '<span class="status-meta">' + (entry?.loading ? "Loading…" : entry?.at ? "Updated " + esc(timestamp(entry.at)) : "") + "</span>" +
    '<button data-action="ct-refresh" data-key="' + esc(key) + '">' + icons.refresh + "Refresh</button></div>";
  if (!entry || (entry.loading && !data)) return bar + '<div class="empty-inline">Reading containers on ' + esc(label) + "…</div>";
  if (entry.error) return bar + '<div class="callout bad">' + icons.alert + "<div><strong>Could not read containers</strong><p>" + esc(entry.error) + "</p></div></div>";
  if (!data.runtime) return bar + '<div class="callout">' + icons.info + "<div><strong>No container runtime</strong><p>Neither docker nor podman was found on " + esc(label) + ".</p></div></div>";
  if (data.error) return bar + '<div class="callout bad">' + icons.alert + "<div><strong>" + esc(data.runtime) + " is not answering</strong><p>" + esc(data.error) + "</p></div></div>";
  const note = data.truncated ? '<p class="help">Showing the first 500 entries.</p>' : "";
  if (state.dc.ctView === "images") {
    if (!data.images.length) return bar + '<div class="empty-inline">No images</div>';
    return bar + '<div class="table-wrap"><table><thead><tr><th>Repository</th><th>Tag</th><th>Image ID</th><th>Size</th><th>Created</th></tr></thead><tbody>' +
      data.images.map(image => "<tr><td><code>" + esc(image.repository) + "</code></td><td>" + chip(image.tag) + "</td><td><code>" + esc(String(image.id).replace(/^sha256:/, "").slice(0, 12)) + '</code></td><td class="num">' + esc(image.size || formatSize(image.sizeBytes)) + '</td><td class="muted">' + esc(image.created) + "</td></tr>").join("") +
      "</tbody></table></div>" + note;
  }
  const running = data.containers.filter(row => row.state === "running").length;
  const rows = state.dc.filter === "running" ? data.containers.filter(row => row.state === "running") : data.containers;
  const summary = '<p class="info-line">' + running + " running · " + data.containers.length + " total · " + data.images.length + " images</p>";
  const table = rows.length
    ? '<div class="table-wrap"><table><thead><tr><th>Container</th><th>State</th><th>Status</th><th>Ports</th><th></th></tr></thead><tbody>' +
      rows.map(row => {
        const ref = esc(row.name || row.id), on = row.state === "running";
        const act = (action, text, danger) => '<button class="small' + (danger ? " danger" : "") + '" data-action="ct-action" data-key="' + esc(key) + '" data-container="' + ref + '" data-verb="' + action + '">' + text + "</button>";
        // Image sits under the name so long references never squeeze a column of their own.
        return '<tr><td class="ct-name"><strong title="' + esc(row.name) + '">' + esc(row.name) + '</strong><small class="ct-image" title="' + esc(row.image) + '"><code>' + esc(row.image) + "</code></small><small><code>" + esc(String(row.id).slice(0, 12)) + "</code></small></td><td>" + ctBadge(row.state) + '</td><td class="muted ct-status">' + esc(row.status) + '</td><td class="wrap"><code>' + esc(row.ports || "—") + "</code></td>" +
          '<td class="actions"><div class="target-actions"><button class="small" data-action="ct-logs" data-key="' + esc(key) + '" data-container="' + ref + '">Logs</button>' +
          (on ? act("restart", "Restart") + act("stop", "Stop", true) : act("start", "Start")) + "</div></td></tr>";
      }).join("") + "</tbody></table></div>"
    : '<div class="empty-inline">' + (state.dc.filter === "running" ? "No running containers · switch to All to see stopped ones" : "No containers") + "</div>";
  const logs = state.ctLogs?.key === key
    ? '<div class="console mt"><div class="console-bar"><strong>Logs · ' + esc(state.ctLogs.container) + "</strong><small>last 200 lines</small>" +
      '<button class="small" data-action="ct-logs" data-key="' + esc(key) + '" data-container="' + esc(state.ctLogs.container) + '">' + icons.refresh + 'Reload</button><button class="small" data-action="ct-logs-close">Close</button></div>' +
      '<div class="output" tabindex="0" aria-label="Container logs"><pre>' + esc(state.ctLogs.loading ? "Loading…" : state.ctLogs.error || state.ctLogs.content || "No log output") + "</pre></div></div>"
    : "";
  return bar + summary + table + note + logs;
}
/* Monitoring: each poll is one bridge call returning counters; CPU % and network rates come from the
   difference between consecutive samples. Polling runs only while this tab is on screen and focused. */
const MONITOR_SAMPLES = 120;
function visibleMonitorKey() {
  if (state.page !== "datacenter" || state.dc.adding || state.dc.tab !== "monitoring") return null;
  const found = state.dc.node === "dc" ? null : dcLookup(state.dc.node);
  if (found?.kind === "master") return dcKey(found.master.item);
  if (found?.kind === "node") return found.item.id;
  return null;
}
function monitorSeries(samples) {
  const rows = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i], seconds = Math.max(0.001, (b.at - a.at) / 1000);
    const total = b.cpu.total - a.cpu.total, idle = b.cpu.idle - a.cpu.idle;
    rows.push({
      at: b.at,
      cpu: total > 0 ? Math.min(100, Math.max(0, 100 * (1 - idle / total))) : null,
      memory: b.memory.total ? 100 * (1 - b.memory.available / b.memory.total) : null,
      rx: a.net && b.net ? Math.max(0, (b.net.rx - a.net.rx) / seconds) : null,
      tx: a.net && b.net ? Math.max(0, (b.net.tx - a.net.tx) / seconds) : null,
      load: b.load?.length ? b.load[0] : null
    });
  }
  return rows;
}
const formatRate = value => value == null ? "—" : formatSize(value) + "/s";
const clock = at => new Date(at).toLocaleTimeString("en-GB");
/** One-axis sparkline: thin line, faint area, endpoint marker, a native tooltip per sample. */
function sparkline(rows, series, max) {
  const w = 300, h = 56, n = rows.length;
  if (n < 2) return '<div class="spark-empty">Collecting…</div>';
  const top = max ?? Math.max(1, ...rows.flatMap(row => series.map(s => row[s.key] ?? 0)));
  const x = i => (i / (n - 1)) * w, y = v => h - 2 - (Math.min(v, top) / top) * (h - 6);
  const lines = series.map((s, index) => {
    const cls = " series-" + (index + 1);
    const points = rows.map((row, i) => row[s.key] == null ? null : [x(i), y(row[s.key])]).filter(Boolean);
    if (points.length < 2) return "";
    const d = points.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
    const last = points[points.length - 1];
    return (series.length === 1 ? '<path class="spark-area" d="' + d + " L" + last[0].toFixed(1) + " " + h + " L" + points[0][0].toFixed(1) + " " + h + ' Z"/>' : "") +
      '<path class="spark-line' + cls + '" d="' + d + '"/><circle class="spark-dot' + cls + '" cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="3"/>';
  }).join("");
  const hits = rows.map((row, i) => '<rect class="spark-hit" x="' + (x(i) - w / (2 * (n - 1))).toFixed(1) + '" y="0" width="' + (w / (n - 1)).toFixed(1) + '" height="' + h + '"><title>' +
    esc(clock(row.at) + " · " + series.map(s => s.label + " " + s.format(row[s.key])).join(" · ")) + "</title></rect>").join("");
  return '<svg class="spark" viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none" role="img" aria-label="' + esc(series.map(s => s.label).join(" and ")) + ' over time">' +
    '<line class="spark-grid" x1="0" x2="' + w + '" y1="' + (h - 2) + '" y2="' + (h - 2) + '"/>' + lines + hits + "</svg>";
}
function meter(percent) {
  const value = Math.min(100, Math.max(0, percent));
  return '<svg class="meter" viewBox="0 0 100 10" preserveAspectRatio="none" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(value) + '"><rect class="meter-track" width="100" height="10"/><rect class="meter-fill' + (value >= HOT ? " is-hot" : "") + '" width="' + value.toFixed(1) + '" height="10"/></svg>';
}
function renderMonitorBody(key) {
  const entry = state.monitor.get(key);
  if (!entry || (!entry.samples.length && !entry.error)) return '<div class="empty-inline">Reading counters…</div>';
  if (!entry.samples.length) return '<div class="callout bad">' + icons.alert + "<div><strong>Could not read utilization</strong><p>" + esc(entry.error) + "</p></div></div>";
  const latest = entry.samples[entry.samples.length - 1], rows = monitorSeries(entry.samples), now = rows[rows.length - 1] || {};
  const pct = value => value == null ? "—" : value.toFixed(value < 10 ? 1 : 0) + "%";
  const memUsed = latest.memory.total - latest.memory.available;
  const disk = latest.disk, diskUsed = disk ? disk.total - disk.free : 0;
  // Six tiles of one shape (label · big value · one line · chart of one height), three by two, so the page reads evenly.
  const tile = (title, value, sub, chart, hint = "") => '<section class="mon-tile"' + (hint ? ' title="' + esc(hint) + '"' : "") + '><span class="stat-label">' + title + (hint ? ' <span class="mon-hint" aria-hidden="true">?</span>' : "") + "</span>" +
    '<span class="mon-value">' + value + '</span><small class="mon-sub">' + (sub || "&nbsp;") + '</small><div class="mon-chart">' + (chart || "") + "</div></section>";
  const cores = latest.cpu.count, load = latest.load;
  const net = (key, label) => latest.net ? sparkline(rows, [{ key, label, format: formatRate }]) : "";
  const tiles = [
    tile("CPU", pct(now.cpu), cores + " cores", sparkline(rows, [{ key: "cpu", label: "CPU", format: pct }], 100)),
    tile("Memory", pct(now.memory ?? 100 * memUsed / latest.memory.total), esc(formatSize(memUsed) + " of " + formatSize(latest.memory.total)) + (latest.swap?.total ? " · swap " + esc(formatSize(latest.swap.total - latest.swap.free)) : ""),
      sparkline(rows, [{ key: "memory", label: "Memory", format: pct }], 100)),
    tile("Disk " + esc(disk?.path || ""), disk ? pct(100 * diskUsed / disk.total) : "—", disk ? esc(formatSize(diskUsed) + " of " + formatSize(disk.total) + " · " + formatSize(disk.free) + " free") : "Not reported", disk ? meter(100 * diskUsed / disk.total) : ""),
    tile("↓ Download", latest.net ? esc(formatRate(now.rx)) : "—", latest.net ? "Received by this host · all interfaces" : "Not reported on this OS", net("rx", "Download")),
    tile("↑ Upload", latest.net ? esc(formatRate(now.tx)) : "—", latest.net ? "Sent by this host · all interfaces" : "Not reported on this OS", net("tx", "Upload")),
    tile("Load · 1 min", load?.length ? load[0].toFixed(2) : "—", load?.length ? "of " + cores + " cores · 5 min " + load[1].toFixed(2) + " · 15 min " + load[2].toFixed(2) : "Not reported on Windows",
      load?.length ? sparkline(rows, [{ key: "load", label: "Load", format: v => v == null ? "—" : v.toFixed(2) }], Math.max(cores, ...rows.map(row => row.load ?? 0))) : "",
      "Processes running or waiting for the CPU, averaged. Below the number of cores (" + cores + ") the CPU keeps up; above it, work queues.")
  ];
  return (entry.error ? '<div class="callout bad">' + icons.alert + "<div><strong>Last poll failed</strong><p>" + esc(entry.error) + "</p></div></div>" : "") + '<div class="mon-grid">' + tiles.join("") + "</div>";
}
function renderMonitorTab(key) {
  const entry = state.monitor.get(key), seconds = state.dc.monInterval / 1000;
  const history = entry?.samples.length > 1 ? " · history " + formatUptime((entry.samples[entry.samples.length - 1].at - entry.samples[0].at) / 1000) : "";
  return '<div class="toolbar"><div class="segmented" role="group" aria-label="Update every">' + [2000, 5000, 10000].map(ms => '<button data-action="mon-interval" data-ms="' + ms + '" aria-pressed="' + (!state.dc.monPaused && state.dc.monInterval === ms) + '">' + ms / 1000 + " s</button>").join("") +
    '</div><button data-action="mon-pause" aria-pressed="' + state.dc.monPaused + '">' + (state.dc.monPaused ? "Resume" : "Pause") + '</button><span class="status-meta" id="mon-meta">' +
    (state.dc.monPaused ? "Paused" : "Every " + seconds + " s while this tab is open") + (entry?.samples.length ? " · updated " + esc(clock(entry.samples[entry.samples.length - 1].at)) : "") + history +
    (entry?.samples.length ? " · up " + esc(formatUptime(entry.samples[entry.samples.length - 1].uptimeSeconds)) : "") + "</span></div>" +
    '<div id="mon-body">' + renderMonitorBody(key) + "</div>";
}
function refreshMonitorView() {
  const key = visibleMonitorKey();
  if (key && $("#dc-panel")) $("#dc-panel").innerHTML = renderDcPanel();
}
async function loadStats(key) {
  const entry = state.monitor.get(key) || { samples: [], loading: false, error: "" };
  if (entry.loading) return;
  entry.loading = true; state.monitor.set(key, entry);
  try {
    const sample = await rpc("monitor.stats", dcTargetParams(key));
    // The window's clock times the samples so rates stay right even if the Target's clock is off.
    entry.samples.push({ ...sample, at: Date.now() });
    if (entry.samples.length > MONITOR_SAMPLES) entry.samples.splice(0, entry.samples.length - MONITOR_SAMPLES);
    entry.error = "";
  } catch (error) { entry.error = String(error?.message || error); }
  finally { entry.loading = false; entry.polled = Date.now(); }
  if (visibleMonitorKey() === key) {
    $("#mon-body") && ($("#mon-body").innerHTML = renderMonitorBody(key));
    const meta = $("#mon-meta");
    const last = entry.samples[entry.samples.length - 1];
    if (meta) meta.textContent = (state.dc.monPaused ? "Paused" : "Every " + state.dc.monInterval / 1000 + " s while this tab is open") + " · updated " + clock(Date.now()) + (last ? " · up " + formatUptime(last.uptimeSeconds) : "");
  }
}
function dcTargetParams(key) { return key === "local" ? {} : { targetId: key }; }
async function loadContainers(key) {
  const previous = state.containers.get(key);
  state.containers.set(key, { ...previous, loading: true });
  if (state.page === "datacenter") $("#dc-panel").innerHTML = renderDcPanel();
  try {
    const data = await rpc("containers.list", dcTargetParams(key));
    state.containers.set(key, { data, at: new Date(), loading: false });
  } catch (error) {
    state.containers.set(key, { error: String(error?.message || error), at: new Date(), loading: false });
  }
  if (state.page === "datacenter") $("#dc-panel").innerHTML = renderDcPanel();
}
/** Key of the machine whose Containers/Images tab is visible, or null. */
function visibleContainerKey() {
  if (state.page !== "datacenter" || state.dc.tab !== "containers") return null;
  const found = state.dc.node === "dc" ? null : dcLookup(state.dc.node);
  if (found?.kind === "master") return dcKey(found.master.item);
  if (found?.kind === "node") return found.item.id;
  return null;
}
async function loadContainersIfShown(force = false) {
  const key = visibleContainerKey();
  if (key && (force || !state.containers.has(key))) await loadContainers(key);
}
/** The machine page in the Datacenter shows `tab` ("jobs", "files", …). */
const machineTab = tab => state.page === "datacenter" && !state.dc.adding && state.dc.tab === tab && Boolean(pageTarget());
async function selectTarget(id, tab = "summary") {
  state.page = "datacenter"; state.dc.node = "node:" + id; state.dc.tab = tab; state.dc.adding = null; state.ctLogs = null;
  state.selected = id; state.job = null; state.jobs = []; state.jobsError = "";
  state.files = null; state.filesError = ""; state.file = null; state.pendingJob = null; state.newJob = false;
  clearNotice(); render();
}
async function refreshJobs() {
  const targetId = state.selected;
  if (!targetId) return;
  try {
    const jobs = await rpc("jobs.list", { targetId });
    if (targetId !== state.selected) return;
    state.jobs = Array.isArray(jobs) ? jobs : []; state.jobsError = "";
  } catch (error) {
    if (targetId !== state.selected) return;
    state.jobsError = String(error);
  }
  if (machineTab("jobs") && $("#job-list")) $("#job-list").innerHTML = renderJobRows();
}
let logVersion = 0;
async function refreshSelectedJob(reset = false) {
  if (!state.job) return;
  const version = ++logVersion, targetId = state.selected, jobId = state.job.id, stream = state.stream;
  const [job, logs] = await Promise.all([
    rpc("jobs.status", { targetId, jobId }),
    rpc("jobs.logs", { targetId, jobId, stream, offset: reset ? 0 : state.offset, limit: 65536 })
  ]);
  if (version !== logVersion || targetId !== state.selected || jobId !== state.job?.id || stream !== state.stream) return;
  state.job = job; state.log = ((reset ? "" : state.log) + (logs.content || "")).slice(-500000);
  state.offset = logs.nextOffset; state.eof = logs.eof;
  if (machineTab("jobs") && $("#job-detail")) {
    const oldLog = $("#log-output"), scroll = oldLog?.scrollTop || 0;
    const wasAtBottom = !oldLog || oldLog.scrollHeight - scroll - oldLog.clientHeight < 40;
    $("#job-detail").innerHTML = renderJobDetail();
    if ($("#log-output")) $("#log-output").scrollTop = wasAtBottom ? $("#log-output").scrollHeight : scroll;
  }
}
async function importRegistration(registration) {
  const imported = await rpc("targets.import", { registration });
  await refreshFleet(); await selectTarget(imported.id || registration.id); notify("Target imported");
}
async function browseFiles(path) {
  const targetId = state.selected;
  const result = await rpc("files.list", { targetId, path });
  if (targetId !== state.selected) return;
  const resolved = Array.isArray(result) ? path : result.path || path;
  if (resolved !== state.files?.path) state.fileQuery = "";
  state.files = { path: resolved, entries: Array.isArray(result) ? result : result.entries || [] }; state.filesError = "";
  state.recentPaths = [resolved, ...(state.recentPaths || []).filter(row => row !== resolved)].slice(0, 6);
  state.file = null;
  if (machineTab("files")) render();
}
/** Opening the Files tab lists the system root right away instead of an empty path prompt. */
async function loadFilesIfShown() {
  if (!machineTab("files") || state.files || state.filesError) return;
  try { await browseFiles("~"); }
  catch (error) { state.filesError = friendlyError(error); if (machineTab("files")) render(); }
}
const UPLOAD_MAX = 2 * 1024 ** 3, UPLOAD_CHUNK = 1024 * 1024;
const randomId = () => [...crypto.getRandomValues(new Uint8Array(16))].map(byte => byte.toString(16).padStart(2, "0")).join("");
/** Upload status above the file list: progress bar with a cancel ✕ at its end, or a Replace/Skip question. */
function renderUploadStatus() {
  const up = state.upload;
  if (!up) return "";
  const file = up.files[up.index], count = up.files.length > 1 ? " (" + (up.index + 1) + " of " + up.files.length + ")" : "";
  if (up.ask) return '<div class="upload-status is-ask" role="alert"><p><code>' + esc(file.name) + "</code> already exists in this folder" + esc(count) + "</p>" +
    '<div class="upload-ask"><button type="button" class="small" data-action="upload-answer" data-answer="replace">Replace</button><button type="button" class="small" data-action="upload-answer" data-answer="skip">Skip</button>' +
    '<button type="button" class="small" data-action="upload-cancel">Cancel all</button></div></div>';
  const percent = up.total ? Math.floor(up.sent / up.total * 100) : 0;
  return '<div class="upload-status" role="status"><p><span>' + (up.cancelling ? "Cancelling…" : "Uploading <code>" + esc(file.name) + "</code>" + esc(count)) + '</span><span class="upload-numbers">' +
    esc(formatSize(up.sent)) + " of " + esc(formatSize(up.total)) + " · " + percent + "%</span></p>" +
    '<div class="upload-row"><div class="upload-bar" role="progressbar" aria-label="Upload progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + percent + '"><i></i></div>' +
    '<button type="button" class="icon-button upload-cancel" data-action="upload-cancel" aria-label="Cancel upload" title="Cancel upload"' + (up.cancelling ? " disabled" : "") + ">" + icons.close + "</button></div></div>";
}
function paintUpload() {
  const box = $("#upload-status");
  if (!box) return;
  box.innerHTML = renderUploadStatus();
  const bar = box.querySelector(".upload-bar i");
  if (bar) bar.style.width = (state.upload.total ? state.upload.sent / state.upload.total * 100 : 0) + "%";
}
/** Asks Replace / Skip / Cancel in the status bar (no confirm(): the desktop webview has none). */
function askReplace() {
  state.upload.ask = true; paintUpload();
  return new Promise(resolve => { state.upload.answer = answer => { state.upload.ask = false; state.upload.answer = null; paintUpload(); resolve(answer); }; });
}
/** Upload files into the open folder in 1 MiB chunks (files.upload); a file appears only when complete and never replaces one without asking. */
async function uploadFiles(files) {
  const targetId = state.selected, folder = state.files?.path;
  if (!folder) throw new Error("Open a folder first");
  if (state.upload) { notify("Another upload is running · wait for it or cancel it first", true); return; }
  const big = files.filter(file => file.size > UPLOAD_MAX);
  if (big.length) notify(big.map(file => file.name).join(", ") + " is larger than 2 GiB · use a job or the CLI", true);
  files = files.filter(file => file.size <= UPLOAD_MAX);
  if (!files.length) return;
  const up = state.upload = { files, index: 0, sent: 0, total: files.reduce((sum, file) => sum + file.size, 0), cancelled: false };
  const names = new Set((state.files?.entries || []).map(entry => entry.name));
  let done = 0, skipped = 0;
  paintUpload();
  try {
    for (; up.index < files.length && !up.cancelled; up.index++) {
      const file = files[up.index], path = joinPath(folder, file.name), uploadId = randomId(), base = up.sent;
      let replace = false;
      if (names.has(file.name)) {
        const answer = await askReplace();
        if (answer === "cancel") break;
        if (answer === "skip") { up.total -= file.size; skipped++; paintUpload(); continue; }
        replace = true;
      }
      let offset = 0;
      try {
        do {
          const bytes = new Uint8Array(await file.slice(offset, offset + UPLOAD_CHUNK).arrayBuffer());
          const last = offset + bytes.length >= file.size;
          await rpc("files.upload", { targetId, path, uploadId, offset, contentBase64: bytesToBase64(bytes), ...(last ? { done: true, ...(replace ? {} : { expectedSha256: "" }) } : {}) });
          offset += bytes.length; up.sent = base + offset; paintUpload();
        } while (offset < file.size && !up.cancelled);
        if (up.cancelled && offset < file.size) { await rpc("files.upload", { targetId, path, uploadId, abort: true }).catch(() => {}); break; }
        done++;
      } catch (error) {
        // Created by someone else meanwhile: ask, then commit the finished part or discard it.
        if (!/E_CONFLICT/.test(String(error?.message || error)) || offset + UPLOAD_CHUNK < file.size) { await rpc("files.upload", { targetId, path, uploadId, abort: true }).catch(() => {}); throw error; }
        const answer = await askReplace();
        if (answer === "replace") { await rpc("files.upload", { targetId, path, uploadId, offset: file.size, contentBase64: "", done: true }); up.sent = base + file.size; done++; }
        else { await rpc("files.upload", { targetId, path, uploadId, abort: true }).catch(() => {}); if (answer === "cancel") break; skipped++; }
      }
    }
  } finally {
    const cancelled = up.cancelled;
    state.upload = null; paintUpload();
    if (targetId === state.selected && state.files?.path === folder) await browseFiles(folder).catch(() => {});
    if (cancelled) notify("Upload cancelled · " + (done ? done + " file" + (done === 1 ? "" : "s") + " finished before that; " : "") + "the unfinished file was not saved");
    else if (done) notify("Uploaded " + done + " file" + (done === 1 ? "" : "s") + " to " + folder + (skipped ? " · skipped " + skipped : ""));
  }
}
/** Saves through the native dialog; the app fetches the bytes itself, so any size works. */
async function downloadFile(path, name) {
  const saved = await native("save_remote_file", { targetId: state.selected, path, name });
  if (saved) notify("Downloaded " + name + " to " + saved);
}
async function readFile(path) {
  const targetId = state.selected;
  const result = await rpc("files.read", { targetId, path, offset: 0, limit: 262144 });
  if (targetId !== state.selected) return;
  const bytes = Uint8Array.from(atob(result.contentBase64), c => c.charCodeAt(0));
  let content, validUtf8 = true;
  try { content = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { validUtf8 = false; content = "This file is binary or not UTF-8"; }
  if (content?.includes("\0")) { validUtf8 = false; content = "This file contains binary data"; }
  state.file = { path, content, sha256: result.sha256, editable: validUtf8 && result.eof, size: result.size };
  if (machineTab("files")) render();
}
async function refreshFolders() { state.folders = await rpc("folders.list"); }
async function refreshDatacenters() { state.datacenters = await rpc("datacenters.list"); }
async function saveFolderEdit(input) {
  const editing = state.dc.editing;
  if (!editing || input.dataset.saving) return;
  input.dataset.saving = "1";
  const name = input.value.trim();
  try {
    if (name && editing.mode === "new-site") {
      await rpc("datacenters.create", { name }); await refreshDatacenters(); notify("Datacenter " + name + " created · drag Masters into it");
    } else if (name && editing.mode === "rename-site") {
      await rpc("datacenters.rename", { id: editing.id, name }); await refreshDatacenters();
    } else if (name && editing.mode === "new") {
      const folder = await rpc("folders.create", { name, master: editing.master });
      state.dc.collapsed.delete("master:" + editing.master);
      await refreshFolders(); notify("Folder " + folder.name + " created · drag machines into it");
    } else if (name && editing.mode === "rename") {
      await rpc("folders.rename", { id: editing.id, name }); await refreshFolders();
    }
  } catch (error) { notify(error?.message || error, true); }
  state.dc.editing = null; render();
}
async function runDiagnose(targetId) {
  // Only the result slot is redrawn, so an open file editor or job form keeps its contents.
  const paint = () => { const slot = $("#check-slot"); if (slot && state.selected === targetId) slot.innerHTML = renderCheckPanel(state.targets.find(item => item.id === targetId)); };
  state.checking = targetId; (state.checkHidden ||= new Set()).delete(targetId); paint();
  try {
    const result = await rpc("targets.doctor", { targetId });
    state.diagnostics.set(targetId, { ...result, checkedAt: new Date().toISOString() });
  } finally { state.checking = null; paint(); }
}
async function removeTarget(targetId) {
  if (!confirm("Remove Target " + targetId + " from this Master’s registry?")) return;
  await rpc("targets.remove", { targetId });
  if (state.selected === targetId) { state.selected = null; state.dc.node = "dc"; state.dc.tab = "summary"; }
  await refreshFleet(); render(); notify("Target removed from the registry");
}
const encodeBase64 = text => bytesToBase64(new TextEncoder().encode(text));
function bytesToBase64(bytes) {
  let raw = "";
  for (let i = 0; i < bytes.length; i += 8192) raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(raw);
}
function playEgg(host) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const element = host.dataset.egg === "ring" ? host.querySelector(".ring") : host;
  if (!element) return;
  element.classList.remove("is-playing");
  void element.offsetWidth;
  element.classList.add("is-playing");
}
document.addEventListener("animationend", event => event.target.classList?.remove("is-playing"));
document.addEventListener("keydown", event => {
  if ((event.key === "Enter" || event.key === " ") && event.target.dataset?.egg) { event.preventDefault(); playEgg(event.target); }
});
document.addEventListener("click", event => {
  if (event.target.closest("#notice-close")) { clearNotice(); return; }
  const egg = event.target.closest("[data-egg]");
  if (egg && !event.target.closest(".marker")) { playEgg(egg); return; }
  const nav = event.target.closest("[data-page]");
  if (nav) { if (nav.dataset.page === "datacenter") { state.dc.node = "dc"; state.dc.adding = null; } void navigate(nav.dataset.page); return; }
  const button = event.target.closest("[data-action]");
  if (button?.closest("#dc-menu")) closeDcMenu();
  if (!button) return;
  void busy(button, async () => {
    const action = button.dataset.action;
    if (action === "open-shell") return openShell(button.dataset.id);
    if (action === "close-shell-dialog") { $("#shell-dialog").close(); return; }
    if (action === "close-two-way-dialog") { $("#two-way-dialog").close(); return; }
    if (action === "open-two-way") {
      const dialog = $("#two-way-dialog"), merge = state.merges.find(row => row.targetId === button.dataset.id);
      dialog.querySelectorAll(".two-way-peer").forEach(item => { item.textContent = merge?.label || button.dataset.id; });
      dialog.querySelector('[name="targetId"]').value = button.dataset.id;
      dialog.showModal(); return;
    }
    if (action === "copy") return copyText(button.dataset.copy);
    if (action === "copy-log") return copyText(state.log, "Log copied");
    if (action === "copy-diagnostics") return copyText(pretty(state.diagnostics.get(state.selected)), "Check result copied");
    if (action === "add") return navigate("enroll");
    if (action === "new-pairing") { state.pairing = null; addReset(); render(); }
    if (action === "refresh-pairings") { await refreshPairings(); render(); }
    if (action === "resume-pairing") { state.pairing = state.pairings.find(item => item.requestId === button.dataset.id); addReset(); render(); }
    if (action === "save-setup") await saveInstaller();
    if (action === "add-skip-save") { state.add.skipped.add(state.pairing?.requestId); render(); }
    if (action === "open-paired-target") { state.pairing = null; addReset(); await refreshFleet(); await selectTarget(button.dataset.id); }
    if (action === "back-fleet") { state.page = "datacenter"; state.dc.node = "dc"; state.selected = null; render(); }
    if (action === "tree-toggle") { state.dc.treeHidden = state.dc.treeHidden !== true; renderHeader(); return; }
    if (action === "add-host" || action === "dc-add") {
      state.page = "datacenter"; state.dc.adding = { folder: button.dataset.folder || "", site: button.dataset.site || "", self: Boolean(button.dataset.self) };
      state.pairing = null; state.pairedMaster = null; addReset(); render();
      try { await refreshPairings(); render(); } catch (error) { notify(pairingError(error), true); }
    }
    if (action === "enroll-close") {
      state.pairing = null; addReset();
      if (state.page === "datacenter") { state.dc.adding = null; render(); } else await navigate("datacenter");
    }
    if (action === "pairing-back") { state.pairing = null; addReset(); render(); }
    if (action === "pairing-cancel") {
      const requestId = button.dataset.id;
      if (!confirm(addText.cancelConfirm)) return;
      await rpc("pairing.cancel", { requestId });
      state.saved.delete(requestId);
      if (state.pairing?.requestId === requestId) { state.pairing = null; addReset(); }
      await refreshPairings(); render(); notify(addText.cancelled);
    }
    if (action === "dc-goto") {
      const node = button.dataset.node;
      if (button.dataset.view) state.dc.ctView = button.dataset.view;
      if (node.startsWith("node:")) await selectTarget(node.slice(5), button.dataset.tab || "summary");
      else { state.page = "datacenter"; state.dc.node = node; state.dc.tab = button.dataset.tab || "summary"; state.dc.adding = null; resetHostState(pageTarget()?.id); render(); }
      if (state.dc.tab === "jobs") await refreshJobs();
      await loadContainersIfShown(); await loadFilesIfShown();
      if (visibleMonitorKey()) await loadStats(visibleMonitorKey());
    }
    if (action === "ctx-diagnose") { await selectTarget(button.dataset.id); await runDiagnose(button.dataset.id); }
    if (action === "ctx-remove") await removeTarget(button.dataset.id);
    if (action === "folder-new") {
      state.dc.editing = { mode: "new", master: button.dataset.master };
      $("#dc-tree").innerHTML = renderDcTree(); $("#dc-edit")?.focus();
    }
    if (action === "folder-rename") {
      const folder = (state.folders.folders || []).find(row => row.id === button.dataset.id);
      state.dc.editing = { mode: "rename", id: button.dataset.id, master: folder?.master };
      $("#dc-tree").innerHTML = renderDcTree(); $("#dc-edit")?.select();
    }
    if (action === "folder-delete") {
      const folder = (state.folders.folders || []).find(row => row.id === button.dataset.id);
      if (!confirm("Delete folder " + (folder?.name || "") + "? Its target hosts stay and move back under the Master.")) return;
      await rpc("folders.delete", { id: button.dataset.id });
      if (state.dc.node === "folder:" + button.dataset.id) state.dc.node = "master:" + (folder?.master || "local");
      await refreshFolders(); render(); notify("Folder deleted");
    }
    if (action === "site-new") { state.dc.editing = { mode: "new-site" }; state.dc.collapsed.delete("dc"); $("#dc-tree").innerHTML = renderDcTree(); $("#dc-edit")?.focus(); }
    if (action === "site-rename") { state.dc.editing = { mode: "rename-site", id: button.dataset.id }; $("#dc-tree").innerHTML = renderDcTree(); $("#dc-edit")?.select(); }
    if (action === "site-delete") {
      const site = (state.datacenters.datacenters || []).find(row => row.id === button.dataset.id);
      if (!confirm("Delete datacenter " + (site?.name || "") + "? Its Masters and target hosts stay and move back under Inventory.")) return;
      await rpc("datacenters.delete", { id: button.dataset.id });
      if (state.dc.node === "site:" + button.dataset.id) state.dc.node = "dc";
      await refreshDatacenters(); render(); notify("Datacenter deleted");
    }
    if (action === "site-unassign") { await rpc("datacenters.assign", { master: button.dataset.master, datacenterId: null }); await refreshDatacenters(); render(); }
    if (action === "folder-unfile") { await rpc("folders.assign", { targetId: button.dataset.id, folderId: null }); await refreshFolders(); render(); }
    if (action === "clear-filter") { state.query = ""; state.group = ""; state.status = ""; render(); }
    if (action === "status-filter") { state.status = button.dataset.status; $("#fleet-table").innerHTML = renderFleetView(); }
    if (action === "refresh-fleet") { await refreshFleet(); render(); await refreshHealth(true); }
    if (action === "fleet-view") {
      state.view = button.dataset.view; localStorage.setItem("sshcc.fleetView", state.view);
      document.querySelectorAll('[data-action="fleet-view"]').forEach(item => item.setAttribute("aria-pressed", String(item.dataset.view === state.view)));
      $("#fleet-table").innerHTML = renderFleetView();
    }
    if (action === "manage-merge") return navigate("masters");
    if (action === "dc-select") {
      if (state.page !== "datacenter") state.page = "datacenter";
      state.dc.node = button.dataset.node; state.dc.adding = null; state.ctLogs = null;
      if (state.dc.node.startsWith("node:")) await selectTarget(state.dc.node.slice(5), ["summary", "jobs", "files", "containers", "monitoring"].includes(state.dc.tab) ? state.dc.tab : "summary");
      else { resetHostState(pageTarget()?.id); render(); }
      if (machineTab("jobs")) await refreshJobs();
      await loadContainersIfShown(); await loadFilesIfShown();
    }
    if (action === "dc-toggle") {
      const node = button.dataset.node;
      if (state.dc.collapsed.has(node)) state.dc.collapsed.delete(node); else state.dc.collapsed.add(node);
      $("#dc-tree").innerHTML = renderDcTree();
    }
    if (action === "dc-tab") {
      state.dc.tab = button.dataset.tab; state.ctLogs = null; $("#dc-panel").innerHTML = renderDcPanel();
      if (machineTab("jobs")) await refreshJobs();
      await loadContainersIfShown(); await loadFilesIfShown();
      if (visibleMonitorKey()) await loadStats(visibleMonitorKey());
    }
    if (action === "ct-view") { state.dc.ctView = button.dataset.view; $("#dc-panel").innerHTML = renderDcPanel(); }
    if (action === "mon-interval") {
      state.dc.monInterval = Number(button.dataset.ms); state.dc.monPaused = false;
      try { localStorage.setItem("sshcc.monitorInterval", String(state.dc.monInterval)); } catch {}
      refreshMonitorView();
    }
    if (action === "mon-pause") { state.dc.monPaused = !state.dc.monPaused; refreshMonitorView(); }
    if (action === "ct-filter") { state.dc.filter = button.dataset.filter; $("#dc-panel").innerHTML = renderDcPanel(); }
    if (action === "ct-refresh") await loadContainers(button.dataset.key);
    if (action === "ct-logs-close") { state.ctLogs = null; $("#dc-panel").innerHTML = renderDcPanel(); }
    if (action === "ct-logs") {
      const key = button.dataset.key, container = button.dataset.container;
      state.ctLogs = { key, container, loading: true }; $("#dc-panel").innerHTML = renderDcPanel();
      try {
        const result = await rpc("containers.logs", { ...dcTargetParams(key), container, tail: 200 });
        if (state.ctLogs?.key === key && state.ctLogs.container === container) state.ctLogs = { key, container, content: result.content };
      } catch (error) {
        if (state.ctLogs?.key === key) state.ctLogs = { key, container, error: String(error?.message || error) };
      }
      if (state.page === "datacenter") $("#dc-panel").innerHTML = renderDcPanel();
    }
    if (action === "ct-action") {
      const key = button.dataset.key, container = button.dataset.container, verb = button.dataset.verb;
      if (verb !== "start" && !confirm(verb[0].toUpperCase() + verb.slice(1) + " container " + container + "?")) return;
      await rpc("containers.action", { ...dcTargetParams(key), container, action: verb });
      notify(container + ": " + verb + " done");
      await loadContainers(key);
    }
    if (action === "select-target") await selectTarget(button.dataset.id);
    if (action === "toggle-new-job") { state.newJob = !state.newJob; render(); if (state.newJob) $('#start-job [name="cwd"]')?.focus(); }
    if (action === "diagnose") await runDiagnose(state.selected);
    if (action === "check-close") { (state.checkHidden ||= new Set()).add(state.selected); $("#check-slot") && ($("#check-slot").innerHTML = ""); return; }
    if (action === "remove-target") await removeTarget(state.selected);
    if (action === "import-registration") {
      const registration = await native("open_json");
      if (registration) await importRegistration(registration);
    }
    if (action === "import-v1-registry") {
      const document = await native("open_json");
      if (document) {
        const result = await rpc("targets.import_legacy", { document });
        await refreshFleet(); notify("v1 registry imported: " + pretty(result));
      }
    }
    if (action === "save-enrollment") {
      const path = await native("save_json", { document: state.export });
      if (path) notify("Enrollment saved: " + path);
    }
    if (action === "refresh-masters") { await refreshMasters(); render(); }
    if (action === "revoke-master") {
      if (!confirm("Revoke Master " + button.dataset.id + " on this host?")) return;
      await rpc("masters.revoke", { masterId: button.dataset.id }); await refreshMasters(); render(); notify("Master revoked");
    }
    if (action === "ctx-merge") {
      const [row] = await rpc("merges.discover", { targetId: button.dataset.id });
      if (row && !row.error) state.masterCheck.set(row.targetId, row.isMaster);
      if (!row?.isMaster) { notify((row?.label || button.dataset.id) + (row?.error ? " could not be checked: " + row.error : " is not a Master, so there is nothing to merge"), Boolean(row?.error)); return; }
    }
    if (action === "merge-master" || action === "sync-merge" || action === "ctx-merge") {
      const targetId = button.dataset.id;
      state.merging.add(targetId); render();
      try {
        const merge = await rpc(action === "sync-merge" ? "merges.sync" : "merges.add", { targetId });
        notify("Merged " + (merge.label || targetId) + " · " + merge.children.length + " hosts added to the tree");
      } finally {
        state.merging.delete(targetId);
        await refreshMasters(); await refreshFleet(); render();
      }
    }
    if (action === "remove-merge") {
      if (!confirm("Remove the merge with " + button.dataset.id + "? Its target hosts will disappear from this Master")) return;
      await rpc("merges.remove", { targetId: button.dataset.id }); await refreshMasters(); await refreshFleet(); render(); notify("Merge removed");
    }
    if (action === "revoke-relay" || action === "allow-relay") {
      const revoke = action === "revoke-relay";
      if (revoke && !confirm("Disable merging for this Master? It cannot control target hosts through this Master until allowed again")) return;
      await rpc(revoke ? "relays.revoke" : "relays.allow", { masterId: button.dataset.id }); await refreshMasters(); render();
      notify(revoke ? "Merging disabled" : "Merging allowed again");
    }
    if (action === "accept-enrollment") {
      const bundle = await native("open_json");
      if (!bundle) return;
      if (!confirm("Allow Master " + (bundle.master?.label || bundle.master?.id || "") + " to run work with system rights on this host?")) return;
      await rpc("enrollment.accept", { bundle }); await refreshMasters(); render();
      notify("Master added. If its SSH key is not in authorized_keys yet, run the installer with this bundle");
    }
    if (action === "refresh-service") { await refreshLocal(); render(); }
    if (action === "connect-client") {
      await native("client_connect", { client: button.dataset.id });
      await refreshLocal(); render();
      notify("Connected " + (state.clientLinks.find(item => item.id === button.dataset.id)?.label || button.dataset.id) + " · start a new session in that client to load the tools");
    }
    if (action === "update-client-path") {
      await native("client_update_path", { client: button.dataset.id });
      await refreshLocal(); render();
      notify("Updated the path for " + (state.clientLinks.find(item => item.id === button.dataset.id)?.label || button.dataset.id) + " · start a new session to load the tools");
    }
    if (action === "refresh-jobs") { await refreshJobs(); await refreshSelectedJob(); }
    if (action === "select-job") {
      state.job = state.jobs.find(job => job.id === button.dataset.id);
      state.log = ""; state.offset = 0; state.eof = true;
      $("#job-list").innerHTML = renderJobRows(); $("#job-detail").innerHTML = renderJobDetail();
      await refreshSelectedJob(true);
    }
    if (action === "log-stream") {
      state.stream = button.dataset.stream; state.log = ""; state.offset = 0;
      $("#job-detail").innerHTML = renderJobDetail();
      await refreshSelectedJob(true);
    }
    if (action === "read-logs") await refreshSelectedJob();
    if (action === "cancel-job") {
      const targetId = state.selected, jobId = state.job.id;
      if (!confirm("Cancel job " + jobId + " and its child processes?")) return;
      const job = await rpc("jobs.cancel", { targetId, jobId });
      if (targetId !== state.selected || jobId !== state.job?.id) return;
      state.job = job;
      await refreshJobs(); await refreshSelectedJob(); notify("Cancel request sent");
    }
    if (action === "upload-cancel") { if (state.upload) { state.upload.cancelled = state.upload.cancelling = true; state.upload.answer?.("cancel"); paintUpload(); } return; }
    if (action === "upload-answer") { state.upload?.answer?.(button.dataset.answer); return; }
    if (action === "upload-pick") { $("#upload-input")?.click(); return; }
    if (action === "path-menu") {
      const box = button.getBoundingClientRect(), chain = [];
      for (let path = state.files?.path; path && !chain.includes(path); path = parentPath(path)) chain.unshift(path);
      const items = [{ label: "~  Home", action: "open-folder", data: { path: "~" }, mono: true }, "-",
        ...chain.map((path, depth) => ({ label: depth ? path.split(/[\\/]/).filter(Boolean).pop() : path, action: "open-folder", data: { path }, indent: depth, mono: true }))];
      const recent = (state.recentPaths || []).filter(path => !chain.includes(path));
      if (recent.length) items.push("-", ...recent.map(path => ({ label: path, action: "open-folder", data: { path }, mono: true })));
      openMenu(items, box.right - 320, box.bottom + 6);
      return;
    }
    if (action === "file-more") { const box = button.getBoundingClientRect(); openFileMenu(button.closest("tr[data-file]"), box.right - 200, box.bottom + 4, box.top); return; }
    if (action === "file-download") { await downloadFile(button.dataset.path, button.dataset.name); return; }
    if (action === "file-delete") { openDeleteDialog(button.dataset.path, button.dataset.name, button.dataset.dir === "1"); return; }
    if (action === "close-delete") { $("#delete-dialog").close(); return; }
    if (action === "parent-folder") await browseFiles(parentPath($("#file-path").value));
    if (action === "open-file") await readFile(button.dataset.path);
    if (action === "open-folder") await browseFiles(button.dataset.path);
    if (action === "mkdir") {
      const folder = state.files?.path, targetId = state.selected;
      const name = (prompt("New folder name in " + folder) || "").trim();
      if (!name) return;
      if (/[\\/]/.test(name) || name === "." || name === "..") throw new Error("Use a plain folder name without / or \\");
      await rpc("files.mkdir", { targetId, path: joinPath(folder, name) });
      if (targetId === state.selected) { await browseFiles(folder); notify("Folder " + name + " created"); }
    }
    if (action === "close-file") { state.file = null; $("#file-editor").innerHTML = ""; }
  });
});
document.addEventListener("input", event => {
  if (event.target.form?.id === "create-pairing" && ["address", "port"].includes(event.target.name)) onWhereInput(event.target.form);
  if (event.target.id === "add-code") onCodeInput(event.target, event.inputType === "insertFromPaste");
  if (event.target.closest?.("#confirm-delete")) { const form = $("#confirm-delete"); form.querySelector('[type="submit"]').disabled = event.target.value !== form.dataset.name; }
  if (event.target.id === "file-filter") { state.fileQuery = event.target.value; $("#files-output").innerHTML = renderFileList(); }
  if (event.target.id === "fleet-search") { state.query = event.target.value; $("#fleet-table").innerHTML = renderFleetView(); }
  if (event.target.id === "dc-search") {
    state.dc.query = state.query = event.target.value; $("#dc-tree").innerHTML = renderDcTree();
    if ($("#fleet-table")) $("#fleet-table").innerHTML = renderFleetView();
  }
});
document.addEventListener("change", event => {
  if (event.target.id === "group-filter") { state.group = event.target.value; $("#fleet-table").innerHTML = renderFleetView(); }
});
document.addEventListener("submit", event => {
  const form = event.target;
  event.preventDefault();
  const values = Object.fromEntries(new FormData(form));
  const submittedPairing = state.pairing;
  void busy($('button[type="submit"]', form), async () => {
    if (form.id === "open-shell-session") {
      $("#shell-dialog").close();
      return openShell(values.targetId, values.ownerSessionId);
    }
    if (form.id === "confirm-two-way") {
      $("#two-way-dialog").close();
      const targetId = values.targetId;
      state.twoWay.set(targetId, { step: "request", message: "Starting" }); render();
      try {
        const result = await native("merge_two_way", { targetId });
        const label = state.merges.find(row => row.targetId === targetId)?.label || targetId;
        if (result.status === "two-way") notify("Two-way enabled with " + label + " · it can now control " + result.children + " of this Master’s hosts");
        else notify("Enrolled with " + label + ", but the merge back failed: " + (result.error || result.status), true);
      } finally {
        state.twoWay.delete(targetId);
        await refreshMasters(); await refreshFleet(); render();
      }
    }
    if (form.id === "create-pairing") {
      const address = values.address.trim();
      // Name is optional: an unnamed host is shown by its address.
      const params = { label: values.label.trim() || address, tenant: values.tenant, os: values.os, address, user: values.user, port: Number(values.port) };
      if (values.targetId.trim()) params.targetId = values.targetId.trim();
      if (values.routeKind) params.routeKind = values.routeKind;
      if (values.routes.trim()) params.routes = JSON.parse(values.routes);
      let folderId = values.folder === "__new__" ? "" : values.folder;
      if (values.folder === "__new__" && values.newFolder.trim()) folderId = (await rpc("folders.create", { name: values.newFolder.trim() })).id;
      state.pairing = await rpc("pairing.create", params);
      // The Target ID is known now, so the machine lands in its folder as soon as it pairs.
      if (folderId) await rpc("folders.assign", { targetId: state.pairing.targetId, folderId });
      if (folderId) state.folders = await rpc("folders.list");
      await refreshPairings(); await saveInstaller();
    }
    if (form.id === "finish-pairing") {
      const preview = state.add.preview;
      if (!preview) return;
      // Finish: save with the edited name, then file it in the folder chosen on the card (only if it changed).
      let folderId = values.folder === "__new__" ? "" : values.folder;
      if (values.folder === "__new__" && values.newFolder.trim()) folderId = (await rpc("folders.create", { name: values.newFolder.trim() })).id;
      const result = await rpc("pairing.complete", { code: preview.code, label: values.label.trim() || preview.label });
      if (folderId !== (state.folders.members?.[preview.targetId] || "")) { await rpc("folders.assign", { targetId: preview.targetId, folderId: folderId || null }); }
      state.folders = await rpc("folders.list");
      state.pairing = result; state.add.preview = null; state.add.code = "";
      await checkPairedMaster(result);
      await refreshPairings(); await refreshFleet(); render();
    }
    if (form.id === "retry-pairing") {
      if (!submittedPairing) return;
      const current = await rpc("targets.list");
      const registered = current.find(item => item.id === submittedPairing.targetId);
      const routes = (registered?.routes || submittedPairing.envelope.bundle.routes).map((route, i) => i === 0 ? { ...route, address: values.address.trim() } : route);
      const result = await rpc("pairing.status", { requestId: submittedPairing.requestId, retry: true, routes });
      if (state.pairing?.requestId === submittedPairing.requestId) state.pairing = result;
      await checkPairedMaster(result);
      await refreshPairings(); await refreshFleet(); render(); notify(result.state === "ready" ? "Ready" : "Still failing. See the details above", result.state !== "ready");
    }
    if (form.id === "edit-target") {
      const routes = JSON.parse(values.routes);
      if (!Array.isArray(routes) || !routes.length) throw new Error("Routes must be an array with at least one route");
      await rpc("targets.update", { target: { ...target(), label: values.label, routes } });
      await refreshFleet(); render(); notify("Target saved");
    }
    if (form.id === "paste-registration") await importRegistration(JSON.parse(values.document));
    if (form.id === "export-enrollment") {
      const routes = values.routes.trim() ? JSON.parse(values.routes) : [{ kind: values.kind, address: values.address, port: Number(values.port) }];
      if (!Array.isArray(routes) || !routes.length) throw new Error("Routes must be an array with at least one route");
      state.export = await rpc("enrollment.export", { targetId: values.targetId, label: values.label || values.targetId, tenant: values.tenant, os: values.os, user: values.user, routes });
      if (state.page === "enroll") {
        $("#enrollment-result").innerHTML = renderEnrollmentResult();
        $("#enrollment-result").scrollIntoView({ block: "nearest" });
      }
      notify("Public enrollment created");
    }
    if (form.id === "start-job") {
      const env = JSON.parse(values.env || "{}");
      if (!env || Array.isArray(env) || typeof env !== "object" || Object.values(env).some(value => typeof value !== "string")) throw new Error("Environment must be a JSON object with string values");
      const params = { targetId: state.selected, script: values.script, cwd: values.cwd, shell: values.shell, env };
      if(values.ownerSessionId) params.ownerSessionId=values.ownerSessionId;
      if(values.asAdmin === 'on') params.asAdmin=true;
      const fingerprint = JSON.stringify(params);
      if (state.pendingJob?.fingerprint !== fingerprint) state.pendingJob = { fingerprint, jobId: crypto.randomUUID() };
      const jobId = state.pendingJob.jobId;
      let job;
      try { job = await rpc("jobs.start", { ...params, jobId }); }
      catch (error) { throw new Error(String(error) + "\nJob ID: " + jobId + " — resend the same command to check or reattach without running it again"); }
      state.pendingJob = null;
      if (params.targetId !== state.selected) return;
      state.job = job; state.log = ""; state.offset = 0; state.eof = true; state.stream = "stdout"; state.newJob = false;
      render(); await refreshJobs(); await refreshSelectedJob(true); notify("Started job " + job.id);
    }
    if (form.id === "browse-files") await browseFiles(values.path.trim());
    if (form.id === "confirm-delete") {
      const { path, name } = form.dataset, targetId = state.selected, folder = state.files?.path;
      if (values.confirm !== name) return;
      $("#delete-dialog").close();
      await rpc("files.remove", { targetId, path });
      if (targetId === state.selected) { await browseFiles(folder); notify("Deleted " + name); }
    }
    if (form.id === "save-file") {
      if (!state.file?.editable) return;
      const path = state.file.path, targetId = state.selected;
      await rpc("files.write", { targetId, path, contentBase64: encodeBase64(values.content), expectedSha256: state.file.sha256 });
      if (targetId === state.selected) { await readFile(path); notify("File saved"); }
    }
  });
});
$("#refresh-all").addEventListener("click", event => void busy(event.currentTarget, async () => {
  await refreshLocal();
  if (state.page === "datacenter") await refreshFleet();
  if (state.page === "datacenter") await loadContainersIfShown(true);
  if (state.page === "masters") await refreshMasters();
  if (state.page === "enroll") await refreshPairings();
  render();
}));
setInterval(async () => {
  if (document.hidden || state.polling || !machineTab("jobs") || !target()?.runnerInstalled) return;
  state.polling = true;
  try { await refreshJobs(); await refreshSelectedJob(); }
  catch (error) { notify("Could not update jobs: " + error, true); }
  finally { state.polling = false; }
}, 5000);
setInterval(() => {
  if (document.hidden) return;
  void refreshLocal();
  refreshHealthIfDue();
}, 30000);
/* Folder name editing in the tree: Enter or leaving the field saves, Escape cancels. */
document.addEventListener("keydown", event => {
  if (event.target.id !== "dc-edit") return;
  if (event.key === "Enter") { event.preventDefault(); void saveFolderEdit(event.target); }
  if (event.key === "Escape") { event.stopPropagation(); state.dc.editing = null; $("#dc-tree").innerHTML = renderDcTree(); }
}, true);
document.addEventListener("focusout", event => { if (event.target.id === "dc-edit" && state.dc.editing) void saveFolderEdit(event.target); });
document.addEventListener("change", event => {
  if (event.target.id === "upload-input" && event.target.files?.length) { const files = [...event.target.files]; event.target.value = ""; void busy(null, () => uploadFiles(files)); return; }
  if (event.target.id === "pairing-folder") { const input = $("#pairing-new-folder"); input.hidden = event.target.value !== "__new__"; if (!input.hidden) input.focus(); }
});
/* The header scene is a map: hovering or focusing a host row lights that host's window. Direct target hosts
   take the near towers, hosts behind another Master the far group; the current Master is the logo itself. */
function sceneLight(item) {
  const group = state.targets.filter(row => Boolean(row.relayed) === Boolean(item.relayed)), index = group.indexOf(item);
  return index < 0 ? null : (item.relayed ? "f" + index % 4 : "t" + index % 6);
}
function lightScene(row) {
  document.querySelectorAll(".scene-light.is-lit").forEach(light => light.classList.remove("is-lit"));
  const item = row && state.targets.find(target => target.id === row.dataset.host), id = item && sceneLight(item);
  const light = id && document.querySelector('.scene-light[data-light="' + id + '"]');
  if (!light) return;
  const status = isHot(item) ? "is-high" : ({ online: "", offline: "is-off" })[nodeState(item)] ?? "is-unknown";
  light.classList.remove("is-high", "is-off", "is-unknown");
  if (status) light.classList.add(status);
  light.classList.add("is-lit");
}
document.addEventListener("mouseover", event => { const row = event.target.closest?.("[data-host]"); if (row !== lightScene.row) { lightScene.row = row; lightScene(row); } });
document.addEventListener("focusin", event => { const row = event.target.closest?.("[data-host]"); lightScene.row = row; lightScene(row); });
/* Files tab: drop files from this computer to upload them into the open folder. */
const draggingFiles = event => [...(event.dataTransfer?.types || [])].includes("Files");
document.addEventListener("dragover", event => {
  const zone = event.target.closest?.(".file-drop");
  if (!zone || !draggingFiles(event) || !state.files) return;
  event.preventDefault(); event.dataTransfer.dropEffect = "copy"; zone.classList.add("is-drop");
});
document.addEventListener("dragleave", event => { const zone = event.target.closest?.(".file-drop"); if (zone && !zone.contains(event.relatedTarget)) zone.classList.remove("is-drop"); });
document.addEventListener("drop", event => {
  const zone = event.target.closest?.(".file-drop");
  if (!zone || !draggingFiles(event)) return;
  event.preventDefault(); zone.classList.remove("is-drop");
  const files = [...event.dataTransfer.files];
  if (files.length) void busy(null, () => uploadFiles(files));
});
/* Drag a machine onto a folder to file it, or onto its Master to unfile it (same Master only). */
document.addEventListener("dragstart", event => {
  const master = event.target.closest?.("[data-drag-master]");
  if (master) {
    event.dataTransfer.setData("text/plain", "master:" + master.dataset.dragMaster);
    event.dataTransfer.effectAllowed = "move";
    state.dc.draggingMaster = master.dataset.dragMaster; state.dc.dragging = null;
    return;
  }
  const source = event.target.closest?.("[data-drag]");
  if (!source?.dataset.drag) return;
  state.dc.draggingMaster = null;
  event.dataTransfer.setData("text/plain", source.dataset.drag);
  event.dataTransfer.effectAllowed = "move";
  state.dc.dragging = source.dataset.drag;
});
document.addEventListener("dragend", () => { state.dc.dragging = null; state.dc.draggingMaster = null; document.querySelectorAll(".dc-row.is-drop").forEach(row => row.classList.remove("is-drop")); });
document.addEventListener("dragover", event => {
  if (state.dc.draggingMaster) {
    const site = event.target.closest?.("[data-drop-site]");
    if (!site) return;
    event.preventDefault(); event.dataTransfer.dropEffect = "move";
    document.querySelectorAll(".dc-row.is-drop").forEach(other => { if (other !== site) other.classList.remove("is-drop"); });
    site.classList.add("is-drop");
    return;
  }
  const row = event.target.closest?.("[data-drop]");
  if (!row || !state.dc.dragging || dcBranch(state.dc.dragging) !== row.dataset.drop) return;
  event.preventDefault(); event.dataTransfer.dropEffect = "move";
  document.querySelectorAll(".dc-row.is-drop").forEach(other => { if (other !== row) other.classList.remove("is-drop"); });
  row.classList.add("is-drop");
});
document.addEventListener("dragleave", event => { const row = event.target.closest?.("[data-drop]"); if (row && !row.contains(event.relatedTarget)) row.classList.remove("is-drop"); });
document.addEventListener("drop", event => {
  const site = event.target.closest?.("[data-drop-site]"), payload = event.dataTransfer.getData("text/plain");
  if (site && payload.startsWith("master:")) {
    event.preventDefault(); site.classList.remove("is-drop");
    const master = payload.slice(7), datacenterId = site.dataset.dropSite === "-" ? null : site.dataset.dropSite;
    if (((state.datacenters.members || {})[master] || null) === datacenterId) return;
    void busy(null, async () => {
      await rpc("datacenters.assign", { master, datacenterId });
      if (datacenterId) state.dc.collapsed.delete("site:" + datacenterId);
      await refreshDatacenters(); render();
    });
    return;
  }
  const row = event.target.closest?.("[data-drop]"), targetId = payload;
  if (targetId.startsWith("master:")) return;
  if (!row || !targetId || dcBranch(targetId) !== row.dataset.drop) return;
  event.preventDefault(); row.classList.remove("is-drop");
  const folderId = row.dataset.dropFolder || null;
  if ((state.folders.members || {})[targetId] === (folderId || undefined)) return;
  void busy(null, async () => {
    await rpc("folders.assign", { targetId, folderId });
    if (folderId) state.dc.collapsed.delete("folder:" + folderId);
    await refreshFolders(); $("#dc-tree").innerHTML = renderDcTree();
    if (state.dc.node.startsWith("folder:") || state.dc.node.startsWith("master:")) $("#dc-panel").innerHTML = renderDcPanel();
  });
});
/* vCenter-style context menu for tree rows: right-click, the Menu key or Shift+F10. */
function dcMenuItems(node) {
  const found = node === "dc" ? { kind: "dc" } : dcLookup(node);
  if (!found) return [];
  const item = (label, action, data = {}, extra = {}) => ({ label, action, data, ...extra });
  const local = found.kind === "dc" || found.master?.current;
  const remoteNote = found.master && !found.master.current ? "Add hosts on " + found.master.label + "; this Master reaches them through it" : "";
  if (found.kind === "site") return [item("Add host…", "dc-add", { site: found.site.id }), "-", item("Rename", "site-rename", { id: found.site.id }), item("Delete datacenter", "site-delete", { id: found.site.id }, { danger: true })];
  if (found.kind === "dc") return [item("Add host…", "dc-add"), "-", item("Topology", "dc-goto", { node: "dc" }), "-", item("Refresh", "refresh-fleet")];
  if (found.kind === "master") return [
    item("Add host…", "dc-add", {}, { disabled: !local, title: remoteNote }),
    item("New folder", "folder-new", { master: found.master.id }),
    "-",
    item("Open terminal", "open-shell", { id: found.master.item?.id || "" }, found.master.current ? { disabled: true, title: "This is the computer you are using; open its own terminal" } : { disabled: !found.master.item?.runnerInstalled }),
    item("Containers", "dc-goto", { node, tab: "containers", view: "containers" }), item("Monitoring", "dc-goto", { node, tab: "monitoring" }),
    ...(local ? [] : ["-", item("Manage merge", "manage-merge")]), "-", item("Refresh", "refresh-fleet"),
    ...(local ? [] : ["-", item("Remove merge…", "remove-merge", { id: found.master.id }, { danger: true })])];
  if (found.kind === "folder") return [
    item("Add host here…", "dc-add", { folder: found.folder.id }, { disabled: !local, title: remoteNote }),
    "-", item("Rename", "folder-rename", { id: found.folder.id }), item("Delete folder", "folder-delete", { id: found.folder.id }, { danger: true })];
  const target = found.item;
  return [
    item("Open terminal", "open-shell", { id: target.id }, { disabled: !target.runnerInstalled }),
    item("Check connection", "ctx-diagnose", { id: target.id }),
    "-",
    item("Jobs & logs", "dc-goto", { node, tab: "jobs" }), item("Files", "dc-goto", { node, tab: "files" }),
    item("Containers", "dc-goto", { node, tab: "containers", view: "containers" }), item("Images", "dc-goto", { node, tab: "containers", view: "images" }),
    item("Monitoring", "dc-goto", { node, tab: "monitoring" }),
    // Health only reads the SSH banner, so whether a machine is a Master is asked on click (one SSH call).
    ...(!target.relayed && state.masterCheck.get(target.id) !== false && !state.merges.some(merge => merge.targetId === target.id) ? ["-", item("Merge its target hosts (if a Master)", "ctx-merge", { id: target.id })] : []),
    ...(dcFolderOf(target.id) ? ["-", item("Remove from folder " + dcFolderOf(target.id).name, "folder-unfile", { id: target.id })] : []),
    ...(target.relayed ? [] : ["-", item("Remove from this Master…", "ctx-remove", { id: target.id }, { danger: true })])];
}
function closeDcMenu() { $("#dc-menu")?.remove(); }
function openDcMenu(node, x, y) { openMenu(dcMenuItems(node), x, y); }
/** Small popup menu at (x, y); items are {label, action, data, danger, disabled, title, indent} or "-".
 *  With `above` (the top of the button that opened it), a menu that does not fit below opens above instead of covering the button. */
function openMenu(items, x, y, above) {
  closeDcMenu();
  if (!items.length) return;
  const menu = document.createElement("div");
  menu.id = "dc-menu"; menu.className = "ctx-menu"; menu.setAttribute("role", "menu");
  menu.innerHTML = items.map(entry => entry === "-" ? '<div class="ctx-sep" role="separator"></div>'
    : '<button role="menuitem" class="ctx-item' + (entry.danger ? " danger" : "") + (entry.indent ? " indent-" + Math.min(entry.indent, 8) : "") + '" data-action="' + entry.action + '"' +
      Object.entries(entry.data).map(([key, value]) => " data-" + key + '="' + esc(value) + '"').join("") +
      (entry.disabled ? " disabled" : "") + (entry.title ? ' title="' + esc(entry.title) + '"' : "") + ">" + esc(entry.label) + "</button>").join("");
  if (items.some(entry => entry.mono)) menu.classList.add("is-mono");
  document.body.append(menu);
  const box = menu.getBoundingClientRect();
  menu.style.left = Math.max(4, Math.min(x, innerWidth - box.width - 4)) + "px";
  const top = above !== undefined && y + box.height > innerHeight - 4 ? above - box.height - 4 : y;
  menu.style.top = Math.max(4, Math.min(top, innerHeight - box.height - 4)) + "px";
  menu.querySelector(".ctx-item:not(:disabled)")?.focus();
}
/** One menu for a file row, from its ⋮ button or a right-click. */
function openFileMenu(row, x, y, above) {
  const { file: path, name, dir } = row.dataset;
  openMenu([{ label: dir ? "Open folder" : "Open", action: dir ? "open-folder" : "open-file", data: { path } },
    ...(dir ? [] : [{ label: "Download…", action: "file-download", data: { path, name } }]), "-",
    { label: "Delete…", action: "file-delete", data: { path, name, dir }, danger: true }], x, y, above);
}
document.addEventListener("contextmenu", event => {
  const file = event.target.closest("tr[data-file]");
  if (file) { event.preventDefault(); openFileMenu(file, event.clientX, event.clientY); return; }
  const row = event.target.closest(".dc-row .dc-item");
  if (!row) return;
  event.preventDefault();
  openDcMenu(row.dataset.node, event.clientX, event.clientY);
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape") { closeDcMenu(); return; }
  const menu = $("#dc-menu");
  if (menu && ["ArrowDown", "ArrowUp"].includes(event.key)) {
    const items = [...menu.querySelectorAll(".ctx-item:not(:disabled)")], index = items.indexOf(document.activeElement);
    items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    event.preventDefault(); return;
  }
  const row = event.target.closest?.(".dc-item");
  if (row && (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) {
    event.preventDefault();
    const box = row.getBoundingClientRect();
    openDcMenu(row.dataset.node, box.left + 24, box.bottom);
  }
});
document.addEventListener("pointerdown", event => { if (!event.target.closest("#dc-menu")) closeDcMenu(); }, true);
window.addEventListener("blur", closeDcMenu);
window.addEventListener("resize", closeDcMenu);
// Monitoring polls only while its tab is on screen, the window has focus and it is not paused.
setInterval(() => {
  const key = visibleMonitorKey();
  if (!key || state.dc.monPaused || document.hidden || !document.hasFocus()) return;
  const entry = state.monitor.get(key);
  if (!entry?.loading && Date.now() - (entry?.polled || 0) >= state.dc.monInterval - 250) void loadStats(key);
}, 1000);
// Containers refresh only while their tab is on screen and the window has focus.
setInterval(() => {
  if (document.hidden || !document.hasFocus() || state.dc.tab !== "containers") return;
  const key = visibleContainerKey();
  if (key && !state.containers.get(key)?.loading) void loadContainers(key);
}, 15000);
window.addEventListener("focus", refreshHealthIfDue);
window.__TAURI__?.event?.listen("merge-two-way", ({ payload }) => {
  if (!state.twoWay.has(payload.targetId) || payload.step === "done") return;
  state.twoWay.set(payload.targetId, payload);
  if (state.page === "masters") render();
});
window.__TAURI__?.event?.listen("management-window-shown", async () => {
  await refreshLocal();
  if (state.page !== "datacenter") return;
  try { await refreshFleet(); if (state.page === "datacenter" && !holdsForm() && !state.dc.adding) render(); } catch (error) { notify(error, true); }
  void refreshHealth();
});
await refreshLocal();
try { await refreshFleet(); } catch (error) { notify(error, true); }
render();
void refreshHealth();
