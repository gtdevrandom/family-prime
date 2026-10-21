import test from "node:test";
import assert from "node:assert/strict";
import { mapGeminiError } from "../lib/geminiErrors.js";

test("maps invalid Gemini model errors to an actionable service configuration error", () => {
  assert.deepEqual(mapGeminiError({ status: 404 }), {
    status: 503,
    message: "Le modèle Gemini configuré est introuvable. Vérifiez GEMINI_MODEL dans les variables Vercel."
  });
});

test("maps invalid credentials and quota errors to their proper statuses", () => {
  assert.equal(mapGeminiError({ status: 403 }).status, 503);
  assert.equal(mapGeminiError({ status: 429 }).status, 429);
  assert.equal(mapGeminiError({ message: "quota exceeded" }).status, 429);
});

test("maps invalid prompts and transient upstream errors", () => {
  assert.equal(mapGeminiError({ status: 400 }).status, 400);
  assert.equal(mapGeminiError({ status: 503 }).status, 503);
  assert.equal(mapGeminiError({ message: "connection reset" }).status, 502);
});
