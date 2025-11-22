// Netlify/Functions/autopost-pick.js
const TwitterApi = require('twitter-api-v2'); // npm i twitter-api-v2

exports.handler = async (event) => {
  const { prediction, projectedScore, winProbability, league, edge } = JSON.parse(event.body);
  if (edge < 6) return { statusCode: 200, body: 'No edge' };

  const client = new TwitterApi({
    appKey: process.env.TWITTER_API_KEY,
    appSecret: process.env.TWITTER_API_SECRET,
    accessToken: process.env.TWITTER_ACCESS_TOKEN,
    accessSecret: process.env.TWITTER_ACCESS_SECRET,
  });

  const tweet = `${league} EDGE: ${prediction} | Score: ${projectedScore} | ${winProbability.homeTeam} win prob | Bet ${edge} >6% edge! #SportsBetting #PredictionApp`;

  try {
    await client.v2.tweet(tweet);
    return { statusCode: 200, body: 'Posted!' };
  } catch (err) {
    return { statusCode: 500, body: err.message };
  }
};