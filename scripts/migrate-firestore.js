import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

async function parseServiceAccount(variableName) {
  let value = process.env[variableName];
  const path = process.env[`${variableName.replace("_JSON", "_PATH")}`];
  if (!value && path) value = await readFile(path, "utf8");
  if (!value) throw new Error(`${variableName} or its _PATH variant is required.`);
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${variableName} must contain valid service-account JSON.`);
  }
}

async function exportLegacyData(outputPath) {
  const serviceAccount = await parseServiceAccount("SOURCE_FIREBASE_SERVICE_ACCOUNT_JSON");
  const sourceApp = initializeApp({
    credential: cert(serviceAccount)
  }, "source-project");
  const snapshot = await getFirestore(sourceApp).collection("lists").doc("shopping").get();
  const data = snapshot.exists ? snapshot.data() : {};
  if (Array.isArray(data.items) && data.items.length > 500) {
    throw new Error("The legacy list contains more than 500 items; split or archive it before migration.");
  }
  const itemIds = new Set();

  const backup = {
    exportedAt: new Date().toISOString(),
    sourceProjectId: serviceAccount.project_id,
    shopping: {
      items: Array.isArray(data.items) ? data.items.map((item, index) => {
        if (!item || typeof item.name !== "string" || !item.name.trim() || item.name.length > 100) {
          throw new Error(`Legacy shopping item ${index + 1} has an invalid name; fix it before migration.`);
        }
        let id = typeof item.id === "string" && item.id.length <= 80 ? item.id : "";
        if (!id || itemIds.has(id)) id = randomUUID();
        itemIds.add(id);
        return {
          ...item,
          id,
          name: item.name.trim(),
          bought: item.bought === true,
          notFound: item.notFound === true,
          aisle: typeof item.aisle === "string" ? item.aisle.slice(0, 100) : null,
          addedByUid: typeof item.addedByUid === "string" ? item.addedByUid : null,
          addedByName: typeof item.addedByName === "string" ? item.addedByName : "Import ancien projet"
        };
      }) : [],
      stores: data.stores && typeof data.stores === "object" ? data.stores : {},
      currentStore: data.currentStore || null,
      promptHistory: Array.isArray(data.promptHistory) ? data.promptHistory : [],
      loyaltyCards: Array.isArray(data.loyaltyCards) ? data.loyaltyCards : []
    }
  };

  await writeFile(outputPath, JSON.stringify(backup, null, 2), { flag: "wx" });
  console.log(`Backup created at ${outputPath}. Keep it private and outside version control.`);
}

async function importData(inputPath, replaceExisting) {
  const backup = JSON.parse(await readFile(inputPath, "utf8"));
  if (!backup.shopping || !Array.isArray(backup.shopping.items)) {
    throw new Error("The backup does not contain a valid shopping list.");
  }
  const documentSize = Buffer.byteLength(JSON.stringify(backup.shopping), "utf8");
  if (documentSize > 900_000) {
    throw new Error("The backup is too large for one Firestore document. Move card images to Firebase Storage before importing.");
  }

  const targetServiceAccount = await parseServiceAccount("TARGET_FIREBASE_SERVICE_ACCOUNT_JSON");
  const targetApp = initializeApp({
    credential: cert(targetServiceAccount)
  }, "target-project");
  const shoppingRef = getFirestore(targetApp).collection("lists").doc("shopping");
  const existing = await shoppingRef.get();
  if (existing.exists && !replaceExisting) {
    throw new Error("The target shopping document already exists. Use --replace only after reviewing the target data.");
  }

  await shoppingRef.set({
    ...backup.shopping,
    migratedAt: new Date().toISOString(),
    migratedFromProjectId: backup.sourceProjectId || null
  });
  console.log(`Imported ${backup.shopping.items.length} items into ${targetServiceAccount.project_id}.`);
}

const [mode, filePath = "migration-backup.json", ...flags] = process.argv.slice(2);
try {
  if (mode === "export") {
    await exportLegacyData(filePath);
  } else if (mode === "import") {
    await importData(filePath, flags.includes("--replace"));
  } else {
    throw new Error("Usage: node scripts/migrate-firestore.js <export|import> [backup-file] [--replace]");
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
