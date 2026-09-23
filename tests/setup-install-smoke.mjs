import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { renderSetupEnv } from "../scripts/setup-wizard-core.mjs";

if (process.env.SETUP_INSTALL_SMOKE !== "yes") throw new Error("Explicit isolated smoke-test opt-in required");
const suffix = randomUUID().slice(0, 8);
const root = path.resolve("backups", `setup-install-smoke-${suffix}`);
if (existsSync(root)) throw new Error(`Test storage already exists: ${root}`);
await mkdir(path.join(root, "objects"), { recursive: true });
const email = "setup-smoke@example.invalid";
const password = "ValidPass$#1234";
const publicMode = process.env.SETUP_PUBLIC_APP_SMOKE === "yes";
const linkSecret = randomBytes(32).toString("hex");
const envFile = path.join(root, "setup.env");
const template = await readFile("docker/env.example", "utf8");
const config = renderSetupEnv(template, { email, password, storageRoot: root.replaceAll("\\", "/") });
await writeFile(envFile, config, { mode: 0o600, flag: "wx" });
const overlay = path.join(root, "override.yml");
await writeFile(overlay, `services:
  postgres:
    container_name: !reset null
  migrate:
    container_name: !reset null
  garage:
    container_name: !reset null
    ports: !override ["127.0.0.1:3904:3900"]
  s3-init:
    environment:
      S3_CORS_ORIGINS: http://localhost:3004
  bootstrap-admin:
    container_name: !reset null
  app:
    container_name: !reset null
    ports: !override ["127.0.0.1:3004:3000"]
    environment:
      S3_PUBLIC_ENDPOINT: http://localhost:3904
${publicMode ? `      PUBLIC_APP_URL: https://family.tail123.ts.net
      PRESIGNED_URL_MODE: app
      PUBLIC_LINK_SECRET: ${linkSecret}
` : ""}
`, { flag: "wx" });

const compose = ["compose", "-p", `enderchest-install-smoke-${suffix}`, "--env-file", envFile, "-f", path.resolve("docker/docker-compose.yml"), "-f", path.resolve("docker/compose.install.yml"), "-f", overlay];
function docker(...args) {
  const result = spawnSync("docker", [...compose, ...args], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`docker compose ${args[0]} failed`);
}
let client;
let key;
try {
  docker("config", "--quiet");
  docker("up", "-d", "--build", "--wait");
  const login = await fetch("http://localhost:3004/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }),
  });
  assert.equal(login.status, 200, `Bootstrap login failed: ${await login.text()}`);
  if (publicMode) {
    const cookies = login.headers.getSetCookie().map(raw => raw.split(";")[0]);
    const cookie = cookies.join("; ");
    const csrf = cookies.find(value => value.startsWith("csrf="))?.slice(5);
    assert.ok(csrf, "Login must set CSRF cookie");
    const rootResponse = await fetch("http://localhost:3004/api/folders/root", { headers: { cookie } });
    assert.equal(rootResponse.status, 200);
    const rootFolder = (await rootResponse.json()).id;
    const form = new FormData();
    form.set("folderId", rootFolder);
    form.set("file", new File(["funnel storage flow"], "funnel.txt", { type: "text/plain" }));
    const uploaded = await fetch("http://localhost:3004/api/upload", { method: "POST", headers: { cookie, "x-csrf-token": csrf }, body: form });
    const uploadBody = await uploaded.text();
    assert.equal(uploaded.status, 200, `Upload failed: ${uploadBody}`);
    const fileId = JSON.parse(uploadBody).id;
    const listed = await fetch(`http://localhost:3004/api/folders?parentId=${rootFolder}`, { headers: { cookie } });
    assert.equal(listed.status, 200);
    assert.ok((await listed.json()).files.some(file => file.id === fileId));
    const normalDownload = await fetch(`http://localhost:3004/api/files/${fileId}/download`, { headers: { cookie } });
    assert.equal(normalDownload.status, 200);
    assert.equal(await normalDownload.text(), "funnel storage flow");
    const signed = await fetch(`http://localhost:3004/api/files/${fileId}/presign`, { headers: { cookie } });
    const signedBody = await signed.text();
    assert.equal(signed.status, 200, `Signing failed: ${signedBody}`);
    const publicUrl = new URL(JSON.parse(signedBody).url);
    assert.equal(publicUrl.origin, "https://family.tail123.ts.net");
    const localSigned = `http://localhost:3004${publicUrl.pathname}${publicUrl.search}`;
    const publicDownload = await fetch(localSigned);
    const downloadBody = await publicDownload.text();
    assert.equal(publicDownload.status, 200, `Public signed download failed: ${downloadBody}`);
    assert.equal(downloadBody, "funnel storage flow");
    const tampered = new URL(localSigned);
    tampered.searchParams.set("signature", "0".repeat(64));
    assert.equal((await fetch(tampered)).status, 403);
    const deleted = await fetch(`http://localhost:3004/api/files/${fileId}`, { method: "DELETE", headers: { cookie, "x-csrf-token": csrf } });
    assert.equal(deleted.status, 200);
    assert.equal((await fetch(localSigned)).status, 404);
  }
  client = new S3Client({
    endpoint: "http://localhost:3904", region: "garage", forcePathStyle: true,
    credentials: {
      accessKeyId: config.match(/^S3_ACCESS_KEY_ID=(.*)$/m)[1],
      secretAccessKey: config.match(/^S3_SECRET_ACCESS_KEY=(.*)$/m)[1],
    },
  });
  key = "install-smoke/probe";
  const bytes = randomBytes(128 * 1024);
  await client.send(new PutObjectCommand({ Bucket: "enderchest", Key: key, Body: bytes }));
  const file = await client.send(new GetObjectCommand({ Bucket: "enderchest", Key: key }));
  assert.deepEqual(Buffer.from(await file.Body.transformToByteArray()), bytes);
  assert.ok((await readdir(path.join(root, "objects"))).length > 0);
  process.stdout.write(`Fresh isolated install passed: bootstrap login, Garage host-folder storage${publicMode ? ", and app-routed signed downloads" : ""}.\n`);
} finally {
  if (client && key) await client.send(new DeleteObjectCommand({ Bucket: "enderchest", Key: key })).catch(() => {});
  client?.destroy();
  const result = spawnSync("docker", [...compose, "down"], { stdio: "inherit" });
  if (result.status !== 0) process.stderr.write("Could not stop isolated smoke containers; inspect them manually.\n");
}
