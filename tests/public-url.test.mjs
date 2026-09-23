import assert from "node:assert/strict";
import { test } from "node:test";
import publicUrlModule from "../app/lib/public-url.ts";

const { invitationUrl, publicAppUrl } = publicUrlModule;

test("accepts only a root HTTPS origin for public invitation links", () => {
  assert.equal(publicAppUrl("https://drive.family.example"), "https://drive.family.example");
  assert.equal(publicAppUrl("https://drive.family.example:8443/"), "https://drive.family.example:8443");
  for (const value of [undefined, "", "http://drive.family.example", "https://drive.family.example/path", "https://drive.family.example/?q=1", "https://user:pass@drive.family.example", "not a URL"]) {
    assert.equal(publicAppUrl(value), null, String(value));
  }
});

test("invitation link uses the installation origin and encodes the token", () => {
  assert.equal(invitationUrl("https://drive.family.example", "a+b/c"), "https://drive.family.example/register?invite=a%2Bb%2Fc");
});
