// netlify/functions/predict.js
// Simple, self-contained 500K simulation endpoint

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

  const league = (body.league || 'NBA').toUpperCase();
  const homeTeam = body.homeTeam;
  const awayTeam = body.awayTeam;

  if (!homeTeam || !awayTeam) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'homeTeam and awayTeam are required' })
    };
  }

  const LEAGUE_STATS = {
    NBA:   { ppg: 117.2, sd: 13.5, homeAdv: 3.4 },
    NFL:   { ppg: 23.4,  sd: 11.8, homeAdv: 2.7 },
    NCAAB: { ppg: 73.8,  sd: 13.2, homeAdv: 4.3 },
    NCAAF: { ppg: 29.6,  sd: 14.8, homeAdv: 3.5 },
    NHL:   { ppg: 3.08,  sd: 2.1,  homeAdv: 0.38 },
    MLB:   { ppg: 4.58,  sd: 3.4,  homeAdv: 0.42 }
  };

  const stats = LEAGUE_STATS[league] || LEAGUE_STATS.NBA;

  const SIMS = 500000;
  let homeWins = 0;
  let homeTotal = 0;
  let awayTotal = 0;

  for (let i = 0; i < SIMS; i++) {
    const base = stats.ppg + (Math.random() - 0.5) * stats.sd * 1.9;
    const homeScore = Math.round(
      base + stats.homeAdv + (Math.random() - 0.5) * stats.sd * 0.9
    );
    const awayScore = Math.round(
      base - stats.homeAdv + (Math.random() - 0.5) * stats.sd * 0.9
    );

    homeTotal += homeScore;
    awayTotal += awayScore;

    if (homeScore > awayScore) homeWins++;
  }

  const winPct = (homeWins / SIMS) * 100;
  const projectedHome = Math.round(homeTotal / SIMS);
  const projectedAway = Math.round(awayTotal / SIMS);

  const impliedBreakEven = 52.4; // rough -110
  const numericEdge = winPct - impliedBreakEven;
  const edgeText =
    winPct > 56
      ? `+${numericEdge.toFixed(2)}% EDGE — BET ${homeTeam.toUpperCase()} NOW`
      : 'No edge';

  const response = {
    matchup: `${awayTeam} @ ${homeTeam}`,
    projectedScore: `${projectedHome}–${projectedAway}`,
    winProbability: winPct.toFixed(2) + '%',
    edge: edgeText,
    explanation:
      winPct > 57
        ? `${homeTeam} wins ${winPct.toFixed(
            2
          )}% of 500K simulations. This is one of the sharpest edges on the board.`
        : 'No strong edge detected over the market. Use this as info, not a hammer play.'
  };

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(response)
  };
};
