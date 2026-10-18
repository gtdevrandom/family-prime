import test from "node:test";
import assert from "node:assert/strict";
import { assignTrustedAuthors, validateShoppingItems } from "../lib/shoppingItems.js";

const item = overrides => ({
  id: "item-1",
  name: "Pain",
  bought: false,
  notFound: false,
  aisle: "Boulangerie",
  ...overrides
});

test("validates item IDs, names, status and aisle limits", () => {
  assert.equal(validateShoppingItems([item()]), true);
  assert.equal(validateShoppingItems([item(), item()]), false);
  assert.equal(validateShoppingItems([item({ name: " ".repeat(1) })]), false);
  assert.equal(validateShoppingItems([item({ aisle: "x".repeat(101) })]), false);
  assert.equal(validateShoppingItems([item({ bought: "false" })]), false);
  assert.equal(validateShoppingItems(Array.from({ length: 501 }, (_, index) =>
    item({ id: `item-${index}` })
  )), false);
});

test("assigns new items to the authenticated user and ignores client-supplied authors", () => {
  const [created] = assignTrustedAuthors([
    item({ addedByUid: "forged-uid", addedByName: "Forged" })
  ], [], { uid: "member-1", displayName: "Camille" });

  assert.equal(created.addedByUid, "member-1");
  assert.equal(created.addedByName, "Camille");
});

test("preserves the original author when an existing item is edited", () => {
  const [updated] = assignTrustedAuthors(
    [item({ name: "Pain complet", addedByUid: "forged-uid", addedByName: "Forged" })],
    [item({ addedByUid: "member-1", addedByName: "Camille" })],
    { uid: "member-2", displayName: "Alex" }
  );

  assert.equal(updated.name, "Pain complet");
  assert.equal(updated.addedByUid, "member-1");
  assert.equal(updated.addedByName, "Camille");
});

test("keeps imported legacy items marked as historical", () => {
  const [updated] = assignTrustedAuthors(
    [item()],
    [item({ addedByUid: null, addedByName: "Import ancien projet" })],
    { uid: "member-1", displayName: "Camille" }
  );

  assert.equal(updated.addedByUid, null);
  assert.equal(updated.addedByName, "Import ancien projet");
});
