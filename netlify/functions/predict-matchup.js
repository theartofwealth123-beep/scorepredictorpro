// netlify/functions/predict-matchup.js
const jstat = require('jstat');

// Load stats (will be auto-updated by your scheduler later)
let stats = {};
try { stats = require('../../data/all-stats.json'); } catch(e) {}
let teams = {};
try { teams = require('../../data/all-teams.json'); } catch(e) {}

const SIMULATIONS = 50000;
const SD = { NBA: 11.4, NFL: 13.8, MLB: 3.1, NCAAB: 12.1, NCAAF: 15.2, NHL: 6.8 };

exports.handler = async (event) => {
  // === AUTH: Get user from token (works with Auth0 + Netlify) ===
  const token = event.headers.authorization?.split(' ')[1];
  if (!token) {
    return { statusCode: 401, body: JSON.stringify({ error: "Login required" }) };
  }

  let subStatus = "free";
  try {
    const userRes = await fetch("https://dev-3cwuyjrqj751y7nr.us.auth0.com/userinfo", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (userRes.ok) {
      const user = await userRes.json();
      if (user.email === "theartofwealth123@gmail.com") {
        subStatus = "active"; // YOU = ADMIN FOREVER
      }
    }
  } catch (e) {
    console.log("Token check failed:", e);
  }

  if (subStatus !== "active") {
    return {
      statusCode: 403,
      body: JSON.stringify({ error: "Upgrade required for predictions" })
    };
  }

  // === Parse request ===
  let body;
  try { body = JSON.parse(event.body); } catch(e) { body = {}; }
  const { league = "NBA", homeTeam, awayTeam } = body;

  if (!homeTeam || !awayTeam) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing teams" }) };
  }

  const h = stats[league]?.[homeTeam];
  const a = stats[league]?.[awayTeam];

  if (!h || !a) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: "Team not found", league })
    };
  }

  // === Monte Carlo Simulation ===
  let homeExp = (h.off_rtg || 110) + 3; // home advantage
  let awayExp = (a.off_rtg || 110);

  let homeWins = 0;
  const sd = SD[league] || 11.4;

  for (let i = 0; i < SIMULATIONS; i