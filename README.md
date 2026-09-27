# AETHER

A hand + voice controlled physics command system, built for a classroom
demonstration. One teacher phone (the **controller**) points and speaks
commands; a **projector** renders the AETHER core and up to ten **student
phones** as real physical nodes in a server-authoritative simulation.

```
HAND = WHERE       (spatial targeting via local hand tracking)
VOICE = WHAT       (the action, via local speech recognition)
PHYSICS = WHAT HAPPENS   (server-authoritative simulation)
PHONES = THE SYSTEM       (each student phone is a real node)
```

Nothing here is simulated for show: node counts, energy values, physics,
and connectivity all come from real WebSocket connections and a real
physics tick on the server. See [`test/simulation.test.js`](test/simulation.test.js)
for a runnable proof of that (`npm test`).

## 1. Install

Requires Node.js 18+ (works on desktop Linux/macOS/Windows and on Android
via Termux).

```bash
npm install
```

No Python, no Docker, no database, no paid/cloud AI API. The only two
runtime dependencies are `express` (static files + HTTP) and `ws`
(WebSocket server) — both pure JS, no native build step.

## 2. Configure (optional)

| Variable                  | Default                  | Purpose                                   |
|----------------------------|---------------------------|--------------------------------------------|
| `HOST`                     | `0.0.0.0`                 | bind address                              |
| `PORT`                     | `4000`                    | bind port                                 |
| `AETHER_CONTROLLER_TOKEN`  | random, printed at boot   | only a browser with this token can become the controller |

If you don't set `AETHER_CONTROLLER_TOKEN`, a fresh one is generated every
time the server starts and printed to the console (and shown on `/`) — so a
random device on the network can never become the controller by guessing.

## 3. Run

```bash
npm start
```

You should see:

```
AETHER listening on http://0.0.0.0:4000
Controller token: 8F2C1A9D
  /world      — projector
  /controller — teacher device (needs the token above)
  /node       — student devices (up to 10)
```

Open `http://<server-ip>:4000/` on the server machine for a page with
direct links to all three and the current token.

## 4. The three clients

### `/world` — the projector
Open on the machine connected to the projector, in Chrome, full-screen
(F11). No login. It boots with a short sequence that only lists nodes that
are *actually* connected at that moment — if none are connected yet it says
so, honestly, rather than faking a full roster.

Press `d` to toggle a small debug overlay (FPS, WS state, connected node
count, core power, last event) — off by default for a clean projected
image.

### `/controller` — the teacher's device
Open on the teacher's phone/tablet. It asks for the controller token shown
in the server console/`/` page, then requests camera (hand tracking) and,
optionally, microphone (voice) permission.

- **Hand tracking** runs entirely in the browser via MediaPipe Tasks
  Vision — no video frame is ever sent to the server, only the interpreted
  gesture events.
- **Voice** uses the browser's built-in Web Speech API — no audio is
  uploaded, and no external/cloud AI is used to interpret it.
- If camera or microphone access is denied, or hand tracking/speech
  recognition isn't supported by the browser, the controller **falls back
  automatically** to an on-screen touch panel (tap to select, swipe to
  change target, buttons for every action) — the demo does not collapse.
- **DEMO MODE** (top bar) hides the debug/camera-overlay clutter for the
  actual classroom presentation. Press `d` to peek at the debug panel at
  any time (camera/tracking/mic/speech/WS status, last gesture, last
  transcript, parsed command).
- **RESET AETHER** (bottom of the touch panel) restores the live
  simulation to standby. It does not disconnect any phone and does not
  touch any files.

Implemented gestures (see `CAL` constants at the top of `controller.js` if
you need to recalibrate thresholds for your lighting/camera):

| Gesture | Effect |
|---|---|
| Point + pinch | select/target the node under your hand |
| Fist | freeze current selection |
| Open hand (after fist) | resume |
| Hold hand steady over a node | charge that node |
| Swipe left/right | previous/next node |
| Fast swipe | launch pulse |
| Circular hand motion | orbit the current selection around the core |
| Two open hands, steady | select all |
| Two hands spreading apart | expand field (push selection outward) |
| Two hands closing together | compress field (pull selection inward) |

`SWEEP` (drag-select across an area) and `PINCH_DRAG` (continuous
manipulation while pinched) from the original design notes are not in this
first version — voice's "select nodes 3 through 6" and touch's node grid
cover group selection in the meantime, and pinch currently performs a
discrete select rather than a continuous drag. Worth revisiting once you've
calibrated the above against your actual classroom camera.

Voice commands (say them plainly, an optional "Aether," prefix is fine):
`select node 4`, `connect to node 4`, `switch to node 7`, `select nodes 3
through 6`, `select all nodes` / `connect everything`, `disconnect all`,
`freeze`, `resume`, `charge` / `charge node 7`, `launch` / `launch pulse`,
`send energy to node 5`, `rotate`, `stop rotation`, `expand` / `compress`,
`increase power`, `reduce power`, `activate reactor`, `shutdown`.

### `/node` — a student's device
Open on each student phone. It's assigned **NODE 01**–**NODE 10**
automatically — nothing to configure. If ten are already connected, the
11th sees **NETWORK CAPACITY REACHED**. A phone that loses signal and
reconnects within ~20 seconds reclaims its own node identity rather than
taking a new slot.

## 5. Cloudflare Tunnel

The app never hard-codes `localhost` — every client builds its WebSocket
URL from `window.location`, so it works unmodified behind a tunnel:

```bash
cloudflared tunnel --url http://localhost:4000
```

Share the resulting `https://*.trycloudflare.com` link; everyone opens
`<link>/controller`, `<link>/world`, `<link>/node` on their own device.

## 6. Running on Android (Termux)

```bash
pkg install nodejs
cd project-aether
npm install
npm start
```

Then either open the projector/controller on the same phone/tablet's
browser, or tunnel it as above so classroom devices can reach it.

## 7. Permissions & compatibility

- **Camera** (controller only): required for hand tracking. If denied, the
  controller switches to touch mode automatically.
- **Microphone** (controller only): required for voice. If denied or
  unsupported, the mic button is disabled and shows "VOICE UNAVAILABLE" —
  gesture and touch continue working normally.
- Voice recognition (`webkitSpeechRecognition`) is best supported in
  Chrome/Edge. Firefox and Safari have limited/no support — the controller
  detects this and disables voice cleanly rather than pretending to listen.
- Hand tracking needs a browser with WebGL2 (virtually all modern mobile
  Chrome/Safari).

## 8. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Controller stuck on "Invalid token" | Re-check the token printed in the server console — it regenerates on every restart unless `AETHER_CONTROLLER_TOKEN` is set. |
| World never leaves boot sequence | Check the server is reachable at the same host/port the world page was loaded from; open the browser console for the WebSocket error. |
| A student's phone won't connect | Ten nodes may already be connected — ask if anyone has two tabs open. |
| Hand tracking never turns on | Check the padlock/site settings for camera permission; some browsers require HTTPS (use the Cloudflare Tunnel link, which is HTTPS) for camera access on a non-localhost host. |
| Gestures fire too easily / not enough | Tune the `CAL` thresholds at the top of `public/controller/controller.js`. |
| Nodes visually "pop" instead of gliding | Check server CPU load — the world interpolates between the last two state snapshots (~20/sec); a very slow machine can fall behind. |

## 9. Classroom demo procedure

1. Start the server (`npm start`) a few minutes before class; note the token.
2. Put `/world` on the projector, full-screen.
3. Have students open `/node` on their phones as they arrive — watch them
   appear in the world in real time.
4. Open `/controller` on your device, enter the token, allow camera (and
   mic if you'll use voice).
5. Toggle **DEMO MODE** on the controller.
6. Point at a node, pinch to target it, say "charge." Then try "select all
   nodes," "increase power," "activate reactor."
7. When you're done, tap **RESET AETHER** to restore standby for the next
   class — it won't disconnect anyone.

## Project layout

```
server.js                 HTTP + WebSocket wiring (thin I/O glue)
server/
  state.js                 authoritative simulation state
  physics.js                deterministic vector physics (integration, impulses, orbits, collisions)
  commands.js                the single command dispatcher — gesture/voice/touch all resolve here
  simulationLoop.js           the per-tick update (pure function of state + dt, unit-tested)
  nodeManager.js              node slot assignment, capacity, reconnect/session reclaim
  wsProtocol.js                inbound message validation
public/
  shared/constants.js          the one protocol definition, shared by server and all clients
  shared/audio.js               procedural Web Audio sound effects
  shared/base.css                shared design tokens
  controller/                   teacher client (hand tracking, voice, touch fallback)
  world/                        projector client (Three.js scene)
  node/                         student client
test/simulation.test.js       dependency-free logic tests (`npm test`)
```
