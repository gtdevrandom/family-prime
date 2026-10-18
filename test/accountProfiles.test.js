import test from "node:test";
import assert from "node:assert/strict";
import { maxDisplayNameLength, normalizeDisplayName } from "../lib/accountProfiles.js";

test("normalizes valid display names", () => {
  assert.equal(normalizeDisplayName("  Camille  "), "Camille");
  assert.equal(normalizeDisplayName("A".repeat(maxDisplayNameLength)), "A".repeat(maxDisplayNameLength));
});

test("rejects empty, non-string and oversized display names", () => {
  assert.equal(normalizeDisplayName("   "), null);
  assert.equal(normalizeDisplayName("A".repeat(maxDisplayNameLength + 1)), null);
  assert.equal(normalizeDisplayName(null), null);
});
