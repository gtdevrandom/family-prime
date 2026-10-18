export const maxDisplayNameLength = 80;

export function normalizeDisplayName(value) {
  if (typeof value !== "string") return null;
  const displayName = value.trim();
  return displayName.length > 0 && displayName.length <= maxDisplayNameLength
    ? displayName
    : null;
}
