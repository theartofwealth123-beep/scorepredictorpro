// netlify/functions/autopost-pick.js
const TwitterApi = require('twitter-api-v2');

exports.handler = async (event) => {
  let payload = {};
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { prediction, projectedScore, winProbability, league, edge } = payload;

  const numericEdge = typeof edge === 'number' ? edge : parseFloat(edge);

  if (!prediction || !projectedScore || !winProbability || !league) {
    return { statusCode: 400, body: 'Missing fields' };
  }

  if (isNaN(numericEdge) || numericEdge < 6) {
    return { statusCode: 200, body: 'No edge' };
  }

  const client = new TwitterApi({
    appKey: process.env.TWITTER_API_KEY,
    appSecret: process.env.TWITTER_API_SECRET,
    accessToken: process.env.TWITTER_ACCESS_TOKEN,
    accessSecret: process.env.TWITTER_ACCESS_SECRET
  });

  const tweet = `${league} EDGE: ${prediction} | Score: ${projectedScore} | ${winProbability} home win prob | ${numericEdge.toFixed(
    2
  )}% edge #SportsBetting #PredictionApp`;

  try {
    await client.v2.tweet(tweet);
    return { statusCode: 200, body: 'Posted!' };
  } catch (err) {
    return { statusCode: 500, body: err.message };
  }
};
