// netlify/functions/game-tracker.js
const fetch = require('node-fetch');

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const league = (params.league || "").toUpperCase();
  const eventId = params.eventId;

  if (!league || !eventId) {
    return { statusCode: 400, body: "league and eventId are required" };
  }

  let base;
  if (league === "NBA") base = "basketball/nba";
  else if (league === "NFL") base = "football/nfl";
  else if (league === "NHL") base = "hockey/nhl";
  else return { statusCode: 400, body: "Unsupported league" };

  const url = `https://site.api.espn.com/apis/site/v2/sports/${base}/summary?event=${eventId}`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    const competitions = data.header?.competitions?.[0];
    const boxscore = data.boxscore || {};
    const teams = boxscore.teams || [];

    const home = teams.find(t => t.homeAway === "home");
    const away = teams.find(t => t.homeAway === "away");

    const response = {
      status: competitions?.status?.type?.shortDetail,
      venue: competitions?.venue?.fullName,
      city: competitions?.venue?.address?.city,
      homeTeam: home?.team?.displayName,
      awayTeam: away?.team?.displayName,
      homeScore: home?.score,
      awayScore: away?.score,
      statistics: boxscore?.players || [],
      // You can trim or reshape this however you want for the UI
    };

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(response)
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: "Failed to load game tracker" };
  }
};
