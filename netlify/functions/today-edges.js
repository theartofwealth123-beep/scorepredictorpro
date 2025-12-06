// netlify/functions/today-edges.js
// Lightweight "today's best edges" generator.
// Uses ESPN scoreboard + pseudo team strength + 100K sims per game.

const fetch = require('node-fetch');

// Baseline league scoring profiles (lighter than main 5M-sim engine)
const FALLBACK_LEAGUE_STATS = {
  NBA: { ppg: 117.2, sd: 13.5, homeAdv: 3.4 },
  NFL: { ppg: 23.4, sd: 11.8, homeAdv: 2.7 },
  NHL: { ppg: 3.08, sd: 2.1, homeAdv: 0.38 }
};

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

// Pseudo team strength (offense/defense/pace) based on name hash
function getTeamStrength(teamName, leagueKey) {
  const base = hashString(leagueKey + ':' + teamName);

  const spreads =
    {
      NBA: { off: 0.12, def: 0.10, pace: 0.10 },
      NFL: { off: 0.18, def: 0.16, pace: 0.12 },
      NHL: { off: 0.10, def: 0.10, pace: 0.08 }
    }[leagueKey] || { off: 0.15, def: 0.15, pace: 0.10 };

  function centeredMultiplier(seed, spread, baseValue = 1) {
    const r = (seed % 2000) / 1000 - 1; // [-1, ~+1)
    return baseValue * (1 + r * spread);
  }

  const offSeed = base;
  const defSeed = Math.floor(base / 9973);
  const paceSeed = Math.floor(base / 31337);

  const offense = centeredMultiplier(offSeed, spreads.off);
  const defense = centeredMultiplier(defSeed, spreads.def);
  const paceRaw = centeredMultiplier(paceSeed, spreads.pace, 1);

  return {
    offense,
    defense,
    pace: paceRaw
  };
}

function computeExpectedPoints(leagueKey, homeTeam, awayTeam) {
  const fallback = FALLBACK_LEAGUE_STATS[leagueKey] || FALLBACK_LEAGUE_STATS.NBA;
  let basePpg = fallback.ppg;
  let baseSd = fallback.sd;
  const homeAdv = fallback.homeAdv;

  const homeStr = getTeamStrength(homeTeam, leagueKey);
  const awayStr = getTeamStrength(awayTeam, leagueKey);

  const defFactorHome = 1 - (homeStr.defense - 1) * 0.6;
  const defFactorAway = 1 - (awayStr.defense - 1) * 0.6;

  const paceFactor = (homeStr.pace + awayStr.pace) / 2;

  let expectedHome = basePpg * homeStr.offense * defFactorAway * paceFactor + homeAdv;
  let expectedAway = basePpg * awayStr.offense * defFactorHome * paceFactor - homeAdv;

  const nameMash = hashString(homeTeam + '|' + awayTeam + '|' + leagueKey);
  const volSeed = (nameMash % 1000) / 1000;
  const sdAdjust = 0.85 + volSeed * 0.4;

  const sd = baseSd * sdAdjust;

  const maxFactor =
    {
      NBA: 2.4,
      NFL: 2.2,
      NHL: 3.0
    }[leagueKey] || 2.2;

  const maxScore = basePpg * maxFactor;
  expectedHome = clamp(expectedHome, 0, maxScore);
  expectedAway = clamp(expectedAway, 0, maxScore);

  return { expectedHome, expectedAway, sd, basePpg };
}

async function fetchTodayGames() {
  const today = new Date().toISOString().slice(0, 10);

  const defs = [
    {
      league: 'NBA',
      url: `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${today}`
    },
    {
      league: 'NFL',
      url: `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${today}`
    },
    {
      league: 'NHL',
      url: `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=${today}`
    }
  ];

  const games = [];

  for (const { league, url } of defs) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();

      (data.events || []).forEach((e) => {
        try {
          const comp = e.competitions && e.competitions[0];
          if (!comp) return;

          const homeComp = comp.competitors.find((c) => c.homeAway === 'home');
          const awayComp = comp.competitors.find((c) => c.homeAway === 'away');

          const home = homeComp?.team?.displayName;
          const away = awayComp?.team?.displayName;

          if (!home || !away) return;

          games.push({
            league,
            homeTeam: home,
            awayTeam: away
          });
        } catch {
          // ignore malformed event
        }
      });
    } catch {
      // ignore league fetch failure
    }
  }

  return games;
}

exports.handler = async () => {
  try {
    const games = await fetchTodayGames();

    if (!games.length) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([])
      };
    }

    const SIMS = 100000; // lighter than 5M but still strong
    const impliedBreakEven = 0.524; // -110

    const results = [];

    for (const g of games.slice(0, 20)) {
      const leagueKey = g.league.toUpperCase();
      const { expectedHome, expectedAway, sd, basePpg } = computeExpectedPoints(
        leagueKey,
        g.homeTeam,
        g.awayTeam
      );

      let homeWins = 0;
      let homeTotal = 0;
      let awayTotal = 0;

      const maxScoreClamp = basePpg * 3;

      for (let i = 0; i < SIMS; i++) {
        const homeScore = Math.round(clamp(normalSample(expectedHome, sd), 0, maxScoreClamp));
        const awayScore = Math.round(clamp(normalSample(expectedAway, sd), 0, maxScoreClamp));

        homeTotal += homeScore;
        awayTotal += awayScore;

        if (homeScore > awayScore) homeWins++;
      }

      const homeWinProb = homeWins / SIMS;
      const projectedHome = Math.round(homeTotal / SIMS);
      const projectedAway = Math.round(awayTotal / SIMS);

      const edgePct = (homeWinProb - impliedBreakEven) * 100;
      let recommendedBet;
      let edgeText;

      if (edgePct > 1) {
        recommendedBet = `Moneyline lean: ${g.homeTeam} (model ${(
          homeWinProb * 100
        ).toFixed(1)}% win)`;
        edgeText = `Approx +${edgePct.toFixed(2)}% vs generic -110 break-even`;
      } else if (edgePct < -1) {
        const awayProb = 1 - homeWinProb;
        recommendedBet = `Contrarian lean: ${g.awayTeam} moneyline (model ${(
          awayProb * 100
        ).toFixed(1)}% win)`;
        edgeText = `Approx +${(-edgePct).toFixed(2)}% vs generic -110 (fade home)`;
      } else {
        recommendedBet = 'No clear edge — info only.';
        edgeText = 'Edge < ±1% vs generic -110 price.';
      }

      results.push({
        league: leagueKey,
        homeTeam: g.homeTeam,
        awayTeam: g.awayTeam,
        projectedHomeScore: projectedHome,
        projectedAwayScore: projectedAway,
        homeWinProbability: (homeWinProb * 100).toFixed(2) + '%',
        edgePct: edgePct,
        edgeText,
        recommendedBet
      });
    }

    // Sort by absolute edge, biggest first, and give top 5
    results.sort((a, b) => Math.abs(b.edgePct) - Math.abs(a.edgePct));

    const top5 = results.slice(0, 5);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 's-maxage=900'
      },
      body: JSON.stringify(top5)
    };
  } catch (err) {
    console.error('today-edges error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'today-edges failed', details: err.message })
    };
  }
};
