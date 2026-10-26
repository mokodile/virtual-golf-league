import { firebaseConfig, firebaseEnabled } from "./firebase-config.js";

const PLAYER_KEY = "golf-player";
const ROUND_KEY = "golf-round";

const PLAYERS = {
  mokodile: { id: "mokodile", name: "Mokodile", index: 17, flight: "B" },
  rondon: { id: "rondon", name: "RonDon", index: 9, flight: "A" },
};

// Grosses are the par 72 card. Front + back = gross. Nets are gross minus index.
const FIELD = {
  A: [
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
  ],
  B: [
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
  ],
};

const FLIGHTS = {
  A: { title: "A Flight", meta: "Indexes 6–12 · RonDon" },
  B: { title: "B Flight", meta: "Indexes 13–19 · Mokodile" },
};

let you = null;
let round = blankRound();
let syncMode = "connecting";
let remote = null;
const dirty = { course: false, par: false, gross: false };

const $ = (id) => document.getElementById(id);

function blankRound() {
  return { courseName: "", par: 72, mokodileGross: null, rondonGross: null };
}

function isGross(n) {
  return Number.isInteger(n) && n >= 40 && n <= 160;
}

function isPar(n) {
  return Number.isInteger(n) && n >= 60 && n <= 80;
}

function grossKey(id) {
  return id === "mokodile" ? "mokodileGross" : "rondonGross";
}

function normalizeRound(data) {
  const src = data && typeof data === "object" ? data : {};
  return {
    courseName: typeof src.courseName === "string" ? src.courseName : "",
    par: isPar(src.par) ? src.par : 72,
    mokodileGross: isGross(src.mokodileGross) ? src.mokodileGross : null,
    rondonGross: isGross(src.rondonGross) ? src.rondonGross : null,
  };
}

function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toPar(gross, par) {
  const diff = gross - par;
  if (diff === 0) return "E";
  return diff > 0 ? `+${diff}` : String(diff);
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

function rankedFlight(flightId) {
  const par = round.par;
  const rows = FIELD[flightId].map((entry) => shiftEntry(entry, par));
  for (const player of Object.values(PLAYERS)) {
    if (player.flight !== flightId) continue;
    const gross = round[grossKey(player.id)];
    if (!isGross(gross)) continue;
    rows.push({
      name: player.name,
      index: player.index,
      front: null,
      back: null,
      gross,
      net: gross - player.index,
      you: player.id === you,
    });
  }
  rows.sort((a, b) => a.net - b.net || a.gross - b.gross || a.name.localeCompare(b.name));
  return rows.map((row, index) => ({ ...row, place: index + 1 }));
}

function bothPosted() {
  return round.courseName.trim() !== "" && isGross(round.mokodileGross) && isGross(round.rondonGross);
}

function joinList(items) {
  if (items.length <= 1) return items[0] || "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function placeFor(playerId) {
  const player = PLAYERS[playerId];
  const rows = rankedFlight(player.flight);
  return rows.find((row) => row.name === player.name) || null;
}

function debounce(fn, ms) {
  let timer = 0;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), ms);
  };
}

function readLocalRound() {
  try {
    return normalizeRound(JSON.parse(localStorage.getItem(ROUND_KEY) || "null"));
  } catch {
    return blankRound();
  }
}

function persistLocal() {
  localStorage.setItem(ROUND_KEY, JSON.stringify(round));
}

async function pushRound(partial) {
  const previous = round;
  round = normalizeRound({ ...round, ...partial });
  if (remote) {
    const payload = {
      courseName: round.courseName,
      par: round.par,
    };
    if (isGross(round.mokodileGross)) payload.mokodileGross = round.mokodileGross;
    if (isGross(round.rondonGross)) payload.rondonGross = round.rondonGross;
    try {
      await remote.update(payload);
      const clears = {};
      if (isGross(previous.mokodileGross) && !isGross(round.mokodileGross)) clears.mokodileGross = null;
      if (isGross(previous.rondonGross) && !isGross(round.rondonGross)) clears.rondonGross = null;
      if (Object.keys(clears).length) await remote.update(clears);
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

async function startSync() {
  const savedId = localStorage.getItem(PLAYER_KEY);
  you = savedId === "mokodile" || savedId === "rondon" ? savedId : null;

  if (!firebaseEnabled) {
    round = readLocalRound();
    syncMode = "local";
    return;
  }

  try {
    const { initializeApp } = await import("https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js");
    const { getDatabase, ref, onValue, update } = await import(
      "https://www.gstatic.com/firebasejs/11.6.0/firebase-database.js"
    );
    const db = getDatabase(initializeApp(firebaseConfig));
    const roundRef = ref(db, "round");
    remote = {
      update(payload) {
        return update(roundRef, payload);
      },
    };
    await new Promise((resolve) => {
      onValue(
        roundRef,
        (snap) => {
          round = normalizeRound(snap.val());
          syncMode = "live";
          if (you) paintRound();
          resolve();
        },
        () => {
          round = readLocalRound();
          syncMode = "error";
          remote = null;
          if (you) paintRound();
          resolve();
        }
      );
    });
  } catch {
    round = readLocalRound();
    syncMode = "error";
    remote = null;
  }
}

function paintSync() {
  const dot = $("sync-dot");
  const text = $("sync-text");
  dot.className = "dot";
  if (syncMode === "live") {
    dot.classList.add("live");
    text.textContent = "Live · both phones see this round";
  } else if (syncMode === "local") {
    dot.classList.add("local");
    text.textContent = "This phone only · shared round isn't connected";
  } else if (syncMode === "error") {
    dot.classList.add("error");
    text.textContent = "Couldn't reach the shared round";
  } else {
    text.textContent = "Connecting…";
  }
}

function setIfIdle(id, value, dirtyKey) {
  const el = $(id);
  if (!el || document.activeElement === el || dirty[dirtyKey]) return;
  if (el.value !== value) el.value = value;
}

function paintRound() {
  if (!you) return;
  const self = PLAYERS[you];
  const other = PLAYERS[you === "mokodile" ? "rondon" : "mokodile"];
  $("you-heading").textContent = self.name;
  $("you-meta").textContent = `${self.index} handicap · ${self.flight} Flight`;
  $("score-label").textContent = `${self.name}'s score`;
  $("other-label").textContent = `${other.name}'s score`;
  $("other-name").textContent = `${other.name} · ${other.index} handicap · ${other.flight} Flight`;

  setIfIdle("course", round.courseName, "course");
  setIfIdle("par", String(round.par), "par");
  const yours = round[grossKey(you)];
  setIfIdle("your-gross", isGross(yours) ? String(yours) : "", "gross");

  if (isGross(yours)) {
    $("your-readout").textContent = `Net ${yours - self.index} · ${toPar(yours, round.par)} to par`;
  } else {
    $("your-readout").textContent = "Enter the gross from the card.";
  }

  const theirs = round[grossKey(other.id)];
  if (isGross(theirs)) {
    $("other-score").textContent = String(theirs);
    $("other-readout").textContent = `Net ${theirs - other.index} · ${toPar(theirs, round.par)} to par · locked`;
  } else {
    $("other-score").textContent = "—";
    $("other-readout").textContent = `${other.name} hasn't posted a score yet.`;
  }

  paintSync();
  paintBoard();
}

function paintBoard() {
  const board = $("board");
  if (!bothPosted()) {
    const missing = [];
    if (round.courseName.trim() === "") missing.push("the course name");
    if (!isGross(round.mokodileGross)) missing.push("Mokodile's score");
    if (!isGross(round.rondonGross)) missing.push("RonDon's score");
    const listed = joinList(missing);
    const verb = missing.length === 1 ? "is" : "are";
    board.innerHTML = `<p class="waiting">The flights fill in after ${esc(listed)} ${verb} in.</p>`;
    return;
  }

  const places = ["rondon", "mokodile"].map((id) => {
    const player = PLAYERS[id];
    const row = placeFor(id);
    return `<article class="place-card${id === you ? " is-you" : ""}">
      <span class="place-num">${ordinal(row.place)}</span>
      <span>${esc(player.name)} · ${player.flight} Flight</span>
    </article>`;
  }).join("");

  const flights = ["A", "B"].map((flightId) => flightTable(flightId)).join("");
  board.innerHTML = `<div class="places">${places}</div><div class="flights">${flights}</div>`;
}

function flightTable(flightId) {
  const info = FLIGHTS[flightId];
  const rows = rankedFlight(flightId).map((row) => {
    const nines = row.front == null ? `${row.index} hcp` : `${row.index} hcp · ${row.front}/${row.back}`;
    return `<tr class="${row.you ? "is-you" : ""}">
      <td>${row.place}</td>
      <td>
        <span class="pname">${esc(row.name)}</span>
        <span class="pdetail">${nines} · ${toPar(row.gross, round.par)}</span>
      </td>
      <td>${row.gross}</td>
      <td>${row.net}</td>
    </tr>`;
  }).join("");

  const shift = round.par - 72;
  const shiftNote = shift === 0
    ? "Rating 72.0, slope 113, so the index is the course handicap."
    : `Simulated scores are the par 72 card shifted by ${shift > 0 ? `+${shift}` : shift}.`;

  return `<section class="flight">
    <h2>${info.title}</h2>
    <p class="flight-meta">${info.meta}</p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Place</th>
            <th>Player</th>
            <th>Gross</th>
            <th>Net</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="hint">${esc(round.courseName.trim())} · par ${round.par}. Net is gross minus index. ${shiftNote} Ties break on lower gross, then name.</p>
  </section>`;
}

async function onCourse() {
  const value = $("course").value.slice(0, 80);
  await pushRound({ courseName: value });
  if ($("course").value.slice(0, 80) === value) dirty.course = false;
}

async function onPar() {
  const par = Number($("par").value);
  if (!isPar(par)) return;
  await pushRound({ par });
  if (Number($("par").value) === par) dirty.par = false;
}

async function onGross() {
  const raw = $("your-gross").value.trim();
  if (raw === "") {
    await pushRound({ [grossKey(you)]: null });
    if ($("your-gross").value.trim() === "") dirty.gross = false;
    return;
  }
  const gross = Number(raw);
  if (!isGross(gross)) return;
  await pushRound({ [grossKey(you)]: gross });
  if (Number($("your-gross").value) === gross) dirty.gross = false;
}

function showPicker() {
  $("picker").hidden = false;
  $("round").hidden = true;
}

function showRound() {
  $("picker").hidden = true;
  $("round").hidden = false;
  paintRound();
}

document.querySelectorAll(".player-btn").forEach((button) => {
  button.addEventListener("click", () => {
    you = button.dataset.player;
    localStorage.setItem(PLAYER_KEY, you);
    showRound();
  });
});

$("switch-player").addEventListener("click", () => {
  localStorage.removeItem(PLAYER_KEY);
  you = null;
  showPicker();
});

const saveCourse = debounce(onCourse, 400);
const savePar = debounce(onPar, 400);
const saveGross = debounce(onGross, 400);

$("course").addEventListener("input", () => {
  dirty.course = true;
  saveCourse();
});
$("par").addEventListener("input", () => {
  dirty.par = true;
  savePar();
});
$("your-gross").addEventListener("input", () => {
  dirty.gross = true;
  saveGross();
});

startSync().then(() => {
  if (you) showRound();
  else showPicker();
});
