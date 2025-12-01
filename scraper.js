// scraper.js (project root)
const fs = require('fs');
const path = require('path');

async function main() {
  const args = process.argv.slice(2);
  console.log('Scraper running with args:', args.join(' '));

  const outDir = path.join(__dirname, 'data');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const payload = {
    lastUpdated: new Date().toISOString(),
    leagues: ['NBA', 'NFL', 'MLB', 'NHL', 'NCAAB', 'NCAAF'],
    note: 'Placeholder data — replace scraper.js with real stat scraping when ready.'
  };

  fs.writeFileSync(
    path.join(outDir, 'all-stats.json'),
    JSON.stringify(payload, null, 2),
    'utf8'
  );

  console.log('✅ Wrote data/all-stats.json');
}

main().catch((err) => {
  console.error('Scraper failed:', err);
  process.exit(1);
});
