// netlify/functions/team-stats.js
// Reads from data/all-stats.json and returns stats for a given league + team.
// Includes fuzzy matching so "Carolina" can match "Carolina Panthers", etc.

const path = require("path");
const fs = require("fs");

// Load the pre-scraped stats file
const STATS_PATH = path.join(__dirname, "..", "..", "data", "all-stats.json");

let ALL_STATS = {};
try {
  const raw = fs.readFileSync(STATS_PATH, "utf-8");
  ALL_STATS = JSON.parse(raw);
} catch (err) {
  console.error("Failed to load all-stats.json:", err);
  ALL_STATS = {};
}

/**
 * Try to find team stats with flexible matching:
 * 1. Exact key match
 * 2. Case-insensitive match
 * 3. Substring match (e.g., "Carolina" ⊂ "Carolina Panthers")
 */
function findTeamStats(leagueStats, teamName) {
  if (!leagueStats || !teamName) return null;

  // 1) Direct match
  if (leagueStats[teamName]) {
    return { key: teamName, stats: leagueStats[teamName] };
  }

  const target = teamName.toLowerCase().trim();
  let bestKey = null;

  for (const key of Object.keys(leagueStats)) {
    const k = key.toLowerCase().trim();

    // 2) case-insensitive exact
    if (k === target) {
      return { key, stats: leagueStats[key] };
    }

    // 3) substring match either way
    if (k.includes(target) || target.includes(k)) {
      // keep the first reasonable match if we don't have one yet
      if (!bestKey) bestKey = key;
    }
  }

  if (bestKey) {
    return { key: bestKey, stats: leagueStats[bestKey] };
  }

  return null;
}

exports.handler = async (event) => {
  try {
    const params = event.queryStringParameters || {};
    const league = (params.league || "").toUpperCase().trim();
    const team = (params.team || "").trim();

    if (!league || !team) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing 'league' or 'team' query parameter." })
      };
    }

    const leagueStats = ALL_STATS[league];
    if (!leagueStats) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: `No stats found for league: ${league}` })
      };
    }

    const match = findTeamStats(leagueStats, team);
    if (!match) {
      console.warn(`No stats match for league=${league}, team="${team}"`);
      return {
        statusCode: 404,
        body: JSON.stringify({ error: `No stats found for team: ${team}` })
      };
    }

    const { key: matchedKey, stats } = match;

    // Ensure all expected fields exist and are numeric
    function num(val, fallback) {
      const n = Number(val);
      return Number.isFinite(n) ? n : fallback;
    }

    const response = {
      league,
      team: matchedKey, // return the full matched name (e.g., "Carolina Panthers")
      off_index:      num(stats.off_index, 1),
      def_index:      num(stats.def_index, 1),
      pace_index:     num(stats.pace_index, 1),
      sos_index:      num(stats.sos_index, 1),
      form_index:     num(stats.form_index, 1),
      ppg:            num(stats.ppg, 0),
      opp_ppg:        num(stats.opp_ppg, 0),
      home_adv_points:num(stats.home_adv_points, 0)
    };

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(response)
    };
  } catch (err) {
    console.error("team-stats error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal server error" })
    };
  }
};
