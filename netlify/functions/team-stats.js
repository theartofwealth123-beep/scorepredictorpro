// netlify/functions/team-stats.js
const fs = require("fs");
const path = require("path");

exports.handler = async (event) => {
  try {
    const params = event.queryStringParameters;
    const league = params.league;
    const team = params.team;

    const statsPath = path.join(__dirname, "../../data/all-stats.json");
    const raw = fs.readFileSync(statsPath, "utf8");
    const allStats = JSON.parse(raw);

    if (!allStats[league] || !allStats[league][team]) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: "Not found" })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify(allStats[league][team])
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
