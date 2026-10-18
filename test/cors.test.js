import test from "node:test";
import assert from "node:assert/strict";
import { handleCors } from "../lib/cors.js";

function response() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    ended: false,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    }
  };
}

test("allows the configured Pages origin and handles preflight", () => {
  const previous = process.env.FAMILY_PRIME_ALLOWED_ORIGINS;
  process.env.FAMILY_PRIME_ALLOWED_ORIGINS = "https://family.github.io";
  const res = response();

  try {
    assert.equal(handleCors({
      method: "OPTIONS",
      headers: { origin: "https://family.github.io" }
    }, res, ["POST"]), true);
    assert.equal(res.statusCode, 204);
    assert.equal(res.ended, true);
    assert.equal(res.headers["Access-Control-Allow-Origin"], "https://family.github.io");
    assert.equal(res.headers["Access-Control-Allow-Methods"], "POST, OPTIONS");
  } finally {
    if (previous === undefined) delete process.env.FAMILY_PRIME_ALLOWED_ORIGINS;
    else process.env.FAMILY_PRIME_ALLOWED_ORIGINS = previous;
  }
});

test("rejects origins that are not explicitly allowed", () => {
  const previous = process.env.FAMILY_PRIME_ALLOWED_ORIGINS;
  process.env.FAMILY_PRIME_ALLOWED_ORIGINS = "https://family.github.io";
  const res = response();

  try {
    assert.equal(handleCors({
      method: "POST",
      headers: { origin: "https://attacker.example" }
    }, res, ["POST"]), true);
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body, { error: "Origin not allowed." });
    assert.equal(res.headers["Access-Control-Allow-Origin"], undefined);
  } finally {
    if (previous === undefined) delete process.env.FAMILY_PRIME_ALLOWED_ORIGINS;
    else process.env.FAMILY_PRIME_ALLOWED_ORIGINS = previous;
  }
});
