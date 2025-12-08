// netlify/functions/today-games.js
// Returns today's NBA, NFL, NHL, MLB, NCAAF, NCAAB games from ESPN's public scoreboard APIs.

const fetch = require('node-fetch');

exports.handler = async () => {
  // Use US Eastern date (YYYYMMDD) to ensure "today" matches the US sports schedule.
  // ESPN API expects YYYYMMDD (no hyphens).
  const todayRaw = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const today = todayRaw.replace(/-/g, '');

  const leagues = [
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

  const fetchPromises = leagues.map(async ({ league, url }) => {
    try {
      const res = await fetch(url);
      if (!res.ok) return;

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

          const startTime = new Date(e.date);
          const timeStr =
            startTime.toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              timeZone: 'America/New_York'
            }) + ' ET';

          const network =
            (comp.broadcasts &&
              comp.broadcasts[0] &&
              comp.broadcasts[0].names &&
              comp.broadcasts[0].names[0]) ||
            'TBD';

          const status = e.status?.type?.name || 'STATUS_SCHEDULED';

          games.push({
            league,
            home,
            away,
            time: timeStr,
            network,
            status,
            shortName: e.shortName || `${away} @ ${home}`,
            id: e.id
          });
        } catch {
          // ignore malformed event
        }
      });
    } catch {
      // ignore single-league fetch errors
    }
  });

  await Promise.all(fetchPromises);

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 's-maxage=600' // 10 min
    },
    body: JSON.stringify(games)
  };
};
