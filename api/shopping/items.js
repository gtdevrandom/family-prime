import { getFirebaseAdmin, requireUser, sendApiError } from "../../lib/firebaseAdmin.js";
import { handleCors } from "../../lib/cors.js";
import { assignTrustedAuthors, validateShoppingItems } from "../../lib/shoppingItems.js";

export default async function handler(req, res) {
  if (handleCors(req, res, ["POST"])) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const { uid, profile } = await requireUser(req);
    const incomingItems = req.body?.items;
    if (!validateShoppingItems(incomingItems)) {
      return res.status(400).json({ error: "The shopping list is invalid or too large." });
    }

    const { db, fieldValue } = getFirebaseAdmin();
    const documentRef = db.collection("lists").doc("shopping");
    const items = await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(documentRef);
      if (!snapshot.exists) {
        const error = new Error("The family shopping list has not been initialized.");
        error.status = 409;
        throw error;
      }

      const existingItems = Array.isArray(snapshot.data().items) ? snapshot.data().items : [];
      const trustedItems = assignTrustedAuthors(incomingItems, existingItems, {
        uid,
        displayName: profile.displayName,
        email: profile.email
      });
      const updatedDocument = { ...snapshot.data(), items: trustedItems };
      if (Buffer.byteLength(JSON.stringify(updatedDocument), "utf8") > 900_000) {
        const error = new Error("Family data is too large for one Firestore document. Move card images to Firebase Storage.");
        error.status = 413;
        throw error;
      }

      transaction.update(documentRef, {
        items: trustedItems,
        updatedAt: fieldValue.serverTimestamp()
      });
      return trustedItems;
    });

    return res.status(200).json({ items });
  } catch (error) {
    if (error.status === 409 || error.status === 413) {
      return res.status(error.status).json({ error: error.message });
    }
    return sendApiError(res, error);
  }
}
