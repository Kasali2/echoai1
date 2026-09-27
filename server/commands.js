'use strict';

const physics = require('./physics');
const { resetSimulation } = require('./state');
const { ACTION, NODE_STATUS, CONTROL_MODE, EVENT_TYPE } = require('../public/shared/constants');

const CHARGE_RATE = 28; // % per second while charging
const CHARGE_CORE_COST = 10; // core energy % consumed per 10% node charge
const TRANSFER_DEFAULT_AMOUNT = 25;
const POWER_STEP = 15;
const ORBIT_ANGULAR_VELOCITY = 0.9; // rad/s

function nodeById(state, id) {
  return state.nodes.find((n) => n.id === id && n.connected);
}

function connectedIds(state) {
  return state.nodes.filter((n) => n.connected).map((n) => n.id);
}

function resolveTargets(state, command) {
  if (Array.isArray(command.targets) && command.targets.length > 0) {
    return command.targets.filter((id) => nodeById(state, id));
  }
  return state.selection.targets.filter((id) => nodeById(state, id));
}

function reject(events, action, reason) {
  events.push({ type: EVENT_TYPE.COMMAND_REJECTED, action, reason });
}

/**
 * Apply one already-normalized command to `state`, mutating it in place.
 * Returns the list of discrete events the command produced (possibly empty).
 * `command` = { action, targets, parameters, source, timestamp, requestId }
 */
function applyCommand(state, command) {
  const events = [];
  const action = command.action;
  const params = command.parameters || {};

  switch (action) {
    case ACTION.SET_TARGET_CURSOR: {
      // Continuous pointing feedback only — does not change selection.
      state.cursor = params.point || null;
      break;
    }

    case ACTION.SELECT: {
      const id = (command.targets && command.targets[0]) || params.nodeId;
      const node = nodeById(state, id);
      if (!node) {
        reject(events, action, `Unknown or offline target: ${id}`);
        break;
      }
      state.selection = { mode: CONTROL_MODE.SINGLE, targets: [id] };
      events.push({ type: EVENT_TYPE.TARGET_ACQUIRED, targets: [id] });
      break;
    }

    case ACTION.SELECT_RANGE: {
      const ids = (command.targets || []).filter((id) => nodeById(state, id));
      if (ids.length === 0) {
        reject(events, action, 'No valid targets in range');
        break;
      }
      state.selection = { mode: CONTROL_MODE.GROUP, targets: ids };
      events.push({ type: EVENT_TYPE.TARGET_ACQUIRED, targets: ids });
      break;
    }

    case ACTION.SELECT_ALL: {
      const ids = connectedIds(state);
      state.selection = { mode: CONTROL_MODE.ALL, targets: ids };
      events.push({ type: EVENT_TYPE.TARGET_ACQUIRED, targets: ids });
      break;
    }

    case ACTION.DESELECT_ALL: {
      state.selection = { mode: CONTROL_MODE.SINGLE, targets: [] };
      break;
    }

    case ACTION.FREEZE: {
      const ids = resolveTargets(state, command);
      if (ids.length === 0) { reject(events, action, 'No target selected'); break; }
      for (const id of ids) {
        const node = nodeById(state, id);
        node.frozen = true;
        node.orbit.active = false;
        node.velocity = physics.vec();
        node.status = NODE_STATUS.FROZEN;
      }
      break;
    }

    case ACTION.RESUME: {
      const ids = resolveTargets(state, command);
      for (const id of ids) {
        const node = nodeById(state, id);
        if (!node) continue;
        node.frozen = false;
        node.status = NODE_STATUS.STANDBY;
      }
      break;
    }

    case ACTION.CHARGE: {
      const ids = resolveTargets(state, command);
      if (ids.length === 0) { reject(events, action, 'No target selected'); break; }
      const duration = params.durationMs || 1400;
      for (const id of ids) {
        const node = nodeById(state, id);
        if (!node || node.frozen) continue;
        node.status = NODE_STATUS.CHARGING;
        node.chargingUntil = Date.now() + duration;
      }
      events.push({ type: EVENT_TYPE.TARGET_ACQUIRED, targets: ids });
      break;
    }

    case ACTION.TRANSFER_ENERGY: {
      const fromId = params.from;
      const toId = params.to || (resolveTargets(state, command)[0]);
      const from = nodeById(state, fromId);
      const to = nodeById(state, toId);
      const amount = Math.min(params.amount || TRANSFER_DEFAULT_AMOUNT, from ? from.energy : 0);
      if (!from || !to || from.id === to.id || amount <= 0) {
        reject(events, action, 'Invalid transfer pair');
        break;
      }
      from.energy = Math.max(0, from.energy - amount);
      to.energy = Math.min(100, to.energy + amount);
      from.status = NODE_STATUS.TRANSFERRING;
      to.status = NODE_STATUS.TRANSFERRING;
      from.transferResetAt = Date.now() + 900;
      to.transferResetAt = Date.now() + 900;
      events.push({ type: EVENT_TYPE.ENERGY_TRANSFER, from: from.id, to: to.id, amount });
      break;
    }

    case ACTION.LAUNCH_PULSE: {
      const ids = resolveTargets(state, command);
      if (ids.length === 0) { reject(events, action, 'No target selected'); break; }
      for (const id of ids) {
        const node = nodeById(state, id);
        if (!node || node.frozen) continue;
        node.orbit.active = false;
        const outward = physics.sub(node.position, physics.CORE_POSITION);
        physics.applyImpulse(node, outward, 14 + (params.power || 0));
      }
      events.push({ type: EVENT_TYPE.PULSE_LAUNCHED, targets: ids });
      break;
    }

    case ACTION.ORBIT_START: {
      const ids = resolveTargets(state, command);
      if (ids.length === 0) { reject(events, action, 'No target selected'); break; }
      ids.forEach((id, i) => {
        const node = nodeById(state, id);
        if (!node || node.frozen) return;
        const radius = physics.MIN_ORBIT_RADIUS + i * 1.6;
        const currentAngle = Math.atan2(node.position.z, node.position.x) || 0;
        node.orbit = {
          active: true,
          radius,
          angle: currentAngle,
          angularVelocity: ORBIT_ANGULAR_VELOCITY,
          tilt: 1.2 + (i % 3) * 0.4,
        };
        node.status = NODE_STATUS.ORBITING;
      });
      events.push({ type: EVENT_TYPE.ORBIT_START, targets: ids });
      break;
    }

    case ACTION.ORBIT_STOP: {
      const ids = resolveTargets(state, command);
      for (const id of ids) {
        const node = nodeById(state, id);
        if (!node) continue;
        node.orbit.active = false;
        node.status = NODE_STATUS.STANDBY;
      }
      events.push({ type: EVENT_TYPE.ORBIT_STOP, targets: ids });
      break;
    }

    case ACTION.INCREASE_POWER: {
      state.core.power = Math.min(100, state.core.power + POWER_STEP);
      state.core.temperature = Math.min(120, state.core.temperature + 6);
      events.push({ type: EVENT_TYPE.POWER_INCREASED, power: state.core.power });
      if (state.core.power >= 95 && !state.core.overload) {
        state.core.overload = true;
        state.core.stability = Math.max(0, state.core.stability - 35);
        events.push({ type: EVENT_TYPE.OVERLOAD });
      }
      break;
    }

    case ACTION.DECREASE_POWER: {
      state.core.power = Math.max(0, state.core.power - POWER_STEP);
      state.core.temperature = Math.max(20, state.core.temperature - 6);
      if (state.core.overload && state.core.power < 70) {
        state.core.overload = false;
        state.core.stability = Math.min(100, state.core.stability + 20);
        events.push({ type: EVENT_TYPE.STABILIZED });
      }
      events.push({ type: EVENT_TYPE.POWER_DECREASED, power: state.core.power });
      break;
    }

    case ACTION.EXPAND_FIELD: {
      // real radial force: pushes the selection (or every connected node,
      // if nothing is selected) away from the core
      const ids = resolveTargets(state, command).length ? resolveTargets(state, command) : connectedIds(state);
      for (const id of ids) {
        const node = nodeById(state, id);
        if (!node || node.frozen) continue;
        node.orbit.active = false;
        physics.applyRadialForce(node, physics.CORE_POSITION, -(params.strength || 90));
      }
      events.push({ type: EVENT_TYPE.FIELD_EXPANDED, targets: ids });
      break;
    }

    case ACTION.COMPRESS_FIELD: {
      const ids = resolveTargets(state, command).length ? resolveTargets(state, command) : connectedIds(state);
      for (const id of ids) {
        const node = nodeById(state, id);
        if (!node || node.frozen) continue;
        node.orbit.active = false;
        physics.applyRadialForce(node, physics.CORE_POSITION, params.strength || 90);
      }
      events.push({ type: EVENT_TYPE.FIELD_COMPRESSED, targets: ids });
      break;
    }

    case ACTION.ACTIVATE_REACTOR: {
      state.core.shutdown = false;
      state.core.activating = true;
      events.push({ type: EVENT_TYPE.CORE_ACTIVATED });
      break;
    }

    case ACTION.SHUTDOWN: {
      state.core.shutdown = true;
      state.core.activating = false;
      for (const node of state.nodes) {
        node.orbit.active = false;
      }
      events.push({ type: EVENT_TYPE.SHUTDOWN });
      break;
    }

    case ACTION.RESET: {
      resetSimulation(state);
      events.push({ type: EVENT_TYPE.RESET });
      break;
    }

    default:
      reject(events, action, 'Unrecognized action');
  }

  return events;
}

module.exports = { applyCommand, nodeById, connectedIds, resolveTargets };
