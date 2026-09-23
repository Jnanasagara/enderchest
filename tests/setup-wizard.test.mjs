import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { normalizeStoragePath, renderSetupEnv, validateAdmin } from "../scripts/setup-wizard-core.mjs";

const template = readFileSync("docker/env.example", "utf8");

test("normalizes safe absolute storage paths on Windows and Linux", () => {
  assert.equal(normalizeStoragePath("D:\\Family Files", "windows"), "D:/Family Files");
  assert.equal(normalizeStoragePath("/srv/enderchest/../files", "linux"), "/srv/files");
  assert.throws(() => normalizeStoragePath("C:\\", "windows"));
  assert.throws(() => normalizeStoragePath("/", "linux"));
  assert.throws(() => normalizeStoragePath("relative/path", "linux"));
});

test("validates admin credentials", () => {
  assert.equal(validateAdmin(" Admin@Example.com ", "ValidPass#1234", "ValidPass#1234"), "admin@example.com");
  assert.throws(() => validateAdmin("bad", "ValidPass#1234", "ValidPass#1234"));
  assert.throws(() => validateAdmin("admin@example.com", "short", "short"));
  assert.throws(() => validateAdmin("admin@example.com", "ValidPass#1234", "other"));
});

test("generates independent secrets and literal Compose password", () => {
  const options = { email: "admin@example.com", password: "ValidPass$#1234", storageRoot: "D:/Family Files" };
  const first = renderSetupEnv(template, options);
  const second = renderSetupEnv(template, options);
  assert.match(first, /^BOOTSTRAP_ADMIN_PASSWORD='ValidPass\$#1234'$/m);
  assert.match(first, /^ENDER_STORAGE_ROOT='D:\/Family Files'$/m);
  assert.match(first, /^ENDER_SETUP_VERSION=1$/m);
  assert.doesNotMatch(first, /replace_me/);
  assert.notEqual(first.match(/^POSTGRES_PASSWORD=(.*)$/m)?.[1], second.match(/^POSTGRES_PASSWORD=(.*)$/m)?.[1]);
  assert.notEqual(first.match(/^GARAGE_RPC_SECRET=(.*)$/m)?.[1], second.match(/^GARAGE_RPC_SECRET=(.*)$/m)?.[1]);
});
