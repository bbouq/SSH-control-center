/* The Inventory sky (DESIGN.md "Relic Night"). Built once, then only updated, so the halo's turn or the parallax
   survives the window's re-renders. app.js hands it a snapshot of the fleet; the sky never asks the Master itself.
   The fleet is the Stardust Halo: a ring of glitter around this Master (a silver relic on the near ridge), one bright
   spark per host. Real 3D points projected by hand on canvas 2D (no library, no WebGL, so it also draws in WebKitGTK
   without a GPU). It draws only while something moves: the arrival, a drag, its inertia, a host changing. Motion budget
   otherwise: the glint and a few sparks; the clock repaints the sky once a minute. CSP: no style="" anywhere, custom
   properties go through CSSOM. */
const NS = "http://www.w3.org/2000/svg";
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const MAX_SPARKS = 48; // hosts named on the halo; the rest still glitter in it

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
const SPARK_RGB = { online: "255,238,214", offline: "255,127,174", hot: "255,194,102", checking: "201,205,226" };
const GLITTER = 5200, TONES = [[240, 160, 96], [255, 232, 200], [191, 216, 255], [255, 140, 90]];
const REST = { yaw: .35, pitch: .27 };

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
  const back = make("canvas", "sky-halo", root);
  const near = svgEl("svg", { class: "sky-ridge near", viewBox: "0 0 1200 190", preserveAspectRatio: "none" }, root);
  svgEl("path", { d: RIDGE_NEAR + " L1200 190 L0 190 Z" }, near);
  const front = make("canvas", "sky-halo", root), bloom = make("canvas", "sky-halo bloom", root);
  const sparks = SPARKS.map(([x, y, s, t, dl]) => set(make("i", "sky-spark", root), { left: x + "%", top: y + "%", "--s": px(s), "--t": t + "s", "--dl": dl + "s" }));
  const film = make("div", "sky-film", root); make("i", "perf", film); const frames = make("span", "frames", film); make("i", "perf", film);
  make("i", "sky-reg tl", root); make("i", "sky-reg br", root);
  const tag = make("span", "sky-tag", root);
  const headline = make("p", "sky-headline", root);
  const callout = make("div", "sky-callout", root); make("i", "stem", callout);
  const cBody = make("div", "body", callout), cName = make("span", "name", cBody), cState = make("span", "state", cBody), cFacts = make("dl", "", cBody);
  const shoot = make("div", "", root); set(shoot, { inset: "0", "pointer-events": "none", overflow: "hidden" });
  void sparks;

  let T = null, snap = null, layoutKey = "", ring = [], byKey = new Map();
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

  /* ---------- the halo: glitter in ring space (angle, radial offset, height), one spark per host ---------- */
  const rand = (seed => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646)(7);
  const G = new Float32Array(GLITTER * 4), GC = [], FROM = new Float32Array(GLITTER * 2);
  for (let i = 0; i < GLITTER; i++) {
    G[i * 4] = rand() * Math.PI * 2; G[i * 4 + 1] = (rand() + rand() + rand() - 1.5) * .075; G[i * 4 + 2] = (rand() - .5) * .035;
    G[i * 4 + 3] = rand() < .985 ? .5 + rand() * 1.1 : 1.8 + rand() * 1.6;
    const t = rand(), c = TONES[t < .45 ? 0 : t < .75 ? 1 : t < .93 ? 2 : 3]; GC.push(`rgba(${c[0]},${c[1]},${c[2]},${(.25 + rand() * .75).toFixed(2)})`);
    FROM[i * 2] = rand(); FROM[i * 2 + 1] = rand();
  }
  const cam = { yaw: REST.yaw, pitch: REST.pitch, vy: 0, vp: 0 };
  let W = 0, H = 0, DPR = 1, cx = 0, cy = 0, R = 0, arrive = REDUCED ? 1 : 0, arriveAt = 0, hover = null, changed = new Map();
  const project = (a, off, h) => {
    const r = 1 + off, x = Math.cos(a) * r, z = Math.sin(a) * r;
    const x1 = x * Math.cos(cam.yaw) - z * Math.sin(cam.yaw), z1 = x * Math.sin(cam.yaw) + z * Math.cos(cam.yaw);
    const y2 = h * Math.cos(cam.pitch) - z1 * Math.sin(cam.pitch), z2 = h * Math.sin(cam.pitch) + z1 * Math.cos(cam.pitch), s = 3.2 / (3.2 + z2);
    return [cx + x1 * R * s, cy + y2 * R * s, z2, s];
  };
  // This Master: the hosts sit evenly round the ring, merged Masters and Masters below them larger
  function build(s) {
    const list = [...s.direct.map(h => [h.id, h, 1]), ...s.peers.flatMap(p => [[p.id, p, 1.6], ...p.hosts.map(h => [p.id + "\u0000" + h.id, h, h.master ? 1.3 : 1])])].slice(0, MAX_SPARKS);
    ring = list.map(([key, , size], i) => ({ key, size, a: -Math.PI / 2 + (i + .5) * Math.PI * 2 / list.length }));
    byKey = new Map(ring.map(sp => [sp.key, sp]));
  }
  function size() {
    DPR = Math.min(2, devicePixelRatio || 1); W = root.clientWidth; H = root.clientHeight;
    cx = W * .6; cy = H * .58; R = Math.min(W * .25, H * .7);
    for (const c of [back, front]) { c.width = W * DPR; c.height = H * DPR; }
    bloom.width = W * DPR / 4; bloom.height = H * DPR / 4;
  }
  function relic(x) {
    const w = R * .07, h = R * .34, base = H - 36, g = x.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
    g.addColorStop(0, "#6E7CA8"); g.addColorStop(.35, "#F4F6FB"); g.addColorStop(.6, "#A6B4D8"); g.addColorStop(1, "#3A4166");
    x.globalCompositeOperation = "source-over"; x.fillStyle = g; x.beginPath(); x.roundRect(cx - w / 2, base - h, w, h, [w / 2, w / 2, 2, 2]); x.fill();
    const s = (seed => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646)(11);
    for (let i = 0; i < 200; i++) { x.fillStyle = `rgba(255,${230 + s() * 25},${200 + s() * 55},${s().toFixed(2)})`; x.fillRect(cx - w / 2 + s() * w, base - h + s() * h, 1.2, 1.2); }
  }
  function flare(x, px, py, r, rgb, a) {
    const g = x.createRadialGradient(px, py, 0, px, py, r * 3); g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`);
    x.fillStyle = g; x.beginPath(); x.arc(px, py, r * 3, 0, 7); x.fill();
    x.strokeStyle = `rgba(${rgb},${a * .8})`; x.lineWidth = .8; x.beginPath(); x.moveTo(px - r * 4, py); x.lineTo(px + r * 4, py); x.moveTo(px, py - r * 4); x.lineTo(px, py + r * 4); x.stroke();
  }
  const eased = t => 1 - Math.pow(1 - t, 3);
  function frame(now) {
    if (arrive < 1) arrive = arriveAt ? Math.min(1, (now - arriveAt) / 1800) : 0;
    const k = eased(arrive), b = back.getContext("2d"), f = front.getContext("2d"), g = bloom.getContext("2d");
    for (const [x, d] of [[b, DPR], [f, DPR], [g, DPR / 4]]) { x.setTransform(d, 0, 0, d, 0, 0); x.clearRect(0, 0, W, H); x.globalCompositeOperation = "lighter"; }
    relic(b); b.globalCompositeOperation = "lighter";
    for (let i = 0; i < GLITTER; i++) {
      const [x0, y0, z, s] = project(G[i * 4], G[i * 4 + 1], G[i * 4 + 2]), x = x0 + (FROM[i * 2] * W - x0) * (1 - k), y = y0 + (FROM[i * 2 + 1] * H - y0) * (1 - k);
      const c = z > 0 ? b : f, sz = G[i * 4 + 3] * s; c.fillStyle = GC[i]; c.fillRect(x - sz / 2, y - sz / 2, sz, sz);
      if (sz > 1.6 || i % 9 === 0) { g.fillStyle = GC[i]; g.fillRect(x - sz, y - sz, sz * 2, sz * 2); }
    }
    let busy = false;
    if (k > .6) for (const sp of ring) {
      const h = hostByKey(sp.key); if (!h) continue;
      const [x, y, z, s] = project(sp.a, 0, 0), c = z > 0 ? b : f, st = podState(h), hit = changed.get(sp.key);
      const swell = hit ? Math.max(0, 1 - (now - hit) / 1400) : 0; if (swell) busy = true;
      const r = 2 * sp.size * s * (sp.key === hover || sp.key === focusId ? 1.8 : 1) * (1 + swell * 1.5) * (k - .6) / .4;
      sp.x = x; sp.y = y; flare(c, x, y, r, SPARK_RGB[st], 1); flare(g, x, y, r * 1.6, SPARK_RGB[st], .9);
      if (swell) { c.strokeStyle = `rgba(${SPARK_RGB[st]},${swell.toFixed(2)})`; c.lineWidth = 1.5; c.beginPath(); c.arc(x, y, 6 + (1 - swell) * 30, 0, 7); c.stroke(); }
      if (sp.size > 1 || st === "offline" || st === "hot" || sp.key === hover) {
        c.globalCompositeOperation = "source-over"; c.font = "400 10px 'Space Mono', monospace"; c.globalAlpha = z > 0 ? .55 : 1;
        c.fillStyle = st === "offline" ? "#FF7FAE" : st === "hot" ? "#FFC266" : "#DCE0F0"; c.fillText(h.label.toUpperCase(), x + 11, y - 9);
        c.globalAlpha = 1; c.globalCompositeOperation = "lighter";
      }
    }
    return busy || arrive < 1 && arriveAt > 0 || Math.abs(cam.vy) > .0004 || Math.abs(cam.vp) > .0004;
  }
  let raf = 0, dragging = false;
  const kick = () => { if (!raf && !document.hidden && !root.hidden) raf = requestAnimationFrame(step); };
  function step(now) {
    raf = 0; cam.yaw += cam.vy; cam.pitch = Math.max(.1, Math.min(.34, cam.pitch + cam.vp)); cam.vy *= .94; cam.vp *= .9;
    const more = frame(now); if (focusId) place(); if (more || dragging) kick();
  }
  document.addEventListener("visibilitychange", kick);
  // drag turns the halo, a point names a spark, a click opens its host
  const pick = (x, y) => { let best = null, d = 22; for (const sp of ring) { if (sp.x == null) continue; const dd = Math.hypot(sp.x - x, sp.y - y); if (dd < d) { d = dd; best = sp.key; } } return best; };
  let lastX = 0, lastY = 0, moved = 0;
  const local = e => { const r = root.getBoundingClientRect(); return [e.clientX - r.left - parallax.x, e.clientY - r.top - parallax.y]; };
  root.addEventListener("pointerdown", e => { if (e.button !== 0 || e.target.closest(".sky-callout")) return; if (arrive < 1) { arrive = 1; kick(); }
    dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY; root.setPointerCapture(e.pointerId); root.classList.add("is-dragging"); });
  root.addEventListener("pointermove", e => {
    if (dragging) { const dx = e.clientX - lastX, dy = e.clientY - lastY; moved += Math.abs(dx) + Math.abs(dy); lastX = e.clientX; lastY = e.clientY;
      if (REDUCED) { cam.yaw -= dx * .004; cam.pitch = Math.max(.1, Math.min(.34, cam.pitch + dy * .0025)); } else { cam.vy = -dx * .004; cam.vp = dy * .0025; } kick(); return; }
    const key = pick(...local(e)); if (key !== hover) { hover = key; root.classList.toggle("is-pointing", !!key); if (key) point(key.split("\u0000").pop()); kick(); }
  });
  root.addEventListener("pointerup", e => { dragging = false; root.classList.remove("is-dragging"); if (moved < 6) { const key = pick(...local(e)); if (key) onSelect(key.split("\u0000").pop()); } });
  root.addEventListener("dblclick", () => { cam.yaw = REST.yaw; cam.pitch = REST.pitch; cam.vy = cam.vp = 0; kick(); });

  /* ---------- state on the sparks, the headline and the film edge ---------- */
  const hostByKey = key => {
    if (!snap) return null;
    const [a, b] = key.split("\u0000");
    if (b) return snap.peers.find(p => p.id === a)?.hosts.find(h => h.id === b) || null;
    return snap.direct.find(h => h.id === a) || snap.peers.find(p => p.id === a) || null;
  };
  const podState = h => h.hot ? "hot" : h.state === "online" ? "online" : h.state === "offline" ? "offline" : "checking";
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
    const key = [...byKey.keys()].find(k => k.split("\u0000").pop() === id);
    if (!key) return;
    focusId = key; kick();
    const h = hostByKey(key), s = podState(h);
    cName.textContent = h.label;
    cState.textContent = s === "hot" ? T.sky.hot : h.stateLabel; set(cState, { "--c": STATE_COLOUR[s] || "var(--lilac)" });
    const facts = [[T.sky.facts.address, h.address], [T.sky.facts.system, h.os], [T.sky.facts.response, h.response], [T.sky.facts.online, h.online], [T.sky.facts.checked, h.checked]].filter(([, v]) => v);
    cFacts.replaceChildren(...facts.flatMap(([k, v]) => { const dt = make("dt"); dt.textContent = k; const dd = make("dd"); dd.textContent = v; return [dt, dd]; }));
    requestAnimationFrame(place);
  }
  function place() {
    const sp = byKey.get(focusId); if (!sp || sp.x == null) return;
    callout.classList.toggle("down", sp.y < 220); callout.classList.toggle("left", sp.x > W - 330);
    callout.style.transform = `translate(${sp.x.toFixed(0)}px, ${sp.y.toFixed(0)}px)`;
    callout.classList.add("is-shown");
  }
  const defaultFocus = () => {
    const all = [...snap.direct, ...snap.peers.flatMap(p => p.hosts)];
    return (all.find(h => h.hot || h.state === "offline") || all[0])?.id;
  };

  /* ---------- events: a host that changes swells and rings once; a recovery sends a shooting star ---------- */
  function signal(key) { changed.set(key, performance.now()); kick(); }
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
    for (const [key] of byKey) {
      const h = hostByKey(key); if (!h) continue;
      const before = last.get(key), now = podState(h);
      if (before && before !== now) { signal(key); if (before !== "online" && now === "online") recovered = true; }
    }
    if (recovered) setTimeout(shootingStar, 700);
    if (prev.online !== snap.online) { flex(); reroll(); }
  }

  /* ---------- parallax: one write per pointer move, eased by CSS, nothing while still ---------- */
  const LAYERS = [[dust, 4], [word, 9], [far, 6], [dawn, 3], [back, 13], [front, 13], [bloom, 13], [callout, 13], [glint, 16], [near, 20]];
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
  addEventListener("resize", () => { if (!root.hidden) { paint(hour); size(); kick(); } });

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
    if (wasHidden) { size(); if (!arriveAt && !REDUCED) arriveAt = performance.now(); }
    writeHeadline(); writeFilm(); health(); kick();
    tag.textContent = T.sky.tag;
    if (langChanged || !word.childElementCount) writeWord();
    if (wasHidden) { paint(nowHour()); startClock(); }
    react(wasHidden ? null : prev);
    // a host that just went offline or hot takes the callout
    const turned = wasHidden || !prev ? null : [...byKey.keys()].find(k => { const h = hostByKey(k), now = h && podState(h); return now && (now === "offline" || now === "hot") && last.get(k) !== now; });
    last = new Map([...byKey.keys()].map(k => { const h = hostByKey(k); return [k, h ? podState(h) : "checking"]; }));
    const keep = turned ? turned.split("\u0000").pop() : focusId && hostByKey(focusId) ? focusId.split("\u0000").pop() : defaultFocus();
    if (keep) point(keep); else callout.classList.remove("is-shown");
  }
  // paint(hour) also lets a test show any hour; the clock repaints the real one within a minute
  // keys() lists the hosts on the halo (for UI tests)
  return { el: root, update, point, paint, keys: () => [...byKey.keys()] };
}
