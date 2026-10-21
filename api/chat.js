import { GoogleGenerativeAI } from "@google/generative-ai";
import { ApiError, getFirebaseAdmin, requireUser, sendApiError } from "../lib/firebaseAdmin.js";
import { handleCors } from "../lib/cors.js";
import { defaultGeminiModel, generateWithGeminiModel } from "../lib/geminiModel.js";
import { mapGeminiError } from "../lib/geminiErrors.js";

const minimumRequestIntervalMs = 30_000;
const maxPromptLength = 8_000;

export default async function handler(req, res) {
  if (handleCors(req, res, ["POST"])) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const { uid } = await requireUser(req);
    const prompt = req.body?.prompt ?? req.body?.message ?? req.body?.messages?.[0]?.content;
    if (typeof prompt !== "string" || !prompt.trim()) {
      throw new ApiError(400, "No prompt provided.");
    }
    if (prompt.length > maxPromptLength) {
      throw new ApiError(413, "The prompt is too long.");
    }

    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new ApiError(503, "The AI service is not configured.");
    }

    const { db, timestamp } = getFirebaseAdmin();
    const rateLimitRef = db.collection("aiRateLimits").doc(uid);
    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(rateLimitRef);
      const previousRequest = snapshot.exists ? snapshot.data().lastRequestAt?.toMillis() : 0;
      const now = Date.now();
      if (previousRequest && now - previousRequest < minimumRequestIntervalMs) {
        throw new ApiError(429, "Wait a short while before asking the AI to sort again.");
      }
      transaction.set(rateLimitRef, { lastRequestAt: timestamp.fromMillis(now) });
    });

    const genAI = new GoogleGenerativeAI(apiKey);
    const preferredModel = process.env.GEMINI_MODEL?.trim() || defaultGeminiModel;
    const result = await generateWithGeminiModel(genAI, prompt.trim(), preferredModel);
    const generatedText = result.response.text();
    if (!generatedText) throw new ApiError(502, "The AI returned an empty response.");

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      choices: [{ message: { content: generatedText } }],
      generated_text: generatedText,
      reply: generatedText
    });
  } catch (error) {
    if (error instanceof ApiError) return sendApiError(res, error);

    const message = typeof error?.message === "string" ? error.message : "Unknown error";
    console.error("Gemini request failed:", error?.status || "unknown status", message);
    const mappedError = mapGeminiError(error);
    return res.status(mappedError.status).json({ error: mappedError.message });
  }
}
