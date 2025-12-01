// netlify/functions/predict.js
// Data-driven 500K simulation using team-level stats if available

const fs = require('fs');
const path = require('path');

const FALLBACK_LEAGUE_STATS = {
  NBA:   { ppg: 117.2, sd: 13.5, homeAdv: 3.4 },
  NFL:   { ppg: 23.4,  sd: 11.8, homeAdv: 2.7 },
  NCAAB: { ppg: 73.8,  sd: 13.2, homeAdv: 4.3 },
  NCAAF: { ppg: 29.6,  sd: 14.8, homeAdv: 3.5 },
  NHL:   { ppg: 3.08,  sd: 2.1,  homeAdv: 0.38 },
  MLB:   { ppg: 4.58,  sd: 3.4,  homeAdv: 0.42 }
};

// Try to load a per-league data file like data/nba.json
function loadLeagueData(leagueKey) {
  const filename = leagueKey.toLowerCase() + '.json';
  const filePath = path.join(__dirname, '..', '..', 'data', filename);
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to read league data for', leagueKey, e.message);
    return null;
  }
}

// Rough normal sample with mean + sd from Math.random()
function normalSample(mean, sd) {
  // Box-Muller transform
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * sd;
}

exports.handler = async (event) => {
  // Parse body
  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid JSON body' })
    };
  }

  const leagueKey = (body.league || 'NBA').toUpperCase();
  const homeTeam = body.homeTeam;
  const awayTeam = body.awayTeam;

  if (!homeTeam || !awayTeam) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'homeTeam and awayTeam are required' })
    };
  }

  // Load league data if present
  const leagueData = loadLeagueData(leagueKey);
  const fallback = FALLBACK_LEAGUE_STATS[leagueKey] || FALLBACK_LEAGUE_STATS.NBA;

  let basePpg = fallback.ppg;
  let baseSd = fallback.sd;
  let homeAdv = fallback.homeAdv;

  let expectedHome = null;
  let expectedAway = null;

  if (leagueData && leagueData.teams) {
    const teams = leagueData.teams;
    const homeStats = teams[homeTeam];
    const awayStats = teams[awayTeam];

    // Compute league averages for scaling if data present
    const teamKeys = Object.keys(teams);
    let sumOff = 0;
    let sumDef = 0;
    teamKeys.forEach(k => {
      sumOff += teams[k].offRating || 0;
      sumDef += teams[k].defRating || 0;
    });
    const leagueAvgOff = sumOff / teamKeys.length;
    const leagueAvgDef = sumDef / teamKeys.length;

    if (leagueData.avgPoints) basePpg = leagueData.avgPoints;
    if (leagueData.stdDevPoints) baseSd = leagueData.stdDevPoints;

    if (homeStats && awayStats) {
      // Off/def scaling model
      // home expected = league avg * (home off / league off) * (away def / league def)^(-1) * homeAdvFactor
      const homeOffFactor = homeStats.offRating / leagueAvgOff;
      const awayDefFactor = leagueAvgDef / awayStats.defRating;

      const awayOffFactor = awayStats.offRating / leagueAvgOff;
      const homeDefFactor = leagueAvgDef / homeStats.defRating;

      const homePace = homeStats.pace || 1;
      const awayPace = awayStats.pace || 1;
      const paceFactor = (homePace + awayPace) / (2 * 100); // normalize around 1 if pace ~100

      const homeBoost = 1.04; // ~4% more at home

      expectedHome = basePpg * homeOffFactor * awayDefFactor * paceFactor * homeBoost;
      expectedAway = basePpg * awayOffFactor * homeDefFactor * paceFactor;
    }
  }

  // If we couldn't compute team-specific expectations, fall back to generic
  if (expectedHome == null || expectedAway == null) {
    expectedHome = basePpg + homeAdv;
    expectedAway = basePpg - homeAdv;
  }

  const SIMS = 500000;
  let homeWins = 0;
  let homeTotal = 0;
  let awayTotal = 0;

  for (let i = 0; i < SIMS; i++) {
    const homeScore = Math.round(normalSample(expectedHome, baseSd));
    const awayScore = Math.round(normalSample(expectedAway, baseSd));

    homeTotal += homeScore;
    awayTotal += awayScore;

    if (homeScore > awayScore) homeWins++;
  }

  const winPct = (homeWins / SIMS) * 100;
  const projectedHome = Math.round(homeTotal / SIMS);
  const projectedAway = Math.round(awayTotal / SIMS);

  const impliedBreakEven = 52.4;
  const numericEdge = winPct - impliedBreakEven;
  const edgeText =
    winPct > 56
      ? `+${numericEdge.toFixed(2)}% EDGE — BET ${homeTeam.toUpperCase()} NOW`
      : 'No edge';

  const explanation =
    leagueData && leagueData.teams && leagueData.teams[homeTeam] && leagueData.teams[awayTeam]
      ? `${homeTeam} vs ${awayTeam} is modeled using team offensive/defensive ratings and pace, then simulated 500,000 times. ${homeTeam} wins ${winPct.toFixed(
          2
        )}% of sims, with expected score around ${projectedHome}–${projectedAway}.`
      : `${homeTeam} vs ${awayTeam} is modeled using league-average scoring with home advantage because no team-level data was found yet for this league. Fill in data/${leagueKey.toLowerCase()}.json to make this sharper.`;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      matchup: `${awayTeam} @ ${homeTeam}`,
      projectedScore: `${projectedHome}–${projectedAway}`,
      winProbability: winPct.toFixed(2) + '%',
      edge: edgeText,
      explanation
    })
  };
};
