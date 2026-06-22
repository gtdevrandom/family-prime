import { GoogleGenerativeAI } from "@google/generative-ai";

const logger = {
  info: (msg, data) => console.log(`✅ [INFO] ${msg}`, data || ''),
  error: (msg, err) => console.error(`❌ [ERROR] ${msg}`, err || ''),
  warn: (msg, data) => console.warn(`⚠️ [WARN] ${msg}`, data || ''),
  debug: (msg, data) => console.debug(`🔍 [DEBUG] ${msg}`, data || '')
};

export default async function handler(req, res) {
  logger.info("API request received", { method: req.method, path: req.url });
  
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );
  
  if (req.method === 'OPTIONS') {
    logger.debug("CORS preflight request");
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    logger.warn("Invalid method", { method: req.method });
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

  if (!GOOGLE_API_KEY) {
    logger.error("GOOGLE_API_KEY not configured in environment");
    return res.status(500).json({ error: 'Google API key not configured - check Vercel Environment Variables' });
  }
  
  logger.debug("API key loaded", { keyLength: GOOGLE_API_KEY.length });

  try {
    const prompt = req.body.prompt || req.body.message || req.body.messages?.[0]?.content || "";

    if (!prompt) {
      logger.warn("No prompt provided in request body");
      return res.status(400).json({ error: 'No prompt provided' });
    }
    
    logger.debug("Processing prompt", { promptLength: prompt.length, bodyKeys: Object.keys(req.body) });

    logger.info("Initializing Gemini API");
    const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash"
    });

    logger.info("Calling generateContent");
    const result = await model.generateContent(prompt);
    
    if (!result || !result.response) {
      logger.error("Invalid response from Gemini");
      return res.status(500).json({ error: 'Invalid response from Gemini API' });
    }
    
    const generatedText = result.response.text();
    
    if (!generatedText) {
      logger.warn("Empty text in Gemini response");
      return res.status(500).json({ error: 'Gemini returned empty response' });
    }
    
    logger.info("Content generated successfully", { textLength: generatedText.length });

    res.status(200).json({
      choices: [{
        message: {
          content: generatedText
        }
      }],
      generated_text: generatedText,
      reply: generatedText
    });
  } catch (error) {
    logger.error('Error calling Google Gemini API', error);
    
    let statusCode = 500;
    let errorMessage = error.message || 'Internal server error';
    
    if (errorMessage.includes('API key') || errorMessage.includes('Invalid') || errorMessage.includes('authentication')) {
      statusCode = 401;
      errorMessage = 'Invalid or expired API key - check GOOGLE_API_KEY in Vercel';
      logger.error("Authentication error detected");
    } else if (errorMessage.includes('quota') || errorMessage.includes('429')) {
      statusCode = 429;
      errorMessage = 'Rate limit exceeded - wait a few minutes before retrying';
      logger.error("Rate limit exceeded");
    } else if (errorMessage.includes('INVALID_ARGUMENT')) {
      statusCode = 400;
      errorMessage = 'Invalid request to Gemini API';
      logger.error("Invalid argument error");
    } else if (errorMessage.includes('RESOURCE_EXHAUSTED')) {
      statusCode = 503;
      errorMessage = 'Gemini quota exhausted - try again later';
      logger.error("Resource exhausted");
    }
    
    logger.error(`Responding with ${statusCode}`, { errorMessage });
    res.status(statusCode).json({ error: errorMessage });
  }
}
