// netlify/functions/today-games.js
const fetch = require('node-fetch');

exports.handler = async () => {
  const today = new Date().toISOString().slice(0,10); // YYYY-MM-DD

  // Free public sports API (no key needed)
  const urls = [
    `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${today}`,
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${today}`,
    `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=${today}`
  ];

  const games = [];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      const data = await res.json();
      data.events?.forEach(e => {
        const home = e.competitions[0].competitors.find(c => c.homeAway === "home")?.team.displayName;
        const away = e.competitions[0].competitors.find(c => c.homeAway === "away")?.team.displayName;
        const time = new Date(e.date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + " ET";
        const network = e.competitions[0].broadcasts?.[0]?.names?.[0] || "TBD";
        const league = url.includes("nba") ? "NBA" : url.includes("nfl") ? "NFL" : "NHL";
        if (home && away) games.push({ league, home, away, time, network });
      });
    } catch (e) {}
  }

  return {
    statusCode: 200,
    headers: { "Cache-Control": "s-maxage=21600" }, // cache 6 hours
    body: JSON.stringify(games.slice(0, 12)) // top 12 games
  };
};