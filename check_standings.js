
const fetch = require("node-fetch"); // or built-in

async function checkStandings() {
  const url = "http://site.api.espn.com/apis/v2/sports/basketball/nba/standings";
  try {
    const res = await fetch(url);
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(e);
  }
}

checkStandings();
