'use strict';

/**
 * Small, deterministic vector physics engine. Runs only on the server, at a
 * fixed tick rate, and is the single source of truth for every node's
 * position/velocity. Clients never invent their own physics — they render
 * whatever the server last told them, interpolating between snapshots.
 *
 * Kept dependency-free and headless-safe (no DOM, no Matter.js World render
 * step) so it is trivial to reason about and to unit test.
 */

const CORE_POSITION = Object.freeze({ x: 0, y: 0, z: 0 });
const DAMPING = 0.96; // velocity retained per tick (simple linear drag)
const NODE_RADIUS = 1.1;
const MIN_ORBIT_RADIUS = 4.5;
const MAX_SPEED = 40;

function vec(x = 0, y = 0, z = 0) {
  return { x, y, z };
}

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(a, s) {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

function length(a) {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

function normalize(a) {
  const len = length(a);
  if (len < 1e-6) return vec(0, 0, 0);
  return scale(a, 1 / len);
}

function clampSpeed(v) {
  const len = length(v);
  if (len > MAX_SPEED) return scale(v, MAX_SPEED / len);
  return v;
}

/** Apply an instantaneous velocity change (an impulse) to a body. */
function applyImpulse(body, direction, magnitude) {
  const dir = normalize(direction);
  body.velocity = clampSpeed(add(body.velocity, scale(dir, magnitude / Math.max(body.mass, 0.1))));
}

/** Push `body` toward or away from `center` by `strength` (negative = repel). */
function applyRadialForce(body, center, strength) {
  const toCenter = sub(center, body.position);
  const dist = Math.max(length(toCenter), 0.5);
  const falloff = 1 / (dist * dist);
  const dir = normalize(toCenter);
  body.velocity = clampSpeed(add(body.velocity, scale(dir, strength * falloff)));
}

/** Advance one orbiting body by dt seconds around `center`. */
function stepOrbit(body, dt) {
  const o = body.orbit;
  o.angle += o.angularVelocity * dt;
  const r = o.radius;
  body.position = {
    x: CORE_POSITION.x + Math.cos(o.angle) * r,
    y: o.tilt !== undefined ? Math.sin(o.angle * 0.6) * o.tilt : body.position.y,
    z: CORE_POSITION.z + Math.sin(o.angle) * r,
  };
  body.velocity = {
    x: -Math.sin(o.angle) * r * o.angularVelocity,
    y: 0,
    z: Math.cos(o.angle) * r * o.angularVelocity,
  };
}

/** Advance one free (non-orbiting) body by dt seconds. */
function stepFree(body, dt) {
  if (body.frozen) {
    body.velocity = vec(0, 0, 0);
    return;
  }
  // gentle pull back toward the node's resting shell so the scene doesn't
  // drift apart after a series of impulses/collisions
  const restDist = length(sub(body.position, CORE_POSITION));
  if (restDist > body.restRadius * 1.6) {
    applyRadialForce(body, CORE_POSITION, 6);
  }
  body.position = add(body.position, scale(body.velocity, dt));
  body.velocity = scale(body.velocity, DAMPING);
  if (length(body.velocity) < 0.01) body.velocity = vec(0, 0, 0);
}

/** Resolve simple elastic collisions between two spherical bodies. */
function resolveCollision(a, b) {
  const delta = sub(b.position, a.position);
  const dist = length(delta);
  const minDist = NODE_RADIUS * 2;
  if (dist >= minDist || dist < 1e-6) return null;

  const normal = normalize(delta);
  const overlap = minDist - dist;
  // separate
  a.position = sub(a.position, scale(normal, overlap / 2));
  b.position = add(b.position, scale(normal, overlap / 2));

  // exchange momentum along the collision normal (equal-mass elastic swap
  // approximation, weighted by actual mass)
  const relVel = sub(b.velocity, a.velocity);
  const velAlongNormal = relVel.x * normal.x + relVel.y * normal.y + relVel.z * normal.z;
  if (velAlongNormal > 0) return null; // already separating

  const restitution = 0.6;
  const invMassA = 1 / Math.max(a.mass, 0.1);
  const invMassB = 1 / Math.max(b.mass, 0.1);
  const j = (-(1 + restitution) * velAlongNormal) / (invMassA + invMassB);
  const impulse = scale(normal, j);

  a.velocity = sub(a.velocity, scale(impulse, invMassA));
  b.velocity = add(b.velocity, scale(impulse, invMassB));

  return { a: a.id, b: b.id, speed: Math.abs(velAlongNormal) };
}

/**
 * Advance the whole simulation by dt seconds.
 * `bodies` is an array of node physics bodies. Returns a list of collision
 * events that occurred this tick (empty most ticks).
 */
function step(bodies, dt) {
  for (const body of bodies) {
    if (!body.connected) continue;
    if (body.orbit && body.orbit.active) {
      stepOrbit(body, dt);
    } else {
      stepFree(body, dt);
    }
  }

  const collisions = [];
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i];
      const b = bodies[j];
      if (!a.connected || !b.connected) continue;
      if ((a.orbit && a.orbit.active) || (b.orbit && b.orbit.active)) continue;
      const hit = resolveCollision(a, b);
      if (hit) collisions.push(hit);
    }
  }
  return collisions;
}

/** A resting-shell position for slot `index` (0-based) of `total` nodes. */
function restingPosition(index, total) {
  const angle = (index / Math.max(total, 1)) * Math.PI * 2;
  const radius = MIN_ORBIT_RADIUS + 2.2;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(index * 1.7) * 1.2,
    z: Math.sin(angle) * radius,
  };
}

module.exports = {
  CORE_POSITION,
  NODE_RADIUS,
  MIN_ORBIT_RADIUS,
  vec,
  add,
  sub,
  scale,
  length,
  normalize,
  applyImpulse,
  applyRadialForce,
  step,
  restingPosition,
};
