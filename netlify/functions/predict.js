// netlify/functions/predict.js
// 5M simulation with matchup-specific strength, bet recommendation,
// and edges vs market for ML, spread, and total (if market odds provided).

const fs = require("fs");
const path = require("path");

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

// ------------ PSEUDO EXPECTED POINTS (FALLBACK) ------------
function computeExpectedPointsPseudo(leagueKey, homeTeam, awayTeam, fallback, opts) {
  let basePpg = fallback.ppg;
  let baseSd  = fallback.sd;
  const baseHomeAdv = fallback.homeAdv;

  const {
    neutralSite,
    homeMajorInjury,
    awayMajorInjury,
    homeMinorInjury,
    awayMinorInjury
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
  const homeInjuryFactor = 1 - (homeMajorInjury * 0.15 + homeMinorInjury * 0.06);
  const awayInjuryFactor = 1 - (awayMajorInjury * 0.15 + awayMinorInjury * 0.06);

  expectedHome *= homeInjuryFactor;
  expectedAway *= awayInjuryFactor;

  sdAdjust *= paceFactor > 1 ? 1.1 : 0.95;

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
  const homeMajorInjury = options.homeMajorInjury || 0; // 0–1
  const awayMajorInjury = options.awayMajorInjury || 0;
  const homeMinorInjury = options.homeMinorInjury || 0;
  const awayMinorInjury = options.awayMinorInjury || 0;

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

    for (const k of teamKeys) {
      const t = teams[k];
      if (t.offRating) { sumOff += t.offRating; countOff++; }
      if (t.defRating) { sumDef += t.defRating; countDef++; }
    }

    const leagueAvgOff = countOff ? sumOff / countOff : 110;
    const leagueAvgDef = countDef ? sumDef / countDef : 110;

    function blendedOff(t) {
      const off = t.offRating || leagueAvgOff;
      const recent = t.last10Off || off;
      return off * 0.7 + recent * 0.3;
    }
    function blendedDef(t) {
      const def = t.defRating || leagueAvgDef;
      const recent = t.last10Def || def;
      return def * 0.7 + recent * 0.3;
    }

    const homeOff = blendedOff(homeStats);
    const homeDef = blendedDef(homeStats);
    const awayOff = blendedOff(awayStats);
    const awayDef = blendedDef(awayStats);

    const homeOffFactor = homeOff / leagueAvgOff;
    const awayOffFactor = awayOff / leagueAvgOff;

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

      rawHome = rawHome * 0.6 + homeSplit * 0.4;
      rawAway = rawAway * 0.6 + awaySplit * 0.4;
    }

    rawHome += homeAdv;
    rawAway -= homeAdv;

    const homeInjuryFactor = 1 - (homeMajorInjury * 0.15 + homeMinorInjury * 0.06);
    const awayInjuryFactor = 1 - (awayMajorInjury * 0.15 + awayMinorInjury * 0.06);

    expectedHome = rawHome * homeInjuryFactor;
    expectedAway = rawAway * awayInjuryFactor;

    const spreadGuess = Math.abs(expectedHome - expectedAway);
    const spreadRatio = spreadGuess / basePpg;
    sdAdjust = 0.85 + Math.min(spreadRatio * 0.7, 0.4);
    sdAdjust *= paceFactor > 1 ? 1.1 : 0.95;
  }

  // 2) PSEUDO PATH (fallback)
  if (expectedHome == null || expectedAway == null) {
    const fallbackResult = computeExpectedPointsPseudo(leagueKey, homeTeam, awayTeam, fallback, {
      neutralSite,
      homeMajorInjury,
      awayMajorInjury,
      homeMinorInjury,
      awayMinorInjury
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

// ------------ MAIN HANDLER ------------
exports.handler = async (event) => {
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
      awayMinorInjury
    }
  );

  const SIMS = 5000000; // 5 MILLION
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

  const numericEdge = bestEdgeValue;
  const edgeText =
    numericEdge > 0.5
      ? `Best edge: +${numericEdge.toFixed(2)}% (${bestPlay})`
      : "No strong edge vs standard -110 pricing.";

  const usesRealData =
    !!(leagueData &&
      leagueData.teams &&
      leagueData.teams[homeTeam] &&
      leagueData.teams[awayTeam]);

  let explanation =
    `${homeTeam} vs ${awayTeam} was simulated 5,000,000 times using ` +
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
      awayMinorInjury
    }
  };

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(responseBody)
  };
};
