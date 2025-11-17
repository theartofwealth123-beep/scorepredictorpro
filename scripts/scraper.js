// scripts/scraper.js
// Node 20-compatible scraper for TeamRankings stat pages
// Single stat page per league -> we derive both team list + stats from it.

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");

//
// ---- LEAGUE CONFIG ----
// Using more reliable stat pages.
// NFL + NCAAF now use POINTS PER GAME instead of offensive-efficiency.
//
const LEAGUES = {
  NFL: {
    statsUrl: "https://www.teamrankings.com/nfl/stat/points-per-game",
    basePpg: 22  // typical avg points per team
  },
  NBA: {
    statsUrl: "https://www.teamrankings.com/nba/stat/offensive-efficiency",
    basePpg: 114
  },
  MLB: {
    statsUrl: "https://www.teamrankings.com/mlb/stat/runs-per-game",
    basePpg: 4.5
  },
  NCAAF: {
    statsUrl: "https://www.teamrankings.com/college-football/stat/points-per-game",
    basePpg: 29
  },
  NCAAB: {
    statsUrl: "https://www.teamrankings.com/ncaa-basketball/stat/offensive-efficiency",
    basePpg: 71
  }
};

//
// ---- UTILS ----
//

async function fetchHtml(url) {
  console.log(`   🌐 GET ${url}`);
  const res = await axios.get(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    },
    timeout: 30000
  });
  if (res.status !== 200) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.data;
}

/**
 * Parse a TeamRankings stat table.
 * We look for a table whose header row contains "Team" and at least
 * one numeric column; we use that numeric column as "value".
 */
function parseTeamRankingsStatTable(html, leagueKey, basePpg) {
  const $ = cheerio.load(html);

  let bestStats = {};
  let bestCount = 0;

  $("table").each((_, table) => {
    const $table = $(table);

    // grab header cells
    const headers = [];
    $table.find("thead tr th").each((i, th) => {
      headers.push($(th).text().trim());
    });

    // find team column
    const teamColIdx = headers.findIndex((h) =>
      h.toLowerCase().includes("team")
    );
    if (teamColIdx === -1) return;

    // find a likely numeric stat column
    let valueColIdx = -1;
    headers.forEach((h, idx) => {
      const lower = h.toLowerCase();
      if (
        lower.includes("offensive efficiency") ||
        lower.includes("points per game") ||
        lower.includes("runs per game") ||
        lower.includes("pts/g") ||
        lower.includes("off")
      ) {
        valueColIdx = idx;
      }
    });

    // if we didn't find a clear numeric column, pick the last column
    if (valueColIdx === -1 && headers.length >= 3) {
      valueColIdx = headers.length - 1;
    }
    if (valueColIdx === -1) return;

    const stats = {};
    let rowCount = 0;

    $table.find("tbody tr").each((__, row) => {
      const cells = $(row).find("td");
      if (cells.length <= Math.max(teamColIdx, valueColIdx)) return;

      const rawTeam = $(cells[teamColIdx]).text().trim();
      const rawVal = $(cells[valueColIdx]).text().trim();
      if (!rawTeam) return;

      const val = parseFloat(rawVal.replace(/[^0-9.\-]/g, ""));
      if (isNaN(val)) return;

      // basic normalization:
      // - NFL/NCAAF/MLB using PPG/RPG, val is already "points per game"
      // - NBA/NCAAB offensive efficiency is points per 100 poss; convert
      let ppg = val;
      if (["NBA", "NCAAB"].includes(leagueKey)) {
        // approximate: points per 100 poss -> divide by ~1.0 (no strong correction)
        // you can tweak later if you want to convert to per-game more precisely.
        ppg = (val / 100) * basePpg || basePpg;
      }

      stats[rawTeam] = {
        off_index: val,   // use the stat as the offense index
        def_index: 1.0,   // neutral placeholders; frontend still uses these
        pace_index: 1.0,
        sos_index: 1.0,
        form_index: 1.0,
        ppg: ppg,
        opp_ppg: basePpg  // neutral opponent scoring baseline
      };
      rowCount++;
    });

    if (rowCount > bestCount) {
      bestStats = stats;
      bestCount = rowCount;
    }
  });

  if (!bestCount) {
    throw new Error(`No valid stat table found for ${leagueKey}`);
  }

  console.log(`   📊 Parsed ${bestCount} teams for ${leagueKey}`);
  return bestStats;
}

//
// ---- MAIN SCRAPER ----
//
(async () => {
  console.log("🟦 SCRAPER STARTED");

  const allTeams = {};
  const allStats = {};

  for (const [leagueKey, cfg] of Object.entries(LEAGUES)) {
    try {
      console.log(`\n➡️ Scraping ${leagueKey}…`);

      const html = await fetchHtml(cfg.statsUrl);
      const statsObj = parseTeamRankingsStatTable(html, leagueKey, cfg.basePpg);

      // team list is just the keys of the stats object
      const teamNames = Object.keys(statsObj).sort((a, b) =>
        a.localeCompare(b)
      );

      allTeams[leagueKey] = teamNames;
      allStats[leagueKey] = statsObj;

      console.log(`✔ ${leagueKey}: ${teamNames.length} teams scraped`);
    } catch (err) {
      console.error(`❌ Error scraping ${leagueKey}:`, err.message);
      allTeams[leagueKey] = allTeams[leagueKey] || [];
      allStats[leagueKey] = allStats[leagueKey] || {};
    }
  }

  // ensure data dir
  const dataDir = path.join(__dirname, "..", "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const teamsPath = path.join(dataDir, "all-teams.json");
  const statsPath = path.join(dataDir, "all-stats.json");

  fs.writeFileSync(teamsPath, JSON.stringify(allTeams, null, 2));
  fs.writeFileSync(statsPath, JSON.stringify(allStats, null, 2));

  console.log("\n✅ Scrape complete. Files updated:");
  console.log("   " + teamsPath);
  console.log("   " + statsPath);
})();
