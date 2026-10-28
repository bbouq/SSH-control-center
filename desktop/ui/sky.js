/* The Inventory sky (DESIGN.md "Relic Night"). Built once, then only updated, so a running light or the parallax
   survives the window's re-renders. app.js hands it a snapshot of the fleet; the sky never asks the Master itself.
   Motion budget: nothing loops but the LED breathing, the glint and a few sparks. A host changing state sends one light
   down its wire, a recovery one shooting star; the clock repaints the sky once a minute. CSP: no style="" anywhere,
   custom properties go through CSSOM. */
const NS = "http://www.w3.org/2000/svg";
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const MAX_PODS = 14; // per group; the rest are counted as "+N"

// Sky colours (zenith → horizon), glow and far ridge per phase of the day, and the hours they peak at.
const PHASES = {
  night:   [["#04050C", "#0A0C1E", "#151A3C", "#26305E"], "#6C7CFF", "#0C0F22"],
  predawn: [["#04050D", "#0C0D24", "#2A2052", "#6E3E7E"], "#C98AD8", "#120F2A"],
  sunrise: [["#05071A", "#141A42", "#4C3274", "#E2805C"], "#FF9A5C", "#181634"],
  day:     [["#050B22", "#0E2052", "#1E4494", "#4E8AD6"], "#9AD0FF", "#0E1A40"],
  late:    [["#060A20", "#121E4E", "#2A3A8A", "#6C72CC"], "#B0A8FF", "#101A3C"],
  golden:  [["#06061A", "#1A183A", "#5C3252", "#E28C4C"], "#FF8A40", "#16132C"],
  dusk:    [["#050514", "#151232", "#3C215A", "#8C3E7A"], "#C86AC8", "#110E28"]
};
// hour · phase · glow strength · stars · rays
const HOURS = [[0, "night", .2, 1, 0], [4.3, "predawn", .55, .95, 0], [6.2, "sunrise", .95, .3, .2], [8.5, "day", .5, 0, .55], [13, "day", .42, 0, .7],
  [16.3, "late", .5, 0, .5], [18.1, "golden", .9, .15, .15], [19.4, "dusk", .55, .6, 0], [21, "night", .22, 1, 0], [24, "night", .2, 1, 0]];
const SUNRISE = 6, SUNSET = 18.6;
const SPARKS = [[78, 12, 8, 9.5, 0], [88, 26, 5, 11, 2.4], [66, 8, 5, 8.2, 4.1], [94, 44, 7, 12, 1.2], [57, 18, 4, 10.4, 6], [83, 52, 4, 9, 3.3]];
const FACES = ["c", "f", "g", "m"];
const STATE_COLOUR = { online: "var(--led)", offline: "var(--rose)", hot: "var(--amber)" };

const hex = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
const mix = (a, b, t) => "#" + hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * t).toString(16).padStart(2, "0")).join("");
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t * t * (3 - 2 * t);
const px = v => v + "px";
const set = (el, props) => { for (const k in props) el.style.setProperty(k, props[k]); return el; };
const make = (tag, cls, parent) => { const el = document.createElement(tag); if (cls) el.className = cls; if (parent) parent.append(el); return el; };
const svgEl = (tag, attrs, parent) => { const el = document.createElementNS(NS, tag); for (const k in attrs) el.setAttribute(k, attrs[k]); if (parent) parent.append(el); return el; };
const RIDGE_FAR = "M0 128 C 140 104, 250 86, 360 108 S 560 132, 700 104 S 900 50, 1010 44 S 1150 40, 1200 52";
const RIDGE_NEAR = "M0 100 C 120 92, 250 96, 360 122 S 500 168, 630 158 S 830 112, 970 96 S 1130 74, 1200 82";

export function createSky({ onSelect }) {
  const root = make("section", "sky");
  root.id = "sky"; root.hidden = true; root.setAttribute("aria-hidden", "true");
  const dust = make("div", "sky-dust", root);
  const word = make("div", "sky-word", root);
  const rays = make("div", "sky-rays", root), sun = make("div", "sky-sun", root), moon = make("div", "sky-moon", root);
  const dawn = make("div", "sky-dawn", root), chill = make("div", "sky-chill", root);
  const far = svgEl("svg", { class: "sky-ridge far", viewBox: "0 0 1200 190", preserveAspectRatio: "none" }, root);
  const grad = svgEl("linearGradient", { id: "sky-rim", x1: 0, x2: 1, y1: 0, y2: 0 }, svgEl("defs", {}, far));
  [[0, "#8FB0F0", 0], [.22, "#C9A8F0", .85], [.45, "#8FB0F0", .35], [.8, "#8FB0F0", 0]].forEach(([o, c, a]) => svgEl("stop", { offset: o, "stop-color": c, "stop-opacity": a }, grad));
  svgEl("path", { class: "fill", d: RIDGE_FAR + " L1200 190 L0 190 Z" }, far);
  svgEl("path", { class: "rim", d: RIDGE_FAR }, far);
  const glint = make("div", "sky-glint", root); make("i", "", glint);
  const view = make("div", "sky-view", root), floor = make("div", "sky-floor", view);
  const near = svgEl("svg", { class: "sky-ridge near", viewBox: "0 0 1200 190", preserveAspectRatio: "none" }, root);
  svgEl("path", { d: RIDGE_NEAR + " L1200 190 L0 190 Z" }, near);
  const sparks = SPARKS.map(([x, y, s, t, dl]) => set(make("i", "sky-spark", root), { left: x + "%", top: y + "%", "--s": px(s), "--t": t + "s", "--dl": dl + "s" }));
  const film = make("div", "sky-film", root); make("i", "perf", film); const frames = make("span", "frames", film); make("i", "perf", film);
  make("i", "sky-reg tl", root); make("i", "sky-reg br", root);
  const tag = make("span", "sky-tag", root);
  const headline = make("p", "sky-headline", root);
  const callout = make("div", "sky-callout", root); make("i", "stem", callout);
  const cBody = make("div", "body", callout), cName = make("span", "name", cBody), cState = make("span", "state", cBody), cFacts = make("dl", "", cBody);
  const shoot = make("div", "", root); set(shoot, { inset: "0", "pointer-events": "none", overflow: "hidden" });
  void sparks;

  let T = null, snap = null, layoutKey = "", pods = new Map(), pos = new Map(), paths = new Map(), halo = null;
  let focusId = null, last = new Map(), hour = 0, clock = 0, parallax = { x: 0, y: 0 };

  /* ---------- the sky clock ---------- */
  function paint(h) {
    hour = h;
    let i = HOURS.findIndex(k => k[0] > h) - 1; if (i < 0) i = HOURS.length - 2;
    const A = HOURS[i], B = HOURS[i + 1], t = ease((h - A[0]) / (B[0] - A[0])), a = PHASES[A[1]], b = PHASES[B[1]], st = document.body.style;
    a[0].forEach((c, n) => st.setProperty("--sky" + n, mix(c, b[0][n], t)));
    st.setProperty("--glow", mix(a[1], b[1], t)); st.setProperty("--ridge-far", mix(a[2], b[2], t));
    st.setProperty("--gs", lerp(A[2], B[2], t).toFixed(3)); st.setProperty("--stars", lerp(A[3], B[3], t).toFixed(3)); st.setProperty("--rays", lerp(A[4], B[4], t).toFixed(3));
    const W = root.clientWidth, H = root.clientHeight, horizon = H * .8;
    const d = (h - SUNRISE) / (SUNSET - SUNRISE), up = d > -.04 && d < 1.04, dc = Math.min(Math.max(d, 0), 1);
    const sx = W * (.33 + .58 * dc), sy = horizon - Math.sin(Math.PI * dc) * H * .5;
    sun.style.transform = rays.style.transform = `translate(${sx.toFixed(0)}px, ${sy.toFixed(0)}px)`;
    sun.style.opacity = up ? Math.min(1, Math.sin(Math.PI * dc) * 6).toFixed(2) : "0";
    set(root, { "--gx": up ? (sx / W * 100).toFixed(1) + "%" : "34%", "--gy": up ? Math.min(92, sy / H * 100 + 6).toFixed(1) + "%" : "74%" });
    const m = (h >= 19 ? h - 19 : h + 5) / 10.5, night = m >= 0 && m <= 1;
    moon.style.transform = `translate(${(W * (.9 - .55 * m)).toFixed(0)}px, ${(horizon - Math.sin(Math.PI * m) * H * .58).toFixed(0)}px) rotate(-20deg)`;
    moon.style.opacity = night ? Math.min(1, Math.sin(Math.PI * m) * 4).toFixed(2) : "0";
  }
  const nowHour = () => { const d = new Date(); return d.getHours() + d.getMinutes() / 60; };
  // the clock runs on every page: the thin sky strip on the other pages reads the same colours
  const tick = () => { paint(nowHour()); if (!root.hidden) writeFilm(); };
  const startClock = () => { if (!clock) clock = setInterval(tick, 60000); };
  const stopClock = () => { clearInterval(clock); clock = 0; };
  document.addEventListener("visibilitychange", () => document.hidden ? stopClock() : (tick(), startClock()));

  /* ---------- layout: this Master, direct hosts north, each merged Master on the trunk with its hosts south ---------- */
  const M = { x: 110, y: 210 };
  function layout(s) {
    pos = new Map(); const peers = s.peers, direct = s.direct.slice(0, MAX_PODS);
    const span = peers.length ? 400 : 720, step = Math.min(110, span / Math.max(1, direct.length));
    direct.forEach((h, i) => pos.set(h.id, { x: 250 + step / 2 + i * step, y: 70 + Math.abs(i - (direct.length - 1) / 2) * 12, via: null }));
    const gap = peers.length ? (960 - 600) / peers.length : 0;
    peers.forEach((p, k) => {
      const px0 = 600 + k * gap + gap * .15, kids = p.hosts.slice(0, MAX_PODS), kstep = Math.min(72, (gap * .8) / Math.max(1, kids.length));
      pos.set(p.id, { x: px0, y: 230, peer: true });
      kids.forEach((h, i) => pos.set(p.id + "\u0000" + h.id, { x: px0 + 60 + i * kstep, y: 330 - Math.abs(i - (kids.length - 1) / 2) * 16, via: p.id }));
    });
  }
  const trunkTo = p => `M ${M.x} ${M.y} C ${M.x + 160} ${M.y + 70}, ${p.x - 180} ${p.y + 60}, ${p.x} ${p.y}`;
  const branch = (from, p) => `Q ${p.x} ${from.y} ${p.x} ${p.y}`;

  function build(s) {
    floor.replaceChildren(); pods = new Map(); paths = new Map();
    layout(s);
    [[M, 190, ""], [M, 330, ""], [M, 260, " steel"]].forEach(([c, r, extra]) => set(make("div", "sky-orbit" + extra, floor), { left: px(c.x - r), top: px(c.y - r), width: px(r * 2), height: px(r * 2) }));
    const wires = svgEl("svg", { class: "sky-wires", width: 1000, height: 380, viewBox: "0 0 1000 380" }, floor);
    const line = (d, cls) => svgEl("path", cls ? { d, class: cls } : { d }, wires);
    for (const h of s.direct.slice(0, MAX_PODS)) { const p = pos.get(h.id), d = `M ${M.x} ${M.y} ${branch(M, p)}`; line(d); paths.set(h.id, d); }
    for (const peer of s.peers) {
      const P = pos.get(peer.id), trunk = trunkTo(P); line(trunk); paths.set(peer.id, trunk);
      for (const h of peer.hosts.slice(0, MAX_PODS)) { const key = peer.id + "\u0000" + h.id, p = pos.get(key); line(`M ${P.x} ${P.y} ${branch(P, p)}`); paths.set(key, trunk + " " + branch(P, p)); }
    }
    pod("local", M, "is-master", 22, 7, s.master.label);
    for (const h of s.direct.slice(0, MAX_PODS)) pod(h.id, pos.get(h.id), "", 5, 6, h.label);
    for (const peer of s.peers) {
      pod(peer.id, pos.get(peer.id), "is-master is-peer", 12, 7, peer.label);
      for (const h of peer.hosts.slice(0, MAX_PODS)) pod(peer.id + "\u0000" + h.id, pos.get(peer.id + "\u0000" + h.id), "", 5, 6, h.label);
      if (peer.hosts.length > MAX_PODS) more(pos.get(peer.id), peer.hosts.length - MAX_PODS, 150);
    }
    if (s.direct.length > MAX_PODS) more({ x: 230 + MAX_PODS * 30, y: 40 }, s.direct.length - MAX_PODS, 0);
    halo = set(make("div", "sky-halo", floor), { left: px(M.x), top: px(M.y), "--z": px(22 * 7 + 78) });
    halo.addEventListener("click", () => { if (REDUCED) return; halo.classList.remove("is-turning"); void halo.offsetWidth; halo.classList.add("is-turning"); });
  }
  function more(at, n, dy) { const el = make("span", "sky-more", floor); el.textContent = "+" + n; set(el, { left: px(at.x + 40), top: px(at.y + dy) }); }
  function pod(key, p, cls, discs, gap, label) {
    const el = make("div", "sky-pod " + cls, floor), h = discs * gap;
    for (let i = 0; i < discs; i++) { const d = make("div", "dk" + (cls.includes("is-master") && i % 4 === 3 ? " s" : ""), el); d.style.setProperty("--z", px(i * gap)); }
    make("div", "cap", el); make("div", "led", el); make("span", "lbl", el).textContent = label;
    set(el, { left: px(p.x), top: px(p.y), "--h": px(h), "z-index": String(Math.round(p.y) + 1) });
    el.dataset.key = key; pods.set(key, el);
    if (key !== "local") el.addEventListener("click", () => onSelect(key.split("\u0000").pop()));
    el.addEventListener("pointerenter", () => point(key.split("\u0000").pop()));
  }

  /* ---------- state on the pods, the headline and the film edge ---------- */
  const hostByKey = key => {
    if (!snap) return null;
    const [a, b] = key.split("\u0000");
    if (b) return snap.peers.find(p => p.id === a)?.hosts.find(h => h.id === b) || null;
    return snap.direct.find(h => h.id === a) || snap.peers.find(p => p.id === a) || null;
  };
  const podState = h => h.hot ? "hot" : h.state === "online" ? "online" : h.state === "offline" ? "offline" : "checking";
  function decorate() {
    for (const [key, el] of pods) {
      if (key === "local") continue;
      const h = hostByKey(key); if (!h) continue;
      const s = podState(h);
      el.classList.toggle("is-online", s === "online"); el.classList.toggle("is-hot", s === "hot"); el.classList.toggle("is-offline", s === "offline");
      el.querySelector(".lbl").textContent = h.label;
    }
  }
  function writeHeadline() {
    const parts = T.sky.headline(snap.online, snap.total);
    headline.replaceChildren();
    make("span", "n", headline).textContent = parts.n; make("span", "of", headline).textContent = parts.of; make("span", "on", headline).textContent = parts.on;
  }
  function writeFilm() {
    if (!snap || !T) return;
    const t = T.sky, two = n => String(n).padStart(2, "0");
    const items = [t.film.app(snap.master.version), "▸ " + t.film.online(two(snap.online), two(snap.total)), snap.master.label, snap.master.address,
      snap.checkedAt ? t.film.polled(snap.checkedAt) : t.film.checking, "◂ " + t.film.off(two(snap.offline))].filter(Boolean);
    // version, Master name and address are data, not wording (marked like #app-version for the language checks)
    const raw = new Set([items[0], snap.master.label, snap.master.address]);
    frames.replaceChildren(...items.map((text, i) => { const s = make("span", i === 1 ? "on" : ""); s.textContent = text; if (raw.has(text)) s.dataset.raw = ""; return s; }));
  }
  function writeWord() {
    const text = T.sky.word, latin = /^[\x20-\x7e]+$/.test(text);
    word.replaceChildren(...[...text].map((ch, i) => { const s = make("span", latin ? (i === 0 ? "c" : FACES[(i * 7 + 3) % 4]) : ""); s.textContent = ch; return s; }));
  }
  function reroll() {
    if (REDUCED) return;
    [...word.children].forEach((l, i) => {
      if (!FACES.some(f => l.classList.contains(f))) return;
      setTimeout(() => { l.classList.add("out"); setTimeout(() => { const cur = FACES.find(f => l.classList.contains(f)); let next; do next = FACES[Math.floor(Math.random() * 4)]; while (next === cur); l.classList.replace(cur, next); l.classList.remove("out"); }, 180); }, i * 70);
    });
  }
  function health() {
    const share = snap.total ? snap.online / snap.total : 1;
    dawn.style.opacity = (0.25 + 0.75 * share ** 3).toFixed(2);
    chill.style.opacity = Math.min(1, snap.offline * 0.7).toFixed(2);
  }

  /* ---------- the callout follows the pointed host (or the first host that needs a look) ---------- */
  function point(id) {
    if (!snap) return;
    const key = [...pods.keys()].find(k => k !== "local" && k.split("\u0000").pop() === id);
    if (!key) return;
    if (focusId && pods.get(focusId)) pods.get(focusId).classList.remove("is-focus");
    focusId = key; const el = pods.get(key); el.classList.add("is-focus");
    const h = hostByKey(key), s = podState(h);
    cName.textContent = h.label;
    cState.textContent = s === "hot" ? T.sky.hot : h.stateLabel; set(cState, { "--c": STATE_COLOUR[s] || "var(--lilac)" });
    const facts = [[T.sky.facts.address, h.address], [T.sky.facts.system, h.os], [T.sky.facts.response, h.response], [T.sky.facts.online, h.online], [T.sky.facts.checked, h.checked]].filter(([, v]) => v);
    cFacts.replaceChildren(...facts.flatMap(([k, v]) => { const dt = make("dt"); dt.textContent = k; const dd = make("dd"); dd.textContent = v; return [dt, dd]; }));
    requestAnimationFrame(() => {
      const r = el.querySelector(".cap").getBoundingClientRect(), pr = root.getBoundingClientRect();
      const x = r.left + r.width / 2 - pr.left - parallax.x, y = r.top + r.height / 2 - pr.top - parallax.y;
      callout.classList.toggle("down", y < 220); callout.classList.toggle("left", x > pr.width - 330);
      callout.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
      callout.classList.add("is-shown");
    });
  }
  const defaultFocus = () => {
    const all = [...snap.direct, ...snap.peers.flatMap(p => p.hosts)];
    return (all.find(h => h.hot || h.state === "offline") || all[0])?.id;
  };

  /* ---------- events: a light down the wire on a change, a shooting star on a recovery ---------- */
  function signal(key, off) {
    const d = paths.get(key), wires = floor.querySelector(".sky-wires"); if (!d || !wires) return 0;
    const c = svgEl("path", { d, class: "comet" + (off ? " is-off" : ""), pathLength: 1000 }, wires);
    c.style.strokeDasharray = "90 1000";
    const dur = key.includes("\u0000") ? 1500 : 900;
    c.animate([{ strokeDashoffset: 90 }, { strokeDashoffset: -1000 }], { duration: dur, easing: "cubic-bezier(.45,.05,.4,1)", fill: "both" }).finished.then(() => c.remove());
    const p = pos.get(key), ping = set(make("div", "sky-ping" + (off ? " is-off" : ""), floor), { left: px(p.x), top: px(p.y) });
    ping.animate([{ transform: "scale(.3)", opacity: 1 }, { transform: "scale(1.6)", opacity: 0 }], { duration: 800, delay: dur - 120, easing: "ease-out", fill: "both" }).finished.then(() => ping.remove());
    setTimeout(() => { const el = pods.get(key); if (el) { el.classList.remove("is-hit"); void el.offsetWidth; el.classList.add("is-hit"); } }, dur);
    return dur;
  }
  function shootingStar() {
    const s = make("i", "sky-star", shoot);
    set(s, { position: "absolute", left: (45 + Math.random() * 30) + "%", top: px(40 + Math.random() * 90) });
    s.animate([{ transform: "rotate(-16deg) translateX(0) scaleX(.15)", opacity: 0 }, { transform: "rotate(-16deg) translateX(-200px) scaleX(1)", opacity: 1, offset: .3 },
      { transform: "rotate(-16deg) translateX(-520px) scaleX(.5)", opacity: 0 }], { duration: 1700, easing: "cubic-bezier(.3,.1,.3,1)" }).finished.then(() => s.remove());
  }
  function flex() {
    const n = headline.querySelector(".n"); if (!n) return;
    n.animate([{ fontVariationSettings: '"SOFT" 0, "WONK" 0, "opsz" 144, "wght" 900', transform: "skewX(0)" },
      { fontVariationSettings: '"SOFT" 100, "WONK" 1, "opsz" 9, "wght" 500', transform: "skewX(-10deg)", offset: .4 },
      { fontVariationSettings: '"SOFT" 0, "WONK" 0, "opsz" 144, "wght" 900', transform: "skewX(0)" }], { duration: 900, easing: "cubic-bezier(.3,.7,.2,1)" });
  }
  function react(prev) {
    if (!prev || REDUCED || root.hidden) return;
    let recovered = false;
    for (const [key] of pods) {
      if (key === "local") continue;
      const h = hostByKey(key); if (!h) continue;
      const before = last.get(key), now = podState(h);
      if (before && before !== now) { signal(key, now === "offline"); if (before !== "online" && now === "online") recovered = true; }
    }
    if (recovered) setTimeout(shootingStar, 700);
    if (prev.online !== snap.online) { flex(); reroll(); }
  }

  /* ---------- parallax: one write per pointer move, eased by CSS, nothing while still ---------- */
  const LAYERS = [[dust, 4], [word, 9], [far, 6], [dawn, 3], [view, 13], [callout, 13], [glint, 16], [near, 20]];
  let pending = 0;
  function drift(nx, ny) {
    for (const [el, d] of LAYERS) el.style.translate = `${(nx * d).toFixed(1)}px ${(ny * d * .5).toFixed(1)}px`;
    parallax = { x: nx * 13, y: ny * 6.5 };
  }
  if (!REDUCED) {
    root.addEventListener("pointermove", e => {
      if (pending) return;
      pending = requestAnimationFrame(() => { const r = root.getBoundingClientRect(); drift(((e.clientX - r.left) / r.width - .5) * -2, ((e.clientY - r.top) / r.height - .5) * -2); pending = 0; });
    });
    root.addEventListener("pointerleave", () => drift(0, 0));
  }
  addEventListener("resize", () => { if (!root.hidden) { paint(hour); if (focusId) point(focusId.split("\u0000").pop()); } });

  paint(nowHour()); startClock();
  // The sidebar is sticky; its copy of the sky follows the page's scroll so the two never part (one write per frame, only while scrolling)
  let scrolling = 0;
  addEventListener("scroll", () => { if (scrolling) return; scrolling = requestAnimationFrame(() => { document.body.style.setProperty("--scroll", (-scrollY).toFixed(0) + "px"); scrolling = 0; }); }, { passive: true });

  /* ---------- public ---------- */
  function update(next, strings) {
    const langChanged = strings !== T; T = strings;
    document.body.classList.toggle("has-sky", Boolean(next?.visible));
    if (!next?.visible) { root.hidden = true; return; }
    const prev = snap, wasHidden = root.hidden; snap = next; root.hidden = false;
    const key = JSON.stringify([next.direct.map(h => h.id), next.peers.map(p => [p.id, p.hosts.map(h => h.id)])]);
    if (key !== layoutKey) { layoutKey = key; build(next); focusId = null; }
    decorate(); writeHeadline(); writeFilm(); health();
    tag.textContent = T.sky.tag;
    if (langChanged || !word.childElementCount) writeWord();
    if (wasHidden) { paint(nowHour()); startClock(); }
    react(wasHidden ? null : prev);
    // a host that just went offline or hot takes the callout
    const turned = wasHidden || !prev ? null : [...pods.keys()].find(k => { const h = k !== "local" && hostByKey(k), now = h && podState(h); return now && (now === "offline" || now === "hot") && last.get(k) !== now; });
    last = new Map([...pods.keys()].filter(k => k !== "local").map(k => { const h = hostByKey(k); return [k, h ? podState(h) : "checking"]; }));
    const keep = turned ? turned.split("\u0000").pop() : focusId && hostByKey(focusId) ? focusId.split("\u0000").pop() : defaultFocus();
    if (keep) point(keep); else callout.classList.remove("is-shown");
  }
  // paint(hour) also lets a test show any hour; the clock repaints the real one within a minute
  return { el: root, update, point, paint };
}
