// netlify/functions/predict.js
// 500K simulation with matchup-specific strength, bet recommendation,
// and explicit home/away scores for ALL leagues.

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

// --------- OPTIONAL REAL DATA LOADER (data/nba.json, data/nfl.json, etc.) ---------
function loadLeagueData(leagueKey) {
  const filename = leagueKey.toLowerCase() + '.json'; // nba.json, nfl.json, etc.
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

// --------- RANDOM UTILITIES (FOR SIMS + TEAM STRENGTH) ---------
function normalSample(mean, sd) {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * sd;
}

function clamp(x, min, max) {
  return Math.max(min, Math.min(max, x));
}

// simple deterministic hash so same team always gets same strength
function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0; // keep 32-bit
  }
  return Math.abs(h);
}

// Create pseudo off/def/pace multipliers per team & league.
// This makes every team different even without real stats,
// but still keeps things realistic-ish.
function getTeamStrength(teamName, leagueKey) {
  const base = hashString(leagueKey + ':' + teamName);

  const spreads = {
    NBA:   { off: 0.12, def: 0.10, pace: 0.10 },
    NFL:   { off: 0.18, def: 0.16, pace: 0.12 },
    NCAAB: { off: 0.15, def: 0.14, pace: 0.12 },
    NCAAF: { off: 0.22, def: 0.20, pace: 0.16 },
    NHL:   { off: 0.10, def: 0.10, pace: 0.08 },
    MLB:   { off: 0.18, def: 0.16, pace: 0.10 }
  }[leagueKey] || { off: 0.15, def: 0.15, pace: 0.10 };

  function centeredMultiplier(seed, spread, baseValue = 1) {
    // map seed → [-spread, +spread] around 1.0
    const r = (seed % 2000) / 1000 - 1; // [-1, +0.999]
    return baseValue * (1 + r * spread);
  }

  const offSeed  = base;
  const defSeed  = Math.floor(base / 9973);
  const paceSeed = Math.floor(base / 31337);

  const offense = centeredMultiplier(offSeed, spreads.off);     // ~[0.9, 1.1+] etc.
  const defense = centeredMultiplier(defSeed, spreads.def);     // >1 = better defense
  const paceRaw = centeredMultiplier(paceSeed, spreads.pace, 1); // around 1

  return {
    offense,
    defense,
    pace: paceRaw
  };
}

// Compute expected points for a matchup using either real data (if present)
// or fallback pseudo-ratings based on team names.
function computeExpectedPoints(leagueKey, homeTeam, awayTeam, leagueData) {
  const fallback = FALLBACK_LEAGUE_STATS[leagueKey] || FALLBACK_LEAGUE_STATS.NBA;
  let basePpg = fallback.ppg;
  let baseSd  = fallback.sd;
  const homeAdv = fallback.homeAdv;

  let expectedHome = null;
  let expectedAway = null;
  let sdAdjust = 1.0;

  // --- 1) REAL DATA PATH (if you ever fill data/<league>.json) ---
  if (leagueData && leagueData.teams) {
    const teams = leagueData.teams;
    const homeStats = teams[homeTeam];
    const awayStats = teams[awayTeam];

    if (leagueData.avgPoints) basePpg = leagueData.avgPoints;
    if (leagueData.stdDevPoints) baseSd = leagueData.stdDevPoints;

    if (homeStats && awayStats) {
      const teamKeys = Object.keys(teams);
      let sumOff = 0;
      let sumDef = 0;
      for (const k of teamKeys) {
        sumOff += teams[k].offRating || 0;
        sumDef += teams[k].defRating || 0;
      }
      const leagueAvgOff = sumOff / teamKeys.length;
      const leagueAvgDef = sumDef / teamKeys.length;

      const homeOffFactor = homeStats.offRating / leagueAvgOff;
      const awayDefFactor = leagueAvgDef / awayStats.defRating;

      const awayOffFactor = awayStats.offRating / leagueAvgOff;
      const homeDefFactor = leagueAvgDef / homeStats.defRating;

      const homePace = homeStats.pace || 100;
      const awayPace = awayStats.pace || 100;
      const paceFactor = (homePace + awayPace) / (2 * 100); // ~1

      const homeBoost = 1.04; // ~4% home scoring bump

      expectedHome = basePpg * homeOffFactor * awayDefFactor * paceFactor * homeBoost;
      expectedAway = basePpg * awayOffFactor * homeDefFactor * paceFactor;

      // add a little matchup-specific variance
      const spreadGuess = Math.abs(expectedHome - expectedAway);
      sdAdjust = 0.9 + Math.min(spreadGuess / basePpg, 0.3); // blowout-y games get more variance
    }
  }

  // --- 2) FALLBACK PSEUDO-RATING PATH (no real data yet) ---
  if (expectedHome == null || expectedAway == null) {
    const homeStr = getTeamStrength(homeTeam, leagueKey);
    const awayStr = getTeamStrength(awayTeam, leagueKey);

    // Offense drives scoring up, defense pushes opponent down.
    // Defense multiplier >1 = better defense → we shrink opp scoring a bit.
    const defFactorHome = 1 - (homeStr.defense - 1) * 0.6;
    const defFactorAway = 1 - (awayStr.defense - 1) * 0.6;

    const paceFactor = (homeStr.pace + awayStr.pace) / 2; // centered around 1

    expectedHome = basePpg * homeStr.offense * defFactorAway * paceFactor + homeAdv;
    expectedAway = basePpg * awayStr.offense * defFactorHome * paceFactor - homeAdv;

    // matchup-dependent volatility: rivalry / crazy pace can juice sd a bit
    const nameMash = hashString(homeTeam + '|' + awayTeam + '|' + leagueKey);
    const volSeed = (nameMash % 1000) / 1000; // [0,1)
    sdAdjust = 0.85 + volSeed * 0.4; // between ~0.85 and 1.25
  }

  // Final SD for this matchup
  const sd = baseSd * sdAdjust;

  // Clamp expected values to sane ranges
  const maxFactor = {
    NBA: 2.4,
    NCAAB: 2.1,
    NFL: 2.2,
    NCAAF: 2.4,
    NHL: 3.0,
    MLB: 3.0
  }[leagueKey] || 2.2;

  const maxScore = basePpg * maxFactor;
  expectedHome = clamp(expectedHome, 0, maxScore);
  expectedAway = clamp(expectedAway, 0, maxScore);

  return { expectedHome, expectedAway, sd };
}

// --------- MAIN HANDLER ---------
exports.handler = async (event) => {
  // Parse body safely
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

  const leagueData = loadLeagueData(leagueKey);
  const fallback = FALLBACK_LEAGUE_STATS[leagueKey] || FALLBACK_LEAGUE_STATS.NBA;

  const { expectedHome, expectedAway, sd } = computeExpectedPoints(
    leagueKey,
    homeTeam,
    awayTeam,
    leagueData
  );

  const SIMS = 500000;
  let homeWins = 0;
  let homeTotal = 0;
  let awayTotal = 0;

  for (let i = 0; i < SIMS; i++) {
    const rawHome = normalSample(expectedHome, sd);
    const rawAway = normalSample(expectedAway, sd);

    const maxScore = fallback.ppg * 3;
    const homeScore = Math.round(clamp(rawHome, 0, maxScore));
    const awayScore = Math.round(clamp(rawAway, 0, maxScore));

    homeTotal += homeScore;
    awayTotal += awayScore;

    if (homeScore > awayScore) homeWins++;
  }

  const winPct = (homeWins / SIMS) * 100;
  const projectedHome = Math.round(homeTotal / SIMS);
  const projectedAway = Math.round(awayTotal / SIMS);

  const impliedBreakEven = 52.4; // -110 baseline
  const numericEdge = winPct - impliedBreakEven;

  const edgeText =
    winPct > 56
      ? `+${numericEdge.toFixed(2)}% EDGE on ${homeTeam.toUpperCase()}`
      : 'No strong edge vs -110 baseline';

  // Build bet recommendation
  const spread = projectedHome - projectedAway; // home -X
  let recommendedBet;

  if (Math.abs(numericEdge) < 1) {
    recommendedBet = 'No clear edge — pass or use as lean / live-bet information.';
  } else if (numericEdge > 0) {
    // Edge on home side
    const modelSpread = spread; // home -X
    const safeSpread = Math.max(0, modelSpread - 1); // conservative ATS range
    if (modelSpread >= 0) {
      recommendedBet =
        `Bet ${homeTeam} to win (moneyline). ` +
        `Model spread: ${homeTeam} -${modelSpread.toFixed(1)}. ` +
        `Comfortable betting ${homeTeam} to cover up to -${safeSpread.toFixed(1)}.`;
    } else {
      recommendedBet =
        `Model likes ${homeTeam} long term but projection is weirdly dog-ish. ` +
        `Stick to small moneyline exposure or pass.`;
    }
  } else {
    // Edge against home → value on away
    const modelSpread = spread; // home -X
    const dogPoints = -modelSpread; // away +X
    const safeDog = Math.max(0, dogPoints - 1);
    if (dogPoints > 0) {
      recommendedBet =
        `Market likely overvalues ${homeTeam}. ` +
        `Lean to ${awayTeam} +points. Model spread: ${homeTeam} -${modelSpread.toFixed(1)}. ` +
        `Comfortable taking ${awayTeam} at +${safeDog.toFixed(1)} or better.`;
    } else {
      recommendedBet = 'No strong dog edge. Pass or treat this as informational only.';
    }
  }

  const usesRealData =
    !!(leagueData && leagueData.teams && leagueData.teams[homeTeam] && leagueData.teams[awayTeam]);

  const explanation = usesRealData
    ? `${homeTeam} vs ${awayTeam} is modeled using team offensive/defensive ratings and pace from data/${leagueKey.toLowerCase()}.json, then simulated 500,000 times. ${homeTeam} wins ${winPct.toFixed(
        2
      )}% of sims. Projected final: ${homeTeam} ${projectedHome} – ${awayTeam} ${projectedAway}.`
    : `${homeTeam} vs ${awayTeam} is modeled using league scoring averages plus team-specific strength profiles derived from their names (offense, defense, pace), then simulated 500,000 times. ${homeTeam} wins ${winPct.toFixed(
        2
      )}% of sims. Projected final: ${homeTeam} ${projectedHome} – ${awayTeam} ${projectedAway}.`;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      matchup: `${awayTeam} @ ${homeTeam}`,
      homeTeam,
      awayTeam,
      projectedHomeScore: projectedHome,
      projectedAwayScore: projectedAway,
      projectedScore: `${projectedHome}–${projectedAway}`,
      winProbability: winPct.toFixed(2) + '%',
      edge: edgeText,
      recommendedBet,
      explanation
    })
  };
};
