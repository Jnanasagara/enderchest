import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { test } from "node:test";
import { chromium } from "playwright-core";

async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test("web wizard creates a new setup and refuses to overwrite it", async () => {
  const root = path.resolve("backups", "setup-tests", randomUUID());
  await mkdir(path.join(root, "scripts"), { recursive: true });
  await mkdir(path.join(root, "docker"));
  await copyFile("scripts/setup-wizard.mjs", path.join(root, "scripts/setup-wizard.mjs"));
  await copyFile("scripts/setup-wizard-core.mjs", path.join(root, "scripts/setup-wizard-core.mjs"));
  await copyFile("docker/env.example", path.join(root, "docker/env.example"));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const args = [path.join(root, "scripts/setup-wizard.mjs"), "web"];
  const env = { ...process.env, ENDER_HOST_OS: "windows", ENDER_HOST_ROOT: "D:/EnderChest", ENDER_SETUP_PORT: String(port), ENDER_SETUP_BIND: "127.0.0.1" };
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: "ignore" });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try { ready = (await fetch(`${base}/health`)).ok; if (ready) break; } catch { /* Starting. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, "Wizard did not start");
    const form = await (await fetch(base)).text();
    const token = form.match(/name="token" value="([a-f0-9]+)"/)?.[1];
    assert.ok(token);
    if (process.env.TEST_SETUP_SCREENSHOT === "1") {
      const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", headless: true });
      try {
        for (const [name, width, height] of [["desktop", 1280, 800], ["mobile", 390, 844]]) {
          const page = await browser.newPage({ viewport: { width, height } });
          await page.goto(base);
          await page.screenshot({ path: path.resolve("backups", `setup-wizard-${name}.png`), fullPage: true });
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
          await page.close();
        }
      } finally { await browser.close(); }
    }
    const body = new URLSearchParams({ token, email: "admin@example.com", password: "ValidPass$#1234", confirmation: "wrong", storageRoot: "D:/Family Files" });
    const headers = { origin: base, "content-type": "application/x-www-form-urlencoded" };
    assert.equal((await fetch(`${base}/create`, { method: "POST", headers: { ...headers, origin: "http://attacker.invalid" }, body })).status, 404);
    assert.equal((await fetch(`${base}/create`, { method: "POST", headers, body })).status, 400);
    body.set("confirmation", "ValidPass$#1234");
    assert.equal((await fetch(`${base}/create`, { method: "POST", headers, body })).status, 200);
    const exitCode = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Wizard did not exit")), 5000);
      child.on("exit", code => { clearTimeout(timeout); resolve(code); });
    });
    assert.equal(exitCode, 0);
    const output = await readFile(path.join(root, "docker/.env.pending"), "utf8");
    assert.match(output, /^ENDER_STORAGE_ROOT='D:\/Family Files'$/m);
    assert.equal(await readFile(path.join(root, "docker/.setup-storage-path.pending"), "utf8"), "D:/Family Files");
    const retry = spawnSync(process.execPath, args, { cwd: root, env, encoding: "utf8" });
    assert.notEqual(retry.status, 0);
    assert.equal(await readFile(path.join(root, "docker/.env.pending"), "utf8"), output);

    if (process.env.TEST_DOCKER_SETUP === "1") {
      const config = spawnSync("docker", ["compose", "--env-file", path.join(root, "docker/.env.pending"), "-f", path.resolve("docker/docker-compose.yml"), "-f", path.resolve("docker/compose.install.yml"), "config", "--format", "json"], { encoding: "utf8" });
      assert.equal(config.status, 0, config.stderr);
      const parsed = JSON.parse(config.stdout);
      assert.equal(parsed.services.app.environment.BOOTSTRAP_ADMIN_PASSWORD, undefined);
      assert.equal(parsed.services["bootstrap-admin"].environment.BOOTSTRAP_ADMIN_PASSWORD, "ValidPass$$#1234");
      assert.ok(parsed.services.garage.volumes.some(volume => volume.type === "bind" && volume.source === "D:/Family Files/objects"));
      const valueCompose = path.join(root, "docker/compose-values.yml");
      await writeFile(valueCompose, 'services:\n  value:\n    image: node:22-bookworm\n    environment:\n      TEST_VALUE: ${BOOTSTRAP_ADMIN_PASSWORD}\n    command: ["node", "-p", "process.env.TEST_VALUE"]\n');
      const project = `enderchest-setup-test-${randomUUID().slice(0, 8)}`;
      const args = ["compose", "-p", project, "--env-file", path.join(root, "docker/.env.pending"), "-f", valueCompose];
      try {
        const actual = spawnSync("docker", [...args, "run", "--rm", "--no-deps", "value"], { encoding: "utf8" });
        assert.equal(actual.status, 0, actual.stderr);
        assert.equal(actual.stdout.trim(), "ValidPass$#1234");
      } finally {
        spawnSync("docker", [...args, "down"], { encoding: "utf8" });
      }
    }
  } finally {
    if (child.exitCode === null) child.kill();
  }
});
