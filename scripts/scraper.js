// scripts/scraper.js
// Real multi-metric scraper for TeamRankings with advanced indices
// Works with Node 16+ using axios + cheerio.
// Output:
//   data/all-teams.json
//   data/all-stats.json

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");

const DATA_DIR = path.join(__dirname, "..", "data");
const ALL_TEAMS_PATH = path.join(DATA_DIR, "all-teams.json");
const ALL_STATS_PATH = path.join(DATA_DIR, "all-stats.json");

// Make sure data/ exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// --- League + metric URLs ---
// These are standard TeamRankings stat pages. If one ever 404s,
// tweak just that URL.
const LEAGUE_CONFIG = {
  NFL: {
    metrics: {
      offEff: "https://www.teamrankings.com/nfl/stat/offensive-efficiency",
      defEff: "https://www.teamrankings.com/nfl/stat/defensive-efficiency",
      pace:  "https://www.teamrankings.com/nfl/stat/plays-per-game",
      ppg:   "https://www.teamrankings.com/nfl/stat/points-per-game",
      oppPpg:"https://www.teamrankings.com/nfl/stat/opponent-points-per-game",
      sos:   "https://www.teamrankings.com/nfl/stat/schedule-strength"
    },
    primaryMetric: "offEff"
  },
  NBA: {
    metrics: {
      offEff: "https://www.teamrankings.com/nba/stat/offensive-efficiency",
      defEff: "https://www.teamrankings.com/nba/stat/defensive-efficiency",
      pace:  "https://www.teamrankings.com/nba/stat/possessions-per-game",
      ppg:   "https://www.teamrankings.com/nba/stat/points-per-game",
      oppPpg:"https://www.teamrankings.com/nba/stat/opponent-points-per-game",
      sos:   "https://www.teamrankings.com/nba/stat/schedule-strength"
    },
    primaryMetric: "offEff"
  },
  MLB: {
    metrics: {
      // Baseball is more about runs than "efficiency"
      offEff: "https://www.teamrankings.com/mlb/stat/runs-per-game",
      defEff: "https://www.teamrankings.com/mlb/stat/opponent-runs-per-game",
      pace:  "https://www.teamrankings.com/mlb/stat/at-bats-per-game",
      ppg:   "https://www.teamrankings.com/mlb/stat/runs-per-game",
      oppPpg:"https://www.teamrankings.com/mlb/stat/opponent-runs-per-game",
      sos:   "https://www.teamrankings.com/mlb/stat/schedule-strength"
    },
    primaryMetric: "offEff"
  },
  NCAAF: {
    metrics: {
      offEff: "https://www.teamrankings.com/college-football/stat/offensive-efficiency",
      defEff: "https://www.teamrankings.com/college-football/stat/defensive-efficiency",
      pace:  "https://www.teamrankings.com/college-football/stat/plays-per-game",
      ppg:   "https://www.teamrankings.com/college-football/stat/points-per-game",
      oppPpg:"https://www.teamrankings.com/college-football/stat/opponent-points-per-game",
      sos:   "https://www.teamrankings.com/college-football/stat/schedule-strength"
    },
    primaryMetric: "offEff"
  },
  NCAAB: {
    metrics: {
      offEff: "https://www.teamrankings.com/ncaa-basketball/stat/offensive-efficiency",
      defEff: "https://www.teamrankings.com/ncaa-basketball/stat/defensive-efficiency",
      pace:  "https://www.teamrankings.com/ncaa-basketball/stat/possessions-per-game",
      ppg:   "https://www.teamrankings.com/ncaa-basketball/stat/points-per-game",
      oppPpg:"https://www.teamrankings.com/ncaa-basketball/stat/opponent-points-per-game",
      sos:   "https://www.teamrankings.com/ncaa-basketball/stat/schedule-strength"
    },
    primaryMetric: "offEff"
  }
};

// --- HTTP helper ---
async function fetchHtml(url) {
  console.log("   ↳ GET", url);
  const res = await axios.get(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml"
    },
    timeout: 30000
  });
  return res.data;
}

// --- Generic table scraper ---
// For a given TeamRankings stat page, grab team name from first <a> in each row
// and the LAST numeric value in that row as the metric value.
function scrapeMetricFromHtml(html) {
  const $ = cheerio.load(html);
  const stats = {};

  let foundAny = false;

  $("table").each((ti, table) => {
    $(table)
      .find("tbody tr")
      .each((i, row) => {
        const $row = $(row);
        const tds = $row.find("td");
        if (!tds.length) return;

        const link = $row.find("a").first();
        const teamName = link.text().trim();
        if (!teamName) return;

        let value = NaN;
        tds.each((ci, cell) => {
          const txt = $(cell).text().trim().replace(/,/g, "");
          const num = parseFloat(txt);
          if (!Number.isNaN(num)) {
            value = num;
          }
        });

        if (!Number.isNaN(value)) {
          stats[teamName] = value;
          foundAny = true;
        }
      });

    if (foundAny) {
      // we found a valid table; stop scanning other tables
      return false;
    }
  });

  return stats;
}

// --- Normalization helpers ---
// Map raw metric values to an index range [minTarget, maxTarget]
// so the prediction model doesn't explode.
function buildIndex(rawMap, { minTarget = 0.9, maxTarget = 1.1, invert = false } = {}) {
  const entries = Object.entries(rawMap).filter(([, v]) => Number.isFinite(v));
  if (!entries.length) return {};

  const values = entries.map(([, v]) => v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const result = {};
  for (const [team, raw] of entries) {
    // normalized in [0,1]
    let t = (raw - min) / range;
    if (invert) {
      // lower raw is better -> higher index
      t = 1 - t;
    }
    const idx = minTarget + (maxTarget - minTarget) * t;
    result[team] = idx;
  }
  return result;
}

// Compute simple league averages for fallback PPG/oppPPG
function averageOfMap(rawMap) {
  const vals = Object.values(rawMap).filter((v) => Number.isFinite(v));
  if (!vals.length) return 0;
  const sum = vals.reduce((a, b) => a + b, 0);
  return sum / vals.length;
}

// --- Per-league scraper ---
async function scrapeLeague(leagueKey, cfg) {
  console.log(`\n🟦 Scraping ${leagueKey}…`);

  const metricMaps = {}; // e.g. metricMaps.offEff = { team: value }

  // 1) Scrape every metric page for this league
  for (const [metricName, url] of Object.entries(cfg.metrics)) {
    try {
      const html = await fetchHtml(url);
      const map = scrapeMetricFromHtml(html);
      const count = Object.keys(map).length;
      console.log(`   ✔ ${metricName}: ${count} teams`);
      metricMaps[metricName] = map;
    } catch (err) {
      console.error(`   ❌ Failed metric ${metricName} for ${leagueKey}:`, err.message);
      metricMaps[metricName] = {};
    }
  }

  // 2) Build set of all teams that appear anywhere
  const teamSet = new Set();
  for (const map of Object.values(metricMaps)) {
    for (const team of Object.keys(map)) {
      teamSet.add(team);
    }
  }

  const teams = Array.from(teamSet).sort();
  console.log(`   ➜ Total teams detected for ${leagueKey}: ${teams.length}`);

  // 3) Build indices

  const offRaw = metricMaps.offEff || {};
  const defRaw = metricMaps.defEff || {};
  const paceRaw = metricMaps.pace || {};
  const ppgRaw = metricMaps.ppg || {};
  const oppRaw = metricMaps.oppPpg || {};
  const sosRaw = metricMaps.sos || {};

  const leaguePpgAvg = averageOfMap(ppgRaw);
  const leagueOppAvg = averageOfMap(oppRaw);

  const offIndexMap = buildIndex(offRaw, { minTarget: 0.9, maxTarget: 1.1, invert: false });

  // Defensive: lower is better -> invert=true
  const defIndexMap =
    Object.keys(defRaw).length > 0
      ? buildIndex(defRaw, { minTarget: 0.9, maxTarget: 1.1, invert: true })
      : {};

  // Pace: keep range tight, doesn't need huge impact
  const paceIndexMap =
    Object.keys(paceRaw).length > 0
      ? buildIndex(paceRaw, { minTarget: 0.95, maxTarget: 1.05, invert: false })
      : {};

  // Strength of schedule: higher schedule strength → harder → index slightly > 1
  const sosIndexMap =
    Object.keys(sosRaw).length > 0
      ? buildIndex(sosRaw, { minTarget: 0.95, maxTarget: 1.05, invert: false })
      : {};

  // Form index: based on scoring margin (PPG - Opp PPG)
  const formRaw = {};
  for (const team of teamSet) {
    const pf = ppgRaw[team];
    const pa = oppRaw[team];
    if (Number.isFinite(pf) && Number.isFinite(pa)) {
      formRaw[team] = pf - pa;
    }
  }
  const formIndexMap =
    Object.keys(formRaw).length > 0
      ? buildIndex(formRaw, { minTarget: 0.9, maxTarget: 1.1, invert: false })
      : {};

  // 4) Build final per-team objects
  const leagueStats = {};

  for (const team of teamSet) {
    const ppg = Number.isFinite(ppgRaw[team]) ? ppgRaw[team] : leaguePpgAvg;
    const opp_ppg = Number.isFinite(oppRaw[team]) ? oppRaw[team] : leagueOppAvg;

    leagueStats[team] = {
      league: leagueKey,
      team,

      // indices
      off_index: offIndexMap[team] || 1.0,
      def_index: defIndexMap[team] || 1.0,
      pace_index: paceIndexMap[team] || 1.0,
      sos_index: sosIndexMap[team] || 1.0,
      form_index: formIndexMap[team] || 1.0,

      // real scoring numbers
      ppg: Number.isFinite(ppg) ? ppg : 0,
      opp_ppg: Number.isFinite(opp_ppg) ? opp_ppg : 0
    };
  }

  return { teams, stats: leagueStats };
}

// --- MAIN ---
(async () => {
  console.log("🚀 ADVANCED SCRAPER STARTED");

  const allTeams = {};
  const allStats = {};

  try {
    for (const [leagueKey, cfg] of Object.entries(LEAGUE_CONFIG)) {
      const { teams, stats } = await scrapeLeague(leagueKey, cfg);
      allTeams[leagueKey] = teams;
      allStats[leagueKey] = stats;
    }

    fs.writeFileSync(ALL_TEAMS_PATH, JSON.stringify(allTeams, null, 2));
    fs.writeFileSync(ALL_STATS_PATH, JSON.stringify(allStats, null, 2));

    console.log("\n✅ Scrape complete. Files updated:");
    console.log("   ", ALL_TEAMS_PATH);
    console.log("   ", ALL_STATS_PATH);
    console.log("Done.");
  } catch (err) {
    console.error("\n❌ SCRAPER FAILED");
    console.error(err);
    process.exit(1);
  }
})();
