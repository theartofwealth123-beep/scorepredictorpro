
    const teamCache = {};

    async function getTeamsForLeague(league) {
      if (teamCache[league]) return teamCache[league];
      
      try {
        const res = await fetch(`/data/${league.toLowerCase()}.json`);
        if (!res.ok) throw new Error("Failed to load league data");
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
