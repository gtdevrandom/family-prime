import test from "node:test";
import assert from "node:assert/strict";
import { defaultGeminiModel, generateWithGeminiModel } from "../lib/geminiModel.js";

test("retries an unavailable configured model with the supported default", async () => {
  const attemptedModels = [];
  const client = {
    getGenerativeModel({ model }) {
      attemptedModels.push(model);
      return {
        async generateContent(prompt) {
          assert.equal(prompt, "sort");
          if (model === "old-model") throw Object.assign(new Error("model not found"), { status: 404 });
          return "sorted";
        }
      };
    }
  };

  assert.equal(await generateWithGeminiModel(client, "sort", "old-model"), "sorted");
  assert.deepEqual(attemptedModels, ["old-model", defaultGeminiModel]);
});

test("does not retry authentication, quota, or default-model errors", async () => {
  let calls = 0;
  const client = {
    getGenerativeModel() {
      calls += 1;
      return { async generateContent() {
        throw Object.assign(new Error("request failed"), { status: 403 });
      } };
    }
  };
  await assert.rejects(generateWithGeminiModel(client, "sort", "custom-model"), { status: 403 });
  assert.equal(calls, 1);

  await assert.rejects(generateWithGeminiModel({
    getGenerativeModel() {
      calls += 1;
      return { async generateContent() {
        throw Object.assign(new Error("model not found"), { status: 404 });
      } };
    }
  }, "sort", defaultGeminiModel), { status: 404 });
  assert.equal(calls, 2);
});
