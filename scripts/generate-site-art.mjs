import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chrome = process.env.CHROME_PATH ?? (process.platform === "win32"
  ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  : "/usr/bin/chromium");
const browser = await chromium.launch({ executablePath: chrome, headless: true });
try {
  const page = await browser.newPage();
  const data = await page.evaluate(() => {
    const small = document.createElement("canvas");
    small.width = 400;
    small.height = 225;
    const c = small.getContext("2d");
    let seed = 28473;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const fill = (color, x, y, w, h) => { c.fillStyle = color; c.fillRect(x, y, w, h); };
    const poly = (color, points) => { c.fillStyle = color; c.beginPath(); c.moveTo(...points[0]); for (const point of points.slice(1)) c.lineTo(...point); c.closePath(); c.fill(); };

    fill("#63868a", 0, 0, 400, 225);
    for (let i = 0; i < 280; i++) {
      const x = Math.floor(rand() * 400), y = Math.floor(rand() * 98);
      fill(rand() > .5 ? "#6c8e8c" : "#587d80", x, y, rand() > .7 ? 4 : 2, 2);
    }
    for (const [x, y, width] of [[14, 38, 42], [125, 25, 54], [253, 47, 38], [347, 31, 38]]) {
      fill("#a9bbb2", x, y, width, 5);
      fill("#a9bbb2", x + 7, y - 5, width - 17, 5);
      fill("#a9bbb2", x + 14, y - 9, width - 31, 4);
      fill("#90a9a5", x + 8, y + 5, width - 14, 3);
    }
    poly("#4d6b6a", [[0, 121], [0, 98], [27, 83], [49, 102], [73, 69], [105, 93], [132, 77], [166, 112], [190, 85], [228, 116], [260, 76], [283, 89], [306, 66], [334, 92], [358, 74], [400, 103], [400, 139]]);
    poly("#3d6059", [[0, 135], [0, 116], [27, 104], [54, 119], [87, 95], [116, 122], [148, 101], [179, 123], [218, 92], [254, 123], [290, 88], [332, 115], [371, 89], [400, 109], [400, 150]]);
    for (let x = -8; x < 420; x += 14) {
      const y = 104 + Math.floor(rand() * 29);
      fill("#24483e", x + 5, y, 4, 32);
      fill("#2b5948", x, y - 12, 15, 19);
      fill("#397057", x + 3, y - 19, 10, 8);
      fill("#24483e", x - 2, y - 8, 18, 7);
    }
    poly("#25483d", [[0, 159], [0, 139], [47, 137], [72, 150], [122, 144], [169, 159], [224, 128], [260, 143], [308, 130], [350, 145], [400, 135], [400, 170]]);
    poly("#456d48", [[0, 225], [0, 174], [48, 166], [80, 183], [126, 171], [167, 185], [219, 151], [264, 162], [301, 146], [346, 162], [400, 149], [400, 225]]);
    for (let x = 0; x < 400; x += 8) {
      const hill = Math.floor(171 + 12 * Math.sin(x / 27) - 14 * (x / 400));
      fill(rand() > .5 ? "#557e4c" : "#3f6c46", x, hill, 8, 4);
      if (rand() > .7) fill("#94a063", x + 3, hill - 3, 2, 3);
    }
    // A terraced foreground mound and an original block-built chest.
    for (const [x, y, w] of [[220, 178, 180], [236, 167, 164], [252, 156, 148], [268, 146, 132], [284, 136, 116]]) {
      fill("#574b37", x, y, w, 14);
      fill("#6c6141", x, y + 5, w, 2);
      fill("#528153", x, y, w, 5);
      for (let sx = x + 8; sx < x + w; sx += 19) fill("#7f9854", sx, y, 5, 2);
    }
    fill("#102c28", 298, 113, 84, 13);
    fill("#4f3929", 304, 107, 71, 50);
    fill("#855c37", 307, 111, 65, 40);
    fill("#a77642", 310, 116, 60, 13);
    fill("#5b3b29", 305, 131, 69, 4);
    fill("#50372a", 316, 110, 5, 44);
    fill("#50372a", 357, 110, 5, 44);
    fill("#5c402a", 310, 140, 60, 13);
    fill("#be9050", 329, 130, 19, 20);
    fill("#eed286", 335, 133, 7, 13);
    fill("#503829", 339, 140, 3, 3);
    fill("#ceb17a", 310, 111, 60, 2);
    fill("#182c27", 297, 155, 86, 5);
    for (let i = 0; i < 36; i++) {
      const x = 225 + Math.floor(rand() * 174), y = 165 + Math.floor(rand() * 60);
      fill(rand() > .5 ? "#638950" : "#304e37", x, y, 2 + Math.floor(rand() * 4), 2);
    }
    for (const [x, y] of [[270, 129], [289, 103], [386, 109], [374, 78]]) {
      fill("#d2c978", x, y, 2, 2);
      fill("#d2c978", x - 2, y + 2, 1, 1);
      fill("#d2c978", x + 3, y - 2, 1, 1);
    }
    const full = document.createElement("canvas");
    full.width = 1600;
    full.height = 900;
    const out = full.getContext("2d");
    out.imageSmoothingEnabled = false;
    out.drawImage(small, 0, 0, full.width, full.height);
    return full.toDataURL("image/png").split(",")[1];
  });
  mkdirSync(path.join(root, "site/assets"), { recursive: true });
  writeFileSync(path.join(root, "site/assets/voxel-world.png"), Buffer.from(data, "base64"));
} finally {
  await browser.close();
}
