
const fs = require('fs');
const ncaab = JSON.parse(fs.readFileSync('data/ncaab.json', 'utf8'));
const teams = Object.keys(ncaab.teams);

const fbsTeams = [
"Air Force", "Akron", "Alabama", "Appalachian State", "Arizona", "Arizona State", "Arkansas", "Arkansas State", "Army", "Auburn", 
"Ball State", "Baylor", "Boise State", "Boston College", "Bowling Green", "BYU", "Buffalo", "California", "Central Michigan", "Charlotte", 
"Cincinnati", "Clemson", "Coastal Carolina", "Colorado", "Colorado State", "UConn", "Duke", "East Carolina", "Eastern Michigan", "FIU", 
"Florida", "Florida Atlantic", "Florida State", "Fresno State", "Georgia", "Georgia Southern", "Georgia State", "Georgia Tech", "Hawaii", "Houston", 
"Illinois", "Indiana", "Iowa", "Iowa State", "Jacksonville State", "James Madison", "Kansas", "Kansas State", "Kent State", "Kentucky", 
"Kennesaw State", "Liberty", "Louisiana", "Louisiana-Monroe", "Louisiana Tech", "Louisville", "LSU", "Marshall", "Maryland", "Memphis", 
"Miami (FL)", "Miami (OH)", "Michigan", "Michigan State", "Middle Tennessee", "Minnesota", "Mississippi State", "Missouri", "Navy", "NC State", 
"Nebraska", "Nevada", "New Mexico", "New Mexico State", "North Carolina", "North Texas", "Northern Illinois", "Northwestern", "Notre Dame", "Ohio", 
"Ohio State", "Oklahoma", "Oklahoma State", "Old Dominion", "Ole Miss", "Oregon", "Oregon State", "Penn State", "Pitt", "Purdue", 
"Rice", "Rutgers", "Sam Houston", "San Diego State", "San Jose State", "SMU", "South Alabama", "South Carolina", "South Florida", "Southern Miss", 
"Stanford", "Syracuse", "TCU", "Temple", "Tennessee", "Texas", "Texas A&M", "Texas State", "Texas Tech", "Toledo", "Troy", 
"Tulane", "Tulsa", "UAB", "UCF", "UCLA", "UMass", "UNLV", "USC", "USF", "Utah", 
"Utah State", "UTEP", "UTSA", "Vanderbilt", "Virginia", "Virginia Tech", "Wake Forest", "Washington", "Washington State", "West Virginia", 
"Western Kentucky", "Western Michigan", "Wyoming"
];

const missing = [];

fbsTeams.forEach(fbs => {
  let found = false;
  // Simple check: does any team name in ncaab.json start with or contain the fbs name?
  // We need to be careful. "Alabama" matches "Alabama", "Alabama A&M", etc.
  // But we want to ensure the main one is there.
  
  // Try exact match or match with common suffixes
  const variants = [fbs];
  if (fbs === "Miami (FL)") variants.push("Miami Hurricanes", "Miami FL");
  if (fbs === "Miami (OH)") variants.push("Miami (OH)", "Miami OH");
  if (fbs === "Ole Miss") variants.push("Mississippi", "Mississippi Rebels");
  if (fbs === "Pitt") variants.push("Pittsburgh");
  if (fbs === "UConn") variants.push("Connecticut");
  if (fbs === "Army") variants.push("Army West Point");
  if (fbs === "Hawaii") variants.push("Hawai'i");
  if (fbs === "California") variants.push("Cal", "California Golden Bears");
  
  // Check against all existing teams
  const foundTeam = teams.find(t => {
      // Check if team name starts with FBS name (e.g. "Alabama Crimson Tide" starts with "Alabama")
      // Or is equal to variant
      if (t.includes(fbs)) return true;
      if (variants.some(v => t.includes(v))) return true;
      return false;
  });
  
  if (!foundTeam) {
    missing.push(fbs);
  }
});

console.log("Potential missing teams:", missing);
