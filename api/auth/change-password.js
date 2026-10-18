import { ApiError, getFirebaseAdmin, requireUser, sendApiError } from "../../lib/firebaseAdmin.js";
import { matchesTemporaryPassword } from "../../lib/accountPasswords.js";
import { handleCors } from "../../lib/cors.js";

export default async function handler(req, res) {
  if (handleCors(req, res, ["POST"])) return;
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const { uid, profile } = await requireUser(req, { allowPasswordChange: true });
    if (profile.mustChangePassword !== true) {
      return res.status(409).json({ error: "A password change is not required for this account." });
    }

    const temporaryPassword = req.body?.temporaryPassword;
    const newPassword = req.body?.newPassword;
    if (typeof temporaryPassword !== "string" || !temporaryPassword) {
      return res.status(400).json({ error: "Enter your temporary password to confirm the change." });
    }
    if (typeof newPassword !== "string" || newPassword.length < 12 || newPassword.length > 128) {
      return res.status(400).json({ error: "Choose a password between 12 and 128 characters." });
    }
    if (newPassword === temporaryPassword) {
      return res.status(400).json({ error: "Choose a password different from the temporary password." });
    }

    const { auth, db, fieldValue } = getFirebaseAdmin();
    const secretSnapshot = await db.collection("accountSecrets").doc(uid).get();
    const expectedHash = secretSnapshot.data()?.temporaryPasswordHash;
    if (!secretSnapshot.exists || !matchesTemporaryPassword(temporaryPassword, expectedHash)) {
      return res.status(403).json({ error: "The temporary password is incorrect." });
    }

    await auth.updateUser(uid, { password: newPassword });
    await db.runTransaction(async transaction => {
      const profileRef = db.collection("users").doc(uid);
      const passwordRef = db.collection("accountSecrets").doc(uid);
      const profileSnapshot = await transaction.get(profileRef);
      const passwordSnapshot = await transaction.get(passwordRef);
      if (!profileSnapshot.exists || profileSnapshot.data().mustChangePassword !== true ||
        !passwordSnapshot.exists || passwordSnapshot.data().temporaryPasswordHash !== expectedHash) {
        throw new ApiError(409, "The temporary password has already been used.");
      }
      transaction.update(profileRef, {
        mustChangePassword: false,
        passwordChangedAt: fieldValue.serverTimestamp()
      });
      transaction.delete(passwordRef);
    });

    return res.status(200).json({ ok: true });
  } catch (error) {
    return sendApiError(res, error);
  }
}
