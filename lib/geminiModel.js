export const defaultGeminiModel = "gemini-2.5-flash-lite";

export class GeminiModelsUnavailableError extends Error {
  constructor(attemptedModels, availableModels) {
    const attempted = attemptedModels.length ? attemptedModels.join(", ") : "aucun";
    const available = availableModels.length ? availableModels.join(", ") : "aucun modèle Flash compatible";
    super(`Aucun modèle Gemini Flash disponible. Modèles essayés : ${attempted}. Modèles Flash annoncés par Google pour cette clé : ${available}.`);
    this.name = "GeminiModelsUnavailableError";
    this.status = 404;
  }
}

async function listAvailableFlashModels(apiKey) {
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
    headers: { "x-goog-api-key": apiKey }
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(`Unable to list Gemini models (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  if (!Array.isArray(result.models)) {
    throw new Error("Gemini returned an invalid model list.");
  }

  return result.models
    .filter(model => Array.isArray(model.supportedGenerationMethods) &&
      model.supportedGenerationMethods.includes("generateContent"))
    .map(model => typeof model.name === "string" ? model.name.replace(/^models\//, "") : "")
    .filter(name => /^gemini-.*flash/i.test(name));
}

function rankFlashModels(models) {
  const preferredOrder = [
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-3-flash"
  ];
  return [...models].sort((first, second) => {
    const rank = model => {
      const index = preferredOrder.findIndex(candidate => model === candidate || model.startsWith(`${candidate}-`));
      return index < 0 ? preferredOrder.length : index;
    };
    return rank(first) - rank(second);
  });
}

export async function generateWithGeminiModel(genAI, prompt, preferredModel, apiKey) {
  const modelName = preferredModel?.trim() || defaultGeminiModel;
  const attemptedModels = [modelName];
  try {
    const model = genAI.getGenerativeModel({ model: modelName });
    return await model.generateContent(prompt);
  } catch (error) {
    if (Number(error?.status) !== 404) throw error;

    const availableModels = rankFlashModels(await listAvailableFlashModels(apiKey))
      .filter(model => !attemptedModels.includes(model));
    for (const fallbackName of availableModels.slice(0, 2)) {
      attemptedModels.push(fallbackName);
      console.warn(`Gemini model "${attemptedModels[0]}" is unavailable; retrying with "${fallbackName}".`);
      try {
        const fallbackModel = genAI.getGenerativeModel({ model: fallbackName });
        return await fallbackModel.generateContent(prompt);
      } catch (fallbackError) {
        if (Number(fallbackError?.status) !== 404) throw fallbackError;
      }
    }

    throw new GeminiModelsUnavailableError(attemptedModels, availableModels);
  }
}
