export const maxSortingPreferenceBatchSize = 500;
export const maxSortingPreferencesPerStore = 1000;

export function normalizeSortingItemKey(name) {
  if (typeof name !== "string") return "";
  const normalized = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return normalized || name.normalize("NFKC").trim().toLocaleLowerCase("fr").replace(/\s+/g, " ");
}

function getAisleName(item) {
  return typeof item?.aisle === "string" && item.aisle.trim()
    ? item.aisle.trim()
    : "Autre";
}

export function createSortingPreference(itemName, aisle, position = {}, updatedAt = Date.now()) {
  const itemKey = normalizeSortingItemKey(itemName);
  const cleanItemName = typeof itemName === "string" ? itemName.trim() : "";
  const cleanAisle = typeof aisle === "string" ? aisle.trim() : "";
  if (!itemKey || cleanItemName.length > 100 || !cleanAisle || cleanAisle.length > 100) {
    return null;
  }

  const beforeItemKey = normalizeSortingItemKey(position.beforeItemName);
  const afterItemKey = normalizeSortingItemKey(position.afterItemName);
  const beforeItemName = beforeItemKey && beforeItemKey !== itemKey && typeof position.beforeItemName === "string"
    ? position.beforeItemName.trim()
    : null;
  const afterItemName = afterItemKey && afterItemKey !== itemKey && typeof position.afterItemName === "string"
    ? position.afterItemName.trim()
    : null;
  return {
    itemName: cleanItemName,
    aisle: cleanAisle,
    position: ["before", "after", "end"].includes(position.position)
      ? position.position
      : beforeItemKey
        ? "before"
        : afterItemKey
          ? "after"
          : "end",
    beforeItemName,
    afterItemName,
    beforeItemKey: beforeItemKey && beforeItemKey !== itemKey ? beforeItemKey : null,
    afterItemKey: afterItemKey && afterItemKey !== itemKey ? afterItemKey : null,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now()
  };
}

export function upsertSortingPreference(preferences, storeName, preference) {
  const store = typeof storeName === "string" ? storeName.trim() : "";
  const itemKey = normalizeSortingItemKey(preference?.itemName);
  if (!store || !itemKey || !preference?.aisle) return preferences;

  const stores = preferences && typeof preferences === "object" && !Array.isArray(preferences)
    ? preferences
    : {};
  const existingStorePreferences = Object.hasOwn(stores, store) &&
    stores[store] && typeof stores[store] === "object" && !Array.isArray(stores[store])
    ? stores[store]
    : {};

  return {
    ...stores,
    [store]: {
      ...existingStorePreferences,
      [itemKey]: preference
    }
  };
}

export function moveItemRelativeTo(items, draggedId, targetId, placement) {
  if (!Array.isArray(items) || !["before", "after"].includes(placement)) return null;
  const draggedIndex = items.findIndex(item => item?.id === draggedId);
  const targetIndexBeforeMove = items.findIndex(item => item?.id === targetId);
  if (draggedIndex < 0 || targetIndexBeforeMove < 0 || draggedIndex === targetIndexBeforeMove) return null;

  const updatedItems = [...items];
  const [draggedItem] = updatedItems.splice(draggedIndex, 1);
  const targetIndex = updatedItems.findIndex(item => item?.id === targetId);
  const targetItem = updatedItems[targetIndex];
  if (targetIndex < 0 || !targetItem) return null;

  const aisle = getAisleName(targetItem);
  const movedItem = { ...draggedItem, aisle };
  const insertIndex = targetIndex + (placement === "after" ? 1 : 0);
  updatedItems.splice(insertIndex, 0, movedItem);

  return {
    items: updatedItems,
    preference: createSortingPreference(movedItem.name, aisle, {
      beforeItemName: placement === "before" ? targetItem.name : null,
      afterItemName: placement === "after" ? targetItem.name : null,
      position: placement
    })
  };
}

export function moveItemToAisleEnd(items, draggedId, targetAisle) {
  if (!Array.isArray(items) || typeof targetAisle !== "string" || !targetAisle.trim()) return null;
  const draggedIndex = items.findIndex(item => item?.id === draggedId);
  if (draggedIndex < 0) return null;

  const updatedItems = [...items];
  const [draggedItem] = updatedItems.splice(draggedIndex, 1);
  const aisle = targetAisle.trim();
  const lastItemInAisleIndex = updatedItems.reduce(
    (lastIndex, item, index) => getAisleName(item) === aisle ? index : lastIndex,
    -1
  );
  const movedItem = { ...draggedItem, aisle };
  const insertIndex = lastItemInAisleIndex >= 0 ? lastItemInAisleIndex + 1 : updatedItems.length;
  updatedItems.splice(insertIndex, 0, movedItem);
  const afterItemName = lastItemInAisleIndex >= 0 ? updatedItems[insertIndex - 1]?.name : null;

  return {
    items: updatedItems,
    preference: createSortingPreference(movedItem.name, aisle, { afterItemName, position: "end" })
  };
}

function preferenceTimestamp(preference) {
  return Number.isFinite(preference?.updatedAt) ? preference.updatedAt : 0;
}

export function applySortingPreferences(items, preferences, storeName, aisleOrder = []) {
  if (!Array.isArray(items)) return [];
  const storePreferences = preferences && Object.hasOwn(preferences, storeName)
    ? preferences[storeName]
    : null;
  if (!storePreferences || typeof storePreferences !== "object" || Array.isArray(storePreferences)) {
    return [...items];
  }

  const availableAisles = new Set([
    "autre",
    ...aisleOrder.filter(aisle => typeof aisle === "string").map(aisle => aisle.trim().toLocaleLowerCase("fr"))
  ]);
  const preferenceEntries = Object.entries(storePreferences)
    .filter(([key, preference]) => normalizeSortingItemKey(key) &&
      preference && typeof preference === "object" && typeof preference.aisle === "string")
    .sort(([, left], [, right]) => preferenceTimestamp(left) - preferenceTimestamp(right));

  const updatedItems = items.map(item => {
    const key = normalizeSortingItemKey(item?.name);
    const preference = Object.hasOwn(storePreferences, key) ? storePreferences[key] : null;
    const preferredAisle = typeof preference?.aisle === "string" ? preference.aisle.trim() : "";
    if (!preferredAisle || !availableAisles.has(preferredAisle.toLocaleLowerCase("fr"))) {
      return { ...item };
    }
    return { ...item, aisle: preferredAisle };
  });

  const groups = new Map();
  for (const item of updatedItems) {
    const aisle = getAisleName(item);
    if (!groups.has(aisle)) groups.set(aisle, []);
    groups.get(aisle).push(item);
  }

  for (const [itemKey, preference] of preferenceEntries) {
    const aisle = typeof preference.aisle === "string" ? preference.aisle.trim() : "";
    const group = groups.get(aisle);
    if (!group) continue;
    const itemIndex = group.findIndex(item => normalizeSortingItemKey(item.name) === itemKey);
    if (itemIndex < 0) continue;

    if (preference.position === "end") {
      const [item] = group.splice(itemIndex, 1);
      group.push(item);
      continue;
    }

    const anchorKey = preference.afterItemKey || preference.beforeItemKey;
    if (typeof anchorKey !== "string" || !anchorKey) continue;
    const anchorIndex = group.findIndex(item => normalizeSortingItemKey(item.name) === anchorKey);
    if (anchorIndex < 0 || anchorIndex === itemIndex) continue;

    const [item] = group.splice(itemIndex, 1);
    const adjustedAnchorIndex = group.findIndex(candidate => normalizeSortingItemKey(candidate.name) === anchorKey);
    if (adjustedAnchorIndex < 0) {
      group.splice(itemIndex, 0, item);
    } else {
      const insertIndex = adjustedAnchorIndex + (preference.afterItemKey ? 1 : 0);
      group.splice(insertIndex, 0, item);
    }
  }

  const orderedAisles = ["Autre", ...aisleOrder.filter(aisle =>
    typeof aisle === "string" && aisle.trim() && aisle.trim().toLocaleLowerCase("fr") !== "autre"
  )];
  for (const aisle of groups.keys()) {
    if (!orderedAisles.includes(aisle)) orderedAisles.push(aisle);
  }
  return orderedAisles.flatMap(aisle => groups.get(aisle) || []);
}
