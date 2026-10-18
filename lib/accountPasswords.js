import { createHash, timingSafeEqual } from "node:crypto";

export function hashTemporaryPassword(password) {
  return createHash("sha256").update(password).digest("hex");
}

export function matchesTemporaryPassword(password, expectedHash) {
  if (typeof password !== "string" || typeof expectedHash !== "string" || !/^[a-f\d]{64}$/i.test(expectedHash)) {
    return false;
  }
  const suppliedHash = createHash("sha256").update(password).digest();
  return timingSafeEqual(Buffer.from(expectedHash, "hex"), suppliedHash);
}
