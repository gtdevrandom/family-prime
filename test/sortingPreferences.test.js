import test from "node:test";
import assert from "node:assert/strict";
import {
  applySortingPreferences,
  createSortingPreference,
  moveItemRelativeTo,
  moveItemToAisleEnd,
  normalizeSortingItemKey,
  upsertSortingPreference
} from "../lib/sortingPreferences.js";

const item = (id, name, aisle) => ({ id, name, aisle });

test("normalizes item names for stable matching across additions", () => {
  assert.equal(normalizeSortingItemKey("  PÂTES   fraîches! "), "pates fraiches");
  assert.equal(normalizeSortingItemKey("🥚"), "🥚");
});

test("moves an item before or after another item and records its aisle anchor", () => {
  const items = [
    item("1", "Pain", "Boulangerie"),
    item("2", "Lait", "Laiterie"),
    item("3", "Croissants", "Boulangerie")
  ];

  const result = moveItemRelativeTo(items, "3", "1", "before");

  assert.deepEqual(result.items.filter(entry => entry.aisle === "Boulangerie").map(entry => entry.name), [
    "Croissants",
    "Pain"
  ]);
  assert.equal(result.preference.aisle, "Boulangerie");
  assert.equal(result.preference.beforeItemKey, "pain");
  assert.equal(result.preference.afterItemKey, null);
  assert.deepEqual(items.map(entry => entry.id), ["1", "2", "3"]);
});

test("moving an item to an aisle header places it at that aisle's end", () => {
  const result = moveItemToAisleEnd([
    item("1", "Pain", "Boulangerie"),
    item("2", "Lait", "Laiterie"),
    item("3", "Croissants", "Boulangerie")
  ], "2", "Boulangerie");

  assert.deepEqual(result.items.filter(entry => entry.aisle === "Boulangerie").map(entry => entry.name), [
    "Pain",
    "Croissants",
    "Lait"
  ]);
  assert.equal(result.preference.afterItemKey, "croissants");
  assert.equal(result.preference.position, "end");
});

test("stores the same article's preferences independently for each store", () => {
  let preferences = {};
  preferences = upsertSortingPreference(preferences, "Magasin A",
    createSortingPreference("Pâtes", "Épicerie", {}, 1));
  preferences = upsertSortingPreference(preferences, "Magasin B",
    createSortingPreference("Pates", "Rayon 7", {}, 2));

  const items = [item("1", "Pâtes", "Autre")];
  const storeA = applySortingPreferences(items, preferences, "Magasin A", ["Épicerie", "Rayon 7"]);
  const storeB = applySortingPreferences(items, preferences, "Magasin B", ["Épicerie", "Rayon 7"]);

  assert.equal(storeA[0].aisle, "Épicerie");
  assert.equal(storeB[0].aisle, "Rayon 7");
});

test("applies learned positions while preserving AI order for other items", () => {
  let preferences = {};
  preferences = upsertSortingPreference(preferences, "Magasin A",
    createSortingPreference("Pâtes", "Épicerie", { afterItemName: "Riz" }, 1));
  const aiItems = [
    item("1", "Pâtes", "Autre"),
    item("2", "Riz", "Épicerie"),
    item("3", "Farine", "Épicerie")
  ];

  const sorted = applySortingPreferences(aiItems, preferences, "Magasin A", ["Épicerie"]);

  assert.deepEqual(sorted.map(entry => entry.name), ["Riz", "Pâtes", "Farine"]);
  assert.equal(sorted[1].aisle, "Épicerie");
});

test("keeps an item at the end of its preferred aisle on later sorts", () => {
  let preferences = {};
  preferences = upsertSortingPreference(preferences, "Magasin A",
    createSortingPreference("Yaourt", "Produits frais", {}, 1));
  const sorted = applySortingPreferences([
    item("1", "Yaourt", "Produits frais"),
    item("2", "Beurre", "Produits frais"),
    item("3", "Crème", "Produits frais")
  ], preferences, "Magasin A", ["Produits frais"]);

  assert.deepEqual(sorted.map(entry => entry.name), ["Beurre", "Crème", "Yaourt"]);
});

test("keeps the AI position when a learned position anchor is missing", () => {
  let preferences = {};
  preferences = upsertSortingPreference(preferences, "Magasin A",
    createSortingPreference("Pâtes", "Épicerie", { afterItemName: "Riz" }, 1));
  const sorted = applySortingPreferences([
    item("1", "Pâtes", "Épicerie"),
    item("2", "Farine", "Épicerie")
  ], preferences, "Magasin A", ["Épicerie"]);

  assert.deepEqual(sorted.map(entry => entry.name), ["Pâtes", "Farine"]);
});

test("does not apply preferences for removed aisles or other stores", () => {
  let preferences = {};
  preferences = upsertSortingPreference(preferences, "Magasin A",
    createSortingPreference("Pâtes", "Rayon supprimé", {}, 1));
  preferences = upsertSortingPreference(preferences, "Magasin B",
    createSortingPreference("Lait", "Rayon B", {}, 1));
  const items = [item("1", "Pâtes", "Autre"), item("2", "Lait", "Autre")];

  const storeA = applySortingPreferences(items, preferences, "Magasin A", ["Épicerie"]);
  const storeB = applySortingPreferences(items, preferences, "Magasin B", ["Rayon B"]);

  assert.equal(storeA.find(entry => entry.name === "Pâtes").aisle, "Autre");
  assert.equal(storeA.find(entry => entry.name === "Lait").aisle, "Autre");
  assert.equal(storeB.find(entry => entry.name === "Lait").aisle, "Rayon B");
});

test("upserts by normalized article identity without duplicate records", () => {
  let preferences = {};
  preferences = upsertSortingPreference(preferences, "Magasin A",
    createSortingPreference("Pâtes", "Épicerie", {}, 1));
  preferences = upsertSortingPreference(preferences, "Magasin A",
    createSortingPreference(" PATES ", "Rayon 2", {}, 2));

  assert.equal(Object.keys(preferences["Magasin A"]).length, 1);
  assert.equal(preferences["Magasin A"].pates.aisle, "Rayon 2");
});
