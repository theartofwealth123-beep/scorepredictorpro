// netlify/functions/today-games.js
// Returns today's NBA, NFL, NHL games from ESPN's public scoreboard APIs.

const fetch = require('node-fetch');

exports.handler = async () => {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const urls = [
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

  for (const { league, url } of urls) {
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

          const time = new Date(e.date).toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit'
          }) + ' ET';

          const network =
            (comp.broadcasts &&
              comp.broadcasts[0] &&
              comp.broadcasts[0].names &&
              comp.broadcasts[0].names[0]) ||
            'TBD';

          games.push({
            league,
            home,
            away,
            time,
            network
          });
        } catch {
          // ignore malformed events
        }
      });
    } catch {
      // ignore fetch errors for a given league
    }
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 's-maxage=900' // cache on edge for 15 minutes
    },
    body: JSON.stringify(games.slice(0, 50)) // cap list just in case
  };
};
