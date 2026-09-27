(() => {
  'use strict';
  const A = window.AETHER;
  const SESSION_KEY = 'aether_node_session_id';

  const el = {
    app: document.getElementById('app'),
    connState: document.getElementById('connState'),
    nodeId: document.getElementById('nodeId'),
    nodeStatus: document.getElementById('nodeStatus'),
    energyRing: document.getElementById('energyRing'),
    energyValue: document.getElementById('energyValue'),
    signalBar: document.getElementById('signalBar'),
    eventBanner: document.getElementById('eventBanner'),
    footSession: document.getElementById('footSession'),
  };

  const RING_CIRCUMFERENCE = 2 * Math.PI * 88;

  let ws = null;
  let myNodeId = null;
  let reconnectDelay = 800;
  let bannerTimer = null;

  function wsUrl() {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws`;
  }

  function connect() {
    setConnState('CONNECTING', '');
    ws = new WebSocket(wsUrl());

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        type: A.MSG.HELLO,
        role: A.ROLE.NODE,
        sessionId: localStorage.getItem(SESSION_KEY) || undefined,
      }));
    });

    ws.addEventListener('message', (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch { return; }
      handleMessage(msg);
    });

    ws.addEventListener('close', () => {
      setConnState('OFFLINE', 'off');
      el.app.classList.add('offline');
      scheduleReconnect();
    });

    ws.addEventListener('error', () => ws.close());
  }

  function scheduleReconnect() {
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 1.6, 8000);
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case A.MSG.WELCOME:
        reconnectDelay = 800;
        myNodeId = msg.nodeId;
        localStorage.setItem(SESSION_KEY, msg.sessionId);
        el.nodeId.textContent = myNodeId.replace('_', ' ');
        el.footSession.textContent = msg.sessionId.slice(0, 8);
        el.app.classList.remove('offline');
        setConnState('CONNECTED', 'on');
        applySnapshot(msg.snapshot);
        if (navigator.vibrate) navigator.vibrate(40);
        break;
      case A.MSG.STATE:
        applySnapshot(msg.snapshot);
        break;
      case A.MSG.EVENT:
        handleEvent(msg.event);
        break;
      case A.MSG.CAPACITY_REACHED:
        showCapacityReached();
        break;
      case A.MSG.REJECTED:
        setConnState('REJECTED', 'off');
        break;
    }
  }

  function applySnapshot(snapshot) {
    if (!snapshot || !myNodeId) return;
    const node = snapshot.nodes.find((n) => n.id === myNodeId);
    if (!node) return;

    el.energyValue.textContent = `${node.energy}%`;
    const offset = RING_CIRCUMFERENCE * (1 - node.energy / 100);
    el.energyRing.style.strokeDashoffset = String(offset);
    el.signalBar.style.width = `${node.signal}%`;
    el.nodeStatus.textContent = statusLabel(node.status, node.selected);

    el.app.classList.toggle('frozen', node.frozen);
    el.app.classList.toggle('charging', node.status === 'charging');
    el.app.classList.toggle('overload', snapshot.core.overload && node.selected);
  }

  function statusLabel(status, selected) {
    const map = {
      offline: 'AWAITING LINK',
      standby: selected ? 'TARGETED' : 'STANDBY',
      targeted: 'TARGET ACQUIRED',
      charging: 'CHARGING',
      transferring: 'ENERGY TRANSFER',
      frozen: 'FROZEN',
      orbiting: 'ORBITING CORE',
      impact: 'IMPACT DETECTED',
      overload: 'OVERLOAD',
    };
    return map[status] || status.toUpperCase();
  }

  function handleEvent(event) {
    const involvesMe = (ids) => Array.isArray(ids) && ids.includes(myNodeId);
    const mine =
      involvesMe(event.targets) ||
      event.nodeId === myNodeId ||
      event.from === myNodeId ||
      event.to === myNodeId ||
      event.a === myNodeId ||
      event.b === myNodeId;

    if (!mine && event.type !== A.EVENT_TYPE.SHUTDOWN && event.type !== A.EVENT_TYPE.RESET) return;

    switch (event.type) {
      case A.EVENT_TYPE.TARGET_ACQUIRED: banner('TARGET ACQUIRED'); buzz(30); break;
      case A.EVENT_TYPE.NODE_CHARGED: banner('CHARGE COMPLETE'); buzz([20, 40, 20]); break;
      case A.EVENT_TYPE.ENERGY_TRANSFER:
        banner(event.to === myNodeId ? 'RECEIVING ENERGY' : 'TRANSMITTING ENERGY');
        buzz(25);
        break;
      case A.EVENT_TYPE.PULSE_LAUNCHED: banner('PULSE LAUNCHED'); buzz(50); break;
      case A.EVENT_TYPE.IMPACT:
        banner('IMPACT DETECTED');
        el.app.classList.add('impact');
        setTimeout(() => el.app.classList.remove('impact'), 400);
        buzz([15, 30, 15]);
        break;
      case A.EVENT_TYPE.ORBIT_START: banner('ORBIT ENGAGED'); break;
      case A.EVENT_TYPE.ORBIT_STOP: banner('ORBIT RELEASED'); break;
      case A.EVENT_TYPE.OVERLOAD: banner('OVERLOAD'); buzz([80, 40, 80]); break;
      case A.EVENT_TYPE.SHUTDOWN: banner('SYSTEM SHUTDOWN'); break;
      case A.EVENT_TYPE.RESET: banner('RESTORING'); break;
    }
  }

  function banner(text) {
    el.eventBanner.textContent = text;
    el.eventBanner.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => el.eventBanner.classList.remove('show'), 1600);
  }

  function buzz(pattern) {
    if (navigator.vibrate) navigator.vibrate(pattern);
  }

  function setConnState(text, cls) {
    el.connState.textContent = text;
    el.connState.className = 'pill' + (cls ? ' ' + cls : '');
  }

  function showCapacityReached() {
    el.app.innerHTML = `
      <div style="margin:auto;text-align:center;">
        <div style="font-family:var(--display);font-size:1.4rem;letter-spacing:.08em;color:var(--danger);">
          NETWORK CAPACITY REACHED
        </div>
        <div style="margin-top:.6rem;color:var(--text-dim);font-size:.8rem;">
          All ${A.MAX_NODES} node slots are occupied.
        </div>
      </div>`;
  }

  connect();
})();
