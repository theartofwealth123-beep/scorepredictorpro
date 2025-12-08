// netlify/functions/today-edges.js
// Lightweight "today's best edges" generator.
// Now aligned with the main calculator's advanced model for consistency.

const fetch = require('node-fetch');
const { computeExpectedPoints, loadLeagueData } = require('./predict');

function normalSample(mean, sd) {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * sd;
}

function clamp(x, min, max) {
  return Math.max(min, Math.min(max, x));
}

async function fetchTodayGames() {
  const todayRaw = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const today = todayRaw.replace(/-/g, '');

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
    },
    {
      league: 'MLB',
      url: `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=${today}`
    },
    {
      league: 'NCAAF',
      url: `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${today}`
    },
    {
      league: 'NCAAB',
      url: `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${today}`
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

    const SIMS = 5000; // 5k sims per game = fast edge finding (100k total for 20 games)
    const impliedBreakEven = 0.524; // -110

    const results = [];

    // Limit to 20 games to ensure we don't timeout
    for (const g of games.slice(0, 20)) {
      const leagueKey = g.league.toUpperCase();
      const leagueData = loadLeagueData(leagueKey);
      const { expectedHome, expectedAway, sd, basePpg } = computeExpectedPoints(
        leagueKey,
        g.homeTeam,
        g.awayTeam,
        leagueData,
        {
          neutralSite: false,
          injuryHome: { impact: 0, volatility: 0 },
          injuryAway: { impact: 0, volatility: 0 }
        }
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
