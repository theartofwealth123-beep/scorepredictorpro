// scraper.js
// Run via Netlify scheduler or manually: `node scraper.js --league=ALL` or `--league=NBA`

const fs = require("fs");
const path = require("path");
// const fetch = require("node-fetch"); // Built-in in Node 18+

const LEAGUES = {
  NBA: {
    sport: "basketball",
    league: "nba",
    file: "nba.json"
  },
  NFL: {
    sport: "football",
    league: "nfl",
    file: "nfl.json"
  },
  NHL: {
    sport: "hockey",
    league: "nhl",
    file: "nhl.json"
  },
  MLB: {
    sport: "baseball",
    league: "mlb",
    file: "mlb.json"
  },
  NCAAB: {
    sport: "basketball",
    league: "mens-college-basketball",
    file: "ncaab.json"
  },
  NCAAF: {
    sport: "football",
    league: "college-football",
    file: "ncaaf.json"
  }
};

const FALLBACK_LEAGUE_STATS = {
  NBA:   { ppg: 117.2, sd: 13.5 },
  NFL:   { ppg: 23.4,  sd: 11.8 },
  NCAAB: { ppg: 73.8,  sd: 13.2 },
  NCAAF: { ppg: 29.6,  sd: 14.8 },
  NHL:   { ppg: 3.08,  sd: 2.1 },
  MLB:   { ppg: 4.58,  sd: 3.4 }
};

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

// Helper to find a stat value by name (case-insensitive) in a stats array
function findStatValue(statsArray, possibleNames) {
  if (!statsArray || !Array.isArray(statsArray)) return null;
  const lowerNames = possibleNames.map(n => n.toLowerCase());
  
  for (const s of statsArray) {
    if (lowerNames.includes((s.name || "").toLowerCase())) {
      return Number(s.value);
    }
  }
  return null;
}

// Deep search for stats across all categories
function extractDetailedStats(statsData) {
  const result = {
    ppgFor: null,
    ppgAgainst: null, // Still hard to find in this endpoint
    pace: null,
    // Detailed stats
    fieldGoalPct: null,
    threePointPct: null,
    freeThrowPct: null,
    avgRebounds: null,
    avgAssists: null,
    avgTurnovers: null,
    avgSteals: null,
    avgBlocks: null,
    avgDefRebounds: null
  };

  const categories = statsData?.results?.stats?.categories || [];
  
  for (const cat of categories) {
    const stats = cat.stats || [];

    // Points Per Game
    if (result.ppgFor === null) {
      result.ppgFor = findStatValue(stats, ["avgPoints", "totalPointsPerGame", "ppg", "pointsPerGame"]);
    }

    // Pace (rarely found here, but checking)
    if (result.pace === null) {
      result.pace = findStatValue(stats, ["pace", "possessionsPerGame"]);
    }

    // Shooting %
    if (result.fieldGoalPct === null) result.fieldGoalPct = findStatValue(stats, ["fieldGoalPct", "fgPct"]);
    if (result.threePointPct === null) result.threePointPct = findStatValue(stats, ["threePointPct", "threePointFieldGoalPct", "3pPct"]);
    if (result.freeThrowPct === null) result.freeThrowPct = findStatValue(stats, ["freeThrowPct", "ftPct"]);

    // General / Offensive
    if (result.avgRebounds === null) result.avgRebounds = findStatValue(stats, ["avgRebounds", "totalReboundsPerGame", "reboundsPerGame"]);
    if (result.avgAssists === null) result.avgAssists = findStatValue(stats, ["avgAssists", "totalAssistsPerGame", "assistsPerGame"]);
    if (result.avgTurnovers === null) result.avgTurnovers = findStatValue(stats, ["avgTurnovers", "turnoversPerGame"]);

    // Defensive
    if (result.avgSteals === null) result.avgSteals = findStatValue(stats, ["avgSteals", "stealsPerGame"]);
    if (result.avgBlocks === null) result.avgBlocks = findStatValue(stats, ["avgBlocks", "blocksPerGame"]);
    if (result.avgDefRebounds === null) result.avgDefRebounds = findStatValue(stats, ["avgDefensiveRebounds", "defReboundsPerGame"]);
  }

  return result;
}

async function fetchStandingsData(sport, league) {
  const url = `http://site.api.espn.com/apis/v2/sports/${sport}/${league}/standings`;
  try {
    const data = await fetchJson(url);
    const map = {};
    
    // Some leagues (like NFL/NBA) have children (conferences), others might have standings directly?
    // Usually ESPN API v2 structure for standings involves children for groups.
    const groups = data.children || [data]; 
    
    const processGroup = (group) => {
      if (group.children) {
        group.children.forEach(processGroup);
        return;
      }
      const entries = group.standings?.entries || [];
      for (const entry of entries) {
        const teamId = entry.team?.id;
        if (!teamId) continue;
        
        const stats = entry.stats || [];
        const ppgFor = findStatValue(stats, ["avgPointsFor", "ppg", "pointsPerGame"]);
        const ppgAgainst = findStatValue(stats, ["avgPointsAgainst", "opp_ppg", "oppPointsPerGame"]);
        const diff = findStatValue(stats, ["differential", "pointDifferential", "avgPointDifferential"]);
        
        map[teamId] = { ppgFor, ppgAgainst, diff };
      }
    };

    groups.forEach(processGroup);
    
    return map;
  } catch (e) {
    console.warn(`Failed to fetch standings for ${league}: ${e.message}`);
    return {};
  }
}

async function buildLeagueData(leagueKey, cfg) {
  const base = `http://site.api.espn.com/apis/site/v2/sports/${cfg.sport}/${cfg.league}`;
  console.log(`\n=== Fetching teams for ${leagueKey} ===`);

  // Fetch standings for records and points against
  const standingsMap = await fetchStandingsData(cfg.sport, cfg.league);

  let allTeams;
  try {
    allTeams = await fetchJson(`${base}/teams?limit=1000`); // Ensure we get all teams
  } catch (e) {
    console.error(`Failed to fetch team list for ${leagueKey}: ${e.message}`);
    return null;
  }

  const teamsOut = {};
  const ppgValues = [];

  const teamItems = allTeams?.sports?.[0]?.leagues?.[0]?.teams || [];
  console.log(`Found ${teamItems.length} teams.`);

  for (const t of teamItems) {
    const team = t.team || t;
    const name = team.displayName || team.name;
    const teamId = team.id;
    
    if (!name || !teamId) continue;

    console.log(`  → ${name} (ID: ${teamId})`);
    
    // Construct Statistics API URL
    const statsUrl = `${base}/teams/${teamId}/statistics`;
    
    let stats = {};
    try {
      const statsData = await fetchJson(statsUrl);
      stats = extractDetailedStats(statsData);
    } catch (e) {
      console.warn(`    failed stats fetch for ${name}: ${e.message}`);
      // Fallback: try to extract from team object itself if available (unlikely for deep stats)
    }

    const standing = standingsMap[teamId] || {};
    
    // Merge stats. Prefer detailed stats if available, otherwise standings.
    // Specifically want ppgAgainst from standings.
    stats.ppgFor = stats.ppgFor || standing.ppgFor;
    stats.ppgAgainst = stats.ppgAgainst || standing.ppgAgainst;
    stats.avgDiff = standing.diff;

    if (stats.ppgFor) ppgValues.push(stats.ppgFor);

    // Calculate ratings
    // offRating: basically ppgFor, potentially adjusted by efficiency
    // defRating: since we lack ppgAllowed, we use a proxy based on defensive stats if available, or just league average placeholders.
    // We will leave calculation logic to prediction engine mostly, but store raw stats here.

    teamsOut[name] = {
      id: teamId,
      ...stats
    };
  }

  const fallback = FALLBACK_LEAGUE_STATS[leagueKey] || { ppg: 100, sd: 12 };

  const avgPoints = 
    ppgValues.length > 0 
      ? ppgValues.reduce((a, b) => a + b, 0) / ppgValues.length 
      : fallback.ppg;

  let stdDevPoints = fallback.sd;
  if (ppgValues.length > 5) {
    const mean = avgPoints;
    const variance = 
      ppgValues.reduce((sum, x) => sum + (x - mean) ** 2, 0) /
      (ppgValues.length - 1);
    stdDevPoints = Math.sqrt(variance) || stdDevPoints;
  }

  return {
    league: leagueKey,
    season: new Date().getFullYear(),
    updatedAt: new Date().toISOString(),
    avgPoints,
    stdDevPoints,
    teams: teamsOut
  };
}

async function main() {
  const argLeague = process.argv.find((a) => a.startsWith("--league="));
  const target = argLeague ? argLeague.split("=")[1].toUpperCase() : "ALL";

  const dataDir = path.join(__dirname, "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

  for (const [leagueKey, cfg] of Object.entries(LEAGUES)) {
    if (target !== "ALL" && target !== leagueKey) continue;
    try {
      const leagueData = await buildLeagueData(leagueKey, cfg);
      if (leagueData) {
        const filePath = path.join(dataDir, cfg.file);
        fs.writeFileSync(filePath, JSON.stringify(leagueData, null, 2));
        console.log(`✓ Wrote ${filePath}`);
      }
    } catch (e) {
      console.error(`✗ Failed ${leagueKey}:`, e.message);
    }
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error("Fatal scraper error:", e);
    process.exit(1);
  });
}