'use strict';

const { ROLE, MSG, ACTION, SOURCE } = require('../public/shared/constants');

const MAX_MESSAGE_BYTES = 8 * 1024; // generous for a command message; blocks abuse
const VALID_ROLES = new Set(Object.values(ROLE));
const VALID_TYPES = new Set(Object.values(MSG));
const VALID_ACTIONS = new Set(Object.values(ACTION));
const VALID_SOURCES = new Set(Object.values(SOURCE));

/** Parse + validate a raw inbound frame. Returns { ok, msg, reason }. */
function parseInbound(raw) {
  if (typeof raw !== 'string' && !(raw instanceof Buffer)) {
    return { ok: false, reason: 'unsupported_frame_type' };
  }
  if (raw.length > MAX_MESSAGE_BYTES) {
    return { ok: false, reason: 'message_too_large' };
  }

  let msg;
  try {
    msg = JSON.parse(raw.toString('utf8'));
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }

  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
    return { ok: false, reason: 'missing_type' };
  }
  if (!VALID_TYPES.has(msg.type)) {
    return { ok: false, reason: 'unknown_message_type' };
  }

  if (msg.type === MSG.HELLO) {
    if (!msg.role || !VALID_ROLES.has(msg.role)) {
      return { ok: false, reason: 'invalid_role' };
    }
  }

  if (msg.type === MSG.COMMAND) {
    const valid = validateCommand(msg.command);
    if (!valid.ok) return valid;
  }

  return { ok: true, msg };
}

function validateCommand(command) {
  if (!command || typeof command !== 'object') {
    return { ok: false, reason: 'missing_command' };
  }
  if (typeof command.action !== 'string' || !VALID_ACTIONS.has(command.action)) {
    return { ok: false, reason: 'unknown_action' };
  }
  if (command.source !== undefined && !VALID_SOURCES.has(command.source)) {
    return { ok: false, reason: 'unknown_source' };
  }
  if (command.targets !== undefined) {
    if (!Array.isArray(command.targets) || command.targets.length > 10) {
      return { ok: false, reason: 'invalid_targets' };
    }
    if (!command.targets.every((t) => typeof t === 'string' && t.length <= 32)) {
      return { ok: false, reason: 'invalid_targets' };
    }
  }
  if (command.parameters !== undefined && typeof command.parameters !== 'object') {
    return { ok: false, reason: 'invalid_parameters' };
  }
  return { ok: true };
}

module.exports = { parseInbound, validateCommand, MAX_MESSAGE_BYTES };
