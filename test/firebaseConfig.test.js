import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/config.js";

function createResponse() {
  return {
    headers: {},
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
    }
  };
}

test("serves only public Firebase configuration fields", () => {
  const keys = [
    "FIREBASE_API_KEY",
    "FIREBASE_AUTH_DOMAIN",
    "FIREBASE_PROJECT_ID",
    "FIREBASE_APP_ID",
    "FIREBASE_STORAGE_BUCKET",
    "FIREBASE_MESSAGING_SENDER_ID",
    "FIREBASE_MEASUREMENT_ID",
    "GOOGLE_API_KEY",
    "FIREBASE_SERVICE_ACCOUNT_JSON"
  ];
  const env = {
    FIREBASE_API_KEY: "public-key",
    FIREBASE_AUTH_DOMAIN: "example.firebaseapp.com",
    FIREBASE_PROJECT_ID: "example",
    FIREBASE_APP_ID: "web-app",
    GOOGLE_API_KEY: "server-secret",
    FIREBASE_SERVICE_ACCOUNT_JSON: "{\"private_key\":\"server-secret\"}"
  };
  const previous = new Map(keys.map(key => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    Object.assign(process.env, env);
    const res = createResponse();
    handler({ method: "GET" }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
      apiKey: "public-key",
      authDomain: "example.firebaseapp.com",
      projectId: "example",
      appId: "web-app"
    });
    assert.equal(JSON.stringify(res.body).includes("server-secret"), false);
    assert.equal(res.headers["Cache-Control"], "no-store");
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("returns an explicit error if required Firebase configuration is missing", () => {
  const keys = [
    "FIREBASE_API_KEY",
    "FIREBASE_AUTH_DOMAIN",
    "FIREBASE_PROJECT_ID",
    "FIREBASE_APP_ID",
    "FIREBASE_STORAGE_BUCKET",
    "FIREBASE_MESSAGING_SENDER_ID",
    "FIREBASE_MEASUREMENT_ID"
  ];
  const previous = new Map(keys.map(key => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    const res = createResponse();
    handler({ method: "GET" }, res);
    assert.equal(res.statusCode, 503);
    assert.match(res.body.error, /Firebase is not configured/);
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
