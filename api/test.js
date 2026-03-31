export default async function handler(req, res) {
  const apiKey = process.env.FOOTBALL_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "FOOTBALL_API_KEY not set" });
  }

  try {
    const response = await fetch("https://v3.football.api-sports.io/status", {
      headers: {
        "x-apisports-key": apiKey
      }
    });
    const data = await response.json();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
