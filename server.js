const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");

// 1. Keskkonnamuutujate laadimine ja kontroll
try {
  if (fs.existsSync(".env")) {
    process.loadEnvFile(".env");
  }
} catch (e) {
  console.log("Märkus: .env faili automaatne laadimine ebaõnnestus või puudub:", e.message);
}

const FRONT_DESK_KEY = process.env.FRONT_DESK_KEY;
const RACE_CONTROL_KEY = process.env.RACE_CONTROL_KEY;
const LAP_LINE_KEY = process.env.LAP_LINE_KEY;
const PORT = process.env.PORT || 3000;

if (!FRONT_DESK_KEY || !RACE_CONTROL_KEY || !LAP_LINE_KEY) {
  console.error("VIGA: Nõutud keskkonnamuutujad (FRONT_DESK_KEY, RACE_CONTROL_KEY, LAP_LINE_KEY) on puudu!");
  console.error("Palun määra need .env failis või keskkonnas enne serveri käivitamist.");
  process.exit(1);
}

// 2. Taimeri pikkuse määramine (dev režiim 1 min, tavarežiim 10 min)
const isDevMode = process.argv.includes("--dev") || process.env.NODE_ENV === "development";
const RACE_DURATION_MS = isDevMode ? 60 * 1000 : 10 * 60 * 1000;
console.log(`Käivitusrežiim: ${isDevMode ? "DEVELOPMENT (1 min taimer)" : "PRODUCTION (10 min taimer)"}`);

// 3. Sündmuste konstandid
const EVENTS = require("./public/shared/events.js");

// 4. Express ja Socket.IO seadistus
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));
app.use("/shared", express.static(path.join(__dirname, "public", "shared")));

// Testkeskuse / Launchpadi marsruudid
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "testing.html")));
app.get("/testing", (req, res) => res.sendFile(path.join(__dirname, "public", "testing.html")));

// Avalikud esmatasandi marsruudid
app.get("/race-flags", (req, res) => res.sendFile(path.join(__dirname, "public", "race-flags.html")));
app.get("/race-countdown", (req, res) => res.sendFile(path.join(__dirname, "public", "race-countdown.html")));
app.get("/next-race", (req, res) => res.sendFile(path.join(__dirname, "public", "next-race.html")));
app.get("/leader-board", (req, res) => res.sendFile(path.join(__dirname, "public", "leader-board.html")));

// Töötajate esmatasandi marsruudid
app.get("/front-desk", (req, res) => res.sendFile(path.join(__dirname, "public", "front-desk.html")));
app.get("/race-control", (req, res) => res.sendFile(path.join(__dirname, "public", "race-control.html")));
app.get("/lap-line-tracker", (req, res) => res.sendFile(path.join(__dirname, "public", "lap-line-tracker.html")));

// 5. Rakenduse algseis (vastavalt CONTRACT.md p. 4)
const STATE_FILE = path.join(__dirname, "state.json");

let race = {
  status: "idle", // 'idle' | 'running' | 'finished'
  mode: "danger", // 'safe' | 'hazard' | 'danger' | 'finish'
  current: null,
  results: [],
  next: null,
  callToPaddock: false,
};
let sessions = [];
let timer = { remainingMs: 0 };
let timerInterval = null;
let nextSessionId = 1;
let carLastCrossTime = {}; // { [carNumber]: timestamp }
let raceEndTime = null;

// Boonus 1: Andmete püsivus (State persistence)
function saveState() {
  try {
    const data = {
      race,
      sessions,
      nextSessionId,
      carLastCrossTime,
      raceEndTime,
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error("Viga oleku salvestamisel:", err.message);
  }
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, "utf8");
      const saved = JSON.parse(raw);
      if (saved.race) race = saved.race;
      if (Array.isArray(saved.sessions)) sessions = saved.sessions;
      if (saved.nextSessionId) nextSessionId = saved.nextSessionId;
      if (saved.carLastCrossTime) carLastCrossTime = saved.carLastCrossTime;
      if (saved.raceEndTime) raceEndTime = saved.raceEndTime;

      // Kui server taaskäivitub poole võistluse ajal:
      if (race.status === "running" && raceEndTime) {
        const remaining = Math.max(0, raceEndTime - Date.now());
        if (remaining > 0) {
          timer.remainingMs = remaining;
          startTimerCountdown();
          console.log(`Taastatud pooleliolev võistlus, jäänud: ${Math.round(remaining / 1000)}s`);
        } else {
          race.status = "finished";
          race.mode = "finish";
          timer.remainingMs = 0;
          console.log("Taastatud võistluse aeg oli serveri maasoleku ajal lõppenud -> lülitatud režiimi FINISH");
        }
      }
    }
  } catch (err) {
    console.error("Viga oleku taastamisel:", err.message);
  }
}

loadState();

function allNamespaces() {
  return [io.of("/"), io.of("/front-desk"), io.of("/race-control"), io.of("/lap-line")];
}

function broadcastRace() {
  allNamespaces().forEach((nsp) => nsp.emit(EVENTS.RACE, race));
}

function broadcastTimer() {
  allNamespaces().forEach((nsp) => nsp.emit(EVENTS.TIMER, timer));
}

function broadcastSessions() {
  allNamespaces().forEach((nsp) => nsp.emit(EVENTS.SESSIONS, sessions));
}

function updateNextSession() {
  race.next = sessions.length > 0 ? sessions[0] : null;
}

function startTimerCountdown() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    timer.remainingMs -= 1000;
    if (timer.remainingMs <= 0) {
      timer.remainingMs = 0;
      clearInterval(timerInterval);
      timerInterval = null;
      race.status = "finished";
      race.mode = "finish";
      raceEndTime = null;
      saveState();
      broadcastRace();
    }
    broadcastTimer();
  }, 1000);
}

// 6. Autentimise middleware töötajate nimeruumidele (500 ms viivitus vale võtmega)
function createAuthMiddleware(expectedKey) {
  return (socket, next) => {
    const key = socket.handshake.auth && socket.handshake.auth.key;
    if (key === expectedKey) {
      return next();
    }
    setTimeout(() => {
      next(new Error("Invalid access key"));
    }, 500);
  };
}

// --- Avalik nimeruum / ---
io.of("/").on("connection", (socket) => {
  socket.emit(EVENTS.RACE, race);
  socket.emit(EVENTS.TIMER, timer);
});

// --- Front Desk nimeruum ---
const frontDeskNsp = io.of("/front-desk");
frontDeskNsp.use(createAuthMiddleware(FRONT_DESK_KEY));
frontDeskNsp.on("connection", (socket) => {
  socket.emit(EVENTS.RACE, race);
  socket.emit(EVENTS.TIMER, timer);
  socket.emit(EVENTS.SESSIONS, sessions);

  socket.on(EVENTS.SESSION_ADD, (payload, callback) => {
    const cb = typeof callback === "function" ? callback : () => {};
    const newSession = {
      id: nextSessionId++,
      drivers: [],
    };
    sessions.push(newSession);
    updateNextSession();
    saveState();
    broadcastSessions();
    broadcastRace();
    cb({ ok: true, session: newSession });
  });

  socket.on(EVENTS.SESSION_REMOVE, (payload, callback) => {
    const cb = typeof callback === "function" ? callback : () => {};
    const sessionId = payload && payload.sessionId;
    const initialLen = sessions.length;
    sessions = sessions.filter((s) => s.id !== sessionId);
    if (sessions.length === initialLen) {
      return cb({ ok: false, error: "Session not found" });
    }
    updateNextSession();
    saveState();
    broadcastSessions();
    broadcastRace();
    cb({ ok: true });
  });

  socket.on(EVENTS.DRIVER_ADD, (payload, callback) => {
    const cb = typeof callback === "function" ? callback : () => {};
    if (!payload || !payload.sessionId || !payload.name || !payload.name.trim()) {
      return cb({ ok: false, error: "Session ID and driver name are required" });
    }
    const session = sessions.find((s) => s.id === payload.sessionId);
    if (!session) {
      return cb({ ok: false, error: "Session not found" });
    }
    if (session.drivers.length >= 8) {
      return cb({ ok: false, error: "Session is full (max 8 drivers)" });
    }
    const nameTrimmed = payload.name.trim();
    if (session.drivers.some((d) => d.name.toLowerCase() === nameTrimmed.toLowerCase())) {
      return cb({ ok: false, error: "Driver name already exists" });
    }

    const usedCars = new Set(session.drivers.map((d) => d.car));
    let assignedCar = null;

    // Kui sooviti konkreetset autot (Boonus 2)
    if (payload.car) {
      const requestedCar = Number(payload.car);
      if (requestedCar < 1 || requestedCar > 8) {
        return cb({ ok: false, error: "Car number must be between 1 and 8" });
      }
      if (usedCars.has(requestedCar)) {
        return cb({ ok: false, error: `Car ${requestedCar} is already assigned` });
      }
      assignedCar = requestedCar;
    } else {
      // Automaatne jagamine: esimene vaba number 1..8
      for (let c = 1; c <= 8; c++) {
        if (!usedCars.has(c)) {
          assignedCar = c;
          break;
        }
      }
    }

    session.drivers.push({ name: nameTrimmed, car: assignedCar });
    session.drivers.sort((a, b) => a.car - b.car);
    updateNextSession();
    saveState();
    broadcastSessions();
    broadcastRace();
    cb({ ok: true, car: assignedCar });
  });

  socket.on(EVENTS.DRIVER_EDIT, (payload, callback) => {
    const cb = typeof callback === "function" ? callback : () => {};
    if (!payload || !payload.sessionId || !payload.name) {
      return cb({ ok: false, error: "Invalid driver edit data" });
    }
    const session = sessions.find((s) => s.id === payload.sessionId);
    if (!session) {
      return cb({ ok: false, error: "Session not found" });
    }
    const driver = session.drivers.find((d) => d.name === payload.name);
    if (!driver) {
      return cb({ ok: false, error: "Driver not found" });
    }

    // Nime muutmine
    if (payload.newName && payload.newName.trim()) {
      const newNameTrimmed = payload.newName.trim();
      if (session.drivers.some((d) => d.name.toLowerCase() === newNameTrimmed.toLowerCase() && d.name !== payload.name)) {
        return cb({ ok: false, error: "Driver name already exists" });
      }
      driver.name = newNameTrimmed;
    }

    // Auto numbri muutmine või vabastamine (Boonus 2)
    if (payload.car !== undefined) {
      if (payload.car === null || payload.car === "" || payload.car === 0) {
        // Vabasta auto
        driver.car = null;
      } else {
        const targetCar = Number(payload.car);
        if (targetCar < 1 || targetCar > 8) {
          return cb({ ok: false, error: "Car number must be between 1 and 8" });
        }
        const isCarUsed = session.drivers.some((d) => d.car === targetCar && d.name !== driver.name);
        if (isCarUsed) {
          return cb({ ok: false, error: `Car ${targetCar} is already taken by another driver` });
        }
        driver.car = targetCar;
      }
    }

    session.drivers.sort((a, b) => (a.car || 99) - (b.car || 99));
    updateNextSession();
    saveState();
    broadcastSessions();
    broadcastRace();
    cb({ ok: true });
  });

  socket.on(EVENTS.DRIVER_REMOVE, (payload, callback) => {
    const cb = typeof callback === "function" ? callback : () => {};
    if (!payload || !payload.sessionId || !payload.name) {
      return cb({ ok: false, error: "Session ID and driver name are required" });
    }
    const session = sessions.find((s) => s.id === payload.sessionId);
    if (!session) {
      return cb({ ok: false, error: "Session not found" });
    }
    const initialCount = session.drivers.length;
    session.drivers = session.drivers.filter((d) => d.name !== payload.name);
    if (session.drivers.length === initialCount) {
      return cb({ ok: false, error: "Driver not found" });
    }
    updateNextSession();
    saveState();
    broadcastSessions();
    broadcastRace();
    cb({ ok: true });
  });
});

// --- Race Control nimeruum ---
const raceControlNsp = io.of("/race-control");
raceControlNsp.use(createAuthMiddleware(RACE_CONTROL_KEY));
raceControlNsp.on("connection", (socket) => {
  socket.emit(EVENTS.RACE, race);
  socket.emit(EVENTS.TIMER, timer);
  socket.emit(EVENTS.SESSIONS, sessions);

  socket.on(EVENTS.RACE_START, (payload, callback) => {
    const cb = typeof callback === "function" ? callback : () => {};
    if (race.status === "running") {
      return cb({ ok: false, error: "Race is already running" });
    }
    if (sessions.length === 0) {
      return cb({ ok: false, error: "No upcoming race sessions" });
    }

    const currentSession = sessions.shift();
    race.current = currentSession;
    race.status = "running";
    race.mode = "safe";
    race.callToPaddock = false;
    updateNextSession();

    // Kindlusta, et igal stardival sõitjal on unikaalne auto 1..8
    const usedCars = new Set(currentSession.drivers.filter((d) => d.car).map((d) => d.car));
    currentSession.drivers.forEach((d) => {
      if (!d.car) {
        for (let c = 1; c <= 8; c++) {
          if (!usedCars.has(c)) {
            d.car = c;
            usedCars.add(c);
            break;
          }
        }
      }
    });
    currentSession.drivers.sort((a, b) => a.car - b.car);

    race.results = currentSession.drivers.map((d) => ({
      car: d.car,
      name: d.name,
      lap: 0,
      fastestLapMs: null,
    }));
    carLastCrossTime = {};

    timer.remainingMs = RACE_DURATION_MS;
    raceEndTime = Date.now() + RACE_DURATION_MS;
    startTimerCountdown();

    saveState();
    broadcastRace();
    broadcastTimer();
    broadcastSessions();
    cb({ ok: true });
  });

  socket.on(EVENTS.RACE_MODE, (payload, callback) => {
    const cb = typeof callback === "function" ? callback : () => {};
    const mode = payload && payload.mode;
    const validModes = ["safe", "hazard", "danger", "finish"];
    if (!validModes.includes(mode)) {
      return cb({ ok: false, error: "Invalid race mode" });
    }
    if (race.mode === "finish") {
      return cb({ ok: false, error: "Race is finished and mode cannot be changed" });
    }
    if (race.status !== "running" && mode !== "finish") {
      return cb({ ok: false, error: "Race is not running" });
    }

    if (mode === "finish") {
      race.status = "finished";
      race.mode = "finish";
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
      timer.remainingMs = 0;
      raceEndTime = null;
      broadcastTimer();
    } else {
      race.mode = mode;
    }

    saveState();
    broadcastRace();
    cb({ ok: true });
  });

  socket.on(EVENTS.RACE_END_SESSION, (payload, callback) => {
    const cb = typeof callback === "function" ? callback : () => {};
    if (race.status !== "finished" && race.mode !== "finish") {
      return cb({ ok: false, error: "Session can only be ended after race finish" });
    }

    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }

    race.status = "idle";
    race.mode = "danger";
    race.current = null;
    race.callToPaddock = true;
    timer.remainingMs = 0;
    raceEndTime = null;
    carLastCrossTime = {};

    saveState();
    broadcastRace();
    broadcastTimer();
    cb({ ok: true });
  });
});

// --- Lap Line Tracker nimeruum (/lap-line) ---
const lapLineNsp = io.of("/lap-line");
lapLineNsp.use(createAuthMiddleware(LAP_LINE_KEY));
lapLineNsp.on("connection", (socket) => {
  socket.emit(EVENTS.RACE, race);
  socket.emit(EVENTS.TIMER, timer);

  socket.on(EVENTS.LAP_RECORD, (payload, callback) => {
    const cb = typeof callback === "function" ? callback : () => {};
    if (race.status !== "running" && race.mode !== "finish") {
      return cb({ ok: false, error: "Race is not active" });
    }

    const carNumber = payload && Number(payload.car);
    const result = race.results.find((r) => r.car === carNumber);
    if (!result) {
      return cb({ ok: false, error: "Car is not in the current race" });
    }

    const now = Date.now();
    if (!carLastCrossTime[carNumber]) {
      // Esimene üle joone sõit alustab 1. ringi (lap 1), aega veel pole
      carLastCrossTime[carNumber] = now;
      result.lap = 1;
      result.fastestLapMs = null;
    } else {
      // Järgmised sõidud arvutavad eelmise ringi aja ja lisavad ringi
      const lapMs = now - carLastCrossTime[carNumber];
      carLastCrossTime[carNumber] = now;
      result.lap += 1;
      if (result.fastestLapMs === null || lapMs < result.fastestLapMs) {
        result.fastestLapMs = lapMs;
      }
    }

    saveState();
    broadcastRace();
    cb({ ok: true, lap: result.lap, fastestLapMs: result.fastestLapMs });
  });
});

function openBrowser(url) {
  const { exec } = require("child_process");
  const cmd =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

server.listen(PORT, () => {
  console.log(`Server töötab pordil ${PORT}`);
  console.log(`Testing Hub: http://localhost:${PORT}`);
  console.log(`Avalikud ekraanid:`);
  console.log(`- http://localhost:${PORT}/leader-board`);
  console.log(`- http://localhost:${PORT}/next-race`);
  console.log(`- http://localhost:${PORT}/race-countdown`);
  console.log(`- http://localhost:${PORT}/race-flags`);
  console.log(`Töötajate liidesed:`);
  console.log(`- http://localhost:${PORT}/front-desk`);
  console.log(`- http://localhost:${PORT}/race-control`);
  console.log(`- http://localhost:${PORT}/lap-line-tracker`);

  if (isDevMode) {
    console.log("Arendusrežiim: avan brauseris http://localhost:" + PORT);
    openBrowser(`http://localhost:${PORT}`);
  }
});
