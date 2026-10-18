import test from "node:test";
import assert from "node:assert/strict";
import { hashTemporaryPassword, matchesTemporaryPassword } from "../lib/accountPasswords.js";

test("temporary password hashes can be verified without storing the password", () => {
  const password = "long-random-temporary-secret";
  const hash = hashTemporaryPassword(password);

  assert.notEqual(hash, password);
  assert.match(hash, /^[a-f\d]{64}$/);
  assert.equal(matchesTemporaryPassword(password, hash), true);
  assert.equal(matchesTemporaryPassword("a different password", hash), false);
  assert.equal(matchesTemporaryPassword(password, null), false);
  assert.equal(matchesTemporaryPassword(password, "not-a-hash"), false);
});
