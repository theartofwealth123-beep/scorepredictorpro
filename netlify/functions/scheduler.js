// netlify/functions/scheduler.js — 2025+ INLINE CRON (no netlify.toml needed)
const { execSync } = require('child_process');

// Export schedule config (runs every 12 hours UTC)
exports.handler = async () => {
  try {
    console.log('Running scraper at', new Date().toISOString());
    execSync('node scraper.js --league=all', { stdio: 'inherit' });  // Full scrape
    return {
      statusCode: 200,
      body: 'Data updated successfully — all 5 leagues fresh'
    };
  } catch (err) {
    console.error('Scrape failed:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

// INLINE SCHEDULE CONFIG — This makes it run every 12 hours
exports.schedule = '0 */12 * * *';  // 12:00 & 00:00 UTC daily