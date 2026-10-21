import { randomUUID } from "node:crypto";
import { handleCors } from "../lib/cors.js";
import { ApiError, getFirebaseAdmin, requireUser, sendApiError } from "../lib/firebaseAdmin.js";
import { isValidFamilyEvent } from "../lib/familyData.js";

const familyId = "family-prime";
const maxFamilyDocumentBytes = 900_000;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

function assertFamilyDocumentSize(data) {
  if (Buffer.byteLength(JSON.stringify(data), "utf8") > maxFamilyDocumentBytes) {
    throw new ApiError(413, "Les données familiales dépasseraient la limite de taille du document Firestore.");
  }
}

function mergeById(existing, imported) {
  const merged = new Map(
    (Array.isArray(existing) ? existing : [])
      .filter(item => item && typeof item.id === "string")
      .map(item => [item.id, item])
  );
  imported.forEach(item => {
    if (item && typeof item.id === "string" && !merged.has(item.id)) {
      merged.set(item.id, item);
    }
  });
  return [...merged.values()];
}

function toIsoString(value) {
  if (typeof value === "string") return value;
  if (value && typeof value.toDate === "function") return value.toDate().toISOString();
  if (value && typeof value.seconds === "number") {
    return new Date(value.seconds * 1000).toISOString();
  }
  return new Date().toISOString();
}

function normalizeLegacyEvent(document) {
  const data = document.data();
  return {
    ...data,
    id: document.id,
    createdAt: toIsoString(data.createdAt),
    updatedAt: toIsoString(data.updatedAt)
  };
}

function normalizeLegacyIceboxItem(document) {
  const data = document.data();
  return {
    ...data,
    id: document.id,
    createdAt: toIsoString(data.createdAt),
    updatedAt: toIsoString(data.updatedAt)
  };
}

async function updateShoppingDocument(db, field, updater) {
  const documentRef = db.collection("lists").doc("shopping");
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(documentRef);
    if (!snapshot.exists) throw new ApiError(409, "La liste familiale n’est pas initialisée.");
    const data = snapshot.data();
    if (data.familyFeaturesMigrated !== true) {
      throw new ApiError(409, "La migration des données familiales n’est pas terminée. Actualisez la page.");
    }
    const current = Array.isArray(data[field]) ? data[field] : [];
    const updated = updater(current);
    assertFamilyDocumentSize({ ...data, [field]: updated });
    transaction.update(documentRef, { [field]: updated });
    return updated;
  });
}

async function migrateLegacyData(db) {
  const [eventsSnapshot, iceboxSnapshot] = await Promise.all([
    db.collection("familyEvents").where("familyId", "==", familyId).get(),
    db.collection("iceboxItems").where("familyId", "==", familyId).get()
  ]);
  const legacyEvents = eventsSnapshot.docs.map(normalizeLegacyEvent);
  const legacyIceboxItems = iceboxSnapshot.docs.map(normalizeLegacyIceboxItem);
  const documentRef = db.collection("lists").doc("shopping");

  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(documentRef);
    if (!snapshot.exists) throw new ApiError(409, "La liste familiale n’est pas initialisée.");
    const data = snapshot.data();
    if (data.familyFeaturesMigrated === true) return { migrated: false };

    const familyEvents = mergeById(data.familyEvents, legacyEvents);
    const iceboxItems = mergeById(data.iceboxItems, legacyIceboxItems);
    const updatedDocument = { ...data, familyEvents, iceboxItems, familyFeaturesMigrated: true };
    assertFamilyDocumentSize(updatedDocument);
    transaction.update(documentRef, {
      familyEvents,
      iceboxItems,
      familyFeaturesMigrated: true
    });
    return { migrated: true, events: familyEvents.length, iceboxItems: iceboxItems.length };
  });
}

export default async function handler(req, res) {
  if (handleCors(req, res, ["POST"])) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const user = await requireUser(req);
    const { db } = getFirebaseAdmin();
    const { operation } = req.body || {};

    if (operation === "migrate") {
      const result = await migrateLegacyData(db);
      return res.status(200).json(result);
    }

    if (operation === "save-event") {
      const input = req.body?.event;
      if (!isValidFamilyEvent(input) || !timePattern.test(input.time)) {
        throw new ApiError(400, "Les informations de l’événement sont invalides.");
      }
      const id = typeof input.id === "string" && input.id.length <= 80 ? input.id : randomUUID();
      const event = {
        id,
        familyId,
        title: input.title.trim(),
        startDate: input.startDate,
        time: input.time,
        recurrence: input.recurrence,
        recurrenceUntil: input.recurrence === "none" ? "" : input.recurrenceUntil || "",
        memberIds: input.memberIds,
        creatorUid: user.uid,
        creatorName: user.profile.displayName || "Membre",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      const events = await updateShoppingDocument(db, "familyEvents", existing => {
        const previous = existing.find(item => item.id === id);
        if (previous && previous.creatorUid !== user.uid) {
          throw new ApiError(403, "Seul le membre qui a créé cet événement peut le modifier.");
        }
        if (previous) event.createdAt = previous.createdAt || event.createdAt;
        return [...existing.filter(item => item.id !== id), event];
      });
      return res.status(200).json({ event, count: events.length });
    }

    if (operation === "delete-event") {
      const id = typeof req.body?.id === "string" ? req.body.id : "";
      if (!id) throw new ApiError(400, "L’événement à supprimer est invalide.");
      let deleted = false;
      await updateShoppingDocument(db, "familyEvents", existing => {
        const event = existing.find(item => item.id === id);
        if (!event) return existing;
        if (event.creatorUid !== user.uid) {
          throw new ApiError(403, "Seul le membre qui a créé cet événement peut le supprimer.");
        }
        deleted = true;
        return existing.filter(item => item.id !== id);
      });
      return res.status(deleted ? 200 : 404).json(deleted ? { ok: true } : { error: "Événement introuvable." });
    }

    if (operation === "add-icebox-item") {
      const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
      const flavor = typeof req.body?.flavor === "string" ? req.body.flavor.trim() : "";
      const quantity = req.body?.quantity;
      if (!name || name.length > 100 || flavor.length > 100 ||
        !Number.isInteger(quantity) || quantity < 1 || quantity > 9999) {
        throw new ApiError(400, "Les informations de la glace sont invalides.");
      }
      const item = {
        id: randomUUID(),
        familyId,
        name,
        flavor,
        quantity,
        createdBy: user.uid,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await updateShoppingDocument(db, "iceboxItems", existing => [...existing, item]);
      return res.status(201).json({ item });
    }

    if (operation === "change-icebox-quantity") {
      const id = typeof req.body?.id === "string" ? req.body.id : "";
      const delta = req.body?.delta;
      if (!id || ![-1, 1].includes(delta)) {
        throw new ApiError(400, "La mise à jour de la quantité est invalide.");
      }
      let updatedItem;
      await updateShoppingDocument(db, "iceboxItems", existing => {
        const item = existing.find(entry => entry.id === id);
        if (!item) throw new ApiError(404, "Glace introuvable.");
        updatedItem = { ...item, quantity: Math.max(0, Math.min(9999, (Number(item.quantity) || 0) + delta)) };
        updatedItem.updatedAt = new Date().toISOString();
        return existing.map(entry => entry.id === id ? updatedItem : entry);
      });
      return res.status(200).json({ item: updatedItem });
    }

    if (operation === "delete-icebox-item") {
      const id = typeof req.body?.id === "string" ? req.body.id : "";
      if (!id) throw new ApiError(400, "La glace à supprimer est invalide.");
      let deleted = false;
      await updateShoppingDocument(db, "iceboxItems", existing => {
        deleted = existing.some(item => item.id === id);
        return existing.filter(item => item.id !== id);
      });
      return res.status(deleted ? 200 : 404).json(deleted ? { ok: true } : { error: "Glace introuvable." });
    }

    throw new ApiError(400, "Opération de données familiales non reconnue.");
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.status).json({ error: error.message });
    }
    return sendApiError(res, error);
  }
}
