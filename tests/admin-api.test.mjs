import test from "node:test";
import assert from "node:assert/strict";

const baseUrl = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const adminEmail = process.env.TEST_ADMIN_EMAIL ?? "admin@example.com";
const adminPassword = process.env.TEST_ADMIN_PASSWORD ?? "replace_me";

const cookieJar = new Map();

function readSetCookies(response) {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie();
  }

  const header = response.headers.get("set-cookie");
  if (!header) return [];

  return header.split(/,(?=[^;]+?=)/g);
}

function storeCookies(setCookies) {
  for (const cookie of setCookies) {
    const [pair] = cookie.split(";");
    if (!pair) continue;
    const [name, value] = pair.split("=");
    if (!name) continue;
    cookieJar.set(name.trim(), value ?? "");
  }
}

function getCookieHeader() {
  return Array.from(cookieJar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function getCsrfToken() {
  return cookieJar.get("csrf") ?? "";
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers ?? {});
  headers.set("accept", "application/json");
  if (options.json !== undefined) {
    headers.set("content-type", "application/json");
  }

  if (options.authenticated) {
    headers.set("cookie", getCookieHeader());
    const csrfToken = getCsrfToken();
    if (options.withCsrf && csrfToken) {
      headers.set("x-csrf-token", csrfToken);
    }
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.json !== undefined ? JSON.stringify(options.json) : undefined,
  });

  storeCookies(readSetCookies(response));

  let data = null;
  const text = await response.text();
  if (text) {
    data = JSON.parse(text);
  }

  return { response, data };
}

function randomEmail() {
  const stamp = Date.now();
  return `admin-test-${stamp}@example.com`;
}

test("admin endpoints", async () => {
  const login = await request("/api/auth/login", {
    method: "POST",
    json: { email: adminEmail, password: adminPassword },
  });

  assert.equal(login.response.status, 200, "login should succeed");
  assert.ok(cookieJar.get("session"), "session cookie is set");
  assert.ok(cookieJar.get("csrf"), "csrf cookie is set");

  const inviteCreate = await request("/api/admin/invite", {
    method: "POST",
    authenticated: true,
    withCsrf: true,
    json: { expiresInHours: 1 },
  });

  assert.equal(inviteCreate.response.status, 200, "invite create should succeed");
  const inviteToken = inviteCreate.data?.token;
  assert.ok(inviteToken, "invite token is returned");

  const testEmail = randomEmail();
  const register = await request("/api/auth/register", {
    method: "POST",
    json: {
      email: testEmail,
      password: "StrongPass#1234",
      inviteToken,
    },
  });

  assert.equal(register.response.status, 200, "registration should succeed");

  const users = await request("/api/admin/users", {
    authenticated: true,
  });

  assert.equal(users.response.status, 200, "admin users list should succeed");
  const createdUser = users.data?.find((user) => user.email === testEmail);
  assert.ok(createdUser, "new user should appear in admin list");

  const disableUser = await request("/api/admin/users", {
    method: "PATCH",
    authenticated: true,
    withCsrf: true,
    json: { userIdToUpdate: createdUser.id, status: "disabled" },
  });

  assert.equal(disableUser.response.status, 200, "disable should succeed");

  const enableUser = await request("/api/admin/users", {
    method: "PATCH",
    authenticated: true,
    withCsrf: true,
    json: { userIdToUpdate: createdUser.id, status: "active" },
  });

  assert.equal(enableUser.response.status, 200, "enable should succeed");

  const promoteUser = await request("/api/admin/users", {
    method: "PATCH",
    authenticated: true,
    withCsrf: true,
    json: { userIdToUpdate: createdUser.id, isAdmin: true },
  });

  assert.equal(promoteUser.response.status, 200, "promote should succeed");

  const demoteUser = await request("/api/admin/users", {
    method: "PATCH",
    authenticated: true,
    withCsrf: true,
    json: { userIdToUpdate: createdUser.id, isAdmin: false },
  });

  assert.equal(demoteUser.response.status, 200, "demote should succeed");

  const quotas = await request("/api/admin/quotas", {
    authenticated: true,
  });

  assert.equal(quotas.response.status, 200, "admin quotas list should succeed");
  const quotaRow = quotas.data?.find((row) => row.user_id === createdUser.id);
  assert.ok(quotaRow, "quota row should exist");

  const updateQuota = await request("/api/admin/quotas", {
    method: "PATCH",
    authenticated: true,
    withCsrf: true,
    json: { userId: createdUser.id, allocatedBytes: quotaRow.allocated_bytes + 1024 },
  });

  assert.equal(updateQuota.response.status, 200, "quota update should succeed");

  const inviteToRevoke = await request("/api/admin/invite", {
    method: "POST",
    authenticated: true,
    withCsrf: true,
    json: { expiresInHours: 2 },
  });

  assert.equal(inviteToRevoke.response.status, 200, "invite create should succeed");

  const inviteList = await request("/api/admin/invite", {
    authenticated: true,
  });

  const revokeTarget = inviteList.data?.find((invite) => invite.token === inviteToRevoke.data?.token);
  assert.ok(revokeTarget, "invite to revoke should be present");

  const revokeInvite = await request("/api/admin/invite", {
    method: "PATCH",
    authenticated: true,
    withCsrf: true,
    json: { inviteId: revokeTarget.id },
  });

  assert.equal(revokeInvite.response.status, 200, "invite revoke should succeed");

  const inviteToDelete = await request("/api/admin/invite", {
    method: "POST",
    authenticated: true,
    withCsrf: true,
    json: { expiresInHours: 2 },
  });

  const inviteListAfter = await request("/api/admin/invite", {
    authenticated: true,
  });

  const deleteTarget = inviteListAfter.data?.find((invite) => invite.token === inviteToDelete.data?.token);
  assert.ok(deleteTarget, "invite to delete should be present");

  const deleteInvite = await request("/api/admin/invite", {
    method: "DELETE",
    authenticated: true,
    withCsrf: true,
    json: { inviteId: deleteTarget.id },
  });

  assert.equal(deleteInvite.response.status, 200, "invite delete should succeed");

  const auditLogs = await request("/api/admin/audit", {
    authenticated: true,
  });

  assert.equal(auditLogs.response.status, 200, "audit logs list should succeed");
  assert.ok(Array.isArray(auditLogs.data), "audit response should be an array");

  const deleteUser = await request("/api/admin/users", {
    method: "DELETE",
    authenticated: true,
    withCsrf: true,
    json: { userIdToDelete: createdUser.id },
  });

  assert.equal(deleteUser.response.status, 200, "user delete should succeed");
});
