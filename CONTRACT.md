# Socket.IO Event Contract

## 1. Namespaces & auth

| Route | Namespace | Needs key? |
|---|---|---|
| /leader-board | `/` | No |
| /next-race | `/` | No |
| /race-countdown | `/` | No |
| /race-flags | `/` | No |
| /front-desk | `/front-desk` | Yes (receptionist key) |
| /race-control | `/race-control` | Yes (safety key) |
| /lap-line-tracker | `/lap-line` | Yes (observer key) |

The public screens only receive data and never send commands, so they share
one open namespace. Each employee screen gets its own namespace so the server
can check a different key for each role.

**Auth flow:**
- The client sends the key in the handshake: `io('/race-control', { auth: { key } })`
- Server middleware on each employee namespace checks the key.
- Wrong key: the server waits 500 ms, then rejects with `new Error('Invalid access key')`.
- The client listens for `connect_error`, shows the message and asks for the key again.

## 2. Server → client events

The server is the only source of truth. It updates its state first, then broadcasts.
Every event is also sent to a single socket right after it connects,
so a screen opened mid-race shows the correct state immediately.

### `race`
- **To:** all namespaces
- **When:** on connect, and after any change (start, mode change, lap, finish, end session)

```js
{
  status: 'idle' | 'running' | 'finished',
  mode: 'safe' | 'hazard' | 'danger' | 'finish',
  current: { id, drivers: [{ name, car }] } | null,
  results: [{ car, name, lap, fastestLapMs }],   // fastestLapMs is null until a full lap
  next: { id, drivers: [{ name, car }] } | null,
  callToPaddock: true | false
}
```

- `results` is the session the leader board shows. It keeps the last session's
  results until the next race starts.
- `callToPaddock` is true after End Session, until the next race starts.
- The server does not sort `results`. The leader board sorts by `fastestLapMs`.

### `sessions`
- **To:** all namespaces
- **When:** on connect, and after any session or driver change

```js
[ { id, drivers: [{ name, car }] } ]   // upcoming sessions, in order
```

### `timer`
- **To:** all namespaces
- **When:** on connect, and every second while a race is running

```js
{ remainingMs: 543000 }
```

## 3. Client → server commands

Every command uses an acknowledgement callback:

```js
socket.emit('driver:add', { sessionId, name }, (res) => { ... })
// res = { ok: true }  or  { ok: false, error: 'Driver name already exists' }
```

| Command | From | Payload |
|---|---|---|
| `session:add` | /front-desk | `{}` |
| `session:remove` | /front-desk | `{ sessionId }` |
| `driver:add` | /front-desk | `{ sessionId, name }` |
| `driver:edit` | /front-desk | `{ sessionId, name, newName }` |
| `driver:remove` | /front-desk | `{ sessionId, name }` |
| `race:start` | /race-control | `{}` |
| `race:mode` | /race-control | `{ mode }` |
| `race:endSession` | /race-control | `{}` |
| `lap:record` | /lap-line | `{ car }` |

Lap times are calculated with the server's clock when `lap:record` arrives,
never with a time sent by the tablet.

## 4. Initial state (right after the server starts)

```js
race = {
  status: 'idle',
  mode: 'danger',
  current: null,
  results: [],
  next: null,
  callToPaddock: false
}
sessions = []
timer = { remainingMs: 0 }
```

## 5. Event names

All event names are kept as constants in `shared/events.js`,
imported by both server and client, so a typo becomes an error instead of silence.