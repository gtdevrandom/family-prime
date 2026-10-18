import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";

let services;

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function getFirebaseAdmin() {
  if (services) return services;

  const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!rawServiceAccount) {
    throw new ApiError(500, "Firebase Admin credentials are not configured.");
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(rawServiceAccount);
  } catch {
    throw new ApiError(500, "FIREBASE_SERVICE_ACCOUNT_JSON must contain valid JSON.");
  }
  if (process.env.FIREBASE_PROJECT_ID && serviceAccount.project_id !== process.env.FIREBASE_PROJECT_ID) {
    throw new ApiError(500, "The Firebase Admin service account does not match FIREBASE_PROJECT_ID.");
  }

  const app = getApps()[0] || initializeApp({
    credential: cert(serviceAccount)
  });

  services = {
    app,
    auth: getAuth(app),
    db: getFirestore(app),
    fieldValue: FieldValue,
    timestamp: Timestamp
  };
  return services;
}

export async function requireUser(req, { allowPasswordChange = false } = {}) {
  const authorization = req.headers.authorization || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new ApiError(401, "Authentication is required.");

  const { auth, db } = getFirebaseAdmin();
  let decodedToken;
  try {
    decodedToken = await auth.verifyIdToken(match[1], true);
  } catch {
    throw new ApiError(401, "Your session is invalid or expired. Sign in again.");
  }

  const profileSnapshot = await db.collection("users").doc(decodedToken.uid).get();
  if (!profileSnapshot.exists) throw new ApiError(403, "This account has no family profile.");

  const profile = profileSnapshot.data();
  if (profile.active !== true || profile.familyId !== "family-prime") {
    throw new ApiError(403, "This account is not an active family member.");
  }
  if (!allowPasswordChange && profile.mustChangePassword === true) {
    throw new ApiError(403, "Change your temporary password before continuing.");
  }

  return {
    uid: decodedToken.uid,
    profile
  };
}

export async function requireAdmin(req) {
  const user = await requireUser(req);
  if (user.profile.role !== "admin") {
    throw new ApiError(403, "Administrator access is required.");
  }
  return user;
}

export function sendApiError(res, error) {
  const status = error instanceof ApiError ? error.status : 500;
  if (status >= 500) {
    console.error("API request failed:", error.message);
  }
  return res.status(status).json({
    error: status >= 500 ? "The server could not complete this request." : error.message
  });
}
