export const maxShoppingItems = 500;

export function validateShoppingItems(items) {
  if (!Array.isArray(items) || items.length > maxShoppingItems) return false;
  const ids = new Set();
  return items.every(item => {
    if (!item || typeof item !== "object" || typeof item.id !== "string" ||
      !item.id || item.id.length > 80 || ids.has(item.id) ||
      typeof item.name !== "string" || !item.name.trim() || item.name.length > 100 ||
      typeof item.bought !== "boolean" || typeof item.notFound !== "boolean" ||
      (item.aisle != null && (typeof item.aisle !== "string" || item.aisle.length > 100))) {
      return false;
    }
    ids.add(item.id);
    return true;
  });
}

export function assignTrustedAuthors(incomingItems, existingItems, user) {
  const existingById = new Map(existingItems.filter(item => item?.id).map(item => [item.id, item]));
  return incomingItems.map(item => {
    const previous = existingById.get(item.id);
    return {
      id: item.id,
      name: item.name.trim(),
      bought: item.bought,
      notFound: item.notFound,
      aisle: typeof item.aisle === "string" ? item.aisle : null,
      addedByUid: previous ? (previous.addedByUid || null) : user.uid,
      addedByName: previous
        ? (previous.addedByName || "Ancien élément")
        : (user.displayName || user.email || "Membre").slice(0, 80)
    };
  });
}
