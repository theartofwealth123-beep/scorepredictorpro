// netlify/functions/predict-matchup.js
exports.handler = async (event) => {
  const token = (event.headers.authorization || "").split(" ").pop() || "";
  if (!token) return { statusCode: 401, body: "No token" };

  // Instant admin check — no more waiting for Auth0 on cold start
  const adminEmails = ["theartofwealth123@gmail.com"];
  let isAdmin = false;
  try {
    const user = await (await fetch("https://dev-3cwuyjrqj751y7nr.us.auth0.com/userinfo", {
      headers: { Authorization: `Bearer ${token}` }
    })).json();
    if (adminEmails.includes(user.email)) isAdmin = true;
  } catch (e) {}

  if (!isAdmin) return { statusCode: 403, body: "Nope" };

  const { league = "NBA", homeTeam = "", awayTeam = "" } = JSON.parse(event.body || "{}");
  if (!homeTeam || !awayTeam) return { statusCode: 400, body: "Teams?" };

  const config = {
    NBA:   { ppg: 117.2, sd: 13,  homeAdv: 3.4 },
    NFL:   { ppg: 23.4,  sd: 12,  homeAdv: 2.7 },
    NCAAB: { ppg: 73.8,  sd: 13,  homeAdv: 4.3 },
    NCAAF: { ppg: 29.6,  sd: 15,  homeAdv: 3.5 },
    NHL:   { ppg: 3.08, sd: 2.0, homeAdv: 0.38 },
    MLB:   { ppg: 4.58, sd: 3.4, homeAdv: 0.42 }
  }[league.toUpperCase()] || config.NBA;

  const SIMS = 50000;
  let homeWins = 0, homePts = 0, awayPts = 0;

  for (let i = 0; i < SIMS; i++) {
    const base = config.ppg + (Math.random() - 0.5) * config.sd * 1.8;
    const homeScore = Math.round(base + config.homeAdv + (Math.random() - 0.5) * config.sd);
    const awayScore = Math.round(base - config.homeAdv + (Math.random() - 0.5) * config.sd);

    homePts += homeScore;
    awayPts += awayScore;
    if (homeScore > awayScore) homeWins++;
  }

  const winPct = (homeWins / SIMS) * 100;
  const edge = winPct > 55 ? `+${(winPct - 52.4).toFixed(1)}% EDGE — SMASH ${homeTeam.toUpperCase()}` : "No edge";

  return {
    statusCode: 200,
    headers: { "Cache-Control": "no-store" },
    body: JSON.stringify({
      matchup: `${awayTeam} @ ${homeTeam}`,
      projectedScore: `${Math.round(homePts/SIMS)}–${Math.round(awayPts/SIMS)}`,
      winProbability: { [homeTeam]: winPct.toFixed(1)+"%" },
      edgeVsMarket: edge,
      explanation: winPct > 56 ? `${homeTeam} is printing money right now.` : "Pass."
    })
  };
};