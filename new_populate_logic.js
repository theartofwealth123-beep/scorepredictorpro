
    async function populateTeams() {
      const league = document.getElementById("league").value;
      const selectHome = document.getElementById("home-team");
      const selectAway = document.getElementById("away-team");
      
      // Show loading state if not cached
      if (!teamCache[league]) {
          const loading = "<option>Loading...</option>";
          selectHome.innerHTML = loading;
          selectAway.innerHTML = loading;
      }
      
      const teams = await getTeamsForLeague(league);
      
      const options = "<option>Select Team</option>" +
          teams.map(t => `<option>${t}</option>`).join("");
          
      selectHome.innerHTML = options;
      selectAway.innerHTML = options;
    }
