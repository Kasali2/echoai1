/**
 * AETHER — shared constants.
 * Loaded by the server via require() and by every browser client via a
 * plain <script> tag, so there is exactly one definition of the protocol
 * and no risk of the server and clients silently disagreeing about it.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = mod; // Node (server.js, server/*.js)
  } else {
    root.AETHER = mod; // Browser (controller/world/node)
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const MAX_NODES = 10;

  const ROLE = Object.freeze({
    CONTROLLER: 'controller',
    WORLD: 'world',
    NODE: 'node',
  });

  // Every inbound message, from every client, is one of these types.
  const MSG = Object.freeze({
    // client -> server
    HELLO: 'hello', // { role, token?, sessionId? }
    COMMAND: 'command', // { command }
    PING: 'ping',
    // server -> client
    WELCOME: 'welcome', // { role, nodeId?, sessionId?, snapshot }
    STATE: 'state', // full or partial simulation snapshot
    EVENT: 'event', // a discrete, meaningful system event
    REJECTED: 'rejected', // { reason }
    CAPACITY_REACHED: 'capacity_reached',
    PONG: 'pong',
  });

  // The single vocabulary of actions. Gesture, voice and touch all resolve
  // to one of these before they ever reach the command dispatcher.
  const ACTION = Object.freeze({
    SELECT: 'select',
    SELECT_RANGE: 'select_range',
    SELECT_ALL: 'select_all',
    DESELECT_ALL: 'deselect_all',
    DISCONNECT_ALL: 'disconnect_all',
    FREEZE: 'freeze',
    RESUME: 'resume',
    CHARGE: 'charge',
    TRANSFER_ENERGY: 'transfer_energy',
    LAUNCH_PULSE: 'launch_pulse',
    ORBIT_START: 'orbit_start',
    ORBIT_STOP: 'orbit_stop',
    INCREASE_POWER: 'increase_power',
    DECREASE_POWER: 'decrease_power',
    ACTIVATE_REACTOR: 'activate_reactor',
    SHUTDOWN: 'shutdown',
    EXPAND_FIELD: 'expand_field',
    COMPRESS_FIELD: 'compress_field',
    RESET: 'reset',
    SET_TARGET_CURSOR: 'set_target_cursor', // continuous spatial pointing, not a discrete command
  });

  const SOURCE = Object.freeze({
    GESTURE: 'gesture',
    VOICE: 'voice',
    TOUCH: 'touch',
    SYSTEM: 'system',
  });

  const CONTROL_MODE = Object.freeze({
    SINGLE: 'single',
    GROUP: 'group',
    ALL: 'all',
  });

  const NODE_STATUS = Object.freeze({
    OFFLINE: 'offline',
    STANDBY: 'standby',
    TARGETED: 'targeted',
    CHARGING: 'charging',
    TRANSFERRING: 'transferring',
    FROZEN: 'frozen',
    ORBITING: 'orbiting',
    IMPACT: 'impact',
    OVERLOAD: 'overload',
  });

  const EVENT_TYPE = Object.freeze({
    NODE_CONNECTED: 'node_connected',
    NODE_DISCONNECTED: 'node_disconnected',
    TARGET_ACQUIRED: 'target_acquired',
    NODE_CHARGED: 'node_charged',
    ENERGY_TRANSFER: 'energy_transfer',
    PULSE_LAUNCHED: 'pulse_launched',
    COLLISION: 'collision',
    IMPACT: 'impact',
    ORBIT_START: 'orbit_start',
    ORBIT_STOP: 'orbit_stop',
    CORE_ACTIVATED: 'core_activated',
    POWER_INCREASED: 'power_increased',
    POWER_DECREASED: 'power_decreased',
    OVERLOAD: 'overload',
    STABILIZED: 'stabilized',
    SHUTDOWN: 'shutdown',
    FIELD_EXPANDED: 'field_expanded',
    FIELD_COMPRESSED: 'field_compressed',
    RESET: 'reset',
    COMMAND_REJECTED: 'command_rejected',
  });

  const GESTURE = Object.freeze({
    OPEN_HAND: 'open_hand',
    PINCH: 'pinch',
    PINCH_DRAG: 'pinch_drag',
    SWIPE_LEFT: 'swipe_left',
    SWIPE_RIGHT: 'swipe_right',
    FAST_SWIPE: 'fast_swipe',
    FIST: 'fist',
    TWO_HANDS: 'two_hands',
    SWEEP: 'sweep',
    TWO_HANDS_OPEN: 'two_hands_open',
    CIRCULAR: 'circular',
    HANDS_APART: 'hands_apart',
    HANDS_TOGETHER: 'hands_together',
    HOLD_OVER_NODE: 'hold_over_node',
  });

  return {
    MAX_NODES,
    ROLE,
    MSG,
    ACTION,
    SOURCE,
    CONTROL_MODE,
    NODE_STATUS,
    EVENT_TYPE,
    GESTURE,
  };
});
