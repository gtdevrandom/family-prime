import test from "node:test";
import assert from "node:assert/strict";
import { defaultGeminiModel, generateWithGeminiModel } from "../lib/geminiModel.js";

test("retries an unavailable configured model with a currently listed Flash model", async () => {
  const attemptedModels = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        models: [
          { name: "models/gemini-3-flash-preview", supportedGenerationMethods: ["generateContent"] },
          { name: "models/gemini-2.5-flash-lite", supportedGenerationMethods: ["generateContent"] },
          { name: "models/gemini-embedding-001", supportedGenerationMethods: ["embedContent"] }
        ]
      };
    }
  });
  const client = {
    getGenerativeModel({ model }) {
      attemptedModels.push(model);
      return {
        async generateContent(prompt) {
          assert.equal(prompt, "sort");
          if (model !== "gemini-2.5-flash-lite") {
            throw Object.assign(new Error("model not found"), { status: 404 });
          }
          return "sorted";
        }
      };
    }
  };

  try {
    assert.equal(await generateWithGeminiModel(client, "sort", "old-model", "test-key"), "sorted");
    assert.deepEqual(attemptedModels, ["old-model", "gemini-2.5-flash-lite"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not retry authentication, quota, or default-model errors", async () => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  const client = {
    getGenerativeModel() {
      calls += 1;
      return { async generateContent() {
        throw Object.assign(new Error("request failed"), { status: 403 });
      } };
    }
  };
  await assert.rejects(generateWithGeminiModel(client, "sort", "custom-model", "test-key"), { status: 403 });
  assert.equal(calls, 1);

  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return { models: [] };
    }
  });
  try {
    await assert.rejects(generateWithGeminiModel({
      getGenerativeModel() {
        calls += 1;
        return { async generateContent() {
          throw Object.assign(new Error("model not found"), { status: 404 });
        } };
      }
    }, "sort", defaultGeminiModel, "test-key"), { status: 404 });
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
