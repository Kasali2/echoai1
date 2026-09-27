'use strict';

const http = require('http');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');

const { createState, snapshot } = require('./server/state');
const { applyCommand } = require('./server/commands');
const { NodeManager } = require('./server/nodeManager');
const { parseInbound } = require('./server/wsProtocol');
const simulation = require('./server/simulationLoop');
const { ROLE, MSG, SOURCE, MAX_NODES, EVENT_TYPE } = require('./public/shared/constants');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 4000);
const TICK_MS = 50; // 20Hz authoritative simulation + broadcast
const HELLO_TIMEOUT_MS = 5000;

// A teacher-visible controller token. Generated fresh each boot unless
// AETHER_CONTROLLER_TOKEN is set, so a random browser can never become the
// controller by guessing.
const CONTROLLER_TOKEN = process.env.AETHER_CONTROLLER_TOKEN || crypto.randomBytes(4).toString('hex').toUpperCase();

const state = createState();
const nodeManager = new NodeManager(state);

// ---- HTTP ----------------------------------------------------------------

const app = express();
app.use('/shared', express.static(path.join(__dirname, 'public/shared')));
app.use('/controller', express.static(path.join(__dirname, 'public/controller')));
app.use('/world', express.static(path.join(__dirname, 'public/world')));
app.use('/node', express.static(path.join(__dirname, 'public/node')));

app.get('/', (req, res) => {
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8">
  <title>AETHER</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body{background:#07090c;color:#d7dee6;font-family:ui-monospace,Menlo,monospace;
      display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;gap:1.2rem}
    a{color:#7fd8e8;text-decoration:none;font-size:1.1rem;letter-spacing:.04em}
    a:hover{text-decoration:underline}
    .tok{color:#6a7684;font-size:.85rem;margin-top:2rem}
  </style></head><body>
  <div><a href="/world">/world</a> — projector display</div>
  <div><a href="/controller">/controller</a> — teacher device</div>
  <div><a href="/node">/node</a> — student device</div>
  <div class="tok">controller token: ${CONTROLLER_TOKEN}</div>
  </body></html>`);
});

const server = http.createServer(app);

// ---- WebSocket -------------------------------------------------------------

const wss = new WebSocketServer({ server, path: '/ws' });

function send(ws, type, payload) {
  if (ws.readyState !== ws.OPEN) return;
  try {
    ws.send(JSON.stringify({ type, ...payload }));
  } catch {
    /* socket in the middle of closing — safe to ignore */
  }
}

function broadcast(type, payload, filterRole) {
  const body = JSON.stringify({ type, ...payload });
  for (const client of wss.clients) {
    if (client.readyState !== client.OPEN) continue;
    if (filterRole && client.aetherRole !== filterRole) continue;
    client.send(body);
  }
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.aetherRole = null;
  ws.aetherSlot = null;

  const helloTimer = setTimeout(() => {
    if (!ws.aetherRole) ws.close(4000, 'hello_timeout');
  }, HELLO_TIMEOUT_MS);

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    const parsed = parseInbound(raw);
    if (!parsed.ok) {
      send(ws, MSG.REJECTED, { reason: parsed.reason });
      return;
    }
    const msg = parsed.msg;

    if (msg.type === MSG.HELLO) {
      clearTimeout(helloTimer);
      handleHello(ws, msg);
      return;
    }

    if (msg.type === MSG.PING) {
      send(ws, MSG.PONG, {});
      return;
    }

    if (msg.type === MSG.COMMAND) {
      handleCommand(ws, msg.command);
      return;
    }
  });

  ws.on('close', () => {
    clearTimeout(helloTimer);
    if (ws.aetherRole === ROLE.NODE && ws.aetherSlot !== null) {
      nodeManager.disconnect(ws.aetherSlot);
      broadcastEvent({ type: EVENT_TYPE.NODE_DISCONNECTED, nodeId: state.nodes[ws.aetherSlot].id });
    }
    if (ws.aetherRole === ROLE.CONTROLLER && activeControllerSocket === ws) {
      activeControllerSocket = null;
    }
  });

  ws.on('error', () => {
    /* the close handler above does the actual cleanup */
  });
});

let activeControllerSocket = null;

function handleHello(ws, msg) {
  if (msg.role === ROLE.CONTROLLER) {
    if (msg.token !== CONTROLLER_TOKEN) {
      send(ws, MSG.REJECTED, { reason: 'invalid_controller_token' });
      ws.close(4001, 'invalid_token');
      return;
    }
    // Only one live controller — a second valid login replaces the first
    // (the teacher reloading a page), rather than allowing two masters.
    if (activeControllerSocket && activeControllerSocket !== ws) {
      send(activeControllerSocket, MSG.REJECTED, { reason: 'controller_replaced' });
      activeControllerSocket.close(4002, 'controller_replaced');
    }
    activeControllerSocket = ws;
    ws.aetherRole = ROLE.CONTROLLER;
    send(ws, MSG.WELCOME, { role: ROLE.CONTROLLER, snapshot: snapshot(state) });
    return;
  }

  if (msg.role === ROLE.WORLD) {
    ws.aetherRole = ROLE.WORLD;
    send(ws, MSG.WELCOME, { role: ROLE.WORLD, snapshot: snapshot(state) });
    return;
  }

  if (msg.role === ROLE.NODE) {
    const result = nodeManager.connect(ws, msg.sessionId);
    if (!result.ok) {
      send(ws, MSG.CAPACITY_REACHED, {});
      ws.close(4003, 'capacity_reached');
      return;
    }
    ws.aetherRole = ROLE.NODE;
    ws.aetherSlot = result.slot;
    const node = state.nodes[result.slot];
    send(ws, MSG.WELCOME, {
      role: ROLE.NODE,
      nodeId: node.id,
      sessionId: result.sessionId,
      snapshot: snapshot(state),
    });
    if (!result.reconnected) {
      broadcastEvent({ type: EVENT_TYPE.NODE_CONNECTED, nodeId: node.id });
    }
    return;
  }
}

function handleCommand(ws, rawCommand) {
  if (ws.aetherRole !== ROLE.CONTROLLER) {
    send(ws, MSG.REJECTED, { reason: 'only_controller_may_command' });
    return;
  }
  if (ws !== activeControllerSocket) {
    send(ws, MSG.REJECTED, { reason: 'stale_controller_session' });
    return;
  }

  const command = {
    action: rawCommand.action,
    targets: rawCommand.targets || [],
    parameters: rawCommand.parameters || {},
    source: rawCommand.source || SOURCE.SYSTEM,
    timestamp: Date.now(),
    requestId: rawCommand.requestId || crypto.randomUUID(),
  };

  const events = applyCommand(state, command);
  for (const event of events) broadcastEvent(event);
}

function broadcastEvent(event) {
  broadcast(MSG.EVENT, { event: { ...event, timestamp: Date.now() } });
}

// ---- Authoritative simulation loop ----------------------------------------

let lastTick = Date.now();

function runTick() {
  const now = Date.now();
  const dtMs = Math.min(now - lastTick, 100); // clamp to guard against stalls
  lastTick = now;

  const events = simulation.tick(state, dtMs, now);
  for (const event of events) broadcastEvent(event);

  broadcast(MSG.STATE, { snapshot: snapshot(state) });
}

setInterval(runTick, TICK_MS);

// Idle/dead socket sweep (covers phones that lock/lose signal without a clean close)
setInterval(() => {
  for (const client of wss.clients) {
    if (client.isAlive === false) {
      client.terminate();
      continue;
    }
    client.isAlive = false;
    client.ping();
  }
}, 15000);

server.listen(PORT, HOST, () => {
  console.log(`AETHER listening on http://${HOST}:${PORT}`);
  console.log(`Controller token: ${CONTROLLER_TOKEN}`);
  console.log(`  /world      — projector`);
  console.log(`  /controller — teacher device (needs the token above)`);
  console.log(`  /node       — student devices (up to ${MAX_NODES})`);
});
