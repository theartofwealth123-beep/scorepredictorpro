<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ScorePredictor Pro • Scores</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="min-h-screen bg-slate-950 text-slate-100 antialiased">
  <header class="border-b border-slate-800/70 bg-slate-950/70 backdrop-blur">
    <div class="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center font-black text-xl">
          S
        </div>
        <div>
          <div class="font-bold text-lg tracking-tight">ScorePredictor Pro</div>
          <div class="text-xs text-slate-400 uppercase tracking-[0.2em]">Live Scores</div>
        </div>
      </div>
      <nav class="flex items-center gap-4 text-sm">
        <a href="/" class="text-slate-400 hover:text-slate-100">Calculator</a>
        <a href="/scores.html" class="text-slate-100 font-medium">Scores</a>
        <a href="/profile.html" class="text-slate-400 hover:text-slate-100">Profile</a>
      </nav>
    </div>
  </header>

  <main class="max-w-6xl mx-auto px-4 pt-8 pb-16">
    <section class="mb-6">
      <h1 class="text-2xl md:text-3xl font-black tracking-tight text-slate-50">
        Today’s Board
      </h1>
      <p class="mt-2 text-sm text-slate-400 max-w-xl">
        Quick view of today’s NBA, NFL, and NHL matchups. Use this page free — the full 5M-sim calculator lives on the main
        <span class="font-semibold">Calculator</span> tab.
      </p>
    </section>

    <section id="scores-card" class="rounded-2xl border border-slate-800/80 bg-slate-900/70 p-4 md:p-6 shadow-xl">
      <div id="loading" class="text-sm text-slate-400">
        Loading today’s games...
      </div>
      <div id="games-grid" class="mt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-4"></div>
      <div id="empty" class="hidden text-sm text-slate-500">
        No games found for today.
      </div>
    </section>
  </main>

  <script>
    async function loadGames() {
      const loading = document.getElementById("loading");
      const grid = document.getElementById("games-grid");
      const empty = document.getElementById("empty");

      try {
        const res = await fetch("/.netlify/functions/today-games");
        const games = await res.json();

        loading.classList.add("hidden");

        if (!Array.isArray(games) || games.length === 0) {
          empty.classList.remove("hidden");
          return;
        }

        grid.innerHTML = games
          .map((g) => {
            return `
            <div class="rounded-xl border border-slate-800 bg-slate-950/60 p-3 flex flex-col justify-between">
              <div class="flex justify-between items-center mb-1">
                <span class="text-[11px] uppercase tracking-[0.2em] text-slate-500">${g.league}</span>
                <span class="text-[11px] text-slate-400">${g.time}</span>
              </div>
              <div class="mt-1 text-sm font-semibold text-slate-50">
                ${g.away} @ ${g.home}
              </div>
              <div class="mt-1 text-[11px] text-slate-500">
                Network: ${g.network}
              </div>
            </div>`;
          })
          .join("");
      } catch (err) {
        loading.textContent = "Failed to load games.";
      }
    }

    loadGames();
  </script>
</body>
</html>
