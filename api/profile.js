import { handleCors } from "../lib/cors.js";
import { ApiError, getFirebaseAdmin, requireUser, sendApiError } from "../lib/firebaseAdmin.js";
import { normalizeDisplayName } from "../lib/accountProfiles.js";
import { updateShoppingItemAuthorNames } from "../lib/shoppingItems.js";

export default async function handler(req, res) {
  if (handleCors(req, res, ["PATCH"])) return;
  if (req.method !== "PATCH") {
    res.setHeader("Allow", "PATCH");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const { uid } = await requireUser(req);
    const displayName = normalizeDisplayName(req.body?.displayName);
    if (!displayName) {
      return res.status(400).json({ error: "Choose a pseudo between 1 and 80 characters." });
    }

    const { db, fieldValue } = getFirebaseAdmin();
    await db.runTransaction(async transaction => {
      const profileRef = db.collection("users").doc(uid);
      const listRef = db.collection("lists").doc("shopping");
      const profileSnapshot = await transaction.get(profileRef);
      const listSnapshot = await transaction.get(listRef);
      if (!profileSnapshot.exists) {
        throw new ApiError(404, "The member profile was not found.");
      }

      transaction.update(profileRef, {
        displayName,
        updatedAt: fieldValue.serverTimestamp()
      });
      if (listSnapshot.exists) {
        const existingItems = listSnapshot.data().items;
        const items = updateShoppingItemAuthorNames(existingItems, uid, displayName);
        if (items !== existingItems) {
          transaction.update(listRef, {
            items,
            updatedAt: fieldValue.serverTimestamp()
          });
        }
      }
    });

    return res.status(200).json({ displayName });
  } catch (error) {
    return sendApiError(res, error);
  }
}
