import assert from "node:assert/strict";
import test from "node:test";
import { isTrustedStateChangingRequest, normalizeOrigin } from "./csrf-origin.mjs";

function request(method, headers = {}, url = "https://app.example.test/api/v1/anchors") {
  return new Request(url, { method, headers });
}

test("same-origin guard accepts matching Origin and rejects cross-origin Origin", () => {
  assert.equal(
    isTrustedStateChangingRequest(request("POST", { origin: "https://app.example.test" })),
    true
  );
  assert.equal(
    isTrustedStateChangingRequest(request("POST", { origin: "https://evil.example.test" })),
    false
  );
});

test("same-origin guard falls back to Referer only when Origin is absent", () => {
  assert.equal(
    isTrustedStateChangingRequest(request("PATCH", { referer: "https://app.example.test/admin" })),
    true
  );
  assert.equal(
    isTrustedStateChangingRequest(request("PATCH", {
      origin: "https://evil.example.test",
      referer: "https://app.example.test/admin",
    })),
    false
  );
  assert.equal(isTrustedStateChangingRequest(request("DELETE")), false);
});

test("configured public origin is accepted when reverse proxy rewrites request URL", () => {
  const req = request("POST", { origin: "https://console.example.test" }, "http://next-internal:3000/api/v1/anchors");
  assert.equal(
    isTrustedStateChangingRequest(req, { APP_URL: "https://console.example.test/" }),
    true
  );
  assert.equal(
    isTrustedStateChangingRequest(req, { NEXT_PUBLIC_API_BASE_URL: "https://console.example.test/api" }),
    true
  );
});

test("safe methods do not require a browser origin", () => {
  for (const method of ["GET", "HEAD", "OPTIONS"]) {
    assert.equal(isTrustedStateChangingRequest(request(method)), true, method);
  }
});

test("origin normalization rejects null/non-http values", () => {
  assert.equal(normalizeOrigin("null"), null);
  assert.equal(normalizeOrigin("file:///tmp/app"), null);
  assert.equal(normalizeOrigin("https://app.example.test:443/path"), "https://app.example.test");
});
