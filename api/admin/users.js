import { randomBytes } from "node:crypto";
import { hashTemporaryPassword } from "../../lib/accountPasswords.js";
import { handleCors } from "../../lib/cors.js";
import { getFirebaseAdmin, requireAdmin, sendApiError } from "../../lib/firebaseAdmin.js";

export default async function handler(req, res) {
  if (handleCors(req, res, ["GET", "POST", "PATCH"])) return;
  if (!["GET", "POST", "PATCH"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST, PATCH");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const { db, auth, fieldValue } = getFirebaseAdmin();
    const admin = await requireAdmin(req);

    if (req.method === "GET") {
      const snapshot = await db.collection("users").get();
      const users = snapshot.docs.map(document => {
        const profile = document.data();
        return {
          uid: document.id,
          email: profile.email || "",
          displayName: profile.displayName || "",
          role: profile.role || "member",
          active: profile.active === true,
          mustChangePassword: profile.mustChangePassword === true
        };
      }).sort((a, b) => a.displayName.localeCompare(b.displayName, "fr"));

      return res.status(200).json({ users });
    }

    if (req.method === "POST") {
      const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
      const displayName = typeof req.body?.displayName === "string" ? req.body.displayName.trim() : "";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || displayName.length < 1 || displayName.length > 80) {
        return res.status(400).json({ error: "Provide a valid email and a name of at most 80 characters." });
      }

      const temporaryPassword = randomBytes(18).toString("base64url");
      let createdUser;
      try {
        createdUser = await auth.createUser({
          email,
          displayName,
          password: temporaryPassword,
          emailVerified: false,
          disabled: false
        });
        const batch = db.batch();
        batch.create(db.collection("users").doc(createdUser.uid), {
          email,
          displayName,
          role: "member",
          active: true,
          mustChangePassword: true,
          familyId: "family-prime",
          createdAt: fieldValue.serverTimestamp(),
          createdBy: admin.uid
        });
        batch.create(db.collection("accountSecrets").doc(createdUser.uid), {
          temporaryPasswordHash: hashTemporaryPassword(temporaryPassword)
        });
        await batch.commit();
      } catch (error) {
        if (createdUser) {
          const cleanupResults = await Promise.allSettled([
            auth.deleteUser(createdUser.uid),
            db.collection("users").doc(createdUser.uid).delete(),
            db.collection("accountSecrets").doc(createdUser.uid).delete()
          ]);
          for (const result of cleanupResults) {
            if (result.status === "rejected") {
              console.error("Failed to clean up an incompletely provisioned account:", result.reason.message);
            }
          }
        }
        if (error.code === "auth/email-already-exists") {
          return res.status(409).json({ error: "An account with this email already exists." });
        }
        throw error;
      }

      return res.status(201).json({
        user: { uid: createdUser.uid, email, displayName, active: true, mustChangePassword: true },
        temporaryPassword
      });
    }

    if (req.method === "PATCH") {
      const uid = typeof req.body?.uid === "string" ? req.body.uid : "";
      const active = req.body?.active;
      if (!uid || uid === admin.uid || typeof active !== "boolean") {
        return res.status(400).json({ error: "Choose another member and whether to activate or deactivate them." });
      }

      const userRef = db.collection("users").doc(uid);
      const userSnapshot = await userRef.get();
      if (!userSnapshot.exists || userSnapshot.data().role === "admin") {
        return res.status(404).json({ error: "The member account was not found." });
      }

      const update = {
        active,
        updatedAt: fieldValue.serverTimestamp(),
        updatedBy: admin.uid
      };
      if (active) {
        await auth.updateUser(uid, { disabled: false });
        await userRef.update(update);
      } else {
        await userRef.update(update);
        await auth.updateUser(uid, { disabled: true });
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed." });
  } catch (error) {
    return sendApiError(res, error);
  }
}
