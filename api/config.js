import { handleCors } from "../lib/cors.js";

const publicFirebaseFields = {
  apiKey: "FIREBASE_API_KEY",
  authDomain: "FIREBASE_AUTH_DOMAIN",
  projectId: "FIREBASE_PROJECT_ID",
  storageBucket: "FIREBASE_STORAGE_BUCKET",
  messagingSenderId: "FIREBASE_MESSAGING_SENDER_ID",
  appId: "FIREBASE_APP_ID",
  measurementId: "FIREBASE_MEASUREMENT_ID"
};

export default function handler(req, res) {
  if (handleCors(req, res, ["GET"])) return;
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  const config = {};
  const missing = [];

  for (const [field, envName] of Object.entries(publicFirebaseFields)) {
    const value = process.env[envName];
    if (value) config[field] = value;
    else if (["apiKey", "authDomain", "projectId", "appId"].includes(field)) {
      missing.push(envName);
    }
  }

  if (missing.length) {
    console.error("Missing Firebase client configuration:", missing.join(", "));
    return res.status(503).json({ error: "Firebase is not configured for this deployment." });
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json(config);
}
