import { HandLandmarker, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';

const A = window.AETHER;
const TOKEN_KEY = 'aether_controller_token';

const el = {
  gate: document.getElementById('gate'),
  tokenInput: document.getElementById('tokenInput'),
  tokenSubmit: document.getElementById('tokenSubmit'),
  gateError: document.getElementById('gateError'),
  app: document.getElementById('app'),
  connState: document.getElementById('connState'),
  modeState: document.getElementById('modeState'),
  controlModeState: document.getElementById('controlModeState'),
  demoToggle: document.getElementById('demoToggle'),
  cam: document.getElementById('cam'),
  overlay: document.getElementById('overlay'),
  handStatus: document.getElementById('handStatus'),
  gestureStatus: document.getElementById('gestureStatus'),
  micState: document.getElementById('micState'),
  micToggle: document.getElementById('micToggle'),
  voiceTranscript: document.getElementById('voiceTranscript'),
  voiceCommand: document.getElementById('voiceCommand'),
  voiceTarget: document.getElementById('voiceTarget'),
  voiceStatus: document.getElementById('voiceStatus'),
  nodeGrid: document.getElementById('nodeGrid'),
  resetBtn: document.getElementById('resetBtn'),
  debug: document.getElementById('debug'),
  dbgCam: document.getElementById('dbgCam'),
  dbgTracking: document.getElementById('dbgTracking'),
  dbgMic: document.getElementById('dbgMic'),
  dbgSpeech: document.getElementById('dbgSpeech'),
  dbgWs: document.getElementById('dbgWs'),
  dbgTarget: document.getElementById('dbgTarget'),
  dbgMode: document.getElementById('dbgMode'),
  dbgGesture: document.getElementById('dbgGesture'),
  dbgTranscript: document.getElementById('dbgTranscript'),
  dbgParsed: document.getElementById('dbgParsed'),
};

// ---- Shared runtime state ---------------------------------------------
const runtime = {
  ws: null,
  lastSnapshot: null,
  inputMode: 'gesture', // 'gesture' | 'touch'
  demo: false,
};

// ======================================================================
// WebSocket + command dispatch
// ======================================================================

function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

function connect(token) {
  setConn('LINKING', '');
  const ws = new WebSocket(wsUrl());
  runtime.ws = ws;

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ type: A.MSG.HELLO, role: A.ROLE.CONTROLLER, token }));
  });

  ws.addEventListener('message', (evt) => {
    let msg; try { msg = JSON.parse(evt.data); } catch { return; }
    if (msg.type === A.MSG.WELCOME) {
      localStorage.setItem(TOKEN_KEY, token);
      el.gate.classList.add('hidden');
      el.app.classList.remove('hidden');
      setConn('ONLINE', 'on');
      applySnapshot(msg.snapshot);
      AetherAudio.unlock();
    } else if (msg.type === A.MSG.REJECTED) {
      if (msg.reason === 'invalid_controller_token') {
        showGateError('Invalid token.');
        localStorage.removeItem(TOKEN_KEY);
      } else if (msg.reason === 'controller_replaced') {
        showGateError('This controller was replaced by another session.');
        el.app.classList.add('hidden');
        el.gate.classList.remove('hidden');
      }
    } else if (msg.type === A.MSG.STATE) {
      applySnapshot(msg.snapshot);
    } else if (msg.type === A.MSG.EVENT) {
      handleEvent(msg.event);
    }
  });

  ws.addEventListener('close', () => {
    setConn('OFFLINE', 'off');
    setTimeout(() => { if (localStorage.getItem(TOKEN_KEY)) connect(localStorage.getItem(TOKEN_KEY)); }, 1500);
  });
  ws.addEventListener('error', () => ws.close());
}

function setConn(text, cls) {
  el.connState.textContent = text;
  el.connState.className = 'pill' + (cls ? ' ' + cls : '');
  el.dbgWs.textContent = text;
}

let selection = { mode: 'single', targets: [] };

function applySnapshot(snapshot) {
  runtime.lastSnapshot = snapshot;
  selection = snapshot.selection;
  el.controlModeState.textContent = selection.mode.toUpperCase();
  el.dbgTarget.textContent = selection.targets.join(', ') || '—';
  renderNodeGrid(snapshot);
}

function handleEvent(event) {
  if (event.type === A.EVENT_TYPE.COMMAND_REJECTED) {
    setVoiceStatus(`REJECTED — ${event.reason || ''}`);
  }
}

/** Every input method funnels through here — one dispatcher, one vocabulary. */
function sendCommand(action, { targets = [], parameters = {}, source = A.SOURCE.TOUCH } = {}) {
  if (!runtime.ws || runtime.ws.readyState !== WebSocket.OPEN) return;
  const command = {
    action, targets, parameters, source,
    requestId: crypto.randomUUID(),
    timestamp: Date.now(),
  };
  runtime.ws.send(JSON.stringify({ type: A.MSG.COMMAND, command }));
  AetherAudio.unlock();
}

// ======================================================================
// Token gate
// ======================================================================

function showGateError(text) { el.gateError.textContent = text; }

el.tokenSubmit.addEventListener('click', () => {
  const token = el.tokenInput.value.trim().toUpperCase();
  if (!token) { showGateError('Enter a token.'); return; }
  showGateError('');
  connect(token);
});
el.tokenInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.tokenSubmit.click(); });

const savedToken = localStorage.getItem(TOKEN_KEY);
if (savedToken) {
  el.tokenInput.value = savedToken;
  connect(savedToken);
}

// ======================================================================
// Touch fallback: node grid + action buttons
// ======================================================================

function renderNodeGrid(snapshot) {
  el.nodeGrid.innerHTML = '';
  snapshot.nodes.forEach((n) => {
    const btn = document.createElement('button');
    btn.textContent = String(n.slot + 1).padStart(2, '0');
    btn.disabled = !n.connected;
    btn.className = (n.connected ? 'connected ' : '') + (n.selected ? 'selected' : '');
    btn.addEventListener('click', () => {
      sendCommand(A.ACTION.SELECT, { targets: [n.id], source: A.SOURCE.TOUCH });
    });
    el.nodeGrid.appendChild(btn);
  });
}

document.querySelectorAll('.actionGrid button').forEach((btn) => {
  btn.addEventListener('click', () => {
    sendCommand(btn.dataset.action, { source: A.SOURCE.TOUCH });
  });
});

el.resetBtn.addEventListener('click', () => {
  if (confirm('Reset the live AETHER simulation? Selections, energy and motion will be restored to standby.')) {
    sendCommand(A.ACTION.RESET, { source: A.SOURCE.SYSTEM });
  }
});

// simple swipe-to-change-target and drag-to-nudge on the camera panel,
// so touch mode still has a spatial feel even without hand tracking
(function setupTouchGestures() {
  const panel = document.getElementById('cameraPanel');
  let startX = null, startY = null, startT = 0;
  panel.addEventListener('pointerdown', (e) => { startX = e.clientX; startY = e.clientY; startT = Date.now(); });
  panel.addEventListener('pointerup', (e) => {
    if (startX === null) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const dt = Date.now() - startT;
    startX = null;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const fast = Math.abs(dx) / Math.max(dt, 1) > 0.9;
    if (fast) {
      sendCommand(A.ACTION.LAUNCH_PULSE, { source: A.SOURCE.TOUCH });
    } else {
      stepSelection(dx > 0 ? 1 : -1);
    }
  });
})();

function stepSelection(dir) {
  const snap = runtime.lastSnapshot;
  if (!snap) return;
  const connected = snap.nodes.filter((n) => n.connected);
  if (connected.length === 0) return;
  const currentId = selection.targets[0];
  let idx = connected.findIndex((n) => n.id === currentId);
  idx = (idx + dir + connected.length) % connected.length;
  sendCommand(A.ACTION.SELECT, { targets: [connected[idx].id], source: runtime.inputMode === 'gesture' ? A.SOURCE.GESTURE : A.SOURCE.TOUCH });
}

// ======================================================================
// Demo mode
// ======================================================================

el.demoToggle.addEventListener('click', () => {
  runtime.demo = !runtime.demo;
  document.body.classList.toggle('demo', runtime.demo);
  el.demoToggle.classList.toggle('active', runtime.demo);
  el.debug.classList.add('hidden'); // demo mode always starts with debug closed
});

addEventListener('keydown', (e) => {
  if (e.key === 'd' || e.key === 'D') el.debug.classList.toggle('hidden');
});

function setVoiceStatus(text) { el.voiceStatus.textContent = text; }

// ======================================================================
// Hand tracking (MediaPipe Tasks Vision, fully local — no frame ever
// leaves the browser; only interpreted gesture events are sent over the
// WebSocket).
// ======================================================================

// Tunable thresholds. Real webcams/lighting vary — these are exposed here
// as the single place to recalibrate rather than buried in logic.
const CAL = {
  extendRatio: 1.12,      // tip-vs-pip distance-from-wrist ratio to count as "extended"
  thumbExtendRatio: 0.85, // thumb-tip-to-index-mcp distance / hand scale
  pinchRatio: 0.38,       // thumb-index distance / hand scale to count as pinched
  swipeVelocity: 0.9,     // normalized units/sec
  fastSwipeVelocity: 2.2,
  circularThreshold: 4.4, // radians of accumulated rotation
  circularWindowMs: 900,
  holdChargeMs: 900,
  twoHandGap: 0.12,       // normalized-distance delta to arm apart/together
  gestureCooldownMs: 550,
};

function dist2(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function analyzeHand(lm) {
  const wrist = lm[0];
  const scale = Math.max(dist2(wrist, lm[9]), 0.02); // wrist -> middle MCP, a stable hand-size reference
  const fingerJoints = [
    [8, 6],   // index tip, pip
    [12, 10], // middle
    [16, 14], // ring
    [20, 18], // pinky
  ];
  const extended = fingerJoints.map(([tip, pip]) => dist2(wrist, lm[tip]) > dist2(wrist, lm[pip]) * CAL.extendRatio);
  const thumbExtended = dist2(lm[4], lm[5]) > scale * CAL.thumbExtendRatio;
  const extendedCount = extended.filter(Boolean).length + (thumbExtended ? 1 : 0);
  const pinchDist = dist2(lm[4], lm[8]) / scale;

  const palm = { x: (lm[0].x + lm[9].x) / 2, y: (lm[0].y + lm[9].y) / 2 };

  return {
    palm,
    scale,
    pinching: pinchDist < CAL.pinchRatio,
    open: extendedCount >= 4,
    fist: extendedCount <= 1,
  };
}

class GestureEngine {
  constructor() {
    this.history = []; // { t, hands: [analyzed...] }
    this.cooldowns = {};
    this.wasPinching = false;
    this.wasFist = false;
    this.holdTarget = null;
    this.holdSince = 0;
    this.circAngleAccum = 0;
    this.circLastAngle = null;
    this.twoHandArmed = true;
    this.lastGesture = '—';
  }

  onCooldown(name, now) {
    return this.cooldowns[name] && now - this.cooldowns[name] < CAL.gestureCooldownMs;
  }
  fire(name, now) { this.cooldowns[name] = now; this.lastGesture = name; }

  /** hands: array of analyzeHand() results (0, 1 or 2). */
  update(hands, now) {
    this.history.push({ t: now, hands });
    this.history = this.history.filter((h) => now - h.t < 1200);

    if (hands.length === 0) { this.wasPinching = false; this.wasFist = false; this.holdTarget = null; return; }

    const primary = hands[0];
    const cursorX = clamp01(1 - primary.palm.x); // undo camera mirroring for an intuitive left/right feel

    // continuous spatial pointer -> which connected node the hand is over
    const connected = (runtime.lastSnapshot?.nodes || []).filter((n) => n.connected);
    const pointedIndex = connected.length ? Math.min(connected.length - 1, Math.floor(cursorX * connected.length)) : -1;
    const pointedNode = pointedIndex >= 0 ? connected[pointedIndex] : null;
    updateCursorUI(cursorX, pointedNode);

    // PINCH -> lock target (SELECT)
    if (primary.pinching && !this.wasPinching && pointedNode) {
      sendCommand(A.ACTION.SELECT, { targets: [pointedNode.id], source: A.SOURCE.GESTURE });
      this.fire('pinch', now);
    }
    this.wasPinching = primary.pinching;

    // FIST -> freeze current selection; release on next open hand
    if (primary.fist && !this.wasFist && !this.onCooldown('fist', now)) {
      sendCommand(A.ACTION.FREEZE, { source: A.SOURCE.GESTURE });
      this.fire('fist', now);
    }
    if (!primary.fist && this.wasFist && !this.onCooldown('resume', now)) {
      sendCommand(A.ACTION.RESUME, { source: A.SOURCE.GESTURE });
      this.fire('resume', now);
    }
    this.wasFist = primary.fist;

    // HOLD OVER NODE (open hand, stationary target) -> charge
    if (primary.open && pointedNode) {
      if (this.holdTarget !== pointedNode.id) { this.holdTarget = pointedNode.id; this.holdSince = now; }
      else if (now - this.holdSince > CAL.holdChargeMs && !this.onCooldown('hold_charge_' + pointedNode.id, now)) {
        sendCommand(A.ACTION.CHARGE, { targets: [pointedNode.id], source: A.SOURCE.GESTURE });
        this.fire('hold_charge_' + pointedNode.id, now);
      }
    } else {
      this.holdTarget = null;
    }

    // SWIPE (open hand, fast horizontal wrist motion)
    if (primary.open) {
      const v = this.horizontalVelocity(now);
      if (v !== null && Math.abs(v) > CAL.swipeVelocity && !this.onCooldown('swipe', now)) {
        if (Math.abs(v) > CAL.fastSwipeVelocity) {
          sendCommand(A.ACTION.LAUNCH_PULSE, { source: A.SOURCE.GESTURE });
          this.fire('fast_swipe', now);
        } else {
          stepSelection(v > 0 ? -1 : 1); // mirrored: positive raw dx = hand moved toward viewer's left
          this.fire('swipe', now);
        }
        this.cooldowns.swipe = now;
      }
    }

    // CIRCULAR (single hand orbiting a point) -> orbit selected group
    this.trackCircular(primary, now);

    // Two-hand gestures
    if (hands.length === 2) {
      this.trackTwoHands(hands, now);
    } else {
      this.twoHandArmed = true;
    }

    el.gestureStatus.textContent = this.lastGesture.toUpperCase();
    el.dbgGesture.textContent = this.lastGesture;
  }

  horizontalVelocity(now) {
    const recent = this.history.filter((h) => now - h.t < 220 && h.hands[0]);
    if (recent.length < 2) return null;
    const a = recent[0].hands[0].palm;
    const b = recent[recent.length - 1].hands[0].palm;
    const dt = (recent[recent.length - 1].t - recent[0].t) / 1000;
    if (dt < 0.05) return null;
    return (b.x - a.x) / dt;
  }

  trackCircular(hand, now) {
    const centroid = this.rollingCentroid(now);
    if (!centroid) { this.circLastAngle = null; return; }
    const angle = Math.atan2(hand.palm.y - centroid.y, hand.palm.x - centroid.x);
    if (this.circLastAngle !== null) {
      let delta = angle - this.circLastAngle;
      if (delta > Math.PI) delta -= Math.PI * 2;
      if (delta < -Math.PI) delta += Math.PI * 2;
      this.circAngleAccum += delta;
    }
    this.circLastAngle = angle;
    if (Math.abs(this.circAngleAccum) > CAL.circularThreshold && !this.onCooldown('circular', now)) {
      sendCommand(A.ACTION.ORBIT_START, { source: A.SOURCE.GESTURE });
      this.fire('circular', now);
      this.circAngleAccum = 0;
    }
  }

  rollingCentroid(now) {
    const recent = this.history.filter((h) => now - h.t < CAL.circularWindowMs && h.hands[0]);
    if (recent.length < 4) return null;
    const sum = recent.reduce((acc, h) => ({ x: acc.x + h.hands[0].palm.x, y: acc.y + h.hands[0].palm.y }), { x: 0, y: 0 });
    return { x: sum.x / recent.length, y: sum.y / recent.length };
  }

  trackTwoHands(hands, now) {
    const [h1, h2] = hands;
    const gap = dist2(h1.palm, h2.palm);
    const prevFrame = this.history[this.history.length - 2];
    const prevGap = prevFrame && prevFrame.hands.length === 2 ? dist2(prevFrame.hands[0].palm, prevFrame.hands[1].palm) : gap;
    const delta = gap - prevGap;

    if (h1.open && h2.open) {
      if (!this.onCooldown('two_open', now) && Math.abs(delta) < 0.01) {
        // both open and steady (not actively spreading/closing) -> select all
        sendCommand(A.ACTION.SELECT_ALL, { source: A.SOURCE.GESTURE });
        this.fire('two_hands_open', now);
      }
      if (this.twoHandArmed && delta > CAL.twoHandGap) {
        sendCommand(A.ACTION.EXPAND_FIELD, { source: A.SOURCE.GESTURE });
        this.fire('hands_apart', now);
        this.twoHandArmed = false;
      } else if (this.twoHandArmed && delta < -CAL.twoHandGap) {
        sendCommand(A.ACTION.COMPRESS_FIELD, { source: A.SOURCE.GESTURE });
        this.fire('hands_together', now);
        this.twoHandArmed = false;
      } else if (Math.abs(delta) < CAL.twoHandGap * 0.3) {
        this.twoHandArmed = true;
      }
    }
  }
}

function clamp01(v) { return Math.max(0, Math.min(1, v)); }

function updateCursorUI(cursorX, pointedNode) {
  el.dbgMode.textContent = runtime.inputMode;
  if (pointedNode) el.voiceTarget.textContent = pointedNode.id; // reused readout; harmless when idle
}

const gestureEngine = new GestureEngine();

let handLandmarker = null;
let cameraReady = false;

async function initHandTracking() {
  try {
    el.dbgTracking.textContent = 'LOADING';
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
    );
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numHands: 2,
    });
    el.dbgTracking.textContent = 'READY';
  } catch (err) {
    console.warn('Hand tracking unavailable, falling back to touch mode.', err);
    el.dbgTracking.textContent = 'UNAVAILABLE';
    setInputMode('touch');
  }
}

async function initCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false });
    el.cam.srcObject = stream;
    await el.cam.play();
    cameraReady = true;
    el.dbgCam.textContent = 'GRANTED';
    resizeOverlay();
  } catch (err) {
    console.warn('Camera unavailable, falling back to touch mode.', err);
    el.dbgCam.textContent = 'DENIED';
    setInputMode('touch');
  }
}

function resizeOverlay() {
  el.overlay.width = el.cam.videoWidth || 640;
  el.overlay.height = el.cam.videoHeight || 480;
}

function setInputMode(mode) {
  runtime.inputMode = mode;
  el.modeState.textContent = mode.toUpperCase();
  el.handStatus.classList.toggle('off', mode !== 'gesture');
}

function drawLandmarks(handsResult) {
  const ctx = el.overlay.getContext('2d');
  ctx.clearRect(0, 0, el.overlay.width, el.overlay.height);
  if (runtime.demo || !handsResult) return;
  ctx.fillStyle = '#e2984f';
  for (const lm of handsResult.landmarks || []) {
    for (const p of lm) {
      ctx.beginPath();
      ctx.arc(p.x * el.overlay.width, p.y * el.overlay.height, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function trackingLoop() {
  requestAnimationFrame(trackingLoop);
  if (!handLandmarker || !cameraReady || el.cam.readyState < 2) return;

  const now = performance.now();
  const result = handLandmarker.detectForVideo(el.cam, now);
  drawLandmarks(result);

  const hands = (result.landmarks || []).map(analyzeHand);
  el.handStatus.textContent = `HANDS: ${hands.length}`;
  el.handStatus.classList.toggle('off', hands.length === 0);
  if (hands.length > 0) setInputMode('gesture');

  gestureEngine.update(hands, now);
}

initCamera().then(initHandTracking);
requestAnimationFrame(trackingLoop);

// ======================================================================
// Voice control (Web Speech API) — resolves to the same command vocabulary
// ======================================================================

const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

function parseNodeNumber(token) {
  if (!token) return null;
  const t = token.toLowerCase().trim();
  if (NUMBER_WORDS[t] !== undefined) return NUMBER_WORDS[t];
  const n = parseInt(t, 10);
  return Number.isInteger(n) && n >= 1 && n <= A.MAX_NODES ? n : null;
}

function nodeIdFor(n) { return `NODE_${String(n).padStart(2, '0')}`; }

/** Returns { action, targets, parameters } or null if nothing matched. */
function parseVoiceCommand(raw) {
  const text = raw.toLowerCase().trim().replace(/^aether,?\s*/i, '');

  let m;
  if ((m = text.match(/^(?:select|connect to|switch to|go to)\s+nodes?\s+(\w+)\s+(?:through|to)\s+(\w+)$/))) {
    const a = parseNodeNumber(m[1]), b = parseNodeNumber(m[2]);
    if (a && b) {
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      const targets = [];
      for (let i = lo; i <= hi; i++) targets.push(nodeIdFor(i));
      return { action: A.ACTION.SELECT_RANGE, targets };
    }
  }
  if ((m = text.match(/^select all( nodes)?$/)) || /^connect everything$/.test(text)) {
    return { action: A.ACTION.SELECT_ALL, targets: [] };
  }
  if (/^disconnect all$/.test(text)) {
    return { action: A.ACTION.DESELECT_ALL, targets: [] };
  }
  if ((m = text.match(/^(?:select|connect to|switch to|go to)\s+nodes?\s+(\w+)$/))) {
    const n = parseNodeNumber(m[1]);
    if (n) return { action: A.ACTION.SELECT, targets: [nodeIdFor(n)] };
  }
  if (/^freeze$/.test(text)) return { action: A.ACTION.FREEZE, targets: [] };
  if (/^resume$/.test(text)) return { action: A.ACTION.RESUME, targets: [] };
  if ((m = text.match(/^charge node (\w+)$/))) {
    const n = parseNodeNumber(m[1]);
    if (n) return { action: A.ACTION.CHARGE, targets: [nodeIdFor(n)] };
  }
  if (/^charge$/.test(text)) return { action: A.ACTION.CHARGE, targets: [] };
  if ((m = text.match(/^send energy to node (\w+)$/))) {
    const n = parseNodeNumber(m[1]);
    const from = selection.targets[0];
    if (n && from) return { action: A.ACTION.TRANSFER_ENERGY, targets: [], parameters: { from, to: nodeIdFor(n) } };
  }
  if (/^launch( pulse)?$/.test(text)) return { action: A.ACTION.LAUNCH_PULSE, targets: [] };
  if (/^rotate$/.test(text)) return { action: A.ACTION.ORBIT_START, targets: [] };
  if (/^stop rotation$/.test(text)) return { action: A.ACTION.ORBIT_STOP, targets: [] };
  if (/^expand( field)?$/.test(text)) return { action: A.ACTION.EXPAND_FIELD, targets: [] };
  if (/^compress( field)?$/.test(text)) return { action: A.ACTION.COMPRESS_FIELD, targets: [] };
  if (/^increase power$/.test(text)) return { action: A.ACTION.INCREASE_POWER, targets: [] };
  if (/^(reduce|decrease) power$/.test(text)) return { action: A.ACTION.DECREASE_POWER, targets: [] };
  if (/^activate reactor$/.test(text)) return { action: A.ACTION.ACTIVATE_REACTOR, targets: [] };
  if (/^shutdown$/.test(text)) return { action: A.ACTION.SHUTDOWN, targets: [] };
  if (/^reset (aether|the system)$/.test(text)) return { action: A.ACTION.RESET, targets: [] };

  return null;
}

const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let voiceOn = false;

function initVoice() {
  if (!SpeechRecognitionImpl) {
    el.micState.textContent = 'VOICE UNAVAILABLE';
    el.micToggle.disabled = true;
    el.dbgSpeech.textContent = 'UNSUPPORTED';
    return;
  }
  el.dbgSpeech.textContent = 'READY';
  recognition = new SpeechRecognitionImpl();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onstart = () => { el.micState.textContent = 'LISTENING'; el.micState.className = 'pill on'; el.dbgMic.textContent = 'LISTENING'; };
  recognition.onend = () => {
    el.micState.textContent = 'MIC OFF'; el.micState.className = 'pill off'; el.dbgMic.textContent = 'OFF';
    if (voiceOn) recognition.start(); // keep continuous listening alive across engine timeouts
  };
  recognition.onerror = (e) => { el.dbgMic.textContent = 'ERROR: ' + e.error; setVoiceStatus('ERROR'); };

  recognition.onresult = (event) => {
    let interim = '', final = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i];
      if (r.isFinal) final += r[0].transcript; else interim += r[0].transcript;
    }
    if (interim) { el.voiceTranscript.textContent = interim; setVoiceStatus('PROCESSING'); }
    if (final) {
      el.voiceTranscript.textContent = final;
      el.dbgTranscript.textContent = final;
      const parsed = parseVoiceCommand(final);
      if (parsed) {
        el.voiceCommand.textContent = parsed.action.toUpperCase();
        el.voiceTarget.textContent = (parsed.targets && parsed.targets[0]) || (parsed.parameters && parsed.parameters.to) || selection.targets.join(', ') || '—';
        el.dbgParsed.textContent = JSON.stringify(parsed);
        setVoiceStatus('COMMAND RECOGNIZED');
        sendCommand(parsed.action, { targets: parsed.targets, parameters: parsed.parameters, source: A.SOURCE.VOICE });
      } else {
        el.voiceCommand.textContent = '—';
        setVoiceStatus('COMMAND REJECTED');
      }
    }
  };
}

el.micToggle.addEventListener('click', () => {
  if (!recognition) return;
  AetherAudio.unlock();
  voiceOn = !voiceOn;
  el.micToggle.classList.toggle('active', voiceOn);
  if (voiceOn) { setVoiceStatus('MICROPHONE READY'); recognition.start(); }
  else recognition.stop();
});

initVoice();
