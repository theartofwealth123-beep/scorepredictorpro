// netlify/functions/scheduler.js — inline cron, runs every 12 hours
const { execSync } = require('child_process');
const path = require('path');

exports.handler = async () => {
  try {
    console.log('Running scraper at', new Date().toISOString());

    // scraper.js is at project root
    const scraperPath = path.join(__dirname, '..', 'scraper.js');

    execSync(`node "${scraperPath}" --league=all`, { stdio: 'inherit' });

    return {
      statusCode: 200,
      body: 'Data updated successfully — all leagues fresh'
    };
  } catch (err) {
    console.error('Scrape failed:', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};

// Runs at 00:00 and 12:00 UTC daily
exports.schedule = '0 */12 * * *';
