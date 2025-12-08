// netlify/functions/game-tracker.js
const fetch = require('node-fetch');

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const league = (params.league || "").toUpperCase();
  const eventId = params.eventId;

  if (!league || !eventId) {
    return { statusCode: 400, body: "league and eventId are required" };
  }

  let base;
  if (league === "NBA") base = "basketball/nba";
  else if (league === "NFL") base = "football/nfl";
  else if (league === "NHL") base = "hockey/nhl";
  else if (league === "MLB") base = "baseball/mlb";
  else if (league === "NCAAF") base = "football/college-football";
  else if (league === "NCAAB") base = "basketball/mens-college-basketball";
  else return { statusCode: 400, body: "Unsupported league" };

  const url = `https://site.api.espn.com/apis/site/v2/sports/${base}/summary?event=${eventId}`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    const competitions = data.header?.competitions?.[0];
    const boxscore = data.boxscore || {};
    const teams = boxscore.teams || [];
    const competitors = competitions?.competitors || [];

    const home = teams.find(t => t.homeAway === "home");
    const away = teams.find(t => t.homeAway === "away");

    // Build scoring by period/quarter/inning if present on competitor objects
    const scoring = competitors.map((c, idx) => ({
      team: c.team?.displayName,
      abbreviation: c.team?.abbreviation,
      homeAway: c.homeAway,
      total: c.score,
      linescores: (c.linescores || []).map((ls, i) => ({
        period: ls.period ?? i + 1,
        value: ls.displayValue || ls.value || ls.score || "-"
      }))
    }));

    // Extract team-level stats for quick box score style view
    const teamStats = teams.map(t => ({
      team: t.team?.displayName,
      abbreviation: t.team?.abbreviation,
      homeAway: t.homeAway,
      stats: (t.statistics || []).map(s => ({
        label: s.label || s.abbreviation,
        abbreviation: s.abbreviation,
        displayValue: s.displayValue
      }))
    }));

    // Leaders (points / rebounds / assists, etc.) when available
    const leaders = (data.leaders || []).map(l => ({
      shortName: l.shortName,
      displayName: l.displayName,
      category: l.category,
      leaders: (l.leaders || []).map(p => ({
        name: p.athlete?.displayName,
        team: p.team?.displayName,
        value: p.value,
        stat: p.displayValue
      }))
    }));
    
    // Determine possession if available (team ID)
    let possession = null;
    if (competitions?.situation?.possession) {
        const pTeamId = competitions.situation.possession;
        const pTeam = competitors.find(c => c.id === pTeamId);
        if (pTeam) {
            possession = pTeam.homeAway; // "home" or "away"
        }
    }

    const recentPlays = Array.isArray(data.plays) ? data.plays.slice(-25).map(p => ({
      clock: p.clock?.displayValue,
      period: p.period?.number,
      text: p.text,
      awayScore: p.awayScore,
      homeScore: p.homeScore,
      scoringPlay: p.scoringPlay,
      type: p.type?.text
    })) : [];

    const response = {
      status: competitions?.status?.type?.shortDetail,
      gameState: competitions?.status?.type?.state, // 'pre', 'in', 'post'
      clock: competitions?.status?.clock,
      period: competitions?.status?.period,
      venue: competitions?.venue?.fullName,
      city: competitions?.venue?.address?.city,
      homeTeam: home?.team?.displayName,
      awayTeam: away?.team?.displayName,
      homeScore: home?.score,
      awayScore: away?.score,
      statistics: boxscore?.players || [],
      teamStats,
      scoring,
      leaders,
      situation: competitions?.situation || {},
      possession: possession,
      lastPlay: competitions?.situation?.lastPlay || (data.plays && data.plays.length ? data.plays[data.plays.length - 1] : null),
      lastPlayText: competitions?.situation?.lastPlay?.text || (data.plays && data.plays.length ? data.plays[data.plays.length - 1]?.text : "No recent play data"),
      plays: recentPlays
    };

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(response)
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: "Failed to load game tracker" };
  }
};
