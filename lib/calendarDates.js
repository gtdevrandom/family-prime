export function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function calendarMonthDates(year, month) {
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
  const dayCount = new Date(year, month + 1, 0).getDate();
  const cellCount = Math.ceil((firstWeekday + dayCount) / 7) * 7;

  return Array.from({ length: cellCount }, (_, index) => {
    const date = new Date(year, month, index - firstWeekday + 1);
    return {
      dateKey: formatDateKey(date),
      day: date.getDate(),
      inMonth: date.getMonth() === month
    };
  });
}

export function eventOccursOnDate(event, dateKey) {
  if (!event || typeof event.startDate !== "string" || dateKey < event.startDate) return false;
  if (event.recurrenceUntil && dateKey > event.recurrenceUntil) return false;
  if (dateKey === event.startDate) return true;

  const recurrence = event.recurrence || "none";
  if (recurrence === "none") return false;

  const [startYear, startMonth, startDay] = event.startDate.split("-").map(Number);
  const [year, month, day] = dateKey.split("-").map(Number);
  if (![startYear, startMonth, startDay, year, month, day].every(Number.isInteger)) return false;

  if (recurrence === "monthly") return day === startDay;
  if (recurrence === "yearly") return month === startMonth && day === startDay;
  if (recurrence === "daily" || recurrence === "weekly") {
    const start = new Date(startYear, startMonth - 1, startDay);
    const current = new Date(year, month - 1, day);
    const daysApart = Math.round((current - start) / 86_400_000);
    return recurrence === "daily" || daysApart % 7 === 0;
  }

  return false;
}
