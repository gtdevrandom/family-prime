export const defaultGeminiModel = "gemini-2.5-flash-lite";

export async function generateWithGeminiModel(genAI, prompt, preferredModel) {
  const modelName = preferredModel?.trim() || defaultGeminiModel;
  try {
    const model = genAI.getGenerativeModel({ model: modelName });
    return await model.generateContent(prompt);
  } catch (error) {
    if (Number(error?.status) !== 404 || modelName === defaultGeminiModel) throw error;

    console.warn(`Gemini model "${modelName}" is unavailable; retrying with "${defaultGeminiModel}".`);
    const fallbackModel = genAI.getGenerativeModel({ model: defaultGeminiModel });
    return fallbackModel.generateContent(prompt);
  }
}
