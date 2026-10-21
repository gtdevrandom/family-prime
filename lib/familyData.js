const validRecurrences = new Set(["none", "daily", "weekly", "monthly", "yearly"]);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateKey(value) {
  if (typeof value !== "string" || !datePattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

export function isValidFamilyEvent(event) {
  return event && typeof event === "object" &&
    typeof event.title === "string" && event.title.trim().length > 0 && event.title.length <= 100 &&
    isValidDateKey(event.startDate) &&
    validRecurrences.has(event.recurrence) &&
    typeof (event.recurrenceUntil || "") === "string" &&
    (!event.recurrenceUntil || (
      isValidDateKey(event.recurrenceUntil) &&
      event.recurrenceUntil >= event.startDate &&
      event.recurrence !== "none"
    )) &&
    Array.isArray(event.memberIds) && event.memberIds.length <= 100 &&
    event.memberIds.every(uid => typeof uid === "string" && uid.length > 0 && uid.length <= 128);
}
