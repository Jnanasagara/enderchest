import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const origin = process.env.SITE_URL ?? 'http://localhost:8088';
const chrome = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser = await chromium.launch({ executablePath: chrome, headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('.hero')?.dataset.chestReady === 'true');
  const image = await page.locator('.hero-canvas').evaluate(canvas => {
    const probe = document.createElement('canvas');
    probe.width = canvas.width;
    probe.height = canvas.height;
    const context = probe.getContext('2d', { willReadFrequently: true });
    context.drawImage(canvas, 0, 0);
    const { data } = context.getImageData(0, 0, probe.width, probe.height);
    let left = probe.width;
    let right = 0;
    let top = probe.height;
    let bottom = 0;
    for (let y = 0; y < probe.height; y++) {
      for (let x = 0; x < probe.width; x++) {
        if (data[(y * probe.width + x) * 4 + 3] < 80) continue;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
    if (right <= left || bottom <= top) throw new Error('The chest canvas is blank');
    const side = Math.max(right - left, bottom - top) + 36;
    const output = document.createElement('canvas');
    output.width = output.height = 512;
    const out = output.getContext('2d');
    out.imageSmoothingEnabled = false;
    out.drawImage(probe, (left + right - side) / 2, (top + bottom - side) / 2, side, side, 0, 0, 512, 512);
    return output.toDataURL('image/png').split(',')[1];
  });
  writeFileSync('site/assets/ender-chest-static.png', Buffer.from(image, 'base64'));
  await page.close();
} finally {
  await browser.close();
}
