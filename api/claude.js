export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: { message: "Method not allowed" } });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: { message: "ANTHROPIC_API_KEY not configured" } });
  }

  try {
    const body = req.body;

    const payload = {
      model: "claude-sonnet-4-20250514",
      max_tokens: body.max_tokens || 1024,
      messages: body.messages || [],
    };

    // Enable web search if requested (used for scoring to verify current facts)
    if (body.use_web_search) {
      payload.tools = [
        {
          type: "web_search_20250305",
          name: "web_search",
        }
      ];
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: { message: "Proxy error: " + err.message } });
  }
}
