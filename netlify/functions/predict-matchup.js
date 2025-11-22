// netlify/functions/predict-matchup.js
const jstat = require('jstat');
let stats = require('../../data/all-stats.json'); // Auto-updates every 12h
let teams = require('../../data/all-teams.json');

const SIMULATIONS = 50000;

// League-specific standard deviations (real 2024–2025 data)
const SD = {
  NBA: 11.4,
  NFL: 13.8,
  MLB: 3.1,    // runs per game
  NCAAB: 12.1,
  NCAAF: 15.2
};

exports.handler = async (event, context) => {
  // === PAYWALL: Only active or trialing users ===
  const user = context.clientContext?.identity?.user;
  if (!user) return { statusCode: 401, body: JSON.stringify({ error: "Login required" }) };

  const subStatus = user.app_metadata?.subStatus || "free";
  if (!["active", "trialing"].includes(subStatus)) {
    return {
      statusCode: 403,
      body: JSON.stringify({ error: "Upgrade for predictions → $9.99/mo after 3-day trial" })
    };
  }

  // === Parse request ===
  const { league = "NBA", homeTeam, awayTeam } = JSON.parse(event.body);
  if (!homeTeam || !awayTeam) return { statusCode: 400, body: JSON.stringify({ error: "Missing teams" }) };

  const h = stats[league]?.[homeTeam];
  const a = stats[league]?.[awayTeam];

  if (!h || !a) {
    return {
      statusCode: 404,
      body: JSON.stringify({
        error: "Team not found. Try exact name (e.g. 'Los Angeles Lakers')",
        suggestions: Object.keys(stats[league] || {}).slice(0, 10)
      })
    };
  }

  // === Core Monte Carlo with 2025 adjustments ===
  let homeExp = (h.off_rtg + a.def_rtg) / 2 + (h.home_off_boost || 3.0);
  let awayExp = (a.off_rtg + h.def_rtg) / 2 - (h.home_off_boost || 3.0); // home advantage hurts away

  // Injuries, rest, travel
  const injuryPenalty = (team) => (team.injuries?.length || 0) * -3.2;
  homeExp += injuryPenalty(h) + (h.rest_days - a.rest_days) * 1.6;
  awayExp += injuryPenalty(a) + (a.rest_days - h.rest_days) * 1.6;

  // Market blend (closing line as prior)
  if (h.closing_line_avg_spread) {
    const marketHome = homeExp + h.closing_line_avg_spread;
    homeExp = (homeExp * 0.6) + (marketHome * 0.4);
    awayExp = homeExp - h.closing_line_avg_spread;
  }

  // === Run 50,000 simulations with correlated error ===
  let homeWins = 0;
  const homeScores = [], awayScores = [];

  const sd = SD[league] || 11.4;

  for (let i = 0; i < SIMULATIONS; i++) {
    const sharedNoise = jstat.normal.sample(0, sd * 0.65);  // pace/tempo correlation
    const homeNoise = jstat.normal.sample(0, sd * 0.75);
    const awayNoise = jstat.normal.sample(0, sd * 0.75);

    let hScore = Math.round(homeExp + sharedNoise + homeNoise);
    let aScore = Math.round(awayExp + sharedNoise + awayNoise);

    // Sport-specific floors
    if (league.includes("MLB")) { hScore = Math.max(0, hScore); aScore = Math.max(0, aScore); }
    if (league.includes("NFL") || league.includes("NCAAF")) { hScore = Math.max(0, hScore); aScore = Math.max(0, aScore); }

    homeScores.push(hScore);
    awayScores.push(aScore);
    if (hScore > aScore) homeWins++;
  }

  const homeWinPct = (homeWins / SIMULATIONS) * 100;
  const edge = h.closing_line_avg_spread
    ? homeWinPct - (50 + h.closing_line_avg_spread * 2.1)
    : 0;

  const result = {
    matchup: `${awayTeam} @ ${homeTeam}`,
    league,
    projectedScore: `${Math.round(homeExp)} – ${Math.round(awayExp)}`,
    winProbability: {
      [homeTeam]: homeWinPct.toFixed(1) + "%",
      [awayTeam]: (100 - homeWinPct).toFixed(1) + "%"
    },
    medianScore: `${jstat.median(homeScores)} – ${jstat.median(awayScores)}`,
    edgeVsMarket: edge > 0 ? `+${edge.toFixed(1)}% EDGE → BET ${homeTeam}` : `${edge.toFixed(1)}% → No bet`,
    simulations: SIMULATIONS,
    timestamp: new Date().toISOString()
  };

  // === AUTO-POST TO X IF EDGE > 6% ===
  if (edge > 6 && process.env.TWITTER_API_KEY) {
    try {
      await fetch('/.netlify/functions/autopost-pick', {
        method: 'POST',
        body: JSON.stringify({
          league,
          prediction: result.matchup,
          projectedScore: result.projectedScore,
          winProbability: result.winProbability[homeTeam],
          edge: edge.toFixed(1)
        })
      });
    } catch (e) { console.log("X post failed", e); }
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(result)
  };
};