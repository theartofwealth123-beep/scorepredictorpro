// netlify/functions/predict.js
// 5M simulation with matchup-specific strength, bet recommendation,
// and edges vs market for ML, spread, and total (if market odds provided).

const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");

const auth0Domain = process.env.AUTH0_DOMAIN || "dev-3cwuyjrqj751y7nr.us.auth0.com";
const managementToken = process.env.AUTH0_MANAGEMENT_TOKEN;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

// ------------ LEAGUE FALLBACKS ------------
const FALLBACK_LEAGUE_STATS = {
  NBA:   { ppg: 117.2, sd: 13.5, homeAdv: 3.4 },
  NFL:   { ppg: 23.4,  sd: 11.8, homeAdv: 2.7 },
  NCAAB: { ppg: 73.8,  sd: 13.2, homeAdv: 4.3 },
  NCAAF: { ppg: 29.6,  sd: 14.8, homeAdv: 3.5 },
  NHL:   { ppg: 3.08,  sd: 2.1,  homeAdv: 0.38 },
  MLB:   { ppg: 4.58,  sd: 3.4,  homeAdv: 0.42 }
};

// ------------ LOAD LEAGUE DATA (data/nba.json, data/nfl.json, etc.) ------------
function loadLeagueData(leagueKey) {
  const filename = leagueKey.toLowerCase() + ".json";
  const filePath = path.join(__dirname, "..", "..", "data", filename);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    console.error("Failed to read league data for", leagueKey, e.message);
    return null;
  }
}

// ------------ UTILITIES ------------
function normalSample(mean, sd) {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * sd;
}

function clamp(x, min, max) {
  return Math.max(min, Math.min(max, x));
}

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

// Convert American odds to implied probability
function impliedProbFromAmerican(odds) {
  if (odds == null) return null;
  if (odds > 0) return 100 / (odds + 100);
  return -odds / (-odds + 100);
}

// Convert fair probability to American line
function fairLineFromProb(prob) {
  if (!prob || prob <= 0 || prob >= 1) return null;
  if (prob >= 0.5) {
    // favorite
    return -Math.round((prob / (1 - prob)) * 100);
  } else {
    // dog
    return Math.round(((1 - prob) / prob) * 100);
  }
}

// Pseudo team strength when we don't have real stats
function getTeamStrength(teamName, leagueKey) {
  const base = hashString(leagueKey + ":" + teamName);

  const spreads = {
    NBA:   { off: 0.12, def: 0.10, pace: 0.10 },
    NFL:   { off: 0.18, def: 0.16, pace: 0.12 },
    NCAAB: { off: 0.15, def: 0.14, pace: 0.12 },
    NCAAF: { off: 0.22, def: 0.20, pace: 0.16 },
    NHL:   { off: 0.10, def: 0.10, pace: 0.08 },
    MLB:   { off: 0.18, def: 0.16, pace: 0.10 }
  }[leagueKey] || { off: 0.15, def: 0.15, pace: 0.10 };

  function centeredMultiplier(seed, spread, baseValue = 1) {
    const r = (seed % 2000) / 1000 - 1; // [-1, ~+1)
    return baseValue * (1 + r * spread);
  }

  const offSeed  = base;
  const defSeed  = Math.floor(base / 9973);
  const paceSeed = Math.floor(base / 31337);

  const offense = centeredMultiplier(offSeed, spreads.off);
  const defense = centeredMultiplier(defSeed, spreads.def);
  const paceRaw = centeredMultiplier(paceSeed, spreads.pace, 1);

  return { offense, defense, pace: paceRaw };
}

// ------------ INJURY MODEL ------------
const POSITION_INJURY_WEIGHTS = {
  NFL: {
    QB: { major: 0.25, minor: 0.12 },
    WR: { major: 0.12, minor: 0.06 },
    TE: { major: 0.08, minor: 0.04 },
    RB: { major: 0.10, minor: 0.05 }
  },
  NBA: {
    PG: { major: 0.14, minor: 0.07 },
    SG: { major: 0.11, minor: 0.05 },
    SF: { major: 0.10, minor: 0.05 },
    PF: { major: 0.10, minor: 0.05 },
    C:  { major: 0.12, minor: 0.06 }
  }
};

function computeInjuryImpact(leagueKey, positionMap = {}, majorFlag = 0, minorFlag = 0, playerList = []) {
  const weights = POSITION_INJURY_WEIGHTS[leagueKey] || {};

  let impact = 0;
  for (const [pos, sevRaw] of Object.entries(positionMap || {})) {
    const sev = (sevRaw || "none").toLowerCase();
    const w = weights[pos];
    if (!w) continue;
    if (sev === "major") impact += w.major;
    else if (sev === "minor") impact += w.minor;
  }

  // Legacy sliders still supported for non-NBA/NFL or as overrides
  impact += majorFlag * 0.15 + minorFlag * 0.06;

  const playerCount = Array.isArray(playerList) ? playerList.length : 0;
  impact += Math.min(playerCount * 0.01, 0.05); // small bump per explicitly flagged player

  impact = clamp(impact, 0, 0.6);
  const volatility = impact * 0.6 + Math.min(playerCount * 0.005, 0.03); // higher injury burden -> wider outcomes

  return { impact, volatility };
}

// ------------ PSEUDO EXPECTED POINTS (FALLBACK) ------------
function computeExpectedPointsPseudo(leagueKey, homeTeam, awayTeam, fallback, opts) {
  let basePpg = fallback.ppg;
  let baseSd  = fallback.sd;
  const baseHomeAdv = fallback.homeAdv;

  const {
    neutralSite,
    homeMajorInjury,
    injuryHome,
    injuryAway
  } = opts;

  const homeStr = getTeamStrength(homeTeam, leagueKey);
  const awayStr = getTeamStrength(awayTeam, leagueKey);

  const defFactorHome = 1 - (homeStr.defense - 1) * 0.6;
  const defFactorAway = 1 - (awayStr.defense - 1) * 0.6;

  const paceFactor = (homeStr.pace + awayStr.pace) / 2;

  const homeAdv = neutralSite ? 0 : baseHomeAdv;

  let expectedHome = basePpg * homeStr.offense * defFactorAway * paceFactor + homeAdv;
  let expectedAway = basePpg * awayStr.offense * defFactorHome * paceFactor - homeAdv;

  const nameMash = hashString(homeTeam + "|" + awayTeam + "|" + leagueKey);
  const volSeed = (nameMash % 1000) / 1000;
  let sdAdjust = 0.85 + volSeed * 0.4;

  // Injuries: major + minor
  const homeInjuryFactor = 1 - injuryHome.impact;
  const awayInjuryFactor = 1 - injuryAway.impact;

  expectedHome *= homeInjuryFactor;
  expectedAway *= awayInjuryFactor;

  sdAdjust *= paceFactor > 1 ? 1.1 : 0.95;
  sdAdjust *= 1 + (injuryHome.volatility + injuryAway.volatility) / 2;

  return { expectedHome, expectedAway, baseSd, sdAdjust };
}

// ------------ REAL EXPECTED POINTS (REAL STATS IF AVAILABLE) ------------
function computeExpectedPoints(leagueKey, homeTeam, awayTeam, leagueData, options = {}) {
  const fallback = FALLBACK_LEAGUE_STATS[leagueKey] || FALLBACK_LEAGUE_STATS.NBA;

  // league baselines
  let basePpg = leagueData?.avgPoints || fallback.ppg;
  let baseSd  = leagueData?.stdDevPoints || fallback.sd;
  const baseHomeAdv = fallback.homeAdv;

  const neutralSite = !!options.neutralSite;

  const homeMajorInjury = options.homeMajorInjury || 0; // legacy support
  const awayMajorInjury = options.awayMajorInjury || 0;
  const homeMinorInjury = options.homeMinorInjury || 0;
  const awayMinorInjury = options.awayMinorInjury || 0;

  const injuryHome = options.injuryHome || computeInjuryImpact(leagueKey, null, homeMajorInjury, homeMinorInjury);
  const injuryAway = options.injuryAway || computeInjuryImpact(leagueKey, null, awayMajorInjury, awayMinorInjury);

  let expectedHome = null;
  let expectedAway = null;
  let sdAdjust = 1.0;

  const teams = leagueData?.teams || {};
  const homeStats = teams[homeTeam];
  const awayStats = teams[awayTeam];

  // 1) REAL DATA PATH
  if (homeStats && awayStats) {
    const teamKeys = Object.keys(teams);
    let sumOff = 0, sumDef = 0, countOff = 0, countDef = 0;
    
    // New stat accumulators for league averages
    let sumFG = 0, sum3P = 0, sumReb = 0, sumTO = 0;
    let countFG = 0, count3P = 0, countReb = 0, countTO = 0;

    for (const k of teamKeys) {
      const t = teams[k];
      // Existing ratings
      if (t.offRating) { sumOff += t.offRating; countOff++; }
      if (t.defRating) { sumDef += t.defRating; countDef++; }
      
      // New stats
      if (t.fieldGoalPct) { sumFG += t.fieldGoalPct; countFG++; }
      if (t.threePointPct) { sum3P += t.threePointPct; count3P++; }
      if (t.avgRebounds) { sumReb += t.avgRebounds; countReb++; }
      if (t.avgTurnovers) { sumTO += t.avgTurnovers; countTO++; }
    }

    const leagueAvgOff = countOff ? sumOff / countOff : 110;
    const leagueAvgDef = countDef ? sumDef / countDef : 110;
    
    const leagueAvgFG = countFG ? sumFG / countFG : 45;
    const leagueAvg3P = count3P ? sum3P / count3P : 35;
    const leagueAvgReb = countReb ? sumReb / countReb : 42;
    const leagueAvgTO = countTO ? sumTO / countTO : 14;

    function blendedOff(t) {
      const off = t.offRating || t.ppgFor || leagueAvgOff;
      const recent = t.last10Off || off;
      return off * 0.7 + recent * 0.3;
    }
    
    // Improved defensive rating using ppgAgainst if available
    function blendedDef(t) {
      const def = t.ppgAgainst || t.defRating || leagueAvgDef;
      const recent = t.last10Def || def;
      return def * 0.7 + recent * 0.3;
    }

    // Calculate advanced stat multipliers
    function getStatMultiifiers(t) {
      let mult = 1.0;
      
      // Shooting efficiency boost
      if (t.fieldGoalPct && leagueAvgFG > 0) {
        mult += (t.fieldGoalPct - leagueAvgFG) / leagueAvgFG * 0.5; // Weight 0.5
      }
      if (t.threePointPct && leagueAvg3P > 0) {
        mult += (t.threePointPct - leagueAvg3P) / leagueAvg3P * 0.2; // Weight 0.2
      }
      
      // Possession control (Rebounds and Turnovers)
      // More rebounds = slightly more possessions/second chances
      if (t.avgRebounds && leagueAvgReb > 0) {
         mult += (t.avgRebounds - leagueAvgReb) / leagueAvgReb * 0.2;
      }
      // Fewer turnovers = better
      if (t.avgTurnovers && leagueAvgTO > 0) {
         mult += (leagueAvgTO - t.avgTurnovers) / leagueAvgTO * 0.2;
      }
      
      return Math.max(0.8, Math.min(1.2, mult)); // Clamp multiplier between 0.8 and 1.2
    }

    const homeOff = blendedOff(homeStats);
    const homeDef = blendedDef(homeStats);
    const awayOff = blendedOff(awayStats);
    const awayDef = blendedDef(awayStats);
    
    // Apply advanced stat adjustments
    const homeAdvStatsFactor = getStatMultiifiers(homeStats);
    const awayAdvStatsFactor = getStatMultiifiers(awayStats);

    // Adjusted ratings
    const adjHomeOff = homeOff * homeAdvStatsFactor;
    const adjAwayOff = awayOff * awayAdvStatsFactor;

    const homeOffFactor = adjHomeOff / leagueAvgOff;
    const awayOffFactor = adjAwayOff / leagueAvgOff;

    const homeDefFactor = leagueAvgDef / homeDef;
    const awayDefFactor = leagueAvgDef / awayDef;

    const homePace = homeStats.pace || 100;
    const awayPace = awayStats.pace || 100;
    const paceFactor = (homePace + awayPace) / (2 * 100);

    const homeAdv = neutralSite ? 0 : baseHomeAdv;
    const homeBoost = neutralSite ? 1.0 : 1.04;

    let rawHome = basePpg * homeOffFactor * awayDefFactor * paceFactor * homeBoost;
    let rawAway = basePpg * awayOffFactor * homeDefFactor * paceFactor;

    const havePpg = homeStats.ppgFor && awayStats.ppgFor;
    if (havePpg) {
      const homeSplit = neutralSite
        ? (homeStats.ppgFor + (homeStats.awayPpgFor || homeStats.ppgFor)) / 2
        : homeStats.homePpgFor || homeStats.ppgFor;
      const awaySplit = neutralSite
        ? (awayStats.ppgFor + (awayStats.awayPpgFor || awayStats.ppgFor)) / 2
        : awayStats.awayPpgFor || awayStats.ppgFor;

      // Blend pure stats-based prediction with raw PPG averages
      // We give slightly more weight to the advanced model now (0.7 vs 0.3)
      rawHome = rawHome * 0.7 + homeSplit * 0.3;
      rawAway = rawAway * 0.7 + awaySplit * 0.3;
    }

    rawHome += homeAdv;
    rawAway -= homeAdv;

    const homeInjuryFactor = 1 - injuryHome.impact;
    const awayInjuryFactor = 1 - injuryAway.impact;

    expectedHome = rawHome * homeInjuryFactor;
    expectedAway = rawAway * awayInjuryFactor;

    const spreadGuess = Math.abs(expectedHome - expectedAway);
    const spreadRatio = spreadGuess / basePpg;
    sdAdjust = 0.85 + Math.min(spreadRatio * 0.7, 0.4);
    sdAdjust *= paceFactor > 1 ? 1.1 : 0.95;
    sdAdjust *= 1 + (injuryHome.volatility + injuryAway.volatility) / 2;
  }

  // 2) PSEUDO PATH (fallback)
  if (expectedHome == null || expectedAway == null) {
    const fallbackResult = computeExpectedPointsPseudo(leagueKey, homeTeam, awayTeam, fallback, {
      neutralSite,
      injuryHome,
      injuryAway
    });
    expectedHome = fallbackResult.expectedHome;
    expectedAway = fallbackResult.expectedAway;
    baseSd = fallbackResult.baseSd;
    sdAdjust = fallbackResult.sdAdjust;
  }

  const sd = baseSd * sdAdjust;

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

  return { expectedHome, expectedAway, sd, basePpg };
}

// Stub – you can wire this to a real odds API later if you want backend-only odds.
// For now we ONLY use market odds passed via body.market.
async function getMarketOddsFromAPI() {
  return null;
}

// ------------ ACCESS CONTROL (Auth0 + subscription) ------------
async function authorizeRequest(headers = {}) {
  // TEMPORARY BYPASS: Allow all requests
  return { allowed: true, user: { sub: "bypassed" }, status: "admin" };

  /*
  if (!auth0Domain) {
    return { allowed: false, code: 500, message: "Auth not configured" };
  }
  const authHeader = headers.authorization || headers.Authorization;
  const token = authHeader?.split(" ")[1];

  if (!token) {
    return { allowed: false, code: 401, message: "Login required" };
  }

  try {
    const uiRes = await fetch(`https://${auth0Domain}/userinfo`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!uiRes.ok) {
      return { allowed: false, code: 401, message: "Invalid session" };
    }
    const user = await uiRes.json();

    if (ADMIN_EMAIL && user.email === ADMIN_EMAIL) {
      return { allowed: true, user, status: "admin" };
    }

    if (!managementToken) {
      return { allowed: false, code: 403, message: "Subscription required" };
    }

    const fullRes = await fetch(
      `https://${auth0Domain}/api/v2/users/${encodeURIComponent(user.sub)}`,
      {
        headers: {
          Authorization: `Bearer ${managementToken}`,
          "Content-Type": "application/json"
        }
      }
    );

    if (!fullRes.ok) {
      return { allowed: false, code: 403, message: "Subscription required" };
    }

    const fullUser = await fullRes.json();
    const status = fullUser.app_metadata?.subStatus;
    const allowed = status === "active" || status === "trialing";

    return allowed
      ? { allowed: true, user, status }
      : { allowed: false, code: 403, message: "Subscription required" };
  } catch (err) {
    console.error("Auth check failed:", err.message);
    return { allowed: false, code: 401, message: "Authentication failed" };
  }
  */
}

// ------------ MAIN HANDLER ------------
exports.handler = async (event) => {
  const auth = await authorizeRequest(event.headers || {});
  if (!auth.allowed) {
    return {
      statusCode: auth.code || 401,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: auth.message })
    };
  }

  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Invalid JSON body" })
    };
  }

  const leagueKey = (body.league || "NBA").toUpperCase();
  const homeTeam = body.homeTeam;
  const awayTeam = body.awayTeam;

  if (!homeTeam || !awayTeam) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "homeTeam and awayTeam are required" })
    };
  }

  const neutralSite = !!body.neutralSite;

  const homeMajorInjury = body.homeMajorInjury ? 1 : 0;
  const homeMinorInjury = body.homeMinorInjury ? 1 : 0;
  const awayMajorInjury = body.awayMajorInjury ? 1 : 0;
  const awayMinorInjury = body.awayMinorInjury ? 1 : 0;

  const homePositionInjuries =
    body.homePositionInjuries && typeof body.homePositionInjuries === "object"
      ? body.homePositionInjuries
      : {};
  const awayPositionInjuries =
    body.awayPositionInjuries && typeof body.awayPositionInjuries === "object"
      ? body.awayPositionInjuries
      : {};

  const homeInjuredPlayers = Array.isArray(body.homeInjuredPlayers)
    ? body.homeInjuredPlayers
    : typeof body.homeInjuredPlayers === "string"
      ? body.homeInjuredPlayers.split(",").map(s => s.trim()).filter(Boolean)
      : [];
  const awayInjuredPlayers = Array.isArray(body.awayInjuredPlayers)
    ? body.awayInjuredPlayers
    : typeof body.awayInjuredPlayers === "string"
      ? body.awayInjuredPlayers.split(",").map(s => s.trim()).filter(Boolean)
      : [];

  const injuryHome = computeInjuryImpact(leagueKey, homePositionInjuries, homeMajorInjury, homeMinorInjury, homeInjuredPlayers);
  const injuryAway = computeInjuryImpact(leagueKey, awayPositionInjuries, awayMajorInjury, awayMinorInjury, awayInjuredPlayers);

  let market = body.market || null;
  if (!market) {
    market = await getMarketOddsFromAPI(leagueKey, homeTeam, awayTeam);
  }

  const leagueData = loadLeagueData(leagueKey);

  const { expectedHome, expectedAway, sd, basePpg } = computeExpectedPoints(
    leagueKey,
    homeTeam,
    awayTeam,
    leagueData,
    {
      neutralSite,
      homeMajorInjury,
      awayMajorInjury,
      homeMinorInjury,
      awayMinorInjury,
      injuryHome,
      injuryAway
    }
  );

  const SIMS = 500000; // 500k simulations
  let homeWins = 0;
  let homeTotal = 0;
  let awayTotal = 0;

  let homeCovers = 0;
  let awayCovers = 0;
  let pushesATS = 0;

  let overHits = 0;
  let underHits = 0;
  let pushesTotal = 0;

  const maxScoreClamp = basePpg * 3;
  const hasSpread = market && typeof market.spread === "number";
  const hasTotal = market && typeof market.total === "number";

  for (let i = 0; i < SIMS; i++) {
    const rawHome = normalSample(expectedHome, sd);
    const rawAway = normalSample(expectedAway, sd);

    const homeScore = Math.round(clamp(rawHome, 0, maxScoreClamp));
    const awayScore = Math.round(clamp(rawAway, 0, maxScoreClamp));

    homeTotal += homeScore;
    awayTotal += awayScore;

    if (homeScore > awayScore) homeWins++;

    if (hasSpread) {
      const spreadHome = market.spread; // home -X
      const margin = homeScore + spreadHome - awayScore;
      if (margin > 0) homeCovers++;
      else if (margin < 0) awayCovers++;
      else pushesATS++;
    }

    if (hasTotal) {
      const totalLine = market.total;
      const pts = homeScore + awayScore;
      if (pts > totalLine) overHits++;
      else if (pts < totalLine) underHits++;
      else pushesTotal++;
    }
  }

  const winPct = (homeWins / SIMS) * 100;
  const projectedHome = Math.round(homeTotal / SIMS);
  const projectedAway = Math.round(awayTotal / SIMS);

  const modelHomeWinProb = homeWins / SIMS;
  const modelAwayWinProb = 1 - modelHomeWinProb;

  // ---------- Calculate edges vs market ----------
  const edges = {
    moneyline: null,
    spread: null,
    total: null
  };

  // Moneyline
  if (market && market.homeMoneyline != null && market.awayMoneyline != null) {
    const mHomeImp = impliedProbFromAmerican(market.homeMoneyline);
    const mAwayImp = impliedProbFromAmerican(market.awayMoneyline);

    edges.moneyline = {
      homeMoneyline: market.homeMoneyline,
      awayMoneyline: market.awayMoneyline,
      modelHomeWinProb,
      modelAwayWinProb,
      impliedHomeProb: mHomeImp,
      impliedAwayProb: mAwayImp,
      homeEdgePct: mHomeImp != null ? (modelHomeWinProb - mHomeImp) * 100 : null,
      awayEdgePct: mAwayImp != null ? (modelAwayWinProb - mAwayImp) * 100 : null,
      homeFairLine: fairLineFromProb(modelHomeWinProb),
      awayFairLine: fairLineFromProb(modelAwayWinProb)
    };
  }

  // Spread (assume default -110 unless prices passed)
  if (hasSpread) {
    const totalSpreads = homeCovers + awayCovers + pushesATS || 1;
    const homeCoverProb = homeCovers / totalSpreads;
    const awayCoverProb = awayCovers / totalSpreads;

    const priceHome = market.spreadPriceHome ?? -110;
    const priceAway = market.spreadPriceAway ?? -110;
    const beHome = impliedProbFromAmerican(priceHome) ?? 0.524;
    const beAway = impliedProbFromAmerican(priceAway) ?? 0.524;

    edges.spread = {
      spread: market.spread, // home -X
      homeCoverProb,
      awayCoverProb,
      homeEdgePct: (homeCoverProb - beHome) * 100,
      awayEdgePct: (awayCoverProb - beAway) * 100
    };
  }

  // Total (assume -110 unless prices passed)
  if (hasTotal) {
    const totalTotals = overHits + underHits + pushesTotal || 1;
    const overProb = overHits / totalTotals;
    const underProb = underHits / totalTotals;

    const overPrice = market.overPrice ?? -110;
    const underPrice = market.underPrice ?? -110;
    const beOver = impliedProbFromAmerican(overPrice) ?? 0.524;
    const beUnder = impliedProbFromAmerican(underPrice) ?? 0.524;

    edges.total = {
      total: market.total,
      overProb,
      underProb,
      overEdgePct: (overProb - beOver) * 100,
      underEdgePct: (underProb - beUnder) * 100
    };
  }

  // ---------- Bet recommendation (picks best edge) ----------
  const impliedBreakEven = 0.524;

  let bestPlay = "No clear edge — use as info or live-bet only.";
  let bestEdgeValue = 0;

  // We'll calculate the raw lean now so we can use it as a fallback:
  const favorite = modelHomeWinProb >= 0.5 ? homeTeam : awayTeam;
  const favProb = Math.max(modelHomeWinProb, modelAwayWinProb);
  const confidence = favProb > 0.65 ? "Strong lean" : favProb > 0.55 ? "Lean" : "Slight lean";
  const rawLean = `${confidence}: ${favorite} to win (${(favProb * 100).toFixed(1)}%)`;

  // If no market odds provided, give a raw model lean
  if (!market) {
    bestPlay = rawLean;
  }

  // ML edges
  if (edges.moneyline) {
    if (edges.moneyline.homeEdgePct > bestEdgeValue) {
      bestEdgeValue = edges.moneyline.homeEdgePct;
      bestPlay =
        `Moneyline: Bet ${homeTeam} to win outright ` +
        `(model ${(modelHomeWinProb * 100).toFixed(1)}% vs implied ${(edges.moneyline.impliedHomeProb * 100).toFixed(1)}%).`;
    }
    if (edges.moneyline.awayEdgePct > bestEdgeValue) {
      bestEdgeValue = edges.moneyline.awayEdgePct;
      bestPlay =
        `Moneyline: Bet ${awayTeam} to win outright ` +
        `(model ${(modelAwayWinProb * 100).toFixed(1)}% vs implied ${(edges.moneyline.impliedAwayProb * 100).toFixed(1)}%).`;
    }
  }

  // Spread edges
  if (edges.spread) {
    if (edges.spread.homeEdgePct > bestEdgeValue) {
      bestEdgeValue = edges.spread.homeEdgePct;
      bestPlay =
        `Spread: Bet ${homeTeam} ${edges.spread.spread > 0 ? "+" : ""}${edges.spread.spread.toFixed(1)} ` +
        `(cover ${(edges.spread.homeCoverProb * 100).toFixed(1)}% vs break-even ${(impliedBreakEven * 100).toFixed(1)}%).`;
    }
    if (edges.spread.awayEdgePct > bestEdgeValue) {
      bestEdgeValue = edges.spread.awayEdgePct;
      bestPlay =
        `Spread: Bet ${awayTeam} ${edges.spread.spread > 0 ? "-" : "+"}${Math.abs(edges.spread.spread).toFixed(1)} ` +
        `(cover ${(edges.spread.awayCoverProb * 100).toFixed(1)}% vs break-even ${(impliedBreakEven * 100).toFixed(1)}%).`;
    }
  }

  // Total edges
  if (edges.total) {
    if (edges.total.overEdgePct > bestEdgeValue) {
      bestEdgeValue = edges.total.overEdgePct;
      bestPlay =
        `Total: Bet OVER ${edges.total.total.toFixed(1)} ` +
        `(model ${(edges.total.overProb * 100).toFixed(1)}% vs break-even ${(impliedBreakEven * 100).toFixed(1)}%).`;
    }
    if (edges.total.underEdgePct > bestEdgeValue) {
      bestEdgeValue = edges.total.underEdgePct;
      bestPlay =
        `Total: Bet UNDER ${edges.total.total.toFixed(1)} ` +
        `(model ${(edges.total.underProb * 100).toFixed(1)}% vs break-even ${(impliedBreakEven * 100).toFixed(1)}%).`;
    }
  }

  // FORCE PREDICTION: If we have market odds but NO strong edge found (bestEdgeValue <= 0),
  // fallback to the raw model lean so the user still gets a "prediction".
  if (market && bestEdgeValue <= 0) {
    bestPlay = `(No strong market edge) ${rawLean}`;
  }

  const numericEdge = bestEdgeValue;
  const edgeText =
    numericEdge > 0.5
      ? `Best edge: +${numericEdge.toFixed(2)}% (${bestPlay})`
      : "No strong edge vs standard pricing.";

  const usesRealData =
    !!(leagueData &&
      leagueData.teams &&
      leagueData.teams[homeTeam] &&
      leagueData.teams[awayTeam]);

  let explanation =
    `${homeTeam} vs ${awayTeam} was simulated 500,000 times using ` +
    (usesRealData
      ? "live team offensive/defensive efficiency, pace, and scoring splits from data files, "
      : "league averages plus team-strength profiles derived from their names, ") +
    `plus home/away context${neutralSite ? " (neutral site)" : ""} and injury adjustments. ` +
    `${homeTeam} wins ${winPct.toFixed(2)}% of simulations. ` +
    `Projected final score: ${homeTeam} ${projectedHome} – ${awayTeam} ${projectedAway}.`;

  if (edges.moneyline || edges.spread || edges.total) {
    explanation += "\n\nMarket comparison:";
    if (edges.moneyline) {
      explanation +=
        `\n• Moneyline: model ${homeTeam} ${(modelHomeWinProb * 100).toFixed(1)}% / ${awayTeam} ${(modelAwayWinProb * 100).toFixed(1)}% ` +
        `vs market lines ${edges.moneyline.homeMoneyline}, ${edges.moneyline.awayMoneyline}.`;
    }
    if (edges.spread) {
      explanation +=
        `\n• Spread (home ${edges.spread.spread.toFixed(1)}): ${homeTeam} cover ${(edges.spread.homeCoverProb * 100).toFixed(1)}%, ` +
        `${awayTeam} cover ${(edges.spread.awayCoverProb * 100).toFixed(1)}%.`;
    }
    if (edges.total) {
      explanation +=
        `\n• Total ${edges.total.total.toFixed(1)}: over ${(edges.total.overProb * 100).toFixed(1)}%, ` +
        `under ${(edges.total.underProb * 100).toFixed(1)}%.`;
    }
  }

  const responseBody = {
    matchup: `${awayTeam} @ ${homeTeam}`,
    homeTeam,
    awayTeam,
    projectedHomeScore: projectedHome,
    projectedAwayScore: projectedAway,
    projectedScore: `${projectedHome}–${projectedAway}`,
    winProbability: winPct.toFixed(2) + "%",
    edge: edgeText,
    recommendedBet: bestPlay,
    explanation,
    edges,
    marketUsed: !!market,
    neutralSite,
    injuries: {
      homeMajorInjury,
      homeMinorInjury,
      awayMajorInjury,
      awayMinorInjury,
      homePositionInjuries,
      awayPositionInjuries,
      homeInjuredPlayers,
      awayInjuredPlayers
    }
  };

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(responseBody)
  };
};

// Named exports for reuse in other functions (free picks, schedulers)
exports.computeExpectedPoints = computeExpectedPoints;
exports.loadLeagueData = loadLeagueData;
exports.computeInjuryImpact = computeInjuryImpact;
