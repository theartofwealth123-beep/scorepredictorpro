
const fetch = require('node-fetch');

async function run() {
  const todayRaw = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const today = todayRaw.replace(/-/g, '');
  console.log(`Date: ${today}`);

  const leagues = [
    { league: 'NCAAF', url: `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${today}` },
    { league: 'NCAAB', url: `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${today}` }
  ];

  for (const { league, url } of leagues) {
    try {
      console.log(`Fetching ${league} from ${url}...`);
      const res = await fetch(url);
      if (!res.ok) {
        console.log(`Failed ${league}: ${res.status}`);
        continue;
      }
      const data = await res.json();
      const count = (data.events || []).length;
      console.log(`${league} events found: ${count}`);
      if (count > 0) {
        console.log(`Sample event: ${data.events[0].shortName}`);
      }
    } catch (e) {
      console.log(`Error ${league}:`, e.message);
    }
  }
}

run();
