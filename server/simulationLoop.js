'use strict';

const physics = require('./physics');
const { NODE_STATUS, EVENT_TYPE } = require('../public/shared/constants');

const CHARGE_RATE = 28; // %/sec
const CORE_DRAIN_RATIO = 0.3;
const IMPACT_SPEED_THRESHOLD = 4;
const IMPACT_HOLD_MS = 700;

/**
 * Advance `state` by `dtMs` milliseconds. Pure function of (state, now) —
 * no I/O, no globals — so it can run identically in the real server loop
 * and in a unit test. Returns the list of events produced this tick.
 */
function tick(state, dtMs, now = Date.now()) {
  const events = [];
  const dtSec = dtMs / 1000;

  advanceCharging(state, dtSec, now, events);
  advanceTransfers(state, now);
  advanceCoreLifecycle(state, dtSec);

  const collisions = physics.step(state.nodes, dtSec);
  for (const hit of collisions) {
    events.push({ type: EVENT_TYPE.COLLISION, a: hit.a, b: hit.b });
    if (hit.speed > IMPACT_SPEED_THRESHOLD) {
      const nodeA = state.nodes.find((n) => n.id === hit.a);
      const nodeB = state.nodes.find((n) => n.id === hit.b);
      if (nodeA && nodeB) {
        nodeA.status = NODE_STATUS.IMPACT;
        nodeB.status = NODE_STATUS.IMPACT;
        nodeA.impactResetAt = now + IMPACT_HOLD_MS;
        nodeB.impactResetAt = now + IMPACT_HOLD_MS;
        events.push({ type: EVENT_TYPE.IMPACT, targets: [hit.a, hit.b] });
      }
    }
  }

  for (const node of state.nodes) {
    if (node.impactResetAt && now > node.impactResetAt && node.status === NODE_STATUS.IMPACT) {
      node.status = node.orbit.active ? NODE_STATUS.ORBITING : NODE_STATUS.STANDBY;
      node.impactResetAt = null;
    }
  }

  return events;
}

function advanceCharging(state, dtSec, now, events) {
  const drawn = CHARGE_RATE * dtSec;
  for (const node of state.nodes) {
    if (node.status !== NODE_STATUS.CHARGING) continue;
    node.energy = Math.min(100, node.energy + drawn);
    state.core.energy = Math.max(0, state.core.energy - drawn * CORE_DRAIN_RATIO);

    const done = node.energy >= 100 || (node.chargingUntil && now > node.chargingUntil);
    if (done) {
      node.status = node.orbit.active ? NODE_STATUS.ORBITING : NODE_STATUS.STANDBY;
      node.chargingUntil = null;
      events.push({ type: EVENT_TYPE.NODE_CHARGED, nodeId: node.id, energy: Math.round(node.energy) });
    }
  }
}

function advanceTransfers(state, now) {
  for (const node of state.nodes) {
    if (node.status === NODE_STATUS.TRANSFERRING && node.transferResetAt && now > node.transferResetAt) {
      node.status = node.orbit.active ? NODE_STATUS.ORBITING : NODE_STATUS.STANDBY;
      node.transferResetAt = null;
    }
  }
}

function advanceCoreLifecycle(state, dtSec) {
  const core = state.core;
  if (core.activating && core.activation < 1) {
    core.activation = Math.min(1, core.activation + dtSec * 0.6);
    if (core.activation >= 1) core.activating = false;
  }
  if (core.shutdown) {
    core.activation = Math.max(0, core.activation - dtSec * 0.5);
    core.power = Math.max(0, core.power - dtSec * 25);
    core.temperature = Math.max(20, core.temperature - dtSec * 10);
    for (const node of state.nodes) {
      if (node.orbit.active) {
        node.orbit.angularVelocity *= 0.9;
        if (node.orbit.angularVelocity < 0.02) node.orbit.active = false;
      }
    }
  }
  if (!core.activating && !core.shutdown && core.power > 0) {
    core.temperature = Math.max(20, core.temperature - dtSec * 1.5);
  }
}

module.exports = { tick };
