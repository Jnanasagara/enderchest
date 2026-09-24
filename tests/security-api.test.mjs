import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const base = process.env.TEST_BASE_URL ?? "http://localhost:3000";

test("public ping reveals no host details and host status needs a session", async () => {
  const ping = await fetch(`${base}/api/host/ping`);
  assert.equal(ping.status, 200);
  assert.equal(ping.headers.get("Access-Control-Allow-Origin"), "*");
  assert.deepEqual(await ping.json(), { ok: true });
  const privateStatus = await fetch(`${base}/api/admin/host`);
  assert.equal(privateStatus.status, 401);
});

function post(path, data, forwardedIp) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": forwardedIp },
    body: JSON.stringify(data),
  });
}

test("auth input rejects non-string values", async () => {
  const login = await post("/api/auth/login", { email: 1, password: {} }, "203.0.113.1");
  assert.equal(login.status, 400);
  const register = await post("/api/auth/register", { email: {}, password: [], inviteToken: 5 }, "203.0.113.2");
  assert.equal(register.status, 400);
  const invalidInvite = await post("/api/auth/register", {
    email: `security-${randomUUID()}@example.invalid`,
    password: "StrongPass#1234",
    inviteToken: "a".repeat(64),
  }, "203.0.113.3");
  assert.equal(invalidInvite.status, 400);
});

test("changing forwarded IP does not reset login limit", async () => {
  const email = `security-${randomUUID()}@example.invalid`;
  const maxAttempts = Number(process.env.LOGIN_RATE_LIMIT_MAX ?? 5);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await post("/api/auth/login", { email, password: "wrong" }, `203.0.113.${attempt + 1}`);
    assert.equal(response.status, 401);
  }
  const blocked = await post("/api/auth/login", { email, password: "wrong" }, "198.51.100.1");
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("Retry-After")) > 0);
});

test("simultaneous first login attempts share one counter", async () => {
  const email = `security-${randomUUID()}@example.invalid`;
  const responses = await Promise.all([1, 2, 3].map(number =>
    post("/api/auth/login", { email, password: "wrong" }, `203.0.113.${number}`)
  ));
  assert.deepEqual(responses.map(response => response.status), [401, 401, 401]);
});
