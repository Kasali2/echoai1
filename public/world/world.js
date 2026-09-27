(() => {
  'use strict';
  const A = window.AETHER;
  const WORLD_SCALE = 3.2; // physics units -> scene units

  // ---- DOM ------------------------------------------------------------
  const el = {
    canvas: document.getElementById('scene'),
    boot: document.getElementById('boot'),
    bootLines: document.getElementById('bootLines'),
    connState: document.getElementById('connState'),
    eventTicker: document.getElementById('eventTicker'),
    debug: document.getElementById('debug'),
    dbgFps: document.getElementById('dbgFps'),
    dbgWs: document.getElementById('dbgWs'),
    dbgNodes: document.getElementById('dbgNodes'),
    dbgPower: document.getElementById('dbgPower'),
    dbgEvent: document.getElementById('dbgEvent'),
    muteBtn: document.getElementById('muteBtn'),
  };

  // ---- Three.js scene ---------------------------------------------------
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x07080a, 0.028);

  const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.1, 500);
  const renderer = new THREE.WebGLRenderer({ canvas: el.canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.setClearColor(0x07080a, 1);

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  scene.add(new THREE.AmbientLight(0x2a3540, 1.1));
  const coreLight = new THREE.PointLight(0xe2984f, 4, 60, 2);
  coreLight.position.set(0, 0, 0);
  scene.add(coreLight);
  const rimLight = new THREE.DirectionalLight(0x6fa8c9, 0.5);
  rimLight.position.set(-10, 12, -6);
  scene.add(rimLight);

  // reference ring grid on the floor — a spatial anchor, not decoration
  const gridGroup = new THREE.Group();
  for (let r = 6; r <= 24; r += 6) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(r - 0.02, r, 96),
      new THREE.MeshBasicMaterial({ color: 0x1e2530, side: THREE.DoubleSide, transparent: true, opacity: 0.5 })
    );
    ring.rotation.x = -Math.PI / 2;
    gridGroup.add(ring);
  }
  gridGroup.position.y = -7;
  scene.add(gridGroup);

  // atmospheric particles
  const PARTICLE_COUNT = 500;
  const particleGeo = new THREE.BufferGeometry();
  const particlePos = new Float32Array(PARTICLE_COUNT * 3);
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const r = 10 + Math.random() * 40;
    const theta = Math.random() * Math.PI * 2;
    const y = (Math.random() - 0.5) * 30;
    particlePos[i * 3] = Math.cos(theta) * r;
    particlePos[i * 3 + 1] = y;
    particlePos[i * 3 + 2] = Math.sin(theta) * r;
  }
  particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePos, 3));
  const particles = new THREE.Points(particleGeo, new THREE.PointsMaterial({ color: 0x35505f, size: 0.09, transparent: true, opacity: 0.5 }));
  scene.add(particles);

  // ---- AETHER CORE --------------------------------------------------------
  const coreGroup = new THREE.Group();
  const coreGeo = new THREE.IcosahedronGeometry(2.1, 2);
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0x1a2028, emissive: 0xe2984f, emissiveIntensity: 0.15,
    roughness: 0.35, metalness: 0.4, flatShading: true,
  });
  const coreMesh = new THREE.Mesh(coreGeo, coreMat);
  coreGroup.add(coreMesh);

  const coreWire = new THREE.Mesh(
    new THREE.IcosahedronGeometry(2.35, 1),
    new THREE.MeshBasicMaterial({ color: 0xe2984f, wireframe: true, transparent: true, opacity: 0.25 })
  );
  coreGroup.add(coreWire);
  scene.add(coreGroup);

  // ---- Node objects (pool of MAX_NODES, created once) --------------------
  const NODE_GEOMETRIES = [
    new THREE.OctahedronGeometry(0.55, 0),
    new THREE.TetrahedronGeometry(0.62, 0),
    new THREE.BoxGeometry(0.75, 0.75, 0.75),
  ];

  function makeLabelSprite(text) {
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.font = '700 34px "JetBrains Mono", monospace';
    ctx.fillStyle = '#dde4ea';
    ctx.textAlign = 'center';
    ctx.fillText(text, 64, 42);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.6, 0.8, 1);
    return sprite;
  }

  const nodeObjects = []; // { group, mesh, ring, label, prevPos, targetPos, lastUpdate }
  for (let i = 0; i < A.MAX_NODES; i++) {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(
      NODE_GEOMETRIES[i % NODE_GEOMETRIES.length],
      new THREE.MeshStandardMaterial({ color: 0x2a3540, emissive: 0x35505f, emissiveIntensity: 0.4, roughness: 0.4, metalness: 0.3 })
    );
    const targetRing = new THREE.Mesh(
      new THREE.RingGeometry(0.75, 0.86, 32),
      new THREE.MeshBasicMaterial({ color: 0xe2984f, side: THREE.DoubleSide, transparent: true, opacity: 0 })
    );
    targetRing.rotation.x = Math.PI / 2;
    const label = makeLabelSprite(String(i + 1).padStart(2, '0'));
    label.position.y = 1.1;
    group.add(mesh, targetRing, label);
    group.visible = false;
    scene.add(group);
    nodeObjects.push({ group, mesh, ring: targetRing, label, prevPos: new THREE.Vector3(), targetPos: new THREE.Vector3(), lastUpdate: 0 });
  }

  // ---- Transient effects layer -------------------------------------------
  const effects = []; // { update(dt) -> bool alive, mesh }
  const effectGroup = new THREE.Group();
  scene.add(effectGroup);

  function spawnTravelPulse(from, to, color, onArrive) {
    const geo = new THREE.SphereGeometry(0.22, 12, 12);
    const mat = new THREE.MeshBasicMaterial({ color });
    const mesh = new THREE.Mesh(geo, mat);
    effectGroup.add(mesh);
    const trailMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.5 });
    let t = 0;
    const duration = 0.7;
    effects.push({
      update(dt) {
        t += dt / duration;
        mesh.position.lerpVectors(from, to, Math.min(t, 1));
        mesh.scale.setScalar(1 + Math.sin(Math.min(t, 1) * Math.PI) * 0.6);
        if (t >= 1) {
          effectGroup.remove(mesh);
          if (onArrive) onArrive();
          return false;
        }
        return true;
      },
    });
  }

  function spawnImpactFlash(position, color = 0xe3585a) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.1, 0.2, 32),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
    );
    ring.position.copy(position);
    ring.lookAt(camera.position);
    effectGroup.add(ring);
    let t = 0;
    effects.push({
      update(dt) {
        t += dt;
        const p = Math.min(t / 0.5, 1);
        ring.scale.setScalar(1 + p * 6);
        ring.material.opacity = 0.9 * (1 - p);
        if (p >= 1) { effectGroup.remove(ring); return false; }
        return true;
      },
    });
  }

  // ---- Networking ---------------------------------------------------------
  let ws = null;
  let lastSnapshot = null;
  let booted = false;
  let connectedSeen = new Set();

  function wsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  }

  function connect() {
    setConn('LINKING', '');
    ws = new WebSocket(wsUrl());
    ws.addEventListener('open', () => ws.send(JSON.stringify({ type: A.MSG.HELLO, role: A.ROLE.WORLD })));
    ws.addEventListener('message', (evt) => {
      let msg; try { msg = JSON.parse(evt.data); } catch { return; }
      if (msg.type === A.MSG.WELCOME) {
        setConn('ONLINE', 'on');
        runBootSequence(msg.snapshot);
      } else if (msg.type === A.MSG.STATE) {
        applySnapshot(msg.snapshot);
      } else if (msg.type === A.MSG.EVENT) {
        handleEvent(msg.event);
      }
    });
    ws.addEventListener('close', () => { setConn('OFFLINE', 'off'); setTimeout(connect, 1500); });
    ws.addEventListener('error', () => ws.close());
  }

  function setConn(text, cls) {
    el.connState.textContent = text;
    el.connState.className = 'pill' + (cls ? ' ' + cls : '');
  }

  // ---- Boot sequence (reflects only real connections) ---------------------
  function bootLine(text, cls, delay) {
    return new Promise((resolve) => {
      setTimeout(() => {
        const div = document.createElement('div');
        div.textContent = text;
        if (cls) div.className = cls;
        el.bootLines.appendChild(div);
        resolve();
      }, delay);
    });
  }

  async function runBootSequence(snapshot) {
    if (booted) { applySnapshot(snapshot); return; }
    booted = true;
    let d = 0;
    const step = 260;
    await bootLine('SYSTEM INITIALIZING', 'title', (d += 0));
    await bootLine('AETHER CORE', null, (d += step));
    await bootLine('CALIBRATING PHYSICS', null, (d += step));
    await bootLine('ESTABLISHING NETWORK', null, (d += step));
    const connected = snapshot.nodes.filter((n) => n.connected);
    if (connected.length === 0) {
      await bootLine('NO NODES CONNECTED YET', null, (d += step));
    } else {
      for (const node of connected) {
        await bootLine(`${node.id.replace('_', ' ')} ........ ONLINE`, 'ok', (d += step * 0.6));
      }
    }
    await bootLine('NETWORK SYNCHRONIZED', null, (d += step));
    await bootLine('AETHER CORE ONLINE', 'ok', (d += step));
    setTimeout(() => el.boot.classList.add('hide'), 700);
    applySnapshot(snapshot);
  }

  // ---- Snapshot application (interpolation targets) ------------------------
  function applySnapshot(snapshot) {
    lastSnapshot = snapshot;
    const now = performance.now();

    snapshot.nodes.forEach((n, i) => {
      const obj = nodeObjects[i];
      obj.group.visible = n.connected;
      if (!n.connected) {
        connectedSeen.delete(n.id);
        return;
      }
      const wasKnown = connectedSeen.has(n.id);
      connectedSeen.add(n.id);

      const target = new THREE.Vector3(n.position.x, n.position.y, n.position.z).multiplyScalar(WORLD_SCALE);
      if (!wasKnown) {
        obj.prevPos.copy(target);
        obj.group.position.copy(target);
      } else {
        obj.prevPos.copy(obj.group.position);
      }
      obj.targetPos.copy(target);
      obj.lastUpdate = now;

      obj.ring.material.opacity = n.selected ? 0.85 : 0;
      const emissiveColor = statusColor(n.status, n.frozen);
      obj.mesh.material.emissive.setHex(emissiveColor);
      obj.mesh.material.emissiveIntensity = n.status === 'charging' ? 1.2 + Math.sin(now * 0.02) * 0.3 : 0.5;
    });

    updateDebug(snapshot);
  }

  function statusColor(status, frozen) {
    if (frozen) return 0x6fa8c9;
    switch (status) {
      case 'charging': return 0xe2984f;
      case 'transferring': return 0xe2984f;
      case 'orbiting': return 0x6fa8c9;
      case 'impact': return 0xe3585a;
      case 'overload': return 0xe3585a;
      default: return 0x35505f;
    }
  }

  // ---- Events -> cinematic effects + ticker ---------------------------------
  const TICKER_TEXT = {
    node_connected: (e) => `${e.nodeId.replace('_', ' ')} LINKED`,
    node_disconnected: (e) => `${e.nodeId.replace('_', ' ')} LOST`,
    target_acquired: (e) => `TARGET ACQUIRED`,
    node_charged: (e) => `${e.nodeId.replace('_', ' ')} CHARGED`,
    energy_transfer: (e) => `ENERGY TRANSFER`,
    pulse_launched: () => `PULSE LAUNCHED`,
    impact: () => `IMPACT`,
    orbit_start: () => `ORBIT ENGAGED`,
    orbit_stop: () => `ORBIT RELEASED`,
    core_activated: () => `CORE ACTIVATED`,
    power_increased: () => `POWER INCREASED`,
    power_decreased: () => `POWER DECREASED`,
    overload: () => `OVERLOAD`,
    stabilized: () => `STABILIZED`,
    shutdown: () => `SHUTDOWN`,
    reset: () => `AETHER RESET`,
  };

  function nodePos(id) {
    if (!lastSnapshot) return new THREE.Vector3();
    const idx = lastSnapshot.nodes.findIndex((n) => n.id === id);
    return idx >= 0 ? nodeObjects[idx].group.position.clone() : new THREE.Vector3();
  }

  function handleEvent(event) {
    AetherAudio.playEvent(event.type);
    if (TICKER_TEXT[event.type]) ticker(TICKER_TEXT[event.type](event));
    el.dbgEvent.textContent = event.type;

    switch (event.type) {
      case A.EVENT_TYPE.PULSE_LAUNCHED:
        (event.targets || []).forEach((id) => {
          const from = new THREE.Vector3(0, 0, 0);
          spawnTravelPulse(from, nodePos(id), 0xe2984f);
        });
        break;
      case A.EVENT_TYPE.ENERGY_TRANSFER:
        spawnTravelPulse(nodePos(event.from), nodePos(event.to), 0xe2984f);
        break;
      case A.EVENT_TYPE.IMPACT:
        (event.targets || []).forEach((id) => spawnImpactFlash(nodePos(id)));
        break;
      case A.EVENT_TYPE.OVERLOAD:
        cameraShake = 0.4;
        break;
      case A.EVENT_TYPE.CORE_ACTIVATED:
        spawnImpactFlash(new THREE.Vector3(0, 0, 0), 0xe2984f);
        break;
    }
  }

  let tickerTimer = null;
  function ticker(text) {
    el.eventTicker.textContent = text;
    el.eventTicker.classList.add('show');
    clearTimeout(tickerTimer);
    tickerTimer = setTimeout(() => el.eventTicker.classList.remove('show'), 2200);
  }

  // ---- Debug panel ----------------------------------------------------------
  function updateDebug(snapshot) {
    el.dbgWs.textContent = ws && ws.readyState === WebSocket.OPEN ? 'OPEN' : 'DOWN';
    el.dbgNodes.textContent = `${snapshot.nodes.filter((n) => n.connected).length} / ${A.MAX_NODES}`;
    el.dbgPower.textContent = `${Math.round(snapshot.core.power)}%`;
  }

  addEventListener('keydown', (e) => {
    if (e.key === 'd' || e.key === 'D') el.debug.classList.toggle('hidden');
  });

  el.muteBtn.addEventListener('click', () => {
    AetherAudio.unlock();
    const muted = !AetherAudio.isMuted();
    AetherAudio.setMuted(muted);
    el.muteBtn.textContent = muted ? 'SOUND: OFF' : 'SOUND: ON';
  });
  addEventListener('pointerdown', () => AetherAudio.unlock(), { once: true });

  // ---- Render loop -------------------------------------------------------
  const SNAPSHOT_INTERVAL_MS = 50;
  let cameraAngle = 0;
  let cameraShake = 0;
  let lastFrame = performance.now();
  let fpsSmooth = 60;

  function animate(now) {
    requestAnimationFrame(animate);
    const dt = Math.min((now - lastFrame) / 1000, 0.1);
    lastFrame = now;
    fpsSmooth += (1 / Math.max(dt, 0.001) - fpsSmooth) * 0.05;
    el.dbgFps.textContent = Math.round(fpsSmooth);

    // interpolate node positions toward their latest server-reported target
    for (const obj of nodeObjects) {
      if (!obj.group.visible) continue;
      const t = Math.min((now - obj.lastUpdate) / SNAPSHOT_INTERVAL_MS, 1);
      obj.group.position.lerpVectors(obj.prevPos, obj.targetPos, t);
      obj.mesh.rotation.y += dt * 0.6;
      obj.mesh.rotation.x += dt * 0.2;
      obj.ring.lookAt(camera.position);
    }

    // core visual state driven directly by core.power / activation / overload
    if (lastSnapshot) {
      const core = lastSnapshot.core;
      const pulse = 0.15 + (core.power / 100) * 0.9 + Math.sin(now * 0.004) * 0.05 * core.activation;
      coreMat.emissiveIntensity = core.overload ? pulse + Math.sin(now * 0.03) * 0.6 : pulse;
      coreMat.color.setHex(core.overload ? 0x3a1414 : 0x1a2028);
      coreWire.material.color.setHex(core.overload ? 0xe3585a : 0xe2984f);
      const scale = 1 + core.activation * 0.18;
      coreGroup.scale.setScalar(scale);
      coreLight.intensity = 2 + core.power / 100 * 6 + (core.overload ? Math.sin(now * 0.03) * 2 : 0);
      coreLight.color.setHex(core.overload ? 0xe3585a : 0xe2984f);
    }
    coreMesh.rotation.y += dt * 0.12;
    coreWire.rotation.y -= dt * 0.08;

    // slow automatic cinematic camera orbit
    cameraAngle += dt * 0.045;
    const radius = 15.5;
    const bob = Math.sin(now * 0.0003) * 1.2;
    let cx = Math.cos(cameraAngle) * radius;
    let cz = Math.sin(cameraAngle) * radius;
    let cy = 4.5 + bob;
    if (cameraShake > 0) {
      cameraShake = Math.max(0, cameraShake - dt);
      cx += (Math.random() - 0.5) * cameraShake * 2;
      cy += (Math.random() - 0.5) * cameraShake * 2;
    }
    camera.position.set(cx, cy, cz);
    camera.lookAt(0, 0, 0);

    particles.rotation.y += dt * 0.01;

    for (let i = effects.length - 1; i >= 0; i--) {
      if (!effects[i].update(dt)) effects.splice(i, 1);
    }

    renderer.render(scene, camera);
  }

  requestAnimationFrame(animate);
  connect();
})();
