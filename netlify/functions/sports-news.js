const fetch = require('node-fetch');

exports.handler = async () => {
  const leagues = [
    { sport: 'basketball', league: 'nba', display: 'NBA' },
    { sport: 'football', league: 'nfl', display: 'NFL' },
    { sport: 'hockey', league: 'nhl', display: 'NHL' },
    { sport: 'baseball', league: 'mlb', display: 'MLB' },
    { sport: 'football', league: 'college-football', display: 'NCAAF' },
    { sport: 'basketball', league: 'mens-college-basketball', display: 'NCAAB' }
  ];

  const allNews = [];

  for (const { sport, league, display } of leagues) {
    try {
      const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/news`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      
      const articles = data.articles || [];
      articles.forEach(a => {
        allNews.push({
          headline: a.headline,
          description: a.description,
          link: a.links?.web?.href,
          image: a.images?.[0]?.url,
          published: a.published,
          league: display,
          source: a.source
        });
      });
    } catch (err) {
      console.error(`Failed to fetch news for ${league}`, err);
    }
  }

  // Sort by published date (descending)
  allNews.sort((a, b) => new Date(b.published) - new Date(a.published));

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 's-maxage=1800' // 30 mins
    },
    body: JSON.stringify(allNews.slice(0, 50)) // Return top 50 recent articles
  };
};
