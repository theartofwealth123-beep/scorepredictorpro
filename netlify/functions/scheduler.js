// netlify/functions/scheduler.js
const { exec } = require("child_process");

exports.handler = async () => {
  return new Promise((resolve) => {
    exec("node scripts/scraper.js", (err, stdout, stderr) => {
      if (err) {
        resolve({
          statusCode: 500,
          body: "Scraper failed: " + err
        });
      }

      resolve({
        statusCode: 200,
        body: "Scraper executed successfully.\n" + stdout
      });
    });
  });
};
