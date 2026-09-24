import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const base = process.env.E2E_BASE_URL ?? "http://localhost:3000";
if (!/^http:\/\/localhost:300[02]$/.test(base)) throw new Error("Host UI test must target a local EnderChest instance");
if (Boolean(process.env.TEST_ADMIN_EMAIL) !== Boolean(process.env.TEST_ADMIN_PASSWORD)) {
  throw new Error("Provide both TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD, or neither");
}
const temporary = !process.env.TEST_ADMIN_EMAIL;
const email = process.env.TEST_ADMIN_EMAIL ?? `host-ui-${randomUUID()}@example.invalid`;
const password = process.env.TEST_ADMIN_PASSWORD ?? randomBytes(24).toString("base64url");
if (!email || !password) throw new Error("Both TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD are required");
const compose = ["compose", "--env-file", "docker/.env", "-f", "docker/docker-compose.yml", "exec", "-T", "app", "node", "-e"];
function inApp(code) {
  const result = spawnSync("docker", [...compose, code, email, password], { stdio: "inherit" });
  if (result.error || result.status !== 0) throw result.error ?? new Error(`Docker exited with ${result.status}`);
}
if (temporary) inApp(`const { Pool } = require("pg"); const bcrypt = require("bcrypt"); const { randomUUID } = require("node:crypto");
const db = new Pool({ host: process.env.POSTGRES_HOST, port: Number(process.env.POSTGRES_PORT), database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
(async () => { const id = randomUUID(); const client = await db.connect(); try { await client.query("BEGIN"); await client.query("INSERT INTO users (id,email,password_hash,is_admin,status) VALUES ($1,$2,$3,true,'active')", [id,process.argv[1],await bcrypt.hash(process.argv[2],12)]); await client.query("INSERT INTO quotas (user_id,allocated_bytes) VALUES ($1,$2)", [id,1073741824]); await client.query("INSERT INTO folders (id,owner_id,parent_id,name) VALUES ($1,$2,NULL,'root')", [randomUUID(),id]); await client.query("COMMIT"); } catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); await db.end(); } })().catch(error => { console.error(error); process.exitCode = 1; });`);
const chrome = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
let browser;
const output = "backups/e2e-ui";
await mkdir(output, { recursive: true });

try {
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  const context = await browser.newContext();
  const login = await context.newPage();
  await login.goto(`${base}/login`);
  await login.getByLabel("Email address").fill(email);
  await login.getByLabel("Password").fill(password);
  await login.getByRole("button", { name: "Sign in" }).click();
  await login.getByRole("heading", { name: "My files" }).waitFor();

  for (const [name, width, height] of [["desktop", 1440, 900], ["tablet", 768, 900], ["phone", 390, 844]]) {
    const page = await context.newPage();
    await page.setViewportSize({ width, height });
    await page.goto(`${base}/admin`);
    await page.getByRole("navigation", { name: "Administration" }).getByRole("button", { name: "Host" }).click();
    await page.getByRole("heading", { name: "Services" }).waitFor();
    await page.getByText("Connected", { exact: true }).first().waitFor();
    for (const theme of ["light", "dark"]) {
      await page.evaluate(mode => document.documentElement.setAttribute("data-theme", mode), theme);
      const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
      assert.ok(dimensions.width <= dimensions.viewport + 1, `${name}/${theme}: horizontal overflow ${JSON.stringify(dimensions)}`);
      await page.screenshot({ path: `${output}/${name}-host-${theme}.png`, fullPage: true });
    }
    await page.getByRole("button", { name: "Refresh host status" }).click();
    await page.getByText("Connected", { exact: true }).first().waitFor();
    await page.close();
  }
  await login.close();
  console.log(`Host dashboard browser checks passed. Screenshots: ${output}`);
} finally {
  await browser?.close();
  if (temporary) inApp(`const { Pool } = require("pg"); const db = new Pool({ host: process.env.POSTGRES_HOST, port: Number(process.env.POSTGRES_PORT), database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
db.query("DELETE FROM users WHERE email = $1", [process.argv[1]]).then(() => db.end()).catch(error => { console.error(error); process.exitCode = 1; });`);
}
