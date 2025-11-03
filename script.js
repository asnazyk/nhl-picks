/* =========================================================
  Puck Picks — League Logic (Front-End Scaffolding)
  ---------------------------------------------------------
  - Local-first storage so it works immediately
  - Supabase hooks you can enable later
  - Enforces your exact rules
========================================================= */

/** ========================
 *  FEATURE FLAGS
 *  ======================== */
const USE_SUPABASE = false; // set true after Phase 6
const SUPABASE_TABLES = {
  users: "users",
  teams: "teams",
  players: "players",
  rosters: "rosters",
  weekly_rosters: "weekly_rosters",
  weekly_games: "weekly_games",
  game_picks: "game_picks",
  weekly_stats: "weekly_stats", // goals/assists snapshot per playerID/week
  schedule: "schedule",
  head_to_head: "head_to_head",
};

/** ========================
 *  CONSTANTS / RULES
 *  ======================== */
const MAX_PLAYERS = 32;
const ROSTER_SIZE = { F: 6, D: 4 };
const STARTERS = { F: 3, D: 2 };
const WEEK_LOCK_DOW = 1; // Monday
const WEEK_LOCK_HOUR_ET = 17; // 5pm ET
const GAME_PICK_COUNT = 30;
const POINTS = { GAME_PICK: 1, GOAL: 2, ASSIST: 1 };

/** ========================
 *  UTILITIES
 *  ======================== */
const ls = {
  get: (k, d = null) => {
    try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; }
  },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
  del: (k) => localStorage.removeItem(k),
};

const todayET = () => new Date(new Date().toLocaleString("en-US", { timeZone: "America/Toronto" }));
const startOfISOWeek = (d) => {
  const copy = new Date(d);
  const day = (copy.getUTCDay() + 6) % 7; // Mon=0
  copy.setUTCDate(copy.getUTCDate() - day);
  copy.setUTCHours(0,0,0,0);
  return copy;
};

const formatWeekKey = (dateObj = todayET()) => {
  const monday = startOfISOWeek(dateObj);
  const y = monday.getUTCFullYear();
  const m = String(monday.getUTCMonth()+1).padStart(2,"0");
  const d = String(monday.getUTCDate()).padStart(2,"0");
  return `${y}-${m}-${d}`; // week starting Monday (ET/ISO)
};

const randomId = (len=8) => Math.random().toString(36).slice(2, 2+len);

/** ========================
 *  DEMO / MOCK DATA
 *  ======================== */
const DEMO_PLAYERS = [
  // Minimal mock player pool (id, name, pos, NHL team)
  { id: "p1",  name: "Connor Demo", pos: "F", team: "EDM" },
  { id: "p2",  name: "Auston Sample", pos: "F", team: "TOR" },
  { id: "p3",  name: "Nathan Mock", pos: "F", team: "COL" },
  { id: "p4",  name: "Sid Crosbyish", pos: "F", team: "PIT" },
  { id: "p5",  name: "David Test", pos: "F", team: "BOS" },
  { id: "p6",  name: "Jack Placeholder", pos: "F", team: "BUF" },
  { id: "p7",  name: "Cale Example", pos: "D", team: "COL" },
  { id: "p8",  name: "Adam Sampleton", pos: "D", team: "NJ" },
  { id: "p9",  name: "Miro TryMan", pos: "D", team: "DAL" },
  { id: "p10", name: "Roman Prototype", pos: "D", team: "NSH" },
];

const DEMO_USERS = [
  { id: "u1", name: "Team Alpha", avatar: "", email: "alpha@example.com" },
  { id: "u2", name: "Team Beta", avatar: "", email: "beta@example.com" },
];

/** ========================
 *  STATE (LOCAL)
 *  ======================== */
const state = {
  users: ls.get("users", DEMO_USERS),
  players: ls.get("players", DEMO_PLAYERS),
  teams: ls.get("teams", DEMO_USERS.map(u => ({ id:u.id, name:u.name, owner:u.id })) ),
  weekly: ls.get("weekly", {}), // keyed by weekKey
  schedule: ls.get("schedule", {}), // NHL-like schedule by date -> array of games
  h2h: ls.get("h2h", {}), // { [weekKey]: [ {homeId, awayId, matchId} ] }
};

/** ========================
 *  AUTH (placeholder)
 *  ======================== */
let currentUserId = ls.get("currentUserId", "u1"); // swap via login later

/** ========================
 *  WEEK / LOCK / SCHEDULE
 *  ======================== */
function isWeekLocked(date = todayET()) {
  const lock = new Date(date);
  // find this week's Monday 5pm ET
  const monday = startOfISOWeek(date);
  lock.setTime(monday.getTime());
  lock.setHours(WEEK_LOCK_HOUR_ET, 0, 0, 0); // 5pm ET Monday
  // if now is after lock time for current week
  return date >= lock;
}

// Minimal fake schedule generator (Sat heavy + weekday games)
function ensureScheduleForWeek(weekKey) {
  if (state.schedule[weekKey]) return;

  const monday = new Date(weekKey + "T00:00:00Z");
  const days = [...Array(7)].map((_,i) => {
    const d = new Date(monday);
    d.setUTCDate(d.getUTCDate()+i);
    return d;
  });

  // Create 8–12 games per Saturday, 4-6 on weekdays
  const makeGamesFor = (dateObj, count) => {
    const dateStr = dateObj.toISOString().slice(0,10);
    const games = [];
    for (let i=0; i<count; i++) {
      games.push({
        gameId: `${dateStr}-${i}`,
        date: dateStr,
        home: ["TOR","MTL","BOS","NYR","VAN","EDM","WPG","OTT"][i%8],
        away: ["BUF","DET","CHI","PIT","NSH","DAL","LAK","SJS"][(i+3)%8],
        startET: "19:00",
        winner: null, // set later to simulate/calc
      });
    }
    return games;
  };

  const weekGames = [];
  days.forEach((d,i) => {
    const isSat = d.getUTCDay() === 6;
    const count = isSat ? 10 : (i===0 ? 6 : 5); // Mon=bit more
    weekGames.push(...makeGamesFor(d, count));
  });

  state.schedule[weekKey] = weekGames;
  ls.set("schedule", state.schedule);
}

/** ========================
 *  H2H MATCHUPS (simple round-robin-ish)
 *  ======================== */
function ensureHeadToHead(weekKey) {
  if (state.h2h[weekKey]) return;

  const ids = state.teams.map(t => t.id);
  // pair sequentially: (0 vs 1), (2 vs 3), ...
  const matches = [];
  for (let i=0; i<ids.length; i+=2) {
    if (ids[i+1]) {
      matches.push({ matchId: randomId(), homeId: ids[i], awayId: ids[i+1] });
    } else {
      // odd bye
      matches.push({ matchId: randomId(), homeId: ids[i], awayId: null });
    }
  }
  state.h2h[weekKey] = matches;
  ls.set("h2h", state.h2h);
}

/** ========================
 *  WEEKLY CONTAINER SHAPE
 *  ======================== */
/*
weekly[weekKey] = {
  rosters: { [teamId]: { starters: {F:[ids], D:[ids]}, bench:[ids], altDay: {playerId: "Tue" | ...} } },
  gameSet: [30 gameIds],
  picks: { [teamId]: { [gameId]: "HOME"|"AWAY" } },
  scores: { [teamId]: { picks: n, goals: n, assists: n, total: n } },
  playerStats: { [playerId]: { goals:n, assists:n, plays: {"2025-11-01":true,...} } } // demo
}
*/

/** ========================
 *  ADMIN: LOAD TEAM ROSTERS
 *  ======================== */
function adminSetTeamRoster(teamId, playerIds /* length 10, 6F & 4D */) {
  const weekKey = formatWeekKey();
  ensureWeekly(weekKey);

  // validate roster composition
  const rosterPlayers = playerIds.map(id => state.players.find(p=>p.id===id)).filter(Boolean);
  const countF = rosterPlayers.filter(p=>p.pos==="F").length;
  const countD = rosterPlayers.filter(p=>p.pos==="D").length;
  if (countF !== ROSTER_SIZE.F || countD !== ROSTER_SIZE.D) {
    alert(`Roster must be exactly ${ROSTER_SIZE.F} Forwards and ${ROSTER_SIZE.D} Defensemen`);
    return false;
  }

  // Set default starters: first 3F, first 2D; rest bench
  const starters = {
    F: rosterPlayers.filter(p=>p.pos==="F").slice(0, STARTERS.F).map(p=>p.id),
    D: rosterPlayers.filter(p=>p.pos==="D").slice(0, STARTERS.D).map(p=>p.id),
  };
  const starterIds = new Set([...starters.F, ...starters.D]);
  const bench = rosterPlayers.map(p=>p.id).filter(id => !starterIds.has(id));

  state.weekly[weekKey].rosters[teamId] = {
    starters, bench, altDay: {}, full: rosterPlayers.map(p=>p.id)
  };
  ls.set("weekly", state.weekly);
  renderWeeklyRosterUI(teamId);
  return true;
}

/** ========================
 *  WEEKLY SETUP
 *  ======================== */
function ensureWeekly(weekKey) {
  if (!state.weekly[weekKey]) {
    state.weekly[weekKey] = { rosters: {}, gameSet: [], picks: {}, scores: {}, playerStats: {} };
    ls.set("weekly", state.weekly);
  }
  ensureScheduleForWeek(weekKey);
  ensureHeadToHead(weekKey);

  // 30 random games for the week’s pick set
  if (state.weekly[weekKey].gameSet.length === 0) {
    const all = [...state.schedule[weekKey]];
    // shuffle
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [all[i], all[j]] = [all[j], all[i]];
    }
    state.weekly[weekKey].gameSet = all.slice(0, GAME_PICK_COUNT).map(g => g.gameId);
    ls.set("weekly", state.weekly);
  }
}

/** ========================
 *  ROSTER INTERACTION
 *  ======================== */
function setStarter(teamId, playerId, makeStarter=true) {
  const weekKey = formatWeekKey();
  ensureWeekly(weekKey);
  const R = state.weekly[weekKey].rosters[teamId];
  if (!R) return;

  const player = state.players.find(p=>p.id===playerId);
  if (!player) return;

  const currentlyStarter =
    R.starters[player.pos].includes(playerId);

  if (makeStarter && !currentlyStarter) {
    // enforce limits
    if (R.starters[player.pos].length >= STARTERS[player.pos]) {
      alert(`You can only start ${STARTERS[player.pos]} ${player.pos === "F" ? "forwards" : "defensemen"}`);
      return;
    }
    // move from bench to starters
    R.starters[player.pos].push(playerId);
    R.bench = R.bench.filter(id => id !== playerId);
  } else if (!makeStarter && currentlyStarter) {
    // move from starters to bench
    R.starters[player.pos] = R.starters[player.pos].filter(id => id !== playerId);
    R.bench.push(playerId);
  }
  ls.set("weekly", state.weekly);
  renderWeeklyRosterUI(teamId);
}

// Set alternate day for a given player (Mon–Fri labels: "Mon".."Fri")
function setAltDay(teamId, playerId, dayLabel /* "Mon" | "Tue" | "Wed" | "Thu" | "Fri" */) {
  const weekKey = formatWeekKey();
  ensureWeekly(weekKey);
  const R = state.weekly[weekKey].rosters[teamId];
  if (!R) return;

  // Only one alternate **per starter** is allowed (overwrite okay)
  const isStarter = ["F","D"].some(pos => R.starters[pos].includes(playerId));
  if (!isStarter) {
    alert("Only starters can have an alternate day.");
    return;
  }
  R.altDay[playerId] = dayLabel;
  ls.set("weekly", state.weekly);
  renderWeeklyRosterUI(teamId);
}

/** ========================
 *  GAME PICKS
 *  ======================== */
function setGamePick(teamId, gameId, pick /* "HOME"|"AWAY" */) {
  const weekKey = formatWeekKey();
  ensureWeekly(weekKey);
  if (!state.weekly[weekKey].picks[teamId]) state.weekly[weekKey].picks[teamId] = {};
  state.weekly[weekKey].picks[teamId][gameId] = pick;
  ls.set("weekly", state.weekly);
  renderGamePicksUI(teamId);
}

/** ========================
 *  SCORING
 *  ======================== */
// Minimal stat simulator: random goals/assists for starters' playing dates
function simulateStatsForWeek(weekKey) {
  const WK = state.weekly[weekKey];
  if (!WK) return;

  // Build quick index of schedule by date
  const gamesByDate = {};
  (state.schedule[weekKey] || []).forEach(g => {
    (gamesByDate[g.date] ||= []).push(g);
  });

  // helper to map day label -> date string
  const monday = new Date(weekKey + "T00:00:00Z");
  const dayLabelToDate = { Mon:0, Tue:1, Wed:2, Thu:3, Fri:4, Sat:5, Sun:6 };
  const labelToDateStr = (label) => {
    const d = new Date(monday);
    d.setUTCDate(d.getUTCDate() + dayLabelToDate[label]);
    return d.toISOString().slice(0,10);
  };

  // Randomize winners so game picks have outcomes
  (state.schedule[weekKey] || []).forEach(g => {
    g.winner = Math.random() > 0.5 ? "HOME" : "AWAY";
  });

  // For each rostered starter: plays on Saturday,
  // and if no Saturday game, use one alternate day if set.
  const saturdayStr = labelToDateStr("Sat");
  Object.entries(WK.rosters).forEach(([teamId, R]) => {
    const starters = [...R.starters.F, ...R.starters.D];

    starters.forEach(pid => {
      // Check if player's NHL team has a Saturday game (mock via 50/50)
      const playsSat = Math.random() > 0.5;
      const useDate = playsSat ? saturdayStr : (R.altDay[pid] ? labelToDateStr(R.altDay[pid]) : null);
      if (!useDate) return;

      // Give random stats for that date
      const goals = Math.random() < 0.35 ? (Math.random() < 0.5 ? 1 : 2) : 0;
      const assists = Math.random() < 0.45 ? (Math.random() < 0.7 ? 1 : 2) : 0;
      WK.playerStats[pid] = WK.playerStats[pid] || { goals:0, assists:0, plays:{} };
      WK.playerStats[pid].goals += goals;
      WK.playerStats[pid].assists += assists;
      WK.playerStats[pid].plays[useDate] = true;
    });
  });

  ls.set("weekly", state.weekly);
}

// Calculate totals and head-to-head table
function calcWeekScores(weekKey) {
  const WK = state.weekly[weekKey];
  if (!WK) return;

  // Picks score
  state.teams.forEach(t => {
    const picks = WK.picks[t.id] || {};
    let pickPts = 0;
    WK.gameSet.forEach(gid => {
      const game = (state.schedule[weekKey] || []).find(x => x.gameId === gid);
      if (!game) return;
      if (picks[gid] && game.winner && picks[gid] === game.winner) {
        pickPts += POINTS.GAME_PICK;
      }
    });

    // Player points
    let goals = 0, assists = 0;
    const R = WK.rosters[t.id];
    if (R) {
      const starters = [...R.starters.F, ...R.starters.D];
      starters.forEach(pid => {
        const stat = WK.playerStats[pid];
        if (stat) {
          goals += stat.goals || 0;
          assists += stat.assists || 0;
        }
      });
    }

    const playerPts = goals * POINTS.GOAL + assists * POINTS.ASSIST;
    const total = pickPts + playerPts;
    WK.scores[t.id] = { picks: pickPts, goals, assists, total };
  });

  ls.set("weekly", state.weekly);
}

/** ========================
 *  RENDERERS (minimal)
 *  ======================== */
function el(id) { return document.getElementById(id); }

function renderWeeklyRosterUI(teamId = currentUserId) {
  const wrap = el("weekly-roster");
  if (!wrap) return;
  const weekKey = formatWeekKey();
  ensureWeekly(weekKey);

  const R = state.weekly[weekKey].rosters[teamId];
  if (!R) {
    wrap.innerHTML = `
      <div class="card">
        <h3>Weekly Lineup</h3>
        <p>No roster set yet. (Admin can load your 10 drafted players.)</p>
      </div>`;
    return;
  }

  const playerRow = (pid, isStarter, pos) => {
    const p = state.players.find(pp=>pp.id===pid);
    if (!p) return "";
    const alt = state.weekly[weekKey].rosters[teamId].altDay[pid] || "";
    return `
      <div class="roster-row ${isStarter ? "starter": "bench"}">
        <div><strong>${p.name}</strong> <span class="pos">${p.pos}</span> <span class="team">${p.team}</span></div>
        <div class="controls">
          ${isStarter
            ? `<button class="btn btn-sm" data-act="bench" data-pid="${pid}">Bench</button>
               <label class="alt-label">Alt day:
                 <select data-act="alt" data-pid="${pid}">
                   <option value="">None</option>
                   <option ${alt==="Mon"?"selected":""}>Mon</option>
                   <option ${alt==="Tue"?"selected":""}>Tue</option>
                   <option ${alt==="Wed"?"selected":""}>Wed</option>
                   <option ${alt==="Thu"?"selected":""}>Thu</option>
                   <option ${alt==="Fri"?"selected":""}>Fri</option>
                 </select>
               </label>`
            : `<button class="btn btn-sm" data-act="start" data-pid="${pid}" data-pos="${pos}">Start</button>`
          }
        </div>
      </div>`;
  };

  const fStarters = R.starters.F.map(pid => playerRow(pid, true, "F")).join("");
  const dStarters = R.starters.D.map(pid => playerRow(pid, true, "D")).join("");
  const bench = R.bench.map(pid => {
    const pos = (state.players.find(pp=>pp.id===pid)||{}).pos || "F";
    return playerRow(pid, false, pos);
  }).join("");

  wrap.innerHTML = `
    <div class="card">
      <h3>Weekly Lineup</h3>
      <p>Start <strong>${STARTERS.F} Forwards</strong> and <strong>${STARTERS.D} Defensemen</strong>. You may set ONE alternate weekday per starter if they don’t play Saturday.</p>
      <div class="grid-2">
        <div>
          <h4>Starters — Forwards (${R.starters.F.length}/${STARTERS.F})</h4>
          ${fStarters || `<div class="muted">No starters yet.</div>`}
          <h4>Starters — Defense (${R.starters.D.length}/${STARTERS.D})</h4>
          ${dStarters || `<div class="muted">No starters yet.</div>`}
        </div>
        <div>
          <h4>Bench</h4>
          ${bench || `<div class="muted">No bench players.</div>`}
        </div>
      </div>
    </div>
  `;

  // attach events
  wrap.querySelectorAll("[data-act]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const act = e.currentTarget.getAttribute("data-act");
      const pid = e.currentTarget.getAttribute("data-pid");
      if (act === "bench") setStarter(teamId, pid, false);
      if (act === "start") setStarter(teamId, pid, true);
    });
  });
  wrap.querySelectorAll('select[data-act="alt"]').forEach(sel => {
    sel.addEventListener("change", (e) => {
      const pid = e.currentTarget.getAttribute("data-pid");
      setAltDay(teamId, pid, e.currentTarget.value);
    });
  });
}

function renderGamePicksUI(teamId = currentUserId) {
  const wrap = el("game-picks");
  if (!wrap) return;
  const weekKey = formatWeekKey();
  ensureWeekly(weekKey);

  const set = state.weekly[weekKey].gameSet;
  const picks = state.weekly[weekKey].picks[teamId] || {};
  const games = set.map(gid => (state.schedule[weekKey] || []).find(g=>g.gameId===gid)).filter(Boolean);

  wrap.innerHTML = `
    <div class="card">
      <h3>Weekly Game Picks (${games.length})</h3>
      <p>Pick the winner for each of the ${GAME_PICK_COUNT} games. (+${POINTS.GAME_PICK} point each correct)</p>
      <div class="games-list">
        ${games.map(g => `
          <div class="game-row">
            <div class="g-info"><strong>${g.away}</strong> @ <strong>${g.home}</strong> <span class="muted">${g.date}</span></div>
            <div class="g-pick">
              <button class="btn btn-sm ${picks[g.gameId]==="AWAY"?"btn-primary":""}" data-act="pick" data-gid="${g.gameId}" data-pick="AWAY">${g.away}</button>
              <button class="btn btn-sm ${picks[g.gameId]==="HOME"?"btn-primary":""}" data-act="pick" data-gid="${g.gameId}" data-pick="HOME">${g.home}</button>
            </div>
          </div>
        `).join("")}
      </div>
    </div>
  `;

  wrap.querySelectorAll('[data-act="pick"]').forEach(b=>{
    b.addEventListener("click", (e) => {
      const gid = e.currentTarget.getAttribute("data-gid");
      const pick = e.currentTarget.getAttribute("data-pick");
      setGamePick(teamId, gid, pick);
    });
  });
}

function renderLeaderboard() {
  const wrap = el("leaderboard");
  if (!wrap) return;
  const weekKey = formatWeekKey();
  ensureWeekly(weekKey);

  const rows = state.teams.map(t => {
    const s = state.weekly[weekKey].scores[t.id] || { picks:0, goals:0, assists:0, total:0 };
    return { team:t, s };
  }).sort((a,b)=>b.s.total - a.s.total);

  wrap.innerHTML = `
    <div class="card">
      <h3>League Standings — ${weekKey}</h3>
      <table class="table">
        <thead><tr><th>Team</th><th>Picks</th><th>Goals</th><th>Assists</th><th>Total</th></tr></thead>
        <tbody>
        ${rows.map(r=>`
          <tr>
            <td>${r.team.name}</td>
            <td>${r.s.picks}</td>
            <td>${r.s.goals}</td>
            <td>${r.s.assists}</td>
            <td><strong>${r.s.total}</strong></td>
          </tr>
        `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderHeadToHead() {
  const wrap = el("head-to-head");
  if (!wrap) return;
  const weekKey = formatWeekKey();
  ensureWeekly(weekKey);

  const matches = state.h2h[weekKey] || [];
  const score = (tid) => (state.weekly[weekKey].scores[tid]?.total ?? 0);

  wrap.innerHTML = `
    <div class="card">
      <h3>Head-to-Head — ${weekKey}</h3>
      ${matches.map(m => {
        const home = state.teams.find(t=>t.id===m.homeId);
        const away = m.awayId ? state.teams.find(t=>t.id===m.awayId) : null;
        return `
          <div class="h2h-row">
            <div class="h2h-team">${home?.name ?? "TBD"} <span class="score">${score(m.homeId)}</span></div>
            <div class="h2h-vs">vs</div>
            <div class="h2h-team">${away?.name ?? "(BYE)"} <span class="score">${away ? score(m.awayId) : "-"}</span></div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

/** ========================
 *  ENTRYPOINTS / DEMO FLOW
 *  ======================== */
function initWeek() {
  const weekKey = formatWeekKey();
  ensureWeekly(weekKey);

  // Demo: if no roster for team Alpha, load demo 10
  if (!state.weekly[weekKey].rosters["u1"]) {
    adminSetTeamRoster("u1", ["p1","p2","p3","p4","p5","p6","p7","p8","p9","p10"]);
  }
  // Demo: team Beta mirrors
  if (!state.weekly[weekKey].rosters["u2"]) {
    adminSetTeamRoster("u2", ["p1","p2","p3","p4","p5","p6","p7","p8","p9","p10"]);
  }

  renderWeeklyRosterUI(currentUserId);
  renderGamePicksUI(currentUserId);
  renderLeaderboard();
  renderHeadToHead();
}

// For demo/testing: simulate stats + calculate scores
function simulateAndScore() {
  const weekKey = formatWeekKey();
  simulateStatsForWeek(weekKey);
  calcWeekScores(weekKey);
  renderLeaderboard();
  renderHeadToHead();
}

// Hook buttons (if present in index.html)
document.addEventListener("DOMContentLoaded", () => {
  initWeek();

  const btnSim = el("btn-simulate");
  if (btnSim) btnSim.addEventListener("click", simulateAndScore);

  const btnReset = el("btn-reset-week");
  if (btnReset) btnReset.addEventListener("click", () => {
    const wk = formatWeekKey();
    delete state.weekly[wk];
    ls.set("weekly", state.weekly);
    initWeek();
  });

  const btnSwapUser = el("btn-swap-user");
  if (btnSwapUser) btnSwapUser.addEventListener("click", () => {
    currentUserId = currentUserId === "u1" ? "u2" : "u1";
    ls.set("currentUserId", currentUserId);
    initWeek();
  });
});
