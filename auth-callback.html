<!DOCTYPE html>
<html lang="en" class="scroll-smooth">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>ScorePredictor Pro</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { font-family: system-ui, sans-serif; background: #0f172a; color: white; min-height: 100vh; }
    .container { max-width: 1200px; margin: 0 auto; padding: 2rem; text-align: center; }
    h1 { font-size: 4.5rem; background: linear-gradient(to right, #60a5fa, #c084fc); -webkit-background-clip: text; color: transparent; }
    .card { background: #1e293b; padding: 2rem; border-radius: 1rem; margin: 1rem; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
    .hidden { display: none; }
  </style>
</head>
<body>
  <div class="container">
    <h1>ScorePredictor Pro</h1>
    <p style="font-size:1.8rem; color:#94a3b8;">AI-powered edge on every game</p>

    <!-- LOADING SCREEN -->
    <div id="loading" class="card">
      <h2>Checking login...</h2>
    </div>

    <!-- MAIN APP -->
    <div id="app" class="hidden">
      <h2>Welcome, <span id="name">User</span>!</h2>
      <p id="email"></p>
      <p><strong>Status: ADMIN — Unlimited Forever</strong></p>
      <button onclick="logout()" style="background:#ef4444;padding:1rem 2rem;border-radius:1rem;margin-top:2rem;">
        Logout
      </button>

      <div style="margin-top:4rem;">
        <h2>Today's Games</h2>
        <div id="games"></div>
      </div>
    </div>
  </div>

  <script>
    // Check for session cookie
    function getCookie(name) {
      const value = `; ${document.cookie}`;
      const parts = value.split(`; ${name}=`);
      if (parts.length === 2) return parts.pop().split(';').shift();
    }

    const token = getCookie("appSession");

    if (!token) {
      // No login → redirect to Auth0
      window.location.href = 
        "https://dev-3cwuyjrqj751y7nr.us.auth0.com/authorize?" +
        new URLSearchParams({
          client_id: "R8YeJdb0ZGuXY0QLcO1FexwRmCrfpw1w",
          response_type: "code",
          redirect_uri: window.location.origin + "/auth-callback",
          scope: "openid profile email",
          state: "xyz"
        });
    } else {
      // Already logged in → get user info
      fetch("https://dev-3cwuyjrqj751y7nr.us.auth0.com/userinfo", {
        headers: { Authorization: `Bearer ${token}` }
      })
      .then(r => r.json())
      .then(user => {
        document.getElementById("loading").classList.add("hidden");
        document.getElementById("app").classList.remove("hidden");
        document.getElementById("name").textContent = user.name || user.email;
        document.getElementById("email").textContent = user.email;

        // Load games
        fetch("/.netlify/functions/today-games")
          .then(r => r.json())
          .then(games => {
            document.getElementById("games").innerHTML = games.map(g => 
              `<div class="card"><strong>${g.home} vs ${g.away}</strong><br>${g.league} • ${g.time}</div>`
            ).join("");
          });
      })
      .catch(() => {
        document.cookie = "appSession=; Max-Age=0; path=/";
        location.reload();
      });
    }

    function logout() {
      document.cookie = "appSession=; Max-Age=0; path=/";
      location.reload();
    }
  </script>
</body>
</html>