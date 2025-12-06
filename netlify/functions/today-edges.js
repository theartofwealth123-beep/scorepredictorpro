// netlify/functions/today-edges.js
const fetch = require('node-fetch');
const { simulateMatchup } = require('./_predict-core'); // you can factor your core logic out

exports.handler = async () => {
  // 1) Get today's games (reuse your ESPN logic or even call your own today-games URL)
  // 2) For each game, call simulateMatchup({ league, homeTeam, awayTeam, market: null })
  // 3) Grab edge numeric value you already compute
  // 4) Sort descending by edge, slice top 5
  // 5) Return as JSON
};
