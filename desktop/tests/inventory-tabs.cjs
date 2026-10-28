// Inventory tabs on the fixture's multi-hop scenario: a merged Master whose hosts include another Master
// (Branch Master → Lab Master → Lab web / Lab db) counts every host below it, in its tab, its row and the sky.
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { startFixture } = require("./decisions.cjs");

(async () => {
  const browser = await chromium.launch({ headless: true }), fixture = await startFixture(["masters-page", "multi-hop"]);
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(fixture.url);
    const tab = page.locator(".inv-tab", { hasText: "Through Branch Master" });
    await tab.waitFor();
    assert.equal((await tab.locator(".n").textContent()).trim(), "6", "three children, Lab Master and its two hosts");
    const branch = page.locator(".inv-row", { hasText: "Branch Master" }).first();
    assert.match(await branch.textContent(), /6 target hosts/);
    await tab.click();
    await page.locator('.inv-tab[aria-selected="true"]', { hasText: "Through Branch Master" }).waitFor();
    assert.equal(await page.locator(".inv-row").count(), 7, "Branch Master and its six hosts");
    for (const name of ["Lab Master", "Lab web", "Lab db"]) await page.locator(".inv-row", { hasText: name }).first().waitFor();
    assert.equal(await page.evaluate(() => window.sshccSky.keys().filter(key => key.startsWith("branch-master\u0000")).length), 6, "the sky draws every host below Branch Master");
    // The sidebar shows only the main menu until its chevron opens Add host, the filter and the tree; that choice is remembered
    await page.evaluate(() => localStorage.setItem("sshcc.sideHosts", "folded")); await page.reload();
    await page.locator(".inv-tab").first().waitFor();
    assert.equal(await page.locator("#side-hosts").isHidden(), true, "folded by default");
    await page.locator(".tree-toggle").click(); await page.locator("#side-hosts .add-host").waitFor();
    await page.reload(); await page.locator("#side-hosts .add-host").waitFor();
    console.log("inventory-tabs: ok");
  } finally { fixture.stop(); await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
