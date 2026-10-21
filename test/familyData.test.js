import test from "node:test";
import assert from "node:assert/strict";
import { isValidFamilyEvent } from "../lib/familyData.js";

const validEvent = {
  title: "Rendez-vous",
  startDate: "2026-10-21",
  time: "09:30",
  recurrence: "weekly",
  recurrenceUntil: "2026-12-31",
  memberIds: ["member-1"]
};

test("accepts a valid event with selected members and recurrence", () => {
  assert.equal(isValidFamilyEvent(validEvent), true);
});

test("rejects invalid dates, recurrence bounds and member lists", () => {
  assert.equal(isValidFamilyEvent({ ...validEvent, startDate: "2026-02-30" }), false);
  assert.equal(isValidFamilyEvent({ ...validEvent, recurrenceUntil: "2026-10-20" }), false);
  assert.equal(isValidFamilyEvent({ ...validEvent, recurrence: "none" }), false);
  assert.equal(isValidFamilyEvent({ ...validEvent, memberIds: [""] }), false);
});
