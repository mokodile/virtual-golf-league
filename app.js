import { firebaseConfig, firebaseEnabled } from "./firebase-config.js";

const PLAYER_KEY = "golf-player";
const LOCAL_KEY = "golf-league";

const SEED = {
  mokodile: { name: "Mokodile", handicap: 17 },
  rondon: { name: "RonDon", handicap: 9 },
};

// Grosses are the par 72 card. Front + back = gross. One field, ranked by net.
const FIELD = [
  { name: "Mara Ellison", index: 7, front: 38, back: 38 },
  { name: "Chris Daley", index: 8, front: 40, back: 39 },
  { name: "Priya Shah", index: 9, front: 41, back: 40 },
  { name: "Lena Cho", index: 10, front: 42, back: 41 },
  { name: "Owen Briggs", index: 6, front: 39, back: 41 },
  { name: "Nora Voss", index: 12, front: 44, back: 42 },
  { name: "Samir Adeyemi", index: 11, front: 41, back: 45 },
  { name: "Jordan Hale", index: 9, front: 43, back: 42 },
  { name: "Elliot Park", index: 8, front: 44, back: 42 },
  { name: "Devon Ruiz", index: 11, front: 49, back: 43 },
  { name: "Andre Brooks", index: 14, front: 41, back: 42 },
  { name: "Keisha Lang", index: 15, front: 43, back: 43 },
  { name: "Tomasz Wojcik", index: 16, front: 44, back: 44 },
  { name: "Riley Chen", index: 13, front: 42, back: 45 },
  { name: "Harper Quinn", index: 17, front: 46, back: 45 },
  { name: "Malik Foster", index: 18, front: 47, back: 46 },
  { name: "Casey Nguyen", index: 19, front: 48, back: 47 },
  { name: "Sofia Marin", index: 15, front: 45, back: 47 },
  { name: "Ben Okonkwo", index: 16, front: 46, back: 48 },
  { name: "Jules Perrin", index: 17, front: 53, back: 47 },
];

const now = new Date();
let viewYear = now.getFullYear();
let viewMonth = now.getMonth();
let selectedWeekId = null;
let you = null;
let players = {};
let weeks = {};
let syncMode = "connecting";
let remote = null;
const dirty = { course: false, par: false, gross: false, handicap: false };

const $ = (id) => document.getElementById(id);

function isGross(n) {
  return Number.isInteger(n) && n >= 40 && n <= 160;
}

function isPar(n) {
  return Number.isInteger(n) && n >= 60 && n <= 80;
}

function isHandicap(n) {
  return Number.isFinite(n) && n >= 0 && n <= 54;
}

function isoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function mondayOf(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d;
}

function weeksForMonth(year, monthIndex) {
  const last = new Date(year, monthIndex + 1, 0);
  let monday = mondayOf(new Date(year, monthIndex, 1));
  if (monday.getMonth() !== monthIndex) monday.setDate(monday.getDate() + 7);
  const list = [];
  while (monday <= last) {
    const start = new Date(monday);
    const end = new Date(monday);
    end.setDate(end.getDate() + 6);
    list.push({ id: isoDate(start), start, end });
    monday = new Date(monday);
    monday.setDate(monday.getDate() + 7);
  }
  return list;
}

function monthWeeks() {
  return weeksForMonth(viewYear, viewMonth);
}

function elapsedWeeks() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const current = today.getFullYear() === viewYear && today.getMonth() === viewMonth;
  return monthWeeks().filter((week) => (current ? week.start <= today : true));
}

function blankWeek() {
  return { courseName: "", par: 72, scores: {} };
}

function selectedWeek() {
  return weeks[selectedWeekId] || blankWeek();
}

function ensureWeekSelection() {
  const list = monthWeeks();
  if (!list.length) return;
  if (!list.some((week) => week.id === selectedWeekId)) {
    const todayId = isoDate(mondayOf(new Date()));
    selectedWeekId = (list.find((week) => week.id === todayId) || list[list.length - 1]).id;
  }
}

function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatNum(n) {
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function formatNet(n) {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function toPar(gross, par) {
  const diff = Math.round((gross - par) * 10) / 10;
  if (diff === 0) return "E";
  return diff > 0 ? `+${formatNet(diff)}` : formatNet(diff);
}

function ordinal(n) {
  const teen = n % 100;
  if (teen >= 11 && teen <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

function weekLabel(week) {
  return week.start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function monthLabel() {
  return new Date(viewYear, viewMonth, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function slug(name) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
  return base || "player";
}

function uniqueId(name) {
  const base = slug(name);
  if (!players[base]) return base;
  let n = 2;
  while (players[`${base}-${n}`]) n += 1;
  return `${base}-${n}`;
}

function normalizePlayers(data) {
  const out = {};
  if (!data || typeof data !== "object") return out;
  for (const [id, value] of Object.entries(data)) {
    if (!/^[a-z0-9-]{1,40}$/.test(id) || !value || typeof value.name !== "string") continue;
    const handicap = Math.round(Number(value.handicap) * 100) / 100;
    const name = value.name.trim();
    if (!name || !isHandicap(handicap)) continue;
    out[id] = { id, name, handicap };
  }
  return out;
}

function normalizeWeeks(data) {
  const out = {};
  if (!data || typeof data !== "object") return out;
  for (const [id, value] of Object.entries(data)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(id) || !value) continue;
    const scores = {};
    if (value.scores && typeof value.scores === "object") {
      for (const [pid, gross] of Object.entries(value.scores)) {
        if (isGross(gross)) scores[pid] = gross;
      }
    }
    out[id] = {
      courseName: typeof value.courseName === "string" ? value.courseName : "",
      par: isPar(value.par) ? value.par : 72,
      scores,
    };
  }
  return out;
}

function playerList() {
  return Object.values(players).sort((a, b) => a.name.localeCompare(b.name));
}

function shiftEntry(entry, par) {
  const delta = par - 72;
  const frontDelta = Math.floor(delta / 2);
  const backDelta = delta - frontDelta;
  const front = entry.front + frontDelta;
  const back = entry.back + backDelta;
  const gross = front + back;
  return {
    name: entry.name,
    index: entry.index,
    front,
    back,
    gross,
    net: gross - entry.index,
    you: false,
  };
}

function rankedField() {
  const week = selectedWeek();
  const rows = FIELD.map((entry) => shiftEntry(entry, week.par));
  for (const player of playerList()) {
    const gross = week.scores[player.id];
    if (!isGross(gross)) continue;
    rows.push({
      name: player.name,
      index: player.handicap,
      front: null,
      back: null,
      gross,
      net: gross - player.handicap,
      you: player.id === you,
    });
  }
  rows.sort((a, b) => a.net - b.net || a.gross - b.gross || a.name.localeCompare(b.name));
  return rows.map((row, index) => ({ ...row, place: index + 1 }));
}

function monthRows() {
  const weeksInView = monthWeeks();
  const required = elapsedWeeks();
  return playerList().map((player) => {
    const nets = [];
    for (const week of weeksInView) {
      const gross = weeks[week.id] && weeks[week.id].scores[player.id];
      const par = weeks[week.id] ? weeks[week.id].par : 72;
      if (!isGross(gross)) continue;
      nets.push({ net: gross - player.handicap, gross, par });
    }
    const playedIds = new Set(
      weeksInView.filter((week) => weeks[week.id] && isGross(weeks[week.id].scores[player.id])).map((week) => week.id)
    );
    const missing = required.filter((week) => !playedIds.has(week.id));
    const total = nets.reduce((sum, row) => sum + row.net, 0);
    return {
      player,
      played: playedIds.size,
      required: required.length,
      missing,
      total,
      average: nets.length ? total / nets.length : null,
      current: missing.length === 0 && required.length > 0,
    };
  });
}

function debounce(fn, ms) {
  let timer = 0;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), ms);
  };
}

function readLocal() {
  try {
    const saved = JSON.parse(localStorage.getItem(LOCAL_KEY) || "null");
    if (!saved) return;
    players = normalizePlayers(saved.players);
    weeks = normalizeWeeks(saved.weeks);
  } catch {
    players = {};
    weeks = {};
  }
}

function persistLocal() {
  localStorage.setItem(LOCAL_KEY, JSON.stringify({ players, weeks }));
}

async function write(path, payload) {
  if (remote) {
    await remote.update(path, payload);
    syncMode = "live";
  } else {
    persistLocal();
  }
}

async function saveWeek(partialScores) {
  const week = selectedWeek();
  const next = {
    courseName: partialScores.courseName !== undefined ? partialScores.courseName : week.courseName,
    par: partialScores.par !== undefined ? partialScores.par : week.par,
    scores: { ...week.scores },
  };
  if (partialScores.scoreId) {
    if (isGross(partialScores.score)) next.scores[partialScores.scoreId] = partialScores.score;
    else delete next.scores[partialScores.scoreId];
  }
  weeks = { ...weeks, [selectedWeekId]: next };
  if (remote) {
    const payload = { courseName: next.courseName, par: next.par };
    if (partialScores.scoreId && isGross(partialScores.score)) {
      payload[`scores/${partialScores.scoreId}`] = partialScores.score;
    }
    try {
      await remote.update(`weeks/${selectedWeekId}`, payload);
      if (partialScores.scoreId && !isGross(partialScores.score)) {
        await remote.update(`weeks/${selectedWeekId}/scores`, { [partialScores.scoreId]: null });
      }
      syncMode = "live";
    } catch {
      syncMode = "error";
      persistLocal();
    }
  } else {
    persistLocal();
  }
  paintRound();
}

async function saveHandicap(handicap) {
  if (!you || !players[you]) return;
  players = { ...players, [you]: { ...players[you], handicap } };
  try {
    await write(`players/${you}`, { name: players[you].name, handicap });
  } catch {
    syncMode = "error";
    persistLocal();
  }
  paintRound();
}

function seedPlayers() {
  players = normalizePlayers(SEED);
  persistLocal();
}

async function startSync() {
  const savedId = localStorage.getItem(PLAYER_KEY);
  you = savedId || null;
  ensureWeekSelection();

  if (!firebaseEnabled) {
    readLocal();
    if (!Object.keys(players).length) seedPlayers();
    if (you && !players[you]) you = null;
    syncMode = "local";
    return;
  }

  try {
    const { initializeApp } = await import("https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js");
    const { getDatabase, ref, onValue, update, get } = await import(
      "https://www.gstatic.com/firebasejs/11.6.0/firebase-database.js"
    );
    const db = getDatabase(initializeApp(firebaseConfig));
    remote = {
      update(path, payload) {
        return update(ref(db, path), payload);
      },
    };
    await new Promise((resolve) => {
      let playersReady = false;
      let weeksReady = false;
      const finish = () => {
        if (playersReady && weeksReady) resolve();
      };
      onValue(ref(db, "players"), async (snap) => {
        const incoming = normalizePlayers(snap.val());
        if (!Object.keys(incoming).length && !playersReady) {
          try {
            await update(ref(db, "players"), SEED);
          } catch {
            players = normalizePlayers(SEED);
          }
        } else {
          players = incoming;
        }
        const hadPlayers = Object.keys(incoming).length > 0 || playersReady;
        const removed = hadPlayers && you && !players[you];
        if (removed) {
          you = null;
          localStorage.removeItem(PLAYER_KEY);
        }
        playersReady = true;
        syncMode = "live";
        if (removed) showPicker();
        else if (you) paintRound();
        else paintPicker();
        finish();
      }, () => {
        readLocal();
        if (!Object.keys(players).length) seedPlayers();
        syncMode = "error";
        remote = null;
        playersReady = true;
        weeksReady = true;
        finish();
      });
      onValue(ref(db, "weeks"), (snap) => {
        weeks = normalizeWeeks(snap.val());
        weeksReady = true;
        syncMode = "live";
        ensureWeekSelection();
        if (you) paintRound();
        finish();
      });
    });
    const legacy = await get(ref(db, "round"));
    await migrateLegacy(legacy.val());
  } catch {
    readLocal();
    if (!Object.keys(players).length) seedPlayers();
    syncMode = "error";
    remote = null;
  }
}

async function migrateLegacy(round) {
  if (!round || !remote) return;
  const weekId = isoDate(mondayOf(new Date()));
  if (weeks[weekId]) return;
  const scores = {};
  if (isGross(round.mokodileGross)) scores.mokodile = round.mokodileGross;
  if (isGross(round.rondonGross)) scores.rondon = round.rondonGross;
  if (!round.courseName && !Object.keys(scores).length) return;
  const payload = {
    courseName: typeof round.courseName === "string" ? round.courseName : "",
    par: isPar(round.par) ? round.par : 72,
  };
  for (const [id, gross] of Object.entries(scores)) payload[`scores/${id}`] = gross;
  try {
    await remote.update(`weeks/${weekId}`, payload);
  } catch {
    syncMode = "error";
  }
}

function paintSync() {
  const dot = $("sync-dot");
  const text = $("sync-text");
  dot.className = "dot";
  if (syncMode === "live") {
    dot.classList.add("live");
    text.textContent = "Live · every phone sees the month";
  } else if (syncMode === "local") {
    dot.classList.add("local");
    text.textContent = "This phone only · the league isn't connected";
  } else if (syncMode === "error") {
    dot.classList.add("error");
    text.textContent = "Couldn't reach the league";
  } else {
    text.textContent = "Connecting…";
  }
}

function setIfIdle(id, value, dirtyKey) {
  const el = $(id);
  if (!el || document.activeElement === el || dirty[dirtyKey]) return;
  if (el.value !== value) el.value = value;
}

function paintPicker() {
  const list = $("player-list");
  list.innerHTML = playerList().map((player) => `
    <button class="player-btn" type="button" data-player="${esc(player.id)}">
      <span class="player-name">${esc(player.name)}</span>
      <span class="player-meta">${esc(formatNum(player.handicap))} handicap</span>
    </button>
  `).join("");
}

function paintWeeks() {
  ensureWeekSelection();
  const required = new Set(elapsedWeeks().map((week) => week.id));
  $("month-label").textContent = monthLabel();
  const today = new Date();
  const atCurrent = viewYear === today.getFullYear() && viewMonth === today.getMonth();
  $("month-next").disabled = atCurrent;
  $("weeks").innerHTML = monthWeeks().map((week) => {
    const posted = weeks[week.id] && isGross(weeks[week.id].scores[you]);
    const due = required.has(week.id) && !posted;
    const note = posted ? "Posted" : due ? "Due" : "Open";
    return `<button class="week-btn${week.id === selectedWeekId ? " is-selected" : ""}" type="button" data-week="${week.id}">
      ${esc(weekLabel(week))}
      <small>${note}</small>
    </button>`;
  }).join("");
}

function paintOthers() {
  const week = selectedWeek();
  const rest = playerList().filter((player) => player.id !== you);
  if (!rest.length) {
    $("others").innerHTML = `<p class="score-readout">Add a player from the name screen.</p>`;
    return;
  }
  $("others").innerHTML = rest.map((player) => {
    const gross = week.scores[player.id];
    const score = isGross(gross) ? String(gross) : "—";
    const detail = isGross(gross)
      ? `Net ${formatNet(gross - player.handicap)} · ${toPar(gross, week.par)} · locked`
      : "No round this week.";
    return `<div class="other-row">
      <p class="other-name">${esc(player.name)} · ${esc(formatNum(player.handicap))} handicap</p>
      <p class="other-score">${score}</p>
      <p class="score-readout">${detail}</p>
    </div>`;
  }).join("");
}

function paintRound() {
  if (!you || !players[you]) return;
  ensureWeekSelection();
  const self = players[you];
  const week = selectedWeek();
  $("you-heading").textContent = self.name;
  $("you-meta").textContent = `${formatNum(self.handicap)} handicap`;
  $("score-label").textContent = `${self.name} this week`;
  setIfIdle("course", week.courseName, "course");
  setIfIdle("par", String(week.par), "par");
  setIfIdle("handicap", formatNum(self.handicap), "handicap");
  const yours = week.scores[you];
  setIfIdle("your-gross", isGross(yours) ? String(yours) : "", "gross");
  $("your-readout").textContent = isGross(yours)
    ? `Net ${formatNet(yours - self.handicap)} · ${toPar(yours, week.par)} to par`
    : "One gross for this week. The month adds every week you post.";
  paintWeeks();
  paintOthers();
  paintSync();
  paintBoard();
}

function paintBoard() {
  const board = $("board");
  const week = selectedWeek();
  const posted = playerList().filter((player) => isGross(week.scores[player.id]));
  const month = monthTable();
  if (!week.courseName.trim() || !posted.length) {
    board.innerHTML = `${month}<p class="waiting">This week's field fills in after the course and at least one gross are posted.</p>`;
    return;
  }
  const ranking = rankedField();
  const places = posted.map((player) => {
    const row = ranking.find((item) => item.name === player.name);
    return `<article class="place-card${player.id === you ? " is-you" : ""}">
      <span class="place-num">${ordinal(row.place)}</span>
      <span>${esc(player.name)}</span>
    </article>`;
  }).join("");
  board.innerHTML = `${month}<div class="places">${places}</div>${fieldTable(ranking)}`;
}

function monthTable() {
  const rows = monthRows().sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    if (a.average == null && b.average == null) return a.player.name.localeCompare(b.player.name);
    if (a.average == null) return 1;
    if (b.average == null) return -1;
    return a.average - b.average || a.total - b.total || a.player.name.localeCompare(b.player.name);
  });
  let place = 0;
  const body = rows.map((row) => {
    if (row.current) place += 1;
    const placeCell = row.current ? place : "—";
    const total = row.average == null ? "—" : formatNet(row.total);
    const average = row.average == null ? "—" : formatNet(row.average);
    return `<tr class="${row.player.id === you ? "is-you" : ""} ${row.current ? "" : "is-behind"}">
      <td>${placeCell}</td>
      <td>
        <span class="pname">${esc(row.player.name)}</span>
        <span class="pdetail">${row.current ? "In the running" : `${row.missing.length} week${row.missing.length === 1 ? "" : "s"} still open`}</span>
      </td>
      <td>${row.played}/${row.required}</td>
      <td>${total}</td>
      <td>${average}</td>
    </tr>`;
  }).join("");
  const due = elapsedWeeks().length;
  return `<section class="flight">
    <h2>${esc(monthLabel())}</h2>
    <p class="flight-meta">One round each week. ${due} week${due === 1 ? "" : "s"} so far. The total adds the net scores.</p>
    <div class="table-wrap">
      <table class="month-table">
        <thead>
          <tr>
            <th>Place</th>
            <th>Player</th>
            <th>Weeks</th>
            <th>Total</th>
            <th>Avg</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    <p class="hint">A player stays in the running by posting every week so far. Place is average net, then total net, then name.</p>
  </section>`;
}

function fieldTable(ranking) {
  const week = selectedWeek();
  const rows = ranking.map((row) => {
    const nines = row.front == null
      ? `${formatNum(row.index)} hcp`
      : `${formatNum(row.index)} hcp · ${row.front}/${row.back}`;
    return `<tr class="${row.you ? "is-you" : ""}">
      <td>${row.place}</td>
      <td>
        <span class="pname">${esc(row.name)}</span>
        <span class="pdetail">${nines} · ${toPar(row.gross, week.par)}</span>
      </td>
      <td>${row.gross}</td>
      <td>${formatNet(row.net)}</td>
    </tr>`;
  }).join("");
  const shift = week.par - 72;
  const shiftNote = shift === 0
    ? "Rating 72.0, slope 113, so the handicap is the course handicap."
    : `Simulated scores are the par 72 card shifted by ${shift > 0 ? `+${shift}` : shift}.`;
  return `<section class="flight">
    <h2>The field</h2>
    <p class="flight-meta">${esc(weekLabel(monthWeeks().find((item) => item.id === selectedWeekId) || monthWeeks()[0]))}</p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Place</th><th>Player</th><th>Gross</th><th>Net</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="hint">${esc(week.courseName.trim())} · par ${week.par}. Net is gross minus handicap. ${shiftNote}</p>
  </section>`;
}

async function onCourse() {
  const value = $("course").value.slice(0, 80);
  await saveWeek({ courseName: value });
  if ($("course").value.slice(0, 80) === value) dirty.course = false;
}

async function onPar() {
  const par = Number($("par").value);
  if (!isPar(par)) return;
  await saveWeek({ par });
  if (Number($("par").value) === par) dirty.par = false;
}

async function onGross() {
  const raw = $("your-gross").value.trim();
  if (raw === "") {
    await saveWeek({ scoreId: you, score: null });
    if ($("your-gross").value.trim() === "") dirty.gross = false;
    return;
  }
  const gross = Number(raw);
  if (!isGross(gross)) return;
  await saveWeek({ scoreId: you, score: gross });
  if (Number($("your-gross").value) === gross) dirty.gross = false;
}

async function onHandicap() {
  const handicap = Math.round(Number($("handicap").value) * 100) / 100;
  if (!isHandicap(handicap)) return;
  await saveHandicap(handicap);
  if (Math.round(Number($("handicap").value) * 100) / 100 === handicap) dirty.handicap = false;
}

function showPicker() {
  $("picker").hidden = false;
  $("round").hidden = true;
  paintPicker();
}

function showRound() {
  $("picker").hidden = true;
  $("round").hidden = false;
  dirty.course = false;
  dirty.par = false;
  dirty.gross = false;
  dirty.handicap = false;
  paintRound();
}

function shiftMonth(delta) {
  const today = new Date();
  const next = new Date(viewYear, viewMonth + delta, 1);
  const cap = new Date(today.getFullYear(), today.getMonth(), 1);
  if (next > cap) return;
  viewYear = next.getFullYear();
  viewMonth = next.getMonth();
  selectedWeekId = null;
  dirty.course = false;
  dirty.par = false;
  dirty.gross = false;
  if (you) paintRound();
}

$("player-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-player]");
  if (!button || !players[button.dataset.player]) return;
  you = button.dataset.player;
  localStorage.setItem(PLAYER_KEY, you);
  showRound();
});

$("add-player").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = $("new-name").value.trim().slice(0, 40);
  const handicap = Math.round(Number($("new-handicap").value) * 100) / 100;
  const note = $("add-note");
  if (!name || !isHandicap(handicap)) {
    note.textContent = "Enter a name and a handicap from 0 to 54.";
    return;
  }
  if (playerList().some((player) => player.name.toLowerCase() === name.toLowerCase())) {
    note.textContent = "That name is already in the league. Tap it above.";
    return;
  }
  const id = uniqueId(name);
  players = { ...players, [id]: { id, name, handicap } };
  try {
    await write(`players/${id}`, { name, handicap });
  } catch {
    syncMode = "error";
    persistLocal();
  }
  $("new-name").value = "";
  $("new-handicap").value = "";
  note.textContent = "";
  you = id;
  localStorage.setItem(PLAYER_KEY, you);
  showRound();
});

$("switch-player").addEventListener("click", () => {
  localStorage.removeItem(PLAYER_KEY);
  you = null;
  showPicker();
});

$("weeks").addEventListener("click", (event) => {
  const button = event.target.closest("[data-week]");
  if (!button) return;
  selectedWeekId = button.dataset.week;
  dirty.course = false;
  dirty.par = false;
  dirty.gross = false;
  paintRound();
});

$("month-prev").addEventListener("click", () => shiftMonth(-1));
$("month-next").addEventListener("click", () => shiftMonth(1));

const saveCourse = debounce(onCourse, 400);
const savePar = debounce(onPar, 400);
const saveGross = debounce(onGross, 400);
const saveHcp = debounce(onHandicap, 400);

$("course").addEventListener("input", () => { dirty.course = true; saveCourse(); });
$("par").addEventListener("input", () => { dirty.par = true; savePar(); });
$("your-gross").addEventListener("input", () => { dirty.gross = true; saveGross(); });
$("handicap").addEventListener("input", () => { dirty.handicap = true; saveHcp(); });

startSync().then(() => {
  ensureWeekSelection();
  if (you && players[you]) showRound();
  else showPicker();
});
