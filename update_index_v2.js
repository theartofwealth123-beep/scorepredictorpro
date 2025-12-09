
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

const newTeamsLogic = fs.readFileSync('new_teams_logic.js', 'utf8');
const newPopulate = fs.readFileSync('new_populate_logic.js', 'utf8');

const newContent = header + newTeamsLogic + footerPart1 + newPopulate + footerPart2;

fs.writeFileSync(indexPath, newContent);
console.log("Updated index.html");
