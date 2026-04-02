export default async function handler(req, res) {
  const apiKey = process.env.FOOTBALL_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "FOOTBALL_API_KEY not set" });

  try {
    // Test 1: Search for Raheem Sterling to see player data structure
    const playerRes = await fetch(
      "https://v3.football.api-sports.io/players?search=Sterling&league=39&season=2023",
      { headers: { "x-apisports-key": apiKey } }
    );
    const playerData = await playerRes.json();

    // Test 2: Get Premier League teams to see club data structure  
    const teamsRes = await fetch(
      "https://v3.football.api-sports.io/teams?league=39&season=2023",
      { headers: { "x-apisports-key": apiKey } }
    );
    const teamsData = await teamsRes.json();

    return res.status(200).json({
      player_example: playerData.response?.[0] || playerData,
      teams_count: teamsData.results,
      requests_used: playerData.paging
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
