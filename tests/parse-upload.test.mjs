import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import stagedModule from "../app/lib/storage/parse-upload.ts";

const { parseUpload } = stagedModule;

function uploadRequest(name, content) {
  const form = new FormData();
  form.set("folderId", "9a5f669e-326a-44b1-8daa-83dff41710ce");
  form.set("file", new File([content], name, { type: "text/plain" }));
  return new Request("http://localhost/api/upload", { method: "POST", body: form });
}

test("stages multipart upload with size and checksum", async () => {
  const staged = await parseUpload(uploadRequest("hello.txt", "hello world"), 1024);
  try {
    assert.equal(staged.name, "hello.txt");
    assert.equal(staged.size, 11);
    assert.equal(staged.mimeType, "text/plain");
    assert.equal(staged.checksum, createHash("sha256").update("hello world").digest("hex"));
    assert.equal((await readFile(staged.path)).toString(), "hello world");
  } finally { await staged.cleanup(); }
});

test("rejects files beyond the configured limit", async () => {
  await assert.rejects(() => parseUpload(uploadRequest("large.txt", "too large"), 3), /File too large/);
});

test("accepts a file exactly at the limit", async () => {
  const staged = await parseUpload(uploadRequest("small.txt", "12345"), 5);
  try { assert.equal(staged.size, 5); } finally { await staged.cleanup(); }
});

test("rejects extra file parts", async () => {
  const form = new FormData();
  form.set("folderId", "9a5f669e-326a-44b1-8daa-83dff41710ce");
  form.set("file", new File(["one"], "one.txt"));
  form.set("other", new File(["two"], "two.txt"));
  const request = new Request("http://localhost/api/upload", { method: "POST", body: form });
  await assert.rejects(() => parseUpload(request, 1024), /Invalid upload/);
});
