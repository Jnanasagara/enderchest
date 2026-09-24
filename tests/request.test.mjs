import test from "node:test";
import assert from "node:assert/strict";
import requestModule from "../app/lib/http/request.ts";

const { readJsonBody } = requestModule;

function jsonRequest(body, headers = {}) {
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

test("JSON input is bounded by UTF-8 bytes", async () => {
  assert.deepEqual(await readJsonBody(jsonRequest('{"x":"ok"}'), { maxBytes: 10 }), { value: { x: "ok" } });
  assert.deepEqual(await readJsonBody(jsonRequest('{"x":"é"}'), { maxBytes: 9 }), { error: "Request body too large" });
  assert.deepEqual(await readJsonBody(jsonRequest('{"x":"ok"}', { "content-length": "999" }), { maxBytes: 10 }), { error: "Request body too large" });
});

test("invalid and empty JSON are rejected", async () => {
  assert.deepEqual(await readJsonBody(jsonRequest("")), { error: "Empty request body" });
  assert.deepEqual(await readJsonBody(jsonRequest("{")), { error: "Invalid JSON" });
});
