// netlify/functions/scheduler.js
// Inline-scheduled function to keep data/*.json fresh with scraper.js

const { execSync } = require("child_process");

exports.handler = async () => {
  try {
    console.log("Running scraper at", new Date().toISOString());
    execSync("node scraper.js --league=ALL", { stdio: "inherit" });
    return {
      statusCode: 200,
      body: "Data updated successfully — all leagues fresh"
    };
  } catch (err) {
    console.error("Scrape failed:", err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

// Every 12 hours UTC
exports.schedule = "0 */12 * * *";

// Runs at 00:00 and 12:00 UTC daily
exports.schedule = '0 */12 * * *';
