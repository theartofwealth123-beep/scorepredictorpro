

const fs = require('fs');

const indexPath = 'index.html';
let content = fs.readFileSync(indexPath, 'utf8');

const teamsStart = content.indexOf('const TEAMS = {');
const posSetsStart = content.indexOf('const POSITION_SETS = {');

if (teamsStart === -1 || posSetsStart === -1) {
    console.error("Could not find TEAMS or POSITION_SETS");
    process.exit(1);
}

const header = content.substring(0, teamsStart);
const footer = content.substring(posSetsStart);

const populateStartMarker = 'function populateTeams() {';
const renderStartMarker = 'function renderPositionInputs() {';

const populateStartIndex = footer.indexOf(populateStartMarker);
const renderStartIndex = footer.indexOf(renderStartMarker);

if (populateStartIndex === -1 || renderStartIndex === -1) {
    console.error("Could not find populateTeams or renderPositionInputs in footer");
    process.exit(1);
}

const footerPart1 = footer.substring(0, populateStartIndex);
const footerPart2 = footer.substring(renderStartIndex);

const newTeamsLogic = "
    const teamCache = {};

    async function getTeamsForLeague(league) {
      if (teamCache[league]) return teamCache[league];
      
      try {
        const res = await fetch(`/data/${league.toLowerCase()}.json`);
        if (!res.ok) throw new Error(\"Failed to load league data\");
        const data = await res.json();
        if (data.teams) {
          const teams = Object.keys(data.teams).sort();
          teamCache[league] = teams;
          return teams;
        }
      } catch (e) {
        console.error("Error fetching teams for", league, e);
      }
      return []; 
    }
    
    ";

const newPopulate = "async function populateTeams() {
      const league = document.getElementById(\"league\").value;
      const selectHome = document.getElementById(\"home-team\");
      const selectAway = document.getElementById(\"away-team\");
      
      // Show loading state if not cached
      if (!teamCache[league]) {
          const loading = \"<option>Loading...</option>\";
          selectHome.innerHTML = loading;
          selectAway.innerHTML = loading;
      }
      
      const teams = await getTeamsForLeague(league);
      
      const options = \"<option>Select Team</option>\" +
          teams.map(t => `<option>${t}</option>`).join(\"\");
          
      selectHome.innerHTML = options;
      selectAway.innerHTML = options;
    }

    ";

const newContent = header + newTeamsLogic + footerPart1 + newPopulate + footerPart2;

fs.writeFileSync(indexPath, newContent);
console.log("Updated index.html");
