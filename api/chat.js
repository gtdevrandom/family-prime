import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

  if (!GOOGLE_API_KEY) {
    return res.status(500).json({ error: 'Google API key not configured' });
  }

  try {
    const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash"
    });

    const prompt = req.body.prompt || req.body.message || req.body.messages?.[0]?.content || "";

    if (!prompt) {
      return res.status(400).json({ error: 'No prompt provided' });
    }

    const result = await model.generateContent(prompt);
    const generatedText = result.response.text();

    res.status(200).json({
      choices: [{
        message: {
          content: generatedText
        }
      }],
      // Fallback format
      generated_text: generatedText,
      reply: generatedText
    });
  } catch (error) {
    console.error('Error calling Google Gemini API:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
