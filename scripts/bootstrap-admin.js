import { readFile } from "node:fs/promises";
import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

async function readServiceAccount() {
  let value = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!value && process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    value = await readFile(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, "utf8");
  }
  if (!value) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH is required.");
  try {
    return JSON.parse(value);
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON must contain valid service-account JSON.");
  }
}

async function bootstrap() {
  if (!process.argv.includes("--confirm-bootstrap")) {
    throw new Error("This one-time operation requires --confirm-bootstrap.");
  }
  const uid = process.env.BOOTSTRAP_ADMIN_UID;
  if (!uid) throw new Error("Set BOOTSTRAP_ADMIN_UID to the UID of the first Auth user.");

  const serviceAccount = await readServiceAccount();
  const app = initializeApp({ credential: cert(serviceAccount) });
  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PROJECT_ID !== serviceAccount.project_id) {
    throw new Error("The service account does not match FIREBASE_PROJECT_ID.");
  }
  const auth = getAuth(app);
  const db = getFirestore(app);
  const authUser = await auth.getUser(uid);
  if (authUser.disabled || !authUser.email ||
    !authUser.providerData.some(provider => provider.providerId === "password")) {
    throw new Error("The bootstrap account must be an enabled email/password user.");
  }

  const users = db.collection("users");
  const admins = await users.where("role", "==", "admin").limit(1).get();
  if (!admins.empty) {
    throw new Error("An admin profile already exists. Bootstrap is allowed only once per project.");
  }

  const shoppingRef = db.collection("lists").doc("shopping");
  const shopping = await shoppingRef.get();
  if (!shopping.exists) {
    await shoppingRef.create({
      items: [],
      stores: {},
      currentStore: null,
      promptHistory: [],
      loyaltyCards: [],
      createdAt: FieldValue.serverTimestamp()
    });
  }

  const profileRef = users.doc(uid);
  const bootstrapRef = db.collection("system").doc("bootstrap");
  await db.runTransaction(async transaction => {
    const [bootstrapSnapshot, profileSnapshot] = await Promise.all([
      transaction.get(bootstrapRef),
      transaction.get(profileRef)
    ]);
    if (bootstrapSnapshot.exists || profileSnapshot.exists) {
      throw new Error("Bootstrap has already been completed or this profile already exists.");
    }
    transaction.create(profileRef, {
      email: authUser.email,
      displayName: authUser.displayName || authUser.email,
      role: "admin",
      active: true,
      mustChangePassword: false,
      familyId: "family-prime",
      createdAt: FieldValue.serverTimestamp(),
      createdBy: "bootstrap"
    });
    transaction.create(bootstrapRef, {
      adminUid: uid,
      completedAt: FieldValue.serverTimestamp()
    });
  });

  console.log(`Bootstrap admin ready for ${authUser.email} in project ${serviceAccount.project_id}.`);
}

try {
  await bootstrap();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
