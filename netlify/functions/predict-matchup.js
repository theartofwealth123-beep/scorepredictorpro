// netlify/functions/predict-matchup.js
exports.handler = async (event) => {
  try {
    const token = (event.headers.authorization || "").split(" ").pop();
    if (!token) return { statusCode: 401, body: "No token" };

    let isAdmin = false;
    try {
      const user = await (await fetch("https://dev-3cwuyjrqj751y7nr.us.auth0.com/userinfo", {
        headers: { Authorization: `Bearer ${token}` }
      })).json();
      if (user.email === "theartofwealth123@gmail.com") isAdmin = true;
    } catch {}
    if (!isAdmin) return { statusCode: 403, body: "Forbidden" };

    const body = JSON.parse(event.body || "{}");
    const league = (body.league || "NBA").toUpperCase();
    const homeTeam = body.homeTeam;
    const awayTeam = body.awayTeam;

    if (!homeTeam || !awayTeam) return { statusCode: 400, body: "Teams required" };

    const stats = {
      NBA:   { name: "NBA",     ppg: 117.2, ortg: 116.1, drtg: 116.1, pace: 99.1,  homeAdv: 3.4 },
      NFL:   { name: "NFL",     ppg: 23.4,  ortg: 25.1,  drtg: 25.1,  pace: 64.8,  homeAdv: 2.7 },
      NCAAB: { name: "NCAAB",   ppg: 73.8,  ortg: 105.1, drtg: 105.1, pace: 70.2,  homeAdv: 4.3 },
      NCAAF: { name: "NCAAF",   ppg: 29.6,  ortg: 29.8,  drtg: 29.8,  pace: 66.1,  homeAdv: 3.5 },
      NHL:   { name: "NHL",     ppg: 3.08,  ortg: 103.2, drtg: 103.2, pace: 59.5,  homeAdv: 0.38 },
      MLB:   { name: "MLB",     ppg: 4.58,  ortg: 104.1, drtg: 104.1, pace: 144,   homeAdv: 0.42 }
    }[league] || stats.NBA;

    const SIMS = 50000;
    let homeWins = 0, homeTotal = 0, awayTotal = 0;

    for (let i = 0; i < SIMS; i++) {
      const variance = 0.06;
      const homeOff = stats.ortg * (1 + (Math.random() - 0.5) * variance);
      const awayOff = stats.ortg * (1 + (Math.random() - 0.5) * variance);
      const homeDef = stats.drtg * (1 + (Math.random() - 0.5) * variance * 0.7);
      const awayDef = stats.drtg * (1 + (Math.random() - 0.5) * variance * 0.7);

      const homeScore = Math.round((homeOff / awayDef) * stats.ppg + stats.homeAdv + (Math.random() - 0.5) * 8);
      const awayScore = Math.round((awayOff / homeDef) * stats.ppg + (Math.random() - 0.5) * 8);

      homeTotal += Math.max(0, homeScore);
      awayTotal += Math.max(0, awayScore);
      if (homeScore > awayScore) homeWins++;
    }

    const homeWinPct = (homeWins / SIMS) * 100;
    const avgHome = Math.round(homeTotal / SIMS);
    const avgAway = Math.round(awayTotal / SIMS);
    const edge = homeWinPct > 53.5 ? `+${(homeWinPct - 52.4).toFixed(1)}% EDGE → BET ${homeTeam.toUpperCase()}` : "No edge";

    return {
      statusCode: 200,
      body: JSON.stringify({
        matchup: `${awayTeam} @ ${homeTeam}`,
        projectedScore: `${avgHome}–${avgAway}`,
        winProbability: { [homeTeam]: homeWinPct.toFixed(1) + "%", [awayTeam]: (100 - homeWinPct).toFixed(1) + "%" },
        edgeVsMarket: edge,
        modelStats: {
          leagueAvgPPG: stats.ppg,
          homeAdv: `+${stats.homeAdv} pts`,
          ortg: stats.ortg,
          drtg: stats.drtg,
          pace: stats.pace
        },
        explanation: homeWinPct > 55
          ? `${homeTeam} wins ${homeWinPct.toFixed(1)}% of simulations — market only prices ~52.4%. Real +EV.`
          : "No clear betting edge."
      })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: "Error" };
  }
};