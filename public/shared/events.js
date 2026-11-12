// All event names in one place, so typos are noticed.
const EVENTS = {
  // server → screens
  RACE: "race",
  TIMER: "timer",
  SESSIONS: "sessions",

  // employee screens → server
  SESSION_ADD: "session:add",
  SESSION_REMOVE: "session:remove",
  DRIVER_ADD: "driver:add",
  DRIVER_EDIT: "driver:edit",
  DRIVER_REMOVE: "driver:remove",
  RACE_START: "race:start",
  RACE_MODE: "race:mode",
  RACE_END_SESSION: "race:endSession",
  LAP_RECORD: "lap:record",
};

// The server and the web pages both load this file.
// This part is only for the server, so it can use EVENTS.
// The web pages skip it, they can use EVENTS without it.

if (typeof module !== "undefined") {
  module.exports = EVENTS;
}
