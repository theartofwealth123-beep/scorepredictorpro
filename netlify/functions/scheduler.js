// netlify/functions/scheduler.js
const { execSync } = require('child_process');

exports.handler = async () => {
  try {
    console.log('Running scraper at', new Date().toISOString());
    execSync('node scraper.js', { stdio: 'inherit' });
    return {
      statusCode: 200,
      body: 'Data updated successfully'
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: 'Scrape failed' };
  }
};