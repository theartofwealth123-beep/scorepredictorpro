const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");

// ------------------------------
// CONFIG
// ------------------------------
const leagues = {
  NFL: {
    url: "https://www.teamrankings.com/nfl/stat/offensive-efficiency",
    teamSelector: ".tr-table tbody tr",
  },
  NBA: {
    url: "https://www.teamrankings.com/nba/stat/offensive-efficiency",
    teamSelector: ".tr-table tbody tr",
  },
  MLB: {
    url: "https://www.teamrankings.com/mlb/stat/runs-per-game",
    teamSelector: ".tr-table tbody tr",
  },
  NCAAF: {
    url: "https://www.teamrankings.com/college-football/stat/offensive-efficiency",
    teamSelector: ".tr-table tbody tr",
  },
  NCAAB: {
    url: "https://www.teamrankings.com/ncaa-basketball/stat/offensive-efficiency",
    teamSelector: ".tr-table tbody tr",
  }
};

// Output files
const teamsFile = path.join(__dirname, "data/all-teams.json");
const statsFile = path.join(__dirname, "data/all-stats.json");

// Utility: clean team name
function clean(str) {
  return str.replace(/\s+/g, " ").trim();
}

// Main scrape
async function scrapeLeague(leagueKey, config) {
  console.log(`Scraping: ${leagueKey}`);

  let allTeams = [];
  let leagueStats = {};

  try {
    const res = await axios.get(config.url);
    const $ = cheerio.load(res.data);

    $(config.teamSelector).each((i, el) => {
      const tds = $(el).find("td");
      const teamName = clean($(tds[1]).text());
      if (!teamName) return;

      const off_eff = parseFloat($(tds[2]).text()) || 0;

      allTeams.push(teamName);

      leagueStats[teamName] = {
        league: leagueKey,
        team: teamName,
        off_index: off_eff,
        def_index: 1.0,
        pace_index: 1.0,
        sos_index: 1.0,
        form_index: 1.0,
        ppg: 1.0,
        opp_ppg: 1.0
      };
    });

    return { allTeams, leagueStats };
  } catch (err) {
    console.error(`FAILED scraping ${leagueKey}`, err);
    return { allTeams: [], leagueStats: {} };
  }
}

// MASTER FUNCTION
(async () => {
  console.log("---- Starting scrape ----");

  let finalTeams = {};
  let finalStats = {};

  for (const league of Object.keys(leagues)) {
    const { allTeams, leagueStats } = await scrapeLeague(league, leagues[league]);
    finalTeams[league] = allTeams;
    finalStats[league] = leagueStats;
  }

  fs.writeFileSync(teamsFile, JSON.stringify(finalTeams, null, 2));
  fs.writeFileSync(statsFile, JSON.stringify(finalStats, null, 2));

  console.log("✓ Scrape complete.");
  console.log("✓ all-teams.json and all-stats.json updated.");
})();
