import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const origin = process.env.THEME_UI_URL ?? "http://localhost:3001";
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
});
mkdirSync("backups/theme-ui", { recursive: true });

try {
  for (const [name, width, height] of [["desktop", 1440, 900], ["mobile", 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${origin}/login`, { waitUntil: "networkidle" });
    assert.match(await page.locator('link[rel="icon"]').getAttribute("href"), /^\/icon\.png(?:\?|$)/);
    assert.equal((await page.request.get(`${origin}/icon.png`)).status(), 200);
    await page.screenshot({ path: `backups/theme-ui/${name}-light.png`, fullPage: true });
    await page.getByRole("button", { name: "Switch to dark mode" }).click();
    assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
    await page.screenshot({ path: `backups/theme-ui/${name}-dark.png`, fullPage: true });
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} overflow`);
    assert.deepEqual(errors, [], `${name} browser errors`);
    await page.close();
  }
  console.log("Theme UI: desktop/mobile switching, persistence, and overflow passed.");
} finally {
  await browser.close();
}
