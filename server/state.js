'use strict';

const physics = require('./physics');
const { MAX_NODES, NODE_STATUS, CONTROL_MODE } = require('../public/shared/constants');

function freshCore() {
  return {
    energy: 20,
    power: 0, // 0-100, drives visual field intensity
    temperature: 20,
    stability: 100,
    activation: 0, // 0 = dormant, 1 = fully activated
    overload: false,
    shutdown: false,
  };
}

function freshNode(slot) {
  return {
    id: `NODE_${String(slot + 1).padStart(2, '0')}`,
    slot,
    connected: false,
    sessionId: null,
    energy: 40,
    signal: 100,
    status: NODE_STATUS.OFFLINE,
    frozen: false,
    mass: 1,
    position: physics.restingPosition(slot, MAX_NODES),
    restRadius: physics.length(physics.restingPosition(slot, MAX_NODES)),
    velocity: physics.vec(),
    orbit: { active: false, radius: 0, angle: 0, angularVelocity: 0, tilt: 0 },
  };
}

function createState() {
  return {
    core: freshCore(),
    nodes: Array.from({ length: MAX_NODES }, (_, slot) => freshNode(slot)),
    selection: { mode: CONTROL_MODE.SINGLE, targets: [] },
    startedAt: Date.now(),
  };
}

/** Reset the live simulation only — never touches connection/session data. */
function resetSimulation(state) {
  state.core = freshCore();
  for (const node of state.nodes) {
    const wasConnected = node.connected;
    const sessionId = node.sessionId;
    const slot = node.slot;
    Object.assign(node, freshNode(slot));
    node.connected = wasConnected;
    node.sessionId = sessionId;
    node.status = wasConnected ? NODE_STATUS.STANDBY : NODE_STATUS.OFFLINE;
  }
  state.selection = { mode: CONTROL_MODE.SINGLE, targets: [] };
}

/** Find the first free slot, or null if the network is at capacity. */
function findFreeSlot(state) {
  const node = state.nodes.find((n) => !n.connected);
  return node ? node.slot : null;
}

/** A lean snapshot safe to broadcast to every client every tick. */
function snapshot(state) {
  return {
    core: state.core,
    nodes: state.nodes.map((n) => ({
      id: n.id,
      slot: n.slot,
      connected: n.connected,
      energy: Math.round(n.energy),
      signal: n.signal,
      status: n.status,
      frozen: n.frozen,
      position: n.position,
      selected: state.selection.targets.includes(n.id),
    })),
    selection: state.selection,
  };
}

module.exports = { createState, resetSimulation, findFreeSlot, snapshot, freshNode, freshCore };
