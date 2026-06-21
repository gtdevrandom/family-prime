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

  const { prompt } = req.body;
  
  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  const HF_TOKEN = process.env.HF_TOKEN;

  if (!HF_TOKEN) {
    return res.status(500).json({ error: 'HuggingFace token not configured' });
  }

  try {
    const response = await fetch(
      "https://api-inference.huggingface.co/models/google/flan-t5-base",
      {
        headers: { Authorization: `Bearer ${HF_TOKEN}` },
        method: "POST",
        body: JSON.stringify({ 
          inputs: prompt,
          parameters: { max_length: 500 }
        }),
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
    res.status(200).json(data);
  } catch (error) {
    console.error('Error calling HuggingFace API:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
