// Adds one host through the add flow on the fixture and prints the decision count.
// Baseline only (ticket 01): it walks today's flow and does not gate on the count yet.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { decisions, startFixture } = require("./decisions.cjs");
const artifacts = path.resolve(__dirname, "../../artifacts/add-host-ui"); fs.mkdirSync(artifacts, { recursive: true });
const ADDRESS = "192.0.2.31", NAME = "win-01";
const calls = async (page, url) => (await (await page.request.get(url + "/calls")).json());

/** Today's flow: "+ Add host ▾" → Target host… → form → Create installer → Save installer → paste code. */
async function addOneHost(page, url, d) {
  await page.goto(url);
  await page.locator('[data-action="add-menu"]').click();
  await d.choose(page.getByRole("menuitem", { name: "Target host…" }), "kind of host");
  const form = page.locator("#create-pairing"); await form.waitFor();
  await d.fill(form.locator('[name="label"]'), NAME, "host name");
  await d.select(form.locator('[name="os"]'), "windows", "operating system");
  await d.fill(form.locator('[name="address"]'), ADDRESS, "address");
  await form.locator('button[type="submit"]').click();
  await page.locator('[data-action="save-setup"]').click();
  await page.locator(".callout.good").filter({ hasText: "Saved" }).waitFor();
  // On the new host: open the installer, Approve, copy the code (simulated by the fixture).
  const { code } = await (await page.request.get(url + "/pairing-code")).json();
  await d.fill(page.locator('#complete-pairing [name="code"]'), code, "pairing code");
  await page.locator('#complete-pairing button[type="submit"]').click();
  await page.locator(".ready-message").waitFor();
}

(async () => {
  const browser = await chromium.launch({ headless: true }); const results = [];
  try {
    for (const scenario of [["empty"], ["empty", "new-host-master"]]) {
      const fixture = await startFixture(scenario);
      try {
        const page = await browser.newPage({ viewport: { width: 1180, height: 900 } });
        const d = decisions();
        await addOneHost(page, fixture.url, d);
        const sent = await calls(page, fixture.url), rpc = method => sent.filter(c => c.command === "rpc" && c.method === method);
        assert.equal(rpc("pairing.create").length, 1); assert.equal(rpc("pairing.create")[0].params.address, ADDRESS);
        assert.equal(sent.filter(c => c.command === "save_setup").length, 1);
        assert.equal(rpc("pairing.complete").length, 1);
        if (scenario.includes("new-host-master")) await page.locator(".callout").filter({ hasText: "is also a Master" }).waitFor();
        const name = scenario.join("+");
        for (const width of [1180, 820]) { await page.setViewportSize({ width, height: 900 }); await page.screenshot({ path: path.join(artifacts, "add-host-" + name + "-" + width + ".png"), fullPage: true }); }
        console.log("[" + name + "] decisions: " + d.count + "\n" + d.summary());
        results.push({ scenario: name, decisions: d.count, log: d.log });
        await page.close();
      } finally { fixture.stop(); }
    }
    fs.writeFileSync(path.join(artifacts, "add-host-results.json"), JSON.stringify({ ok: true, gate: null, results }, null, 2) + "\n");
    console.log(JSON.stringify({ ok: true, decisions: results[0].decisions }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
