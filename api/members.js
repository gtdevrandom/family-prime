import { handleCors } from "../lib/cors.js";
import { getFirebaseAdmin, requireUser, sendApiError } from "../lib/firebaseAdmin.js";

export default async function handler(req, res) {
  if (handleCors(req, res, ["GET"])) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    await requireUser(req);
    const { db } = getFirebaseAdmin();
    const snapshot = await db.collection("users")
      .where("active", "==", true)
      .where("familyId", "==", "family-prime")
      .get();
    const members = snapshot.docs
      .map(document => ({
        uid: document.id,
        displayName: document.data().displayName || ""
      }))
      .filter(member => member.displayName)
      .sort((first, second) => first.displayName.localeCompare(second.displayName, "fr"));

    return res.status(200).json({ members });
  } catch (error) {
    return sendApiError(res, error);
  }
}
