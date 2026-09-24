import test from "node:test";
import assert from "node:assert/strict";

const base = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const adminEmail = process.env.TEST_ADMIN_EMAIL ?? process.env.BOOTSTRAP_ADMIN_EMAIL ?? "admin@example.com";
const adminPassword = process.env.TEST_ADMIN_PASSWORD ?? process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "replace_me";
const userPassword = "StrongPass#1234";

function session() {
  const cookies = new Map();
  return async function request(path, { method = "GET", json, body, csrf = true } = {}) {
    const headers = new Headers();
    if (json !== undefined) headers.set("Content-Type", "application/json");
    if (cookies.size) headers.set("Cookie", [...cookies].map(([name, value]) => `${name}=${value}`).join("; "));
    if (csrf && method !== "GET" && cookies.get("csrf")) headers.set("x-csrf-token", cookies.get("csrf"));
    const response = await fetch(`${base}${path}`, { method, headers, body: body ?? (json === undefined ? undefined : JSON.stringify(json)) });
    for (const raw of response.headers.getSetCookie()) {
      const [name, value] = raw.split(";")[0].split("=");
      cookies.set(name, value);
    }
    const data = response.headers.get("content-type")?.includes("application/json") ? await response.json() : await response.text();
    return { status: response.status, data, response };
  };
}

test("storage lifecycle and quota", async () => {
  const admin = session(), user = session();
  const email = `storage-test-${Date.now()}@example.com`;
  const login = await admin("/api/auth/login", { method: "POST", json: { email: adminEmail, password: adminPassword } });
  assert.equal(login.status, 200);
  const invite = await admin("/api/admin/invite", { method: "POST", json: { expiresInHours: 1 } });
  assert.equal(invite.status, 200);
  const registration = await user("/api/auth/register", { method: "POST", json: { email, password: userPassword, inviteToken: invite.data.token } });
  assert.equal(registration.status, 200);
  const users = await admin("/api/admin/users");
  const created = users.data.find(item => item.email === email);
  assert.ok(created);

  try {
    assert.equal((await user("/api/auth/login", { method: "POST", json: { email, password: userPassword } })).status, 200);
    assert.equal((await user("/api/admin/host")).status, 403);
    const root = await user("/api/folders/root");
    assert.equal(root.status, 200);
    const rootId = root.data.id;
    const folder = await user("/api/folders", { method: "POST", json: { name: "Documents", parentId: rootId } });
    assert.equal(folder.status, 200);
    const folderId = folder.data.id;

    const upload = (name, contents) => { const form = new FormData(); form.set("folderId", folderId); form.set("file", new File([contents], name, { type: "text/plain" })); return form; };
    assert.equal((await user("/api/upload", { method: "POST", body: upload("note.txt", "hello"), csrf: false })).status, 403);
    const stored = await user("/api/upload", { method: "POST", body: upload("note.txt", "hello") });
    assert.equal(stored.status, 200);
    const fileId = stored.data.id;
    const listing = await user(`/api/folders?parentId=${folderId}`);
    assert.equal(listing.data.files[0].name, "note.txt");
    const download = await user(`/api/files/${fileId}/download`);
    assert.equal(download.data, "hello");
    assert.equal(download.response.headers.get("content-disposition")?.startsWith("attachment"), true);
    const preview = await user(`/api/files/${fileId}/download?inline=1`);
    assert.equal(preview.response.headers.get("content-disposition")?.startsWith("inline"), true);
    assert.equal(preview.response.headers.get("content-security-policy"), "sandbox");
    const signed = await user(`/api/files/${fileId}/presign`);
    assert.equal(signed.status, 200);
    assert.equal(signed.data.expiresIn, 300);
    assert.equal((await admin(`/api/files/${fileId}/presign`)).status, 404);
    if (process.env.TEST_FETCH_PRESIGNED !== "false") {
      const signedDownload = await fetch(signed.data.url);
      assert.equal(signedDownload.status, 200);
      assert.equal(await signedDownload.text(), "hello");
      const preflight = await fetch(signed.data.url, { method: "OPTIONS", headers: { Origin: "http://localhost:3000", "Access-Control-Request-Method": "GET" } });
      assert.equal(preflight.headers.get("access-control-allow-origin"), "http://localhost:3000");
    }
    const html = new FormData();
    html.set("folderId", folderId);
    html.set("file", new File(["<script>alert(1)</script>"], "unsafe.html", { type: "text/html" }));
    const storedHtml = await user("/api/upload", { method: "POST", body: html });
    assert.equal(storedHtml.status, 200);
    const htmlPreview = await user(`/api/files/${storedHtml.data.id}/download?inline=1`);
    assert.equal(htmlPreview.response.headers.get("content-disposition")?.startsWith("attachment"), true);
    assert.equal(htmlPreview.response.headers.get("content-security-policy"), "sandbox");
    assert.equal((await user(`/api/files/${storedHtml.data.id}`, { method: "DELETE" })).status, 200);
    assert.equal((await user(`/api/trash/file/${storedHtml.data.id}`, { method: "DELETE" })).status, 200);

    const quota = await user("/api/library");
    assert.equal(Number(quota.data.quota.used_bytes), 5);
    assert.equal((await admin("/api/admin/quotas", { method: "PATCH", json: { userId: created.id, allocatedBytes: 4 } })).status, 409);
    const copied = await user(`/api/files/${fileId}/copy`, { method: "POST", json: { name: "copy.txt", folderId } });
    assert.equal(copied.status, 200);
    assert.equal((await user(`/api/files/${copied.data.id}/download`)).data, "hello");
    assert.equal(Number((await user("/api/library")).data.quota.used_bytes), 10);
    assert.equal((await user(`/api/files/${copied.data.id}`, { method: "DELETE" })).status, 200);
    assert.equal((await user(`/api/trash/file/${copied.data.id}`, { method: "DELETE" })).status, 200);
    assert.equal((await admin("/api/admin/quotas", { method: "PATCH", json: { userId: created.id, allocatedBytes: 6 } })).status, 200);
    assert.equal((await user("/api/upload", { method: "POST", body: upload("excess.txt", "too big") })).status, 413);
    assert.equal((await user(`/api/files/${fileId}`, { method: "PATCH", json: { name: "renamed.txt", folderId: rootId } })).status, 200);
    assert.equal((await user(`/api/files/${fileId}`, { method: "DELETE" })).status, 200);
    const trash = await user("/api/trash");
    assert.ok(trash.data.files.some(item => item.id === fileId));
    assert.equal((await user(`/api/trash/file/${fileId}`, { method: "POST" })).status, 200);
    assert.equal((await user(`/api/files/${fileId}`, { method: "DELETE" })).status, 200);
    assert.equal((await user(`/api/trash/file/${fileId}`, { method: "DELETE" })).status, 200);
    assert.equal(Number((await user("/api/library")).data.quota.used_bytes), 0);

    assert.equal((await user(`/api/folders/${folderId}`, { method: "DELETE" })).status, 200);
    assert.equal((await user(`/api/trash/folder/${folderId}`, { method: "POST" })).status, 200);
    assert.equal((await user(`/api/folders/${folderId}`, { method: "DELETE" })).status, 200);
    assert.equal((await user(`/api/trash/folder/${folderId}`, { method: "DELETE" })).status, 200);
  } finally {
    await admin("/api/admin/users", { method: "DELETE", json: { userIdToDelete: created.id } });
  }
});
