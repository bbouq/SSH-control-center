// Target update pack (roadmap entry 8) on the fixture (plain Chromium): which hosts are older than this Master,
// updating one from its page (and the fallback when it fails), and updating every outdated host one at a time.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { decisions, startFixture } = require("./decisions.cjs");
const artifacts = path.resolve(__dirname, "../../artifacts/target-update-ui"); fs.mkdirSync(artifacts, { recursive: true });
const rpcCalls = async (page, url) => (await (await page.request.get(url + "/calls")).json()).filter(c => c.command === "rpc");
const calls = async (page, url) => (await (await page.request.get(url + "/calls")).json());

async function shots(page, name) {
  for (const width of [1180, 820, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: path.join(artifacts, name + "-" + width + ".png"), fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), "no sideways scroll at " + width + " px");
  }
  await page.setViewportSize({ width: 1180, height: 900 });
}
async function openTree(page) {
  await page.locator("#dc-tree .dc-row").first().waitFor();
  for (let i = 0; i < 6; i++) {
    const closed = page.locator('#dc-tree .dc-toggle[aria-expanded="false"]');
    if (!(await closed.count())) break;
    await closed.first().click();
  }
}
async function openHost(page, id) {
  await openTree(page);
  await page.locator(`#dc-tree .dc-item[data-node="node:${id}"]`).click();
}

const checks = {
  /** Badges: tree, table, host page; a merged host says who updates it. */
  async "badges"(page, url) {
    await page.goto(url);
    await openTree(page);
    await page.locator('#dc-tree .dc-item[data-node="node:ui-test"] .dc-tag.is-update').waitFor();
    assert.equal(await page.locator('#dc-tree .dc-item[data-node="node:branch-master"] .dc-tag.is-update').count(), 0, "a current host has no badge");
    await openHost(page, "branch-master/child-1");
    await page.locator(".upgrade-badge", { hasText: "Needs update (0.4.0 → 0.5.0) · by Branch Master" }).waitFor();
    assert.equal(await page.locator('[data-action="host-upgrade"]').count(), 0, "its own Master updates it");
    assert.match(await page.locator(".upgrade-row").textContent(), /Updated by Branch Master/);
    await shots(page, "badges");
  },
  /** Update one host from its page; a failure offers the installer to run by hand. */
  async "update-one"(page, url) {
    await page.goto(url);
    await openHost(page, "hq-master");
    await page.locator('[data-action="host-upgrade"]').click();
    await page.locator("#notice", { hasText: "Couldn’t update HQ Master" }).waitFor();
    assert.match(await page.locator("#notice").textContent(), /didn’t come back with the new version/);
    await page.locator('[data-action="host-upgrade-file"]').click();
    await page.locator("#notice", { hasText: "Saved /fixture/Downloads/sshcc_0.5.0.deb" }).waitFor();
    const saved = (await calls(page, url)).find(c => c.command === "save_upgrade");
    assert.deepEqual([saved.targetId, saved.os], ["hq-master", "linux"]);
    await openHost(page, "ui-test");
    await page.locator('[data-action="host-upgrade"]').click();
    await page.locator("#notice", { hasText: "UI test target now runs 0.5.0" }).waitFor();
    await page.locator(".upgrade-badge").waitFor({ state: "detached" });
  },
  /** Update every outdated host, one at a time, from the Inventory. */
  async "update-all"(page, url, d) {
    await page.goto(url);
    const panel = page.locator("#upgrade-panel");
    await panel.waitFor();
    assert.match(await panel.textContent(), /2 hosts run an older version than this Master \(0\.5\.0\)/);
    await d.choose(panel.locator('[data-action="upgrade-all"]'), "Update every outdated host");
    await page.locator('#upgrade-panel tr[data-upgrade="hq-master"] .badge', { hasText: "Failed" }).waitFor({ timeout: 30000 });
    await page.locator('#upgrade-panel tr[data-upgrade="ui-test"] .badge', { hasText: "Done" }).waitFor({ timeout: 30000 });
    await page.locator("#upgrade-panel", { hasText: "1 of 2 updated" }).waitFor({ timeout: 30000 });
    assert.match(await page.locator('#upgrade-panel tr[data-upgrade="hq-master"]').textContent(), /E_UPGRADE_TIMEOUT/);
    assert.ok((await rpcCalls(page, url)).some(c => c.method === "targets.upgrade_all"));
    await shots(page, "update-all");
  },
  /** A development build of the Master has nothing to send: the button says why. */
  async "no-templates"(page, url) {
    await page.goto(url);
    await openHost(page, "ui-test");
    const button = page.locator('[data-action="host-upgrade"]');
    await button.waitFor();
    assert.ok(await button.isDisabled());
    assert.match(await button.getAttribute("title"), /no installer to send/);
    assert.equal(await page.locator("#upgrade-panel").count(), 0);
  },
};
const scenarios = { "badges": ["masters-page", "outdated-hosts"], "update-one": ["masters-page", "outdated-hosts", "upgrade-fails"],
  "update-all": ["masters-page", "outdated-hosts", "upgrade-fails"], "no-templates": ["outdated-hosts", "no-templates"] };

(async () => {
  const browser = await chromium.launch({ headless: true }); const results = [];
  try {
    for (const [name, flags] of Object.entries(scenarios)) {
      const fixture = await startFixture(flags);
      try {
        const page = await browser.newPage({ viewport: { width: 1180, height: 900 }, locale: "en-US" });
        const d = decisions();
        await checks[name](page, fixture.url, d);
        if (d.count) console.log("[" + name + "] decisions: " + d.count + "\n" + d.summary());
        console.log("ok " + name);
        results.push({ scenario: name, decisions: d.count, log: d.log });
        await page.close();
      } finally { fixture.stop(); }
    }
    fs.writeFileSync(path.join(artifacts, "target-update-results.json"), JSON.stringify({ ok: true, results }, null, 2) + "\n");
    console.log(JSON.stringify({ ok: true }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
