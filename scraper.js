// scraper.js
// Run via Netlify scheduler or manually: `node scraper.js --league=ALL` or `--league=NBA`

const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");

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

// Try to locate “per-game” style stats in a team JSON
function extractTeamStats(teamJson) {
  const statsRoot =
    teamJson.statistics ||
    teamJson.team?.statistics ||
    teamJson.team?.team?.statistics;

  if (!statsRoot || !Array.isArray(statsRoot)) return {};

  let ppgFor = null;
  let ppgAgainst = null;
  let pace = null;

  for (const block of statsRoot) {
    if (!block.categories) continue;
    for (const cat of block.categories) {
      if (!cat.stats) continue;
      for (const s of cat.stats) {
        const name = (s.name || "").toLowerCase();
        if (!name) continue;

        if (!ppgFor && (name === "ppg" || name === "pointspergame" || name === "points_pg")) {
          ppgFor = Number(s.value);
        }
        if (!ppgAgainst && (name === "opp_ppg" || name === "opp_points_pg" || name === "oppointspergame")) {
          ppgAgainst = Number(s.value);
        }
        if (!pace && (name === "pace" || name === "possessionspg")) {
          pace = Number(s.value);
        }
      }
    }
  }

  return { ppgFor, ppgAgainst, pace };
}

async function buildLeagueData(leagueKey, cfg) {
  const base = `http://site.api.espn.com/apis/site/v2/sports/${cfg.sport}/${cfg.league}`;
  console.log(`\n=== Fetching teams for ${leagueKey} ===`);

  const allTeams = await fetchJson(`${base}/teams`);
  const teamsOut = {};
  const ppgValues = [];

  const teamItems = allTeams?.sports?.[0]?.leagues?.[0]?.teams || [];
  for (const t of teamItems) {
    const team = t.team || t;
    const name = team.displayName || team.name;
    const teamUrl = team.$ref || team.href || team.links?.[0]?.href;
    if (!name || !teamUrl) continue;

    console.log(`  → ${name}`);
    let details;
    try {
      details = await fetchJson(teamUrl);
    } catch (e) {
      console.warn(`    failed team details for ${name}: ${e.message}`);
      continue;
    }

    const statObj = extractTeamStats(details) || {};
    const ppgFor = statObj.ppgFor || null;
    const ppgAgainst = statObj.ppgAgainst || null;
    const pace = statObj.pace || null;

    if (ppgFor) ppgValues.push(ppgFor);

    // crude off/def ratings from PPG if nothing else
    const offRating = ppgFor || null;
    const defRating = ppgAgainst || null;

    teamsOut[name] = {
      offRating,
      defRating,
      pace,
      ppgFor,
      ppgAgainst
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
      const filePath = path.join(dataDir, cfg.file);
      fs.writeFileSync(filePath, JSON.stringify(leagueData, null, 2));
      console.log(`✓ Wrote ${filePath}`);
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
