'use strict';

const crypto = require('crypto');
const { MAX_NODES, NODE_STATUS } = require('../public/shared/constants');
const { findFreeSlot, freshNode } = require('./state');

const RECONNECT_GRACE_MS = 20_000; // a node can drop and reclaim its slot within this window

/**
 * Owns the mapping between live WebSocket sockets and node slots.
 * `state.nodes[i].connected` is the single source of truth for "is a real
 * phone occupying slot i" — nothing here fakes connectivity.
 */
class NodeManager {
  constructor(state) {
    this.state = state;
    this.socketBySlot = new Map(); // slot -> ws
    this.slotBySessionId = new Map(); // sessionId -> slot
    this.pendingRelease = new Map(); // slot -> Timeout
  }

  /** A new /node socket says hello. Returns { ok, slot, sessionId, reason }. */
  connect(ws, requestedSessionId) {
    const state = this.state;

    // Reconnect: the phone remembers a sessionId from a previous load.
    if (requestedSessionId && this.slotBySessionId.has(requestedSessionId)) {
      const slot = this.slotBySessionId.get(requestedSessionId);
      const node = state.nodes[slot];
      if (node && (!node.connected || this.pendingRelease.has(slot))) {
        this._clearPendingRelease(slot);
        node.connected = true;
        node.status = NODE_STATUS.STANDBY;
        this.socketBySlot.set(slot, ws);
        return { ok: true, slot, sessionId: requestedSessionId, reconnected: true };
      }
    }

    const slot = findFreeSlot(state);
    if (slot === null) {
      return { ok: false, reason: 'capacity_reached' };
    }

    const sessionId = requestedSessionId || crypto.randomUUID();
    const node = state.nodes[slot];
    Object.assign(node, freshNode(slot));
    node.connected = true;
    node.sessionId = sessionId;
    node.status = NODE_STATUS.STANDBY;

    this.socketBySlot.set(slot, ws);
    this.slotBySessionId.set(sessionId, slot);
    return { ok: true, slot, sessionId, reconnected: false };
  }

  /** A /node socket closed. Keep the slot reserved briefly for reconnects. */
  disconnect(slot) {
    if (slot === undefined || slot === null) return;
    const node = this.state.nodes[slot];
    if (!node) return;
    this.socketBySlot.delete(slot);

    const timer = setTimeout(() => {
      // still not reclaimed -> actually free the slot
      node.connected = false;
      node.status = NODE_STATUS.OFFLINE;
      node.orbit.active = false;
      this.pendingRelease.delete(slot);
      if (node.sessionId) this.slotBySessionId.delete(node.sessionId);
    }, RECONNECT_GRACE_MS);

    this.pendingRelease.set(slot, timer);
  }

  _clearPendingRelease(slot) {
    const timer = this.pendingRelease.get(slot);
    if (timer) {
      clearTimeout(timer);
      this.pendingRelease.delete(slot);
    }
  }

  socketFor(slot) {
    return this.socketBySlot.get(slot);
  }

  connectedCount() {
    return this.state.nodes.filter((n) => n.connected).length;
  }
}

module.exports = { NodeManager, MAX_NODES };
