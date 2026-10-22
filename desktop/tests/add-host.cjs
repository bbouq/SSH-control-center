// Walks the one-column add flow ("+ Add host") on the fixture and gates on the decision count (≤ 2).
// Also checks: step marking and focus, plain errors in place, one check per pasted value, the address as the
// default name, "Add host here…" on a folder, unfinished requests, and no "target" noun on screen.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { decisions, startFixture } = require("./decisions.cjs");
const artifacts = path.resolve(__dirname, "../../artifacts/add-host-ui"); fs.mkdirSync(artifacts, { recursive: true });
const ADDRESS = "192.0.2.31", MAX_DECISIONS = 2;
const calls = async (page, url) => (await (await page.request.get(url + "/calls")).json());
const rpcCalls = (sent, method) => sent.filter(c => c.command === "rpc" && c.method === method);
const codeFor = async (page, url, query = "") => (await (await page.request.get(url + "/pairing-code" + query)).json()).code;
const column = page => page.locator("#add-host");
const step = (page, n) => column(page).locator('.add-step[data-step="' + n + '"]');

/** Exactly one step is current: it has aria-current="step", and only its number is acid. */
async function assertCurrent(page, n) {
  await step(page, n).and(page.locator('[aria-current="step"]')).waitFor();
  assert.equal(await column(page).locator('[aria-current="step"]').count(), 1, "one current step");
  const acid = await page.evaluate(() => { const probe = document.createElement("i"); probe.style.color = "var(--acid)"; document.body.append(probe); const c = getComputedStyle(probe).color; probe.remove(); return c; });
  const colors = await column(page).locator(".add-step .add-n").evaluateAll(els => els.map(el => getComputedStyle(el).color));
  assert.deepEqual(colors.map(c => c === acid), [1, 2, 3, 4].map(i => i === n), "acid only on step " + n);
}
async function assertNoTargetNoun(page, where) {
  const text = await column(page).innerText();
  assert.doesNotMatch(text, /\btargets?\b/i, "no on-screen 'target' in " + where);
}
const focusedId = page => page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);

/** Steps 1–3 as a Newcomer does them: type the address, Save installer…, paste the code. */
async function addOneHost(page, url, d, { folderId } = {}) {
  await assertCurrent(page, 1);
  assert.equal(await focusedId(page), "add-address", "focus starts in the address box");
  if (folderId) assert.equal(await column(page).locator('[name="folder"]').inputValue(), folderId, "folder pre-selected");
  await assertNoTargetNoun(page, "step 1");
  await column(page).getByText("Advanced").click();
  await assertNoTargetNoun(page, "step 1 with Advanced open");
  await d.fill(page.locator("#add-address"), ADDRESS, "address");
  // A fresh Windows machine has no SSH server yet: a calm note, and the flow goes on.
  await page.locator("#add-address-check").filter({ hasText: "the installer turns SSH on" }).waitFor();
  await page.getByRole("button", { name: "Save installer…" }).click();
  await assertCurrent(page, 3);
  assert.equal(await focusedId(page), "add-code", "focus moves to the code box");
  await step(page, 2).filter({ hasText: /Open sshcc-client-.*\.exe on the new host and click Approve/ }).waitFor();
  assert.equal(await step(page, 2).locator(".add-n").innerText(), "✓");
  assert.equal(await page.locator('#add-host button[type="submit"]').count(), 0, "no submit button in steps 2–3");
  await assertNoTargetNoun(page, "step 3");
  // On the new host: open the installer, Approve, copy the code (simulated by the fixture).
  await d.fill(page.locator("#add-code"), await codeFor(page, url), "pairing code");
  await page.locator(".ready-message").waitFor();
  await assertCurrent(page, 4);
}

async function shots(page, name) {
  for (const width of [1180, 820]) { await page.setViewportSize({ width, height: 900 }); await page.screenshot({ path: path.join(artifacts, "add-host-" + name + "-" + width + ".png"), fullPage: true }); }
  await page.setViewportSize({ width: 1180, height: 900 });
}

const checks = {
  /** Core task: one Windows host from an empty Master; the name is left empty. */
  async "empty"(page, url, d) {
    await page.goto(url);
    const add = page.locator('[data-action="add-host"]');
    assert.equal(await add.getAttribute("aria-haspopup"), null, "no dropdown");
    await add.click();
    await addOneHost(page, url, d);
    await assertNoTargetNoun(page, "step 4");
    const sent = await calls(page, url);
    assert.equal(rpcCalls(sent, "pairing.create").length, 1);
    assert.equal(rpcCalls(sent, "pairing.create")[0].params.address, ADDRESS);
    assert.equal(rpcCalls(sent, "pairing.create")[0].params.label, ADDRESS, "empty name is sent as the address");
    assert.equal(sent.filter(c => c.command === "save_setup").length, 1);
    assert.equal(rpcCalls(sent, "pairing.complete").length, 1);
    await page.locator('[data-action="dc-toggle"][data-node="master:local"]').click();
    await page.locator("#dc-tree .dc-item").filter({ hasText: ADDRESS }).waitFor();
  },
  /** The new host is a Master: today's offer card shows until the review card (ticket 04/05). */
  async "empty+new-host-master"(page, url, d) {
    await page.goto(url); await page.locator('[data-action="add-host"]').click();
    await addOneHost(page, url, d);
    await page.locator(".callout").filter({ hasText: "is also a Master" }).waitFor();
  },
  /** Wrong codes: a plain sentence in place, the code stays, one request per distinct value. */
  async "wrong-codes"(page, url) {
    await page.goto(url); await page.locator('[data-action="add-host"]').click();
    await page.locator("#add-address").fill(ADDRESS);
    await page.getByRole("button", { name: "Save installer…" }).click();
    await assertCurrent(page, 3);
    const box = page.locator("#add-code"), check = page.locator("#add-code-check");
    const other = await codeFor(page, url, "?master=other");
    await box.fill(other);
    await check.filter({ hasText: "different Master" }).waitFor();
    await box.fill(other); await page.waitForTimeout(800);
    assert.equal(await box.inputValue(), other, "code is not cleared on error");
    await box.fill("SSHCC1.fixture.damaged");
    await check.filter({ hasText: "damaged or incomplete" }).waitFor();
    assert.doesNotMatch(await check.innerText(), /E_PAIRING/, "plain words, no error code");
    assert.equal(await page.locator('#add-host button[type="submit"]').count(), 0);
    const sent = rpcCalls(await calls(page, url), "pairing.complete");
    assert.equal(sent.filter(c => c.params.code === other).length, 1, "same value checked once");
    await assertCurrent(page, 3);
    await shots(page, "wrong-code");
    // Leave it unfinished, then come back: the request is listed with Resume / Cancel.
    await column(page).getByRole("button", { name: "Close" }).click();
    await page.locator('[data-action="add-host"]').click();
    const row = column(page).locator(".add-unfinished tr").filter({ hasText: ADDRESS });
    await row.getByRole("button", { name: "Resume" }).click();
    await assertCurrent(page, 3);
    page.once("dialog", dialog => dialog.accept());
    await column(page).locator(".add-unfinished").getByRole("button", { name: "Cancel" }).click();
    await page.waitForFunction(() => !document.querySelector(".add-unfinished"));
    assert.equal(rpcCalls(await calls(page, url), "pairing.cancel").length, 1);
    await assertCurrent(page, 1);
  },
  /** "Add host here…" on a folder pre-selects and applies it; context menus say "Add host…". */
  async "folder"(page, url, d) {
    const folder = await (await page.request.post(url + "/rpc", { data: { command: "rpc", args: { method: "folders.create", params: { name: "Office" } } } })).json();
    await page.goto(url);
    await page.locator('.dc-item[data-node="master:local"]').click({ button: "right" });
    const items = await page.locator("#dc-menu .ctx-item").allTextContents();
    assert.ok(items.includes("Add host…"), "master menu offers Add host…");
    assert.ok(!items.some(text => /target|Master host/i.test(text)), "no separate Target/Master items: " + items);
    await page.keyboard.press("Escape");
    await page.locator('[data-action="dc-toggle"][data-node="master:local"]').click();
    await page.locator('.dc-item[data-node="folder:' + folder.id + '"]').click({ button: "right" });
    await page.getByRole("menuitem", { name: "Add host here…" }).click();
    await addOneHost(page, url, d, { folderId: folder.id });
    const assigned = rpcCalls(await calls(page, url), "folders.assign");
    assert.equal(assigned.length, 1); assert.equal(assigned[0].params.folderId, folder.id);
  },
  /** Step 1 live check: detected OS, duplicates of a host or a request, and late answers ignored. */
  async "live-check"(page, url) {
    await page.goto(url); await page.locator('[data-action="add-host"]').click();
    const box = page.locator("#add-address"), line = page.locator("#add-address-check"), os = page.locator('#create-pairing [name="os"]');
    const save = page.getByRole("button", { name: "Save installer…" });
    // An answer for an earlier value that arrives late is never shown.
    await box.fill("192.0.2.99"); await page.waitForTimeout(600);
    await box.fill("192.0.2.40");
    await line.filter({ hasText: "the installer turns SSH on" }).waitFor();
    await page.waitForTimeout(1500);
    assert.match(await line.innerText(), /the installer turns SSH on/, "late answer ignored");
    assert.equal(await os.inputValue(), "windows", "late answer did not change the OS");
    assert.equal(rpcCalls(await calls(page, url), "pairing.check").length, 2, "one check per pause");
    // A known OS fills the OS choice.
    await box.fill("192.0.2.32");
    await line.filter({ hasText: "SSH answers · Ubuntu or Debian" }).waitFor();
    assert.equal(await os.inputValue(), "linux");
    await box.fill("192.0.2.33");
    await line.filter({ hasText: "SSH answers · Windows" }).waitFor();
    assert.equal(await os.inputValue(), "windows");
    assert.ok(await save.isEnabled());
    await shots(page, "live-check-os");
    // An existing host: "Already added as …", Save installer disabled, a link to that host.
    await box.fill("192.0.2.20");
    await line.filter({ hasText: "Already added as UI test target" }).waitFor();
    assert.ok(await save.isDisabled(), "duplicate disables Save installer");
    await shots(page, "live-check-duplicate");
    await box.fill("192.0.2.33");
    await line.filter({ hasText: "SSH answers" }).waitFor();
    assert.ok(await save.isEnabled(), "enabled again for a new address");
    // An open request for the address: same message, with Resume.
    await page.request.post(url + "/rpc", { data: { command: "rpc", args: { method: "pairing.create", params: { label: "Lab box", tenant: "lab", os: "linux", address: "192.0.2.50", port: 22 } } } });
    await box.fill("192.0.2.50");
    await line.filter({ hasText: "Already added as Lab box" }).waitFor();
    assert.ok(await save.isDisabled());
    await line.getByRole("button", { name: "Resume it" }).click();
    await column(page).locator(".facts").filter({ hasText: "Lab box" }).waitFor();
    // Back to a fresh form, then follow the link to the existing host.
    page.once("dialog", dialog => dialog.accept());
    await column(page).getByRole("button", { name: "Cancel request" }).click();
    await assertCurrent(page, 1);
    await page.locator("#add-address").fill("192.0.2.20");
    await line.getByRole("button", { name: "Open it" }).click();
    await page.waitForFunction(() => !document.querySelector("#add-host"));
  },
  /** Reduced motion: steps never animate. */
  async "reduced-motion"(page, url) {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(url); await page.locator('[data-action="add-host"]').click();
    const motion = await column(page).locator(".add-step, .add-step *").evaluateAll(els => els.filter(el => { const s = getComputedStyle(el); return s.animationName !== "none" || s.transitionDuration.split(",").some(v => parseFloat(v) > 0); }).length);
    assert.equal(motion, 0, "nothing animates");
  },
};
const scenarios = { "empty": ["empty"], "empty+new-host-master": ["empty", "new-host-master"], "wrong-codes": ["empty"], "folder": ["empty"], "live-check": [], "reduced-motion": ["empty"] };

(async () => {
  const browser = await chromium.launch({ headless: true }); const results = [];
  try {
    for (const [name, flags] of Object.entries(scenarios)) {
      const fixture = await startFixture(flags);
      try {
        const page = await browser.newPage({ viewport: { width: 1180, height: 900 } });
        const d = decisions();
        await checks[name](page, fixture.url, d);
        if (d.count) {
          await shots(page, name);
          console.log("[" + name + "] decisions: " + d.count + "\n" + d.summary());
          assert.ok(d.count <= MAX_DECISIONS, name + ": " + d.count + " decisions, target ≤ " + MAX_DECISIONS);
        }
        console.log("ok " + name);
        results.push({ scenario: name, decisions: d.count, log: d.log });
        await page.close();
      } finally { fixture.stop(); }
    }
    fs.writeFileSync(path.join(artifacts, "add-host-results.json"), JSON.stringify({ ok: true, gate: MAX_DECISIONS, results }, null, 2) + "\n");
    console.log(JSON.stringify({ ok: true, decisions: results[0].decisions }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
