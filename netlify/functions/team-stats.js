// netlify/functions/team-stats.js
const fs = require("fs");
const path = require("path");

let ALL_STATS = null;

function loadStatsOnce() {
  if (ALL_STATS) return ALL_STATS;
  const dataPath = path.join(__dirname, "..", "..", "data", "all-stats.json");
  const txt = fs.readFileSync(dataPath, "utf8");
  ALL_STATS = JSON.parse(txt);
  return ALL_STATS;
}

exports.handler = async (event) => {
  try {
    const stats = loadStatsOnce();

    const league = (event.queryStringParameters.league || "").toUpperCase();
    const team = event.queryStringParameters.team || "";

    if (!league || !team) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing league or team" })
      };
    }

    if (!stats[league] || !stats[league][team]) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: "Team not found" })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify(stats[league][team])
    };
  } catch (err) {
    console.error("team-stats error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server error" })
    };
  }
};
