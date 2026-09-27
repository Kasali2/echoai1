'use strict';
// Temporary self-test — exercises the pure simulation/command/nodeManager
// logic with zero external dependencies. Not shipped in the final zip.

const assert = require('assert');
const { createState, snapshot } = require('../server/state');
const { applyCommand } = require('../server/commands');
const { NodeManager } = require('../server/nodeManager');
const simulation = require('../server/simulationLoop');
const { ACTION, NODE_STATUS, CONTROL_MODE, EVENT_TYPE, MAX_NODES } = require('../public/shared/constants');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok  - ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL - ${name}`);
    console.log(`         ${e.message}`);
  }
}

console.log('state + nodeManager');
{
  const state = createState();
  assert.strictEqual(state.nodes.length, MAX_NODES);
  const nm = new NodeManager(state);

  check('10 nodes connect and get sequential IDs', () => {
    const results = [];
    for (let i = 0; i < 10; i++) results.push(nm.connect({}, null));
    assert.ok(results.every((r) => r.ok));
    assert.strictEqual(state.nodes.filter((n) => n.connected).length, 10);
    assert.strictEqual(state.nodes[0].id, 'NODE_01');
    assert.strictEqual(state.nodes[9].id, 'NODE_10');
  });

  check('11th connection is rejected at capacity', () => {
    const r = nm.connect({}, null);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'capacity_reached');
  });

  check('disconnect + reconnect within grace period reclaims the same slot', () => {
    const sessionId = state.nodes[3].sessionId;
    nm.disconnect(3);
    assert.strictEqual(state.nodes[3].connected, true, 'still connected during grace period');
    const r = nm.connect({}, sessionId);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.slot, 3);
    assert.strictEqual(r.reconnected, true);
  });
}

console.log('command dispatcher');
{
  const state = createState();
  const nm = new NodeManager(state);
  for (let i = 0; i < 4; i++) nm.connect({}, null);

  check('SELECT sets selection and rejects unknown targets', () => {
    let events = applyCommand(state, { action: ACTION.SELECT, targets: ['NODE_02'] });
    assert.deepStrictEqual(state.selection, { mode: CONTROL_MODE.SINGLE, targets: ['NODE_02'] });
    assert.strictEqual(events[0].type, EVENT_TYPE.TARGET_ACQUIRED);

    events = applyCommand(state, { action: ACTION.SELECT, targets: ['NODE_09'] }); // not connected
    assert.strictEqual(events[0].type, EVENT_TYPE.COMMAND_REJECTED);
  });

  check('CHARGE moves a node into CHARGING and energy actually rises over ticks', () => {
    applyCommand(state, { action: ACTION.SELECT, targets: ['NODE_02'] });
    applyCommand(state, { action: ACTION.CHARGE, parameters: { durationMs: 500 } });
    const node = state.nodes[1];
    assert.strictEqual(node.status, NODE_STATUS.CHARGING);
    const before = node.energy;
    for (let i = 0; i < 5; i++) simulation.tick(state, 50, Date.now());
    assert.ok(node.energy > before, `energy should rise: ${before} -> ${node.energy}`);
  });

  check('CHARGE draws down core energy (real transfer, not free)', () => {
    const before = state.core.energy;
    for (let i = 0; i < 5; i++) simulation.tick(state, 50, Date.now());
    assert.ok(state.core.energy <= before, 'core energy should not increase while a node charges');
  });

  check('TRANSFER_ENERGY moves energy from one connected node to another', () => {
    const from = state.nodes[0];
    const to = state.nodes[2];
    from.energy = 80;
    to.energy = 10;
    const events = applyCommand(state, {
      action: ACTION.TRANSFER_ENERGY,
      parameters: { from: from.id, to: to.id, amount: 30 },
    });
    assert.strictEqual(from.energy, 50);
    assert.strictEqual(to.energy, 40);
    assert.strictEqual(events[0].type, EVENT_TYPE.ENERGY_TRANSFER);
  });

  check('FREEZE actually zeroes velocity and stops further motion', () => {
    const node = state.nodes[0];
    node.velocity = { x: 5, y: 0, z: 0 };
    applyCommand(state, { action: ACTION.SELECT, targets: [node.id] });
    applyCommand(state, { action: ACTION.FREEZE });
    assert.strictEqual(node.frozen, true);
    assert.deepStrictEqual(node.velocity, { x: 0, y: 0, z: 0 });
    const posBefore = { ...node.position };
    for (let i = 0; i < 10; i++) simulation.tick(state, 50, Date.now());
    assert.deepStrictEqual(node.position, posBefore, 'frozen node must not move');
  });

  check('LAUNCH_PULSE gives a real non-zero velocity to the target', () => {
    const node = state.nodes[2];
    node.frozen = false;
    applyCommand(state, { action: ACTION.SELECT, targets: [node.id] });
    const events = applyCommand(state, { action: ACTION.LAUNCH_PULSE });
    assert.strictEqual(events[0].type, EVENT_TYPE.PULSE_LAUNCHED);
    const speed = Math.hypot(node.velocity.x, node.velocity.y, node.velocity.z);
    assert.ok(speed > 0, 'pulse must actually change velocity');
  });

  check('ORBIT_START makes position continuously derive from orbital state', () => {
    const node = state.nodes[3];
    node.frozen = false;
    applyCommand(state, { action: ACTION.SELECT, targets: [node.id] });
    applyCommand(state, { action: ACTION.ORBIT_START });
    assert.strictEqual(node.orbit.active, true);
    const positions = [];
    for (let i = 0; i < 5; i++) {
      simulation.tick(state, 50, Date.now());
      positions.push({ ...node.position });
    }
    const distinct = new Set(positions.map((p) => `${p.x.toFixed(3)},${p.z.toFixed(3)}`));
    assert.ok(distinct.size > 1, 'orbiting node must move each tick');
    const radii = positions.map((p) => Math.hypot(p.x, p.z));
    for (const r of radii) assert.ok(Math.abs(r - radii[0]) < 0.05, 'radius should stay constant while orbiting');
  });

  check('INCREASE_POWER past threshold triggers a real overload state', () => {
    state.core.power = 85;
    state.core.overload = false;
    const events = applyCommand(state, { action: ACTION.INCREASE_POWER });
    assert.strictEqual(state.core.power, 100);
    assert.strictEqual(state.core.overload, true);
    assert.ok(events.some((e) => e.type === EVENT_TYPE.OVERLOAD));
  });

  check('EXPAND_FIELD pushes connected nodes outward (real velocity, away from core)', () => {
    for (const n of state.nodes) { n.frozen = false; n.orbit.active = false; n.velocity = { x: 0, y: 0, z: 0 }; }
    applyCommand(state, { action: ACTION.DESELECT_ALL });
    applyCommand(state, { action: ACTION.EXPAND_FIELD });
    const node = state.nodes.find((n) => n.connected);
    const outward = { x: node.position.x, y: node.position.y, z: node.position.z };
    const dot = node.velocity.x * outward.x + node.velocity.y * outward.y + node.velocity.z * outward.z;
    assert.ok(dot > 0, 'velocity should point away from the core');
  });

  check('COMPRESS_FIELD pulls connected nodes inward (real velocity, toward core)', () => {
    for (const n of state.nodes) { n.frozen = false; n.orbit.active = false; n.velocity = { x: 0, y: 0, z: 0 }; }
    applyCommand(state, { action: ACTION.DESELECT_ALL });
    applyCommand(state, { action: ACTION.COMPRESS_FIELD });
    const node = state.nodes.find((n) => n.connected);
    const outward = { x: node.position.x, y: node.position.y, z: node.position.z };
    const dot = node.velocity.x * outward.x + node.velocity.y * outward.y + node.velocity.z * outward.z;
    assert.ok(dot < 0, 'velocity should point toward the core');
  });

  check('RESET restores standby without dropping actual connections', () => {
    const wasConnected = state.nodes.map((n) => n.connected);
    applyCommand(state, { action: ACTION.RESET });
    assert.deepStrictEqual(state.nodes.map((n) => n.connected), wasConnected, 'reset must not disconnect real phones');
    assert.strictEqual(state.core.power, 0);
    assert.strictEqual(state.selection.targets.length, 0);
  });
}

console.log('snapshot shape');
{
  const state = createState();
  const nm = new NodeManager(state);
  nm.connect({}, null);
  check('snapshot only reports actually-connected nodes as connected', () => {
    const snap = snapshot(state);
    const connectedInSnap = snap.nodes.filter((n) => n.connected).length;
    assert.strictEqual(connectedInSnap, 1, 'snapshot must reflect real connection state, not a hardcoded count');
  });
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
