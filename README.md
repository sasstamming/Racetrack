# Beachside Racetrack Info-Screens

A real-time race management and spectator information system powered by Node.js, Express, and Socket.IO.

## Getting Started

### 1. Prerequisites & Installation
Ensure you have Node.js (v20+) installed:
```bash
npm install
```

### 2. Environment Variables Setup
The server requires access keys to be configured for employee interfaces before launching. Copy the sample file:
```bash
cp .env.example .env
```
Default keys defined in `.env`:
- `PORT=3000`
- `FRONT_DESK_KEY=receptionist123` (Access key for `/front-desk`)
- `RACE_CONTROL_KEY=safety123` (Access key for `/race-control`)
- `LAP_LINE_KEY=observer123` (Access key for `/lap-line-tracker`)

*(Note: The server will refuse to start if any of these access keys are missing).*

### 3. Launching the Server
- **Production mode (10-minute race countdown):**
  ```bash
  npm start
  ```
- **Developer mode (1-minute race countdown & automatic browser launch):**
  ```bash
  npm run dev
  ```

Once running, the interfaces are accessible at:
- **Testing Hub & Launchpad:** `http://localhost:3000/` or `http://localhost:3000/testing`
- **Employee Interfaces:**
  - Front Desk: `http://localhost:3000/front-desk`
  - Race Control: `http://localhost:3000/race-control`
  - Lap-Line Tracker: `http://localhost:3000/lap-line-tracker`
- **Public Displays:**
  - Leader Board: `http://localhost:3000/leader-board`
  - Next Race: `http://localhost:3000/next-race`
  - Race Countdown: `http://localhost:3000/race-countdown`
  - Race Flags: `http://localhost:3000/race-flags`

---

## Testing Hub & Launchpad (`/` or `/testing`)
To speed up local development and manual testing, the root URL `http://localhost:3000` provides a clean, lightweight launchpad with one-click links to all 7 interfaces (opening each in a separate browser tab). In developer mode (`npm run dev`), the server automatically opens this page in your default browser on startup.

---

## Employee Interfaces User Guide

### 1. Front Desk (`/front-desk`)
- **Persona:** Receptionist (Desktop/Stationary)
- **Authentication:** Enter receptionist key (`FRONT_DESK_KEY`).
- **Core Functionality:**
  - **Create & Delete Sessions:** Add new race sessions or remove upcoming sessions.
  - **Add Drivers:** Register driver names with unique-name validation within the session (max 8 drivers).
  - **Tactile Car Number Selector (1..N):** Each driver row displays interactive buttons for available car numbers matching the session's driver count. Clicking an available number assigns that car to the driver. Clicking the active orange number unassigns it (`(No car)`), allowing quick re-selection.
  - **⚡ Auto-Assign 1..N:** Reassigns car numbers sequentially to all drivers with one click.
  - **⚡ Fill Sample Data:** Quickly generates a complete test session with 4 sample drivers and auto-assigned cars.
  - **Edit & Remove Drivers:** Rename or delete drivers before the race starts.
  - **Session Lock:** Once the Safety Official starts a race, it moves to the track and can no longer be edited at the front desk.

### 2. Race Control (`/race-control`)
- **Persona:** Safety Official (Mobile optimized)
- **Authentication:** Enter safety key (`RACE_CONTROL_KEY`).
- **Core Functionality:**
  - **Pre-race (Idle):** Review upcoming session drivers and assigned cars to brief them. Press **Start Race** to begin.
  - **During Race (Running):** Track flag mode buttons become active:
    - **Safe** (Green)
    - **Hazard** (Yellow)
    - **Danger** (Red)
    - **Finish** (Chequered)
  - **Finish & End Session:** When the timer runs out or the Safety Official presses **Finish**, race controls disappear and the **End Race Session** button appears. Pressing it declares cars have returned to the pit, sets the flag to Danger, shows the paddock call on public displays, and queues up the next session.

### 3. Lap-Line Tracker (`/lap-line-tracker`)
- **Persona:** Lap-line Observer (Tablet optimized, portrait & landscape)
- **Authentication:** Enter observer key (`LAP_LINE_KEY`).
- **Core Functionality:**
  - Displays large, high-contrast tappable buttons for each car participating in the active race.
  - When a car crosses the lap line, tap its button:
    - The first crossing starts the car's Lap 1.
    - Subsequent crossings increment the lap count, compute the lap time using the server's clock, and update the fastest lap on the Leader Board.
  - When no race is active or after a session is ended, the buttons are disabled with a clear status notice.

---

## Bonus Features & Quality Implementation

1. **System State Persistence across Server Restarts (`state.json`):**
   - The application automatically persists the full state (sessions, active race, results, lap timestamps, and remaining timer) to `state.json`.
   - When the server restarts, all upcoming races are preserved and any active race timer continues counting down from where it left off.
2. **Manual Driver Car Assignment:**
   - The receptionist can assign drivers to specific car numbers via the tactile 1..N button selector or allow the system to auto-assign them.

---

## Public Displays

The public displays are web pages meant for large screens (40–75") around the
racetrack. They need no access key. Each page updates in real time through
Socket.IO, so nobody has to reload anything.

Every display has a **Full screen** button in the top-right corner. Click it
once when setting up the screen. The button hides itself in full-screen mode
and comes back if you press Esc.

### Race Flags (`/race-flags`)

For race drivers on the track. The whole screen shows the current race mode
as a flag, with no other information:

| Mode   | Screen                    |
|--------|---------------------------|
| Safe   | solid green               |
| Hazard | solid yellow              |
| Danger | solid red                 |
| Finish | chequered black and white |

The screen changes as soon as the Safety Official switches the mode.

### Race Countdown (`/race-countdown`)

For race drivers. Shows the remaining race time in large digits (minutes and
seconds), counting down every second.

### Next Race (`/next-race`)

For race drivers waiting in the paddock area. Lists the drivers of the next
race session and the car each one is assigned to. When the current session
has ended, a "Proceed to the paddock" message appears above the list. If no
session has been created yet, the screen shows "No upcoming race".

### Leader Board (`/leader-board`)

For spectators. Shows:

- the current flag status as a coloured bar at the top
- the remaining race time
- a table of all cars in the session, sorted by fastest lap: position,
  car number, driver name, current lap and fastest lap time

Cars that have not completed a full lap yet show `--` and are listed last.
The results of the last session stay on screen until the next session starts.

### Connection lost notice

If a display loses its connection to the server (for example when the server
restarts or the network drops), a red "Connection lost, reconnecting..." bar
appears at the top of the screen. The display reconnects automatically. When
the connection is back, the bar disappears and the screen shows the current
state again.

## Accessing the app from other networks

We use [ngrok](https://ngrok.com) to give the local server a public address.

1. Create a free ngrok account and install ngrok.
2. Save your own authtoken once (shown in the ngrok dashboard):
   `ngrok config add-authtoken <your-token>`
3. Start the server, then in a second terminal run:
   `ngrok http 3000`
4. Use the `https://...ngrok-free.dev` address from the "Forwarding" line,
   followed by a route, e.g. `https://<your-address>.ngrok-free.dev/leader-board`.

On the free plan the address changes every time ngrok restarts, and the
first visit shows an ngrok warning page. Click "Visit Site" to continue.
