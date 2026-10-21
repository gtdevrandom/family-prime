import test from "node:test";
import assert from "node:assert/strict";
import { mapGeminiError } from "../lib/geminiErrors.js";

test("maps invalid Gemini model errors to an actionable service configuration error", () => {
  const unavailableModel = mapGeminiError({ status: 404 });
  assert.equal(unavailableModel.status, 503);
  assert.match(unavailableModel.message, /clé Google AI Studio/);
  assert.match(unavailableModel.message, /dernière version de l’API/);

  const unavailableAccountModels = mapGeminiError({
    status: 404,
    message: "Aucun modèle Gemini Flash disponible. Modèles essayés : gemini-test."
  });
  assert.equal(unavailableAccountModels.status, 503);
  assert.match(unavailableAccountModels.message, /Modèles essayés : gemini-test/);
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
