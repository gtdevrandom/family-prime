export function mapGeminiError(error) {
  const message = typeof error?.message === "string" ? error.message : "";
  const status = Number(error?.status);

  if (status === 429 || message.toLowerCase().includes("quota") || message.includes("429")) {
    return {
      status: 429,
      message: "La limite de demandes Gemini est atteinte. Réessayez dans un instant."
    };
  }
  if (status === 400 || message.includes("INVALID_ARGUMENT")) {
    return {
      status: 400,
      message: "Gemini a refusé la requête. Vérifiez la longueur de la liste et les noms des rayons."
    };
  }
  if (status === 401 || status === 403) {
    return {
      status: 503,
      message: "Gemini refuse la clé API ou son accès. Vérifiez GOOGLE_API_KEY et l’activation de la Gemini API dans Google AI Studio."
    };
  }
  if (status === 404 || message.includes("NOT_FOUND")) {
    return {
      status: 503,
      message: message.startsWith("Aucun modèle Gemini Flash disponible.")
        ? message
        : "Gemini ne reconnaît pas le modèle demandé. Vérifiez que la dernière version de l’API est déployée sur Vercel et que GOOGLE_API_KEY est une clé Google AI Studio disposant de modèles Gemini."
    };
  }
  if (status >= 500) {
    return {
      status: 503,
      message: "Le service Gemini est temporairement indisponible. Réessayez plus tard."
    };
  }
  return {
    status: 502,
    message: "Gemini n’a pas pu terminer le tri. Consultez les journaux Vercel pour connaître la cause."
  };
}
