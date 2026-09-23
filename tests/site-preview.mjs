import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const origin = process.env.SITE_URL ?? "http://localhost:8088";
const chrome = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, headless: true });
mkdirSync("backups/site-preview", { recursive: true });

async function assertSceneClearOfText(page, label) {
  const overlaps = await page.evaluate(() => {
    const canvas = document.querySelector('.hero-canvas');
    const image = document.querySelector('.hero-static');
    if (getComputedStyle(canvas).display === 'none') {
      if (getComputedStyle(image).display === 'none') return [];
      const art = image.getBoundingClientRect();
      return [...document.querySelectorAll('.hero-copy, .hero-actions a')].map(element => {
        const rect = element.getBoundingClientRect();
        const overlap = art.left < rect.right && art.right > rect.left && art.top < rect.bottom && art.bottom > rect.top;
        return { text: element.textContent.trim().slice(0, 22), overlap };
      }).filter(item => item.overlap);
    }
    const bounds = canvas.getBoundingClientRect();
    const probe = document.createElement('canvas');
    probe.width = canvas.width;
    probe.height = canvas.height;
    const context = probe.getContext('2d', { willReadFrequently: true });
    context.drawImage(canvas, 0, 0);
    const pixels = context.getImageData(0, 0, probe.width, probe.height).data;
    const scale = canvas.width / bounds.width;
    return [...document.querySelectorAll('.hero-copy, .hero-actions a')].map(element => {
      const rect = element.getBoundingClientRect();
      let count = 0;
      for (let y = Math.max(0, Math.floor((rect.top - bounds.top) * scale)); y < Math.min(probe.height, Math.ceil((rect.bottom - bounds.top) * scale)); y += 4) {
        for (let x = Math.max(0, Math.floor((rect.left - bounds.left) * scale)); x < Math.min(probe.width, Math.ceil((rect.right - bounds.left) * scale)); x += 4) {
          if (pixels[(y * probe.width + x) * 4 + 3] >= 80) count++;
        }
      }
      return { text: element.textContent.trim().slice(0, 22), count };
    }).filter(item => item.count > 0);
  });
  assert.deepEqual(overlaps, [], `${label} chest overlaps copy or actions`);
}

async function goldPixelCount(page) {
  return page.locator('.hero-canvas').evaluate(canvas => {
    const probe = document.createElement('canvas');
    probe.width = canvas.width;
    probe.height = canvas.height;
    const context = probe.getContext('2d');
    context.drawImage(canvas, 0, 0);
    const data = context.getImageData(0, 0, probe.width, probe.height).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 16) {
      if (data[i] > 160 && data[i + 1] > 100 && data[i + 1] < 240 && data[i + 2] < 150 && data[i + 3] > 120) count++;
    }
    return count;
  });
}

try {
  for (const [name, width, height] of [["desktop", 1440, 900], ["mobile", 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    const response = await page.goto(origin, { waitUntil: "networkidle" });
    assert.equal(response.status(), 200);
    assert.match(await page.title(), /EnderChest/);
    assert.equal(await page.locator("h1").count(), 1);
    assert.match(await page.locator('.hero-copy').textContent(), /just for yourself/);
    assert.equal(await page.locator('link[rel="icon"]').getAttribute("href"), "/assets/enderchest-mark.png");
    assert.equal(await page.locator("img.brand-mark, img.download-stamp").count(), 3);
    assert.equal(await page.locator("img.brand-mark, img.download-stamp").evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0 && image.getAttribute("src") === "/assets/enderchest-mark.png")), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} horizontal overflow`);
    assert.equal(await page.locator('.status-light').count(), 0);
    assert.equal(await page.evaluate(() => Boolean(locomotiveScroll)), name === 'desktop', `${name} scroll mode`);
    if (name === 'desktop') {
      await page.waitForFunction(() => document.querySelector('.hero')?.dataset.chestReady === 'true');
      assert.equal(await page.locator('.hero').getAttribute('data-chest-mode'), 'interactive');
      const pixels = await page.locator('.hero-canvas').evaluate(canvas => {
      const probe = document.createElement('canvas');
      probe.width = canvas.width;
      probe.height = canvas.height;
      const context = probe.getContext('2d', { willReadFrequently: true });
      context.drawImage(canvas, 0, 0);
      const image = context.getImageData(0, 0, probe.width, probe.height);
      const scale = canvas.getBoundingClientRect().width / canvas.width;
      let count = 0;
      let left = probe.width;
      let right = 0;
      let top = probe.height;
      let bottom = 0;
      for (let y = 0; y < probe.height; y += 6) {
        for (let x = 0; x < probe.width; x += 6) {
          if (image.data[(y * probe.width + x) * 4 + 3] < 80) continue;
          count++;
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
      }
      return { count, left: left * scale, right: right * scale, top: top * scale, bottom: bottom * scale };
      });
      assert.ok(pixels.count > 150, `${name} 3D scene is blank: ${JSON.stringify(pixels)}`);
      const heroBox = await page.locator('.hero').boundingBox();
      assert.ok(pixels.right <= width && pixels.bottom < heroBox.height - 72, 'desktop chest crosses the bottom rule');
      assert.ok(pixels.left > width * .5, 'desktop chest is not on the right');
      const closedFrame = await page.locator('.hero-canvas').evaluate(canvas => canvas.toDataURL());
      const closedGold = await goldPixelCount(page);
      await page.mouse.move((pixels.left + pixels.right) / 2, 76 + (pixels.top + pixels.bottom) / 2);
      await page.waitForTimeout(400);
      assert.equal(await page.locator('.hero').getAttribute('data-chest-hover'), 'true');
      assert.ok(Number(await page.locator('.hero').getAttribute('data-chest-openness')) > .4, 'the supplied lid did not open');
      assert.ok(Number(await page.locator('.hero').getAttribute('data-folder-lift')) > .8, 'folders did not rise from the chest');
      assert.ok(await goldPixelCount(page) > closedGold * 1.5, 'the yellow folders are not visible');
      const openFrame = await page.locator('.hero-canvas').evaluate(canvas => canvas.toDataURL());
      assert.notEqual(openFrame, closedFrame, 'lid animation did not change the canvas');
      const openTop = await page.locator('.hero-canvas').evaluate(canvas => {
        const probe = document.createElement('canvas');
        probe.width = canvas.width;
        probe.height = canvas.height;
        const context = probe.getContext('2d');
        context.drawImage(canvas, 0, 0);
        const data = context.getImageData(0, 0, probe.width, probe.height).data;
        for (let y = 0; y < probe.height; y++) {
          for (let x = 0; x < probe.width; x += 4) {
            if (data[(y * probe.width + x) * 4 + 3] > 80) return y * canvas.getBoundingClientRect().height / canvas.height;
          }
        }
        return 0;
      });
      assert.ok(openTop > 20, 'open lid is clipped by the top of the hero');
      await page.screenshot({ path: 'backups/site-preview/desktop-open-viewport.png' });
      await page.mouse.move(0, 0);
      await page.waitForTimeout(400);
      assert.equal(await page.locator('.hero').getAttribute('data-chest-hover'), 'false');
      assert.ok(Number(await page.locator('.hero').getAttribute('data-folder-lift')) < .05, 'folders did not settle back into the chest');
    } else {
      assert.equal(await page.locator('.hero').getAttribute('data-chest-mode'), 'static');
      assert.equal(await page.locator('.hero-canvas').isVisible(), false);
      assert.equal(await page.locator('.hero-static').isVisible(), true);
      assert.equal(await page.locator('.hero-static').evaluate(image => image.complete && image.naturalWidth === 512), true);
      const staticPixels = await page.locator('.hero-static').evaluate(image => {
        const probe = document.createElement('canvas');
        probe.width = image.naturalWidth;
        probe.height = image.naturalHeight;
        const context = probe.getContext('2d');
        context.drawImage(image, 0, 0);
        const data = context.getImageData(0, 0, probe.width, probe.height).data;
        let count = 0;
        for (let i = 3; i < data.length; i += 128) if (data[i] > 80) count++;
        return count;
      });
      assert.ok(staticPixels > 100, 'phone chest image is blank');
    }
    await assertSceneClearOfText(page, name);
    await page.screenshot({ path: `backups/site-preview/${name}.png`, fullPage: true });
    await page.screenshot({ path: `backups/site-preview/${name}-viewport.png` });
    assert.deepEqual(pageErrors, [], `${name} browser errors`);
    if (name === "mobile") {
      for (const id of ["setup", "access", "download"]) {
        await page.locator(`#${id}`).screenshot({ path: `backups/site-preview/mobile-${id}.png` });
      }
    }
    await page.getByRole("tab", { name: "Linux" }).click();
    assert.equal(await page.locator("#panel-linux").isVisible(), true);
    assert.equal(await page.locator("#panel-windows").isVisible(), false);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByRole("button", { name: "Copy Linux setup command" }).click();
    await page.getByRole("button", { name: "Setup command copied" }).waitFor();
    assert.match(await page.evaluate(() => navigator.clipboard.readText()), /bash setup\.sh/);
    await page.getByRole("tab", { name: "Windows" }).click();
    assert.equal(await page.locator("#panel-windows").isVisible(), true);
    await page.getByRole("tab", { name: "Windows" }).focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.locator("#panel-linux").isVisible(), true);
    await page.getByRole("tab", { name: "Your HTTPS provider" }).click();
    assert.equal(await page.locator("#access-panel-provider").isVisible(), true);
    await page.getByRole("tab", { name: "Tailscale Funnel" }).click();
    assert.equal(await page.locator("#access-panel-funnel").isVisible(), true);
    if (name === "mobile") {
      await page.getByRole("button", { name: "Open menu" }).click();
      assert.equal(await page.locator("#mobile-nav").isVisible(), true);
      await page.locator("#mobile-nav a[href='#download']").click();
      assert.equal(await page.locator("#mobile-nav").isVisible(), false);
      assert.equal(await page.evaluate(() => location.hash), '#download');
    }
    await page.close();
  }
  const anchors = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await anchors.goto(origin, { waitUntil: 'networkidle' });
  await anchors.locator('.hero-actions a[href="#why"]').click();
  await anchors.waitForTimeout(90);
  const inFlight = await anchors.evaluate(() => scrollY);
  assert.ok(inFlight > 0 && inFlight < 700, `anchor did not animate: ${inFlight}`);
  await anchors.waitForFunction(() => Math.abs(document.querySelector('#why').getBoundingClientRect().top - 32) < 3);
  assert.equal(await anchors.evaluate(() => location.hash), '#why');
  await anchors.waitForFunction(() => document.activeElement.id === 'why');
  assert.equal(await anchors.evaluate(() => document.activeElement.id), 'why');
  await anchors.goBack();
  assert.equal(await anchors.evaluate(() => location.hash), '');
  await anchors.emulateMedia({ reducedMotion: 'reduce' });
  await anchors.waitForFunction(() => !locomotiveScroll);
  await anchors.locator('.main-nav a[href="#setup"]').click();
  assert.ok(await anchors.evaluate(() => Math.abs(document.querySelector('#setup').getBoundingClientRect().top - 32) < 3), 'reduced-motion anchor did not settle immediately');
  await anchors.close();
  const tablet = await browser.newPage({ viewport: { width: 1180, height: 820 }, hasTouch: true });
  await tablet.goto(origin, { waitUntil: 'networkidle' });
  assert.equal(await tablet.evaluate(() => Boolean(locomotiveScroll)), false, 'touch tablet should use native scrolling');
  await tablet.close();
  const wide = await browser.newPage({ viewport: { width: 1912, height: 900 } });
  await wide.goto(origin, { waitUntil: 'networkidle' });
  await wide.waitForFunction(() => document.querySelector('.hero')?.dataset.chestReady === 'true');
  const gap = await wide.evaluate(() => {
    const canvas = document.querySelector('.hero-canvas');
    const probe = document.createElement('canvas');
    probe.width = canvas.width;
    probe.height = canvas.height;
    const context = probe.getContext('2d');
    context.drawImage(canvas, 0, 0);
    const data = context.getImageData(0, 0, probe.width, probe.height).data;
    let left = probe.width;
    for (let y = 0; y < probe.height; y += 5) {
      for (let x = 0; x < probe.width; x += 5) {
        if (data[(y * probe.width + x) * 4 + 3] > 80) left = Math.min(left, x);
      }
    }
    const title = document.createRange();
    title.selectNodeContents(document.querySelector('.hero h1'));
    return left * canvas.getBoundingClientRect().width / canvas.width - title.getBoundingClientRect().right;
  });
  assert.ok(gap > 8, `wide hero chest touches the title: ${gap}px gap`);
  await wide.screenshot({ path: 'backups/site-preview/wide-viewport.png' });
  await wide.close();
  for (const path of ["/guide.html", "/downloads/EnderChest-0.1.0.zip", "/downloads/EnderChest-0.1.0.tar.gz", "/downloads/SHA256SUMS.txt", "/assets/enderchest-mark.png", "/assets/ender-chest.gltf", "/assets/ender-chest-static.png", "/vendor/three.module.js", "/vendor/three.core.js", "/vendor/loaders/GLTFLoader.js", "/vendor/utils/BufferGeometryUtils.js"]) {
    const response = await fetch(new URL(path, origin), { method: "HEAD" });
    assert.equal(response.status, 200, `${path} is unavailable`);
  }
  for (const width of [320, 480, 600, 700, 701, 720, 768, 900, 901, 960, 1024]) {
    const page = await browser.newPage({ viewport: { width, height: 768 } });
    await page.goto(origin, { waitUntil: "networkidle" });
    const layout = await page.evaluate(() => ({
      pageFits: document.documentElement.scrollWidth <= innerWidth,
      headingOverflow: [...document.querySelectorAll("h1, h2, h3")].filter(node => node.scrollWidth > node.clientWidth + 2).map(node => ({ text: node.textContent, width: node.clientWidth, scrollWidth: node.scrollWidth })),
    }));
    assert.equal(layout.pageFits, true, `${width}px page overflow`);
    assert.deepEqual(layout.headingOverflow, [], `${width}px heading overflow`);
    await page.screenshot({ path: `backups/site-preview/${width}-viewport.png` });
    await assertSceneClearOfText(page, `${width}px`);
    await page.close();
  }
  const guide = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await guide.goto(new URL("/guide.html", origin).toString(), { waitUntil: "networkidle" });
  assert.equal(await guide.locator('link[rel="icon"]').getAttribute("href"), "/assets/enderchest-mark.png");
  assert.equal(await guide.locator("img.brand-mark").count(), 2);
  assert.equal(await guide.locator("img.brand-mark").evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)), true);
  assert.equal(await guide.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "guide horizontal overflow");
  assert.equal(await guide.evaluate(() => Boolean(locomotiveScroll)), false, 'mobile guide should use native scrolling');
  await guide.locator('.guide-sidebar a[href="#backup"]').click();
  await guide.waitForFunction(() => Math.abs(document.querySelector('#backup').getBoundingClientRect().top - 22) < 3);
  assert.equal(await guide.evaluate(() => location.hash), '#backup');
  await guide.screenshot({ path: "backups/site-preview/guide-mobile.png", fullPage: true });
  await guide.close();
  const desktopGuide = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await desktopGuide.goto(new URL('/guide.html', origin).toString(), { waitUntil: 'networkidle' });
  assert.equal(await desktopGuide.evaluate(() => Boolean(locomotiveScroll)), true, 'desktop guide should use Locomotive Scroll');
  await desktopGuide.locator('.guide-sidebar a[href="#backup"]').click();
  await desktopGuide.waitForFunction(() => Math.abs(document.querySelector('#backup').getBoundingClientRect().top - 32) < 3);
  assert.equal(await desktopGuide.evaluate(() => location.hash), '#backup');
  await desktopGuide.close();
  console.log("Product site: desktop/mobile, navigation, guide, downloads, and interactive 3D chest passed.");
} finally {
  await browser.close();
}
