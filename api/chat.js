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

  const HF_TOKEN = process.env.HF_TOKEN;

  if (!HF_TOKEN) {
    return res.status(500).json({ error: 'HuggingFace token not configured' });
  }

  try {
    const response = await fetch(
      "https://api-inference.huggingface.co/models/openai-community/gpt2",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${HF_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          inputs: req.body.prompt || req.body.messages?.[0]?.content || ""
        })
      }
    );

    if (!response.ok) {
      const errorData = await response.text();
      console.error(`HuggingFace API error ${response.status}:`, errorData);
      
      if (response.status === 503) {
        return res.status(503).json({ error: 'HuggingFace service temporarily unavailable' });
      } else if (response.status === 429) {
        return res.status(429).json({ error: 'Too many requests, please try again later' });
      }
      
      throw new Error(`HuggingFace API error: ${response.status} - ${errorData}`);
    }

    const data = await response.json();
    
    // Format la réponse pour être compatible avec les deux formats
    const generatedText = data[0]?.generated_text || "";
    
    res.status(200).json({
      choices: [{
        message: {
          content: generatedText
        }
      }],
      // Fallback format
      generated_text: generatedText
    });
  } catch (error) {
    console.error('Error calling HuggingFace API:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
