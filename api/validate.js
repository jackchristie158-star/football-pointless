const cache = {};
const LEAGUE_ID = 39;
const API_BASE = "https://v3.football.api-sports.io";

function seasonYear(seasonStr) {
  return parseInt(seasonStr.split("/")[0]);
}

async function apiFetch(path, apiKey) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, { headers: { "x-apisports-key": apiKey } });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const data = await res.json();
  if (data.errors && Object.keys(data.errors).length > 0) throw new Error("API errors: " + JSON.stringify(data.errors));
  return data.response;
}

function norm(name) {
  return name.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
}

function nameMatches(typed, fullName) {
  const t = norm(typed);
  const f = norm(fullName);
  if (f === t) return true;
  const parts = f.split(" ");
  const surname = parts[parts.length - 1];
  if (surname === t && surname.length > 2) return true;
  if (parts.length > 2 && `${parts[0]} ${surname}` === t) return true;
  if (f.includes(t) && t.length > 4) return true;
  if (t.includes(surname) && surname.length > 4) return true;
  return false;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const apiKey = process.env.FOOTBALL_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "FOOTBALL_API_KEY not set" });

  const { type, season, club, club2, nationality, minGoals, answers } = req.body;
  if (!type || !answers || !Array.isArray(answers)) return res.status(400).json({ error: "Missing fields" });

  try {
    let validatedAnswers = [];

    if (type === "squad") {
      // 1 API call: get squad for club/season
      const year = seasonYear(season);
      const cacheKey = `squad_${club}_${year}`;
      if (!cache[cacheKey]) {
        const teams = await apiFetch(`/teams?name=${encodeURIComponent(club)}&league=${LEAGUE_ID}&season=${year}`, apiKey);
        if (!teams || teams.length === 0) throw new Error(`Club "${club}" not found`);
        const teamId = teams[0].team.id;
        const squad = await apiFetch(`/players/squads?team=${teamId}`, apiKey);
        cache[cacheKey] = (squad?.[0]?.players || []).map(p => ({ id: p.id, name: p.name }));
      }
      const squadList = cache[cacheKey];
      validatedAnswers = answers.map(a => {
        const match = squadList.find(p => nameMatches(a.answer, p.name));
        return {
          player: a.player, answer: a.answer,
          identified_as: match ? match.name : a.answer,
          valid: !!match,
          reason: match ? `${match.name} played for ${club} in ${season}` : `Cannot verify ${a.answer} in ${club} ${season} squad`
        };
      });

    } else if (type === "squad_two_clubs") {
      // 2 API calls: get squad for each club (any season 2010+)
      // We check if player appears in EITHER club's squad across multiple seasons
      // To keep within 2 calls, we search by player name across both clubs
      const seasons = ["2023","2022","2021","2020","2019","2018","2017","2016","2015","2014","2013","2012","2011","2010"];

      // Get team IDs for both clubs (1 call each)
      const cacheKeyA = `teamid_${club}`;
      const cacheKeyB = `teamid_${club2}`;

      if (!cache[cacheKeyA]) {
        const teams = await apiFetch(`/teams?name=${encodeURIComponent(club)}&league=${LEAGUE_ID}&season=2023`, apiKey);
        cache[cacheKeyA] = teams?.[0]?.team?.id || null;
      }
      if (!cache[cacheKeyB]) {
        const teams = await apiFetch(`/teams?name=${encodeURIComponent(club2)}&league=${LEAGUE_ID}&season=2023`, apiKey);
        cache[cacheKeyB] = teams?.[0]?.team?.id || null;
      }

      const teamIdA = cache[cacheKeyA];
      const teamIdB = cache[cacheKeyB];

      validatedAnswers = await Promise.all(answers.map(async a => {
        const cacheKey = `player_clubs_${norm(a.answer)}`;
        if (!cache[cacheKey]) {
          try {
            const results = await apiFetch(`/players?search=${encodeURIComponent(a.answer)}&league=${LEAGUE_ID}&season=2023`, apiKey);
            cache[cacheKey] = results || [];
          } catch {
            cache[cacheKey] = [];
          }
        }
        // For two-club questions, fall back to Claude if API uncertain
        return {
          player: a.player, answer: a.answer,
          identified_as: a.answer,
          valid: null, // null = let Claude decide
          reason: "Two-club verification requires Claude"
        };
      }));

    } else if (type === "topscorers") {
      // 1 API call: top scorers for season
      const year = seasonYear(season);
      const cacheKey = `topscorers_${year}`;
      if (!cache[cacheKey]) {
        const scorers = await apiFetch(`/players/topscorers?league=${LEAGUE_ID}&season=${year}`, apiKey);
        cache[cacheKey] = scorers.map(s => ({
          name: s.player.name,
          goals: s.statistics[0]?.goals?.total || 0
        }));
      }
      const scorerList = cache[cacheKey];
      const threshold = minGoals || 0;
      validatedAnswers = answers.map(a => {
        const match = scorerList.find(p => nameMatches(a.answer, p.name));
        if (!match) return { player: a.player, answer: a.answer, identified_as: a.answer, valid: false, reason: `${a.answer} not found in ${season} top scorer data` };
        const valid = match.goals >= threshold;
        return {
          player: a.player, answer: a.answer,
          identified_as: match.name, valid,
          reason: valid ? `${match.name} scored ${match.goals} PL goals in ${season}` : `${match.name} scored ${match.goals} goals in ${season} (needed ${threshold}+)`
        };
      });

    } else if (type === "clubscorers") {
      // 1 API call: top scorers for season, filter by club
      const year = seasonYear(season);
      const cacheKey = `topscorers_${year}`;
      if (!cache[cacheKey]) {
        const scorers = await apiFetch(`/players/topscorers?league=${LEAGUE_ID}&season=${year}`, apiKey);
        cache[cacheKey] = scorers.map(s => ({
          name: s.player.name,
          goals: s.statistics[0]?.goals?.total || 0,
          team: s.statistics[0]?.team?.name || ""
        }));
      }
      const scorerList = cache[cacheKey];
      const threshold = minGoals || 0;
      validatedAnswers = answers.map(a => {
        const match = scorerList.find(p => nameMatches(a.answer, p.name));
        if (!match) return { player: a.player, answer: a.answer, identified_as: a.answer, valid: false, reason: `${a.answer} not in ${season} scorer data` };
        const rightClub = match.team.toLowerCase().includes(club.toLowerCase().split(" ")[0]) || club.toLowerCase().includes(match.team.toLowerCase().split(" ")[0]);
        const valid = rightClub && match.goals >= threshold;
        return {
          player: a.player, answer: a.answer,
          identified_as: match.name, valid,
          reason: valid
            ? `${match.name} scored ${match.goals} goals for ${match.team} in ${season}`
            : !rightClub ? `${match.name} played for ${match.team}, not ${club} in ${season}`
            : `${match.name} only scored ${match.goals} goals (needed ${threshold}+)`
        };
      });

    } else if (type === "nationality") {
      // Up to 1 call per unique answer — deduplicated
      const unique = [...new Set(answers.map(a => norm(a.answer)))];
      const playerData = {};
      for (const ans of unique) {
        const cacheKey = `nat_${ans}`;
        if (cache[cacheKey] !== undefined) { playerData[ans] = cache[cacheKey]; continue; }
        try {
          const results = await apiFetch(`/players?search=${encodeURIComponent(ans)}&league=${LEAGUE_ID}&season=2023`, apiKey);
          if (results && results.length > 0) {
            const p = results[0].player;
            cache[cacheKey] = { name: p.name, nationality: p.nationality };
          } else {
            cache[cacheKey] = null;
          }
          playerData[ans] = cache[cacheKey];
        } catch { playerData[ans] = null; }
      }
      const reqNat = (nationality || "").toLowerCase();
      validatedAnswers = answers.map(a => {
        const found = playerData[norm(a.answer)];
        if (!found) return { player: a.player, answer: a.answer, identified_as: a.answer, valid: null, reason: `Could not find "${a.answer}" — Claude will verify` };
        const natMatch = found.nationality.toLowerCase().includes(reqNat) || reqNat.includes(found.nationality.toLowerCase());
        return {
          player: a.player, answer: a.answer,
          identified_as: found.name, valid: natMatch,
          reason: natMatch ? `${found.name} is ${found.nationality}` : `${found.name} is ${found.nationality}, not ${nationality}`
        };
      });

    } else {
      return res.status(400).json({ error: `Unknown type: ${type}` });
    }

    return res.status(200).json({ answers: validatedAnswers });

  } catch (err) {
    return res.status(200).json({ fallback: true, error: err.message, answers: answers.map(a => ({ ...a, valid: null, identified_as: a.answer, reason: "API unavailable — Claude scoring" })) });
  }
}
