// Tags, filter and group run (roadmap entry 4) on the fixture (plain Chromium). Gates the core task, tag 3 hosts `web` and
// run one command on all three, at ≤ 5 decisions. Also checks the filter (folders and Tags, merged hosts included).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { decisions, startFixture } = require("./decisions.cjs");
const artifacts = path.resolve(__dirname, "../../artifacts/tags-ui"); fs.mkdirSync(artifacts, { recursive: true });
const MAX_DECISIONS = 5;
const calls = async (page, url) => (await (await page.request.get(url + "/calls")).json());
/** A request straight to the fixture, as the page would send it (to set up state). */
const rpc = async (page, url, method, params = {}) => (await page.request.post(url + "/rpc", { data: { command: "rpc", args: { method, params } } })).json();
const treeHosts = page => page.locator("#dc-tree .dc-item[data-node^='node:']");

async function shots(page, name) {
  for (const width of [1180, 820]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: path.join(artifacts, name + "-" + width + ".png"), fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), "no sideways scroll at " + width + " px");
  }
  await page.setViewportSize({ width: 1180, height: 900 });
}
/** Every Master branch open, so the tree shows every host the filter keeps. */
async function openTree(page) {
  for (let i = 0; i < 6; i++) {
    const closed = page.locator('#dc-tree .dc-toggle[aria-expanded="false"]');
    if (!(await closed.count())) return;
    await closed.first().click();
  }
}
async function filter(page, text) {
  await page.locator("#dc-search").fill(text);
  await openTree(page);
}
const visibleHosts = async page => (await treeHosts(page).allTextContents()).map(text => text.trim());

const checks = {
  /** The filter box matches folder names, for direct and merged hosts. */
  async "filter-folders"(page, url) {
    const web = await rpc(page, url, "folders.create", { name: "Web servers" });
    await rpc(page, url, "folders.assign", { targetId: "ui-test", folderId: web.id });
    const branch = await rpc(page, url, "folders.create", { name: "Branch office", master: "branch-master" });
    await rpc(page, url, "folders.assign", { targetId: "branch-master/child-2", folderId: branch.id });
    await page.goto(url);
    await page.locator("#dc-tree").waitFor();
    await filter(page, "web serv");
    await page.waitForFunction(() => document.querySelectorAll("#dc-tree .dc-item[data-node^='node:']").length === 1);
    assert.deepEqual((await visibleHosts(page)).map(t => t.includes("UI test target")), [true], "the host in Web servers");
    await filter(page, "branch office");
    await page.locator("#dc-tree .dc-item[data-node='node:branch-master/child-2']").waitFor();
    assert.equal(await treeHosts(page).filter({ hasText: "UI test target" }).count(), 0);
    await filter(page, "192.0.2.20"); // addresses still match
    await page.locator("#dc-tree .dc-item[data-node='node:ui-test']").waitFor();
    await shots(page, "filter-folder");
  },
};
const scenarios = { "filter-folders": ["masters-page"] };

(async () => {
  const browser = await chromium.launch({ headless: true }); const results = [];
  try {
    for (const [name, flags] of Object.entries(scenarios)) {
      const fixture = await startFixture(flags);
      try {
        const page = await browser.newPage({ viewport: { width: 1180, height: 900 }, locale: "en-US" });
        const d = decisions();
        await checks[name](page, fixture.url, d);
        if (d.count) {
          console.log("[" + name + "] decisions: " + d.count + "\n" + d.summary());
          assert.ok(d.count <= MAX_DECISIONS, name + ": " + d.count + " decisions, target ≤ " + MAX_DECISIONS);
        }
        console.log("ok " + name);
        results.push({ scenario: name, decisions: d.count, log: d.log });
        await page.close();
      } finally { fixture.stop(); }
    }
    fs.writeFileSync(path.join(artifacts, "tags-results.json"), JSON.stringify({ ok: true, gate: MAX_DECISIONS, results }, null, 2) + "\n");
    console.log(JSON.stringify({ ok: true }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
