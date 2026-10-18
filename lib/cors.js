export function handleCors(req, res, allowedMethods) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Vary", "Origin");

  const origin = req.headers?.origin;
  if (origin) {
    const allowedOrigins = (process.env.FAMILY_PRIME_ALLOWED_ORIGINS || "")
      .split(",")
      .map(value => value.trim())
      .filter(Boolean);

    if (!allowedOrigins.includes(origin)) {
      res.status(403).json({ error: "Origin not allowed." });
      return true;
    }

    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", [...allowedMethods, "OPTIONS"].join(", "));
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Max-Age", "600");
  }

  if (req.method === "OPTIONS") {
    res.setHeader("Allow", [...allowedMethods, "OPTIONS"].join(", "));
    res.status(204).end();
    return true;
  }

  return false;
}
