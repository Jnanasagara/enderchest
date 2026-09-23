import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { renderPublicConfig } from "../scripts/publish-config-core.mjs";

test("funnel and provider configs keep an independent app origin and secret", () => {
  const funnel = renderPublicConfig("funnel", ["https://family.tail123.ts.net"]);
  assert.match(funnel, /^PUBLIC_MODE=funnel$/m);
  assert.match(funnel, /^PUBLIC_APP_URL=https:\/\/family\.tail123\.ts\.net$/m);
  assert.match(funnel, /^PUBLIC_LINK_SECRET=[a-f0-9]{64}$/m);
  assert.doesNotMatch(funnel, /S3_PUBLIC_ENDPOINT/);
  const updated = renderPublicConfig("funnel", ["https://new.tail123.ts.net"], funnel);
  assert.equal(updated.match(/^PUBLIC_LINK_SECRET=(.*)$/m)?.[1], funnel.match(/^PUBLIC_LINK_SECRET=(.*)$/m)?.[1]);
  assert.throws(() => renderPublicConfig("funnel", ["https://drive.example.com"]));
  assert.throws(() => renderPublicConfig("provider", ["http://drive.example.com"]));
  assert.throws(() => renderPublicConfig("provider", ["https://drive.example.com/path"]));
  assert.throws(() => renderPublicConfig("provider", ["https://user:pass@drive.example.com"]));
  assert.throws(() => renderPublicConfig("provider", ["https://drive.example.com"], funnel));
});

test("direct domain config requires distinct hostnames", () => {
  const config = renderPublicConfig("domain", ["drive.example.com", "files.example.com"]);
  assert.match(config, /^DOMAIN=drive\.example\.com$/m);
  assert.match(config, /^S3_PUBLIC_DOMAIN=files\.example\.com$/m);
  assert.throws(() => renderPublicConfig("domain", ["drive.example.com", "drive.example.com"]));
  assert.throws(() => renderPublicConfig("domain", ["https://drive.example.com", "files.example.com"]));
});

test("publisher preserves the signing key and never rewrites private configuration", () => {
  const parent = path.resolve("backups", "publish-tests");
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(path.join(parent, "case-"));
  mkdirSync(path.join(root, "scripts"));
  mkdirSync(path.join(root, "docker"));
  copyFileSync("scripts/publish-config.mjs", path.join(root, "scripts/publish-config.mjs"));
  copyFileSync("scripts/publish-config-core.mjs", path.join(root, "scripts/publish-config-core.mjs"));
  const privateFile = path.join(root, "docker/.env");
  writeFileSync(privateFile, "POSTGRES_PASSWORD=untouched\n", { flag: "wx" });
  const run = (...args) => spawnSync(process.execPath, [path.join(root, "scripts/publish-config.mjs"), ...args], { cwd: root, encoding: "utf8" });
  assert.equal(run("funnel", "https://first.tail123.ts.net").status, 0);
  const first = readFileSync(path.join(root, "docker/.env.public"), "utf8");
  assert.equal(run("funnel", "https://second.tail123.ts.net").status, 0);
  const second = readFileSync(path.join(root, "docker/.env.public"), "utf8");
  assert.notEqual(first, second);
  assert.equal(first.match(/^PUBLIC_LINK_SECRET=(.*)$/m)?.[1], second.match(/^PUBLIC_LINK_SECRET=(.*)$/m)?.[1]);
  assert.notEqual(run("provider", "https://drive.example.com").status, 0);
  assert.equal(readFileSync(path.join(root, "docker/.env.public"), "utf8"), second);
  assert.equal(readFileSync(privateFile, "utf8"), "POSTGRES_PASSWORD=untouched\n");
});
