(() => {
  'use strict';

  let ctx = null;
  let master = null;
  let muted = false;

  function ensureCtx() {
    if (ctx) return ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    ctx = new Ctx();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    return ctx;
  }

  /** Must be called from a user gesture (tap/click) to satisfy autoplay policy. */
  function unlock() {
    const c = ensureCtx();
    if (c && c.state === 'suspended') c.resume();
  }

  function tone({ freq = 440, duration = 0.2, type = 'sine', gain = 0.3, glideTo = null, delay = 0 }) {
    const c = ensureCtx();
    if (!c || muted) return;
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(glideTo, 1), t0 + duration);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  function noiseBurst({ duration = 0.25, gain = 0.25, delay = 0, filterFreq = 1200 }) {
    const c = ensureCtx();
    if (!c || muted) return;
    const t0 = c.currentTime + delay;
    const bufferSize = Math.floor(c.sampleRate * duration);
    const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const src = c.createBufferSource();
    src.buffer = buffer;
    const filter = c.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = filterFreq;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(filter).connect(g).connect(master);
    src.start(t0);
  }

  const EVENT_SOUNDS = {
    node_connected: () => tone({ freq: 520, duration: 0.18, type: 'triangle', gain: 0.2 }),
    node_disconnected: () => tone({ freq: 260, duration: 0.25, type: 'triangle', gain: 0.2, glideTo: 140 }),
    target_acquired: () => tone({ freq: 880, duration: 0.09, type: 'square', gain: 0.15 }),
    node_charged: () => { tone({ freq: 440, duration: 0.12, gain: 0.2 }); tone({ freq: 660, duration: 0.18, gain: 0.2, delay: 0.08 }); },
    energy_transfer: () => tone({ freq: 300, duration: 0.4, type: 'sine', gain: 0.18, glideTo: 700 }),
    pulse_launched: () => { tone({ freq: 180, duration: 0.3, type: 'sawtooth', gain: 0.22, glideTo: 40 }); noiseBurst({ duration: 0.15, gain: 0.12 }); },
    collision: () => noiseBurst({ duration: 0.12, gain: 0.2, filterFreq: 700 }),
    impact: () => noiseBurst({ duration: 0.3, gain: 0.3, filterFreq: 400 }),
    orbit_start: () => tone({ freq: 220, duration: 0.5, type: 'sine', gain: 0.15, glideTo: 440 }),
    orbit_stop: () => tone({ freq: 440, duration: 0.3, type: 'sine', gain: 0.15, glideTo: 220 }),
    core_activated: () => { tone({ freq: 110, duration: 1.2, type: 'sine', gain: 0.25, glideTo: 220 }); tone({ freq: 165, duration: 1.2, type: 'sine', gain: 0.15, delay: .1 }); },
    power_increased: () => tone({ freq: 500, duration: 0.15, gain: 0.15, glideTo: 620 }),
    power_decreased: () => tone({ freq: 500, duration: 0.15, gain: 0.15, glideTo: 380 }),
    overload: () => { tone({ freq: 90, duration: 0.6, type: 'sawtooth', gain: 0.28 }); noiseBurst({ duration: 0.4, gain: 0.2, filterFreq: 250 }); },
    stabilized: () => tone({ freq: 330, duration: 0.3, gain: 0.15, glideTo: 440 }),
    shutdown: () => tone({ freq: 400, duration: 1.0, type: 'sine', gain: 0.2, glideTo: 60 }),
    reset: () => tone({ freq: 660, duration: 0.2, gain: 0.15 }),
    command_rejected: () => tone({ freq: 160, duration: 0.15, type: 'square', gain: 0.12 }),
  };

  function playEvent(type) {
    const fn = EVENT_SOUNDS[type];
    if (fn) fn();
  }

  function setMuted(value) { muted = value; }
  function isMuted() { return muted; }

  window.AetherAudio = { unlock, tone, noiseBurst, playEvent, setMuted, isMuted };
})();
