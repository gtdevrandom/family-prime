import { handleCors } from "../../lib/cors.js";
import { getFirebaseAdmin, requireUser, sendApiError } from "../../lib/firebaseAdmin.js";
import {
  createSortingPreference,
  maxSortingPreferenceBatchSize,
  maxSortingPreferencesPerStore,
  normalizeSortingItemKey,
  upsertSortingPreference
} from "../../lib/sortingPreferences.js";

const maxStoreNameLength = 100;

function getStoreName(req) {
  const queryStoreName = typeof req.query?.store === "string"
    ? req.query.store
    : new URL(req.url, "http://localhost").searchParams.get("store");
  return typeof queryStoreName === "string" ? queryStoreName.trim() : "";
}

function isAllowedAisle(aisle, aisles) {
  if (aisle.toLocaleLowerCase("fr") === "autre") return true;
  return aisles.some(storeAisle =>
    typeof storeAisle === "string" && storeAisle.trim() === aisle
  );
}

function validatePreferenceInput(input) {
  if (!input || typeof input !== "object" ||
    typeof input.itemName !== "string" || !input.itemName.trim() ||
    input.itemName.trim().length > 100 ||
    typeof input.aisle !== "string" || !input.aisle.trim() ||
    input.aisle.trim().length > 100) {
    return null;
  }

  const beforeItemName = input.beforeItemName == null ? null : input.beforeItemName;
  const afterItemName = input.afterItemName == null ? null : input.afterItemName;
  const position = input.position ?? (beforeItemName ? "before" : afterItemName ? "after" : "end");
  if ((beforeItemName !== null && (typeof beforeItemName !== "string" || beforeItemName.length > 100)) ||
    (afterItemName !== null && (typeof afterItemName !== "string" || afterItemName.length > 100)) ||
    (beforeItemName && afterItemName) ||
    !["before", "after", "end"].includes(position)) {
    return null;
  }

  return createSortingPreference(input.itemName, input.aisle, {
    beforeItemName,
    afterItemName,
    position
  });
}

export default async function handler(req, res) {
  if (handleCors(req, res, ["GET", "POST"])) return;
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    await requireUser(req);
    const { db } = getFirebaseAdmin();
    const listRef = db.collection("lists").doc("shopping");

    if (req.method === "GET") {
      const storeName = getStoreName(req);
      if (!storeName || storeName.length > maxStoreNameLength) {
        return res.status(400).json({ error: "Choose a valid store." });
      }
      const snapshot = await listRef.get();
      const stores = snapshot.data()?.stores || {};
      if (!snapshot.exists || !Object.hasOwn(stores, storeName)) {
        return res.status(404).json({ error: "The selected store was not found." });
      }

      const allPreferences = snapshot.data()?.sortingPreferences;
      const preferences = allPreferences && Object.hasOwn(allPreferences, storeName)
        ? allPreferences[storeName]
        : {};
      return res.status(200).json({
        storeName,
        preferences: preferences && typeof preferences === "object" && !Array.isArray(preferences)
          ? preferences
          : {}
      });
    }

    const storeName = typeof req.body?.storeName === "string" ? req.body.storeName.trim() : "";
    const inputs = req.body?.preferences;
    if (!storeName || storeName.length > maxStoreNameLength ||
      !Array.isArray(inputs) || inputs.length < 1 || inputs.length > maxSortingPreferenceBatchSize) {
      return res.status(400).json({ error: "Provide a valid store and a batch of sort preferences." });
    }

    const validatedPreferences = inputs.map(validatePreferenceInput);
    if (validatedPreferences.some(preference => preference === null)) {
      return res.status(400).json({ error: "One or more sort preferences are invalid." });
    }

    const savedCount = await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(listRef);
      if (!snapshot.exists) {
        return 0;
      }
      const stores = snapshot.data().stores || {};
      if (!Object.hasOwn(stores, storeName)) {
        return 0;
      }
      const storeAisles = Array.isArray(stores[storeName]?.aisles) ? stores[storeName].aisles : [];
      if (validatedPreferences.some(preference => !isAllowedAisle(preference.aisle, storeAisles))) {
        return -1;
      }

      const currentPreferences = snapshot.data().sortingPreferences || {};
      const existingStorePreferences = currentPreferences[storeName] &&
        typeof currentPreferences[storeName] === "object" &&
        !Array.isArray(currentPreferences[storeName])
        ? currentPreferences[storeName]
        : {};
      const uniqueKeys = new Set(validatedPreferences.map(preference =>
        normalizeSortingItemKey(preference.itemName)
      ));
      const newKeys = [...uniqueKeys].filter(key => !Object.hasOwn(existingStorePreferences, key));
      if (Object.keys(existingStorePreferences).length + newKeys.length > maxSortingPreferencesPerStore) {
        return -2;
      }

      let updatedPreferences = currentPreferences;
      let updatedAt = Date.now();
      for (const preference of validatedPreferences) {
        updatedPreferences = upsertSortingPreference(updatedPreferences, storeName, {
          ...preference,
          updatedAt: updatedAt++
        });
      }
      const updatedDocument = {
        ...snapshot.data(),
        sortingPreferences: updatedPreferences
      };
      if (Buffer.byteLength(JSON.stringify(updatedDocument), "utf8") > 900_000) {
        return -3;
      }
      transaction.update(listRef, { sortingPreferences: updatedPreferences });
      return validatedPreferences.length;
    });

    if (savedCount === 0) {
      return res.status(404).json({ error: "The selected store was not found." });
    }
    if (savedCount === -1) {
      return res.status(400).json({ error: "A sort preference refers to an aisle that does not belong to this store." });
    }
    if (savedCount === -2) {
      return res.status(413).json({ error: "This store has reached its maximum number of saved sort preferences." });
    }
    if (savedCount === -3) {
      return res.status(413).json({ error: "Family data is too large to save more sorting preferences." });
    }

    return res.status(200).json({ savedCount });
  } catch (error) {
    return sendApiError(res, error);
  }
}
