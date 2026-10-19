import test from "node:test";
import assert from "node:assert/strict";
import { calendarMonthDates, eventOccursOnDate, formatDateKey } from "../lib/calendarDates.js";

test("formats local dates without shifting across time zones", () => {
  assert.equal(formatDateKey(new Date(2026, 9, 19, 23)), "2026-10-19");
});

test("builds a complete Monday-first calendar month", () => {
  const dates = calendarMonthDates(2026, 9);

  assert.equal(dates.length % 7, 0);
  assert.equal(dates[0].dateKey, "2026-09-28");
  assert.equal(dates[0].inMonth, false);
  assert.equal(dates.find(day => day.dateKey === "2026-10-01").day, 1);
  assert.equal(dates.filter(day => day.inMonth).length, 31);
});

test("matches non-recurring and daily events only from their start date", () => {
  assert.equal(eventOccursOnDate({ startDate: "2026-10-19" }, "2026-10-18"), false);
  assert.equal(eventOccursOnDate({ startDate: "2026-10-19" }, "2026-10-20"), false);
  assert.equal(eventOccursOnDate({ startDate: "2026-10-19", recurrence: "daily" }, "2026-10-20"), true);
});

test("matches weekly, monthly and yearly recurrence and respects an end date", () => {
  assert.equal(eventOccursOnDate({
    startDate: "2026-10-19",
    recurrence: "weekly"
  }, "2026-10-26"), true);
  assert.equal(eventOccursOnDate({
    startDate: "2026-10-19",
    recurrence: "monthly"
  }, "2026-11-19"), true);
  assert.equal(eventOccursOnDate({
    startDate: "2024-02-29",
    recurrence: "yearly"
  }, "2025-02-28"), false);
  assert.equal(eventOccursOnDate({
    startDate: "2026-10-19",
    recurrence: "daily",
    recurrenceUntil: "2026-10-20"
  }, "2026-10-21"), false);
});

