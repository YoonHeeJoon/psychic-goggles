// Procedural soundscape built on the Web Audio API. There are no audio files:
// wind, leaves, surf, birds, crickets, footsteps, combat and UI sounds are all
// synthesised from oscillators and filtered noise at runtime.

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const rnd = (a, b) => a + Math.random() * (b - a);
const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12); // midi -> Hz

const EL_ROOT = { wind: 79, fire: 72, water: 76, thunder: 74, ice: 84, phys: 72 };

export class Sound {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
    this.muted = false;
    try {
      const s = JSON.parse(localStorage.getItem('starwind.audio') || '{}');
      if (typeof s.volume === 'number') this.volume = clamp(s.volume, 0, 1);
      if (s.muted) this.muted = true;
    } catch (e) {}
    this.t = 0;
    this.birdT = 1.5;
    this.cricketT = 0.5;
    this.last = {};
    this.gemChain = 0;
  }

  // Must be called from a user gesture (browsers keep audio locked until then).
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch (e) {
      return;
    }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;
    this.master.connect(comp);
    comp.connect(c.destination);
    this.sfxBus = this.bus(0.9);
    this.ambBus = this.bus(0.75);
    this.uiBus = this.bus(0.55);
    this.white = this.noise('white', 2);
    this.pink = this.noise('pink', 4);
    this.brown = this.noise('brown', 4);
    // small synthetic hall for magical one-shots
    this.verb = c.createConvolver();
    this.verb.buffer = this.impulse(2.2, 3.2);
    this.verbIn = c.createGain();
    this.verbIn.gain.value = 0.3;
    this.verbIn.connect(this.verb);
    this.verb.connect(this.master);
    this.buildAmbience();
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  setVolume(v) {
    this.volume = clamp(v, 0, 1);
    this.applyVolume();
  }
  setMuted(m) {
    this.muted = !!m;
    this.applyVolume();
  }
  applyVolume() {
    try {
      localStorage.setItem('starwind.audio', JSON.stringify({ volume: this.volume, muted: this.muted }));
    } catch (e) {}
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  // ------------------------------------------------------------------ plumbing
  bus(v) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    g.connect(this.master);
    return g;
  }

  noise(kind, seconds) {
    const c = this.ctx;
    const n = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0,
      b1 = 0,
      b2 = 0,
      b3 = 0,
      b4 = 0,
      b5 = 0,
      b6 = 0,
      last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w;
      else if (kind === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
    return buf;
  }

  impulse(seconds, decay) {
    const c = this.ctx;
    const n = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
    }
    return buf;
  }

  // output stage: gain -> pan -> bus (+ optional reverb send)
  out(bus, pan = 0, verb = 0) {
    const c = this.ctx;
    const g = c.createGain();
    let node = g;
    if (pan && c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      g.connect(p);
      node = p;
    }
    node.connect(bus || this.sfxBus);
    if (verb > 0) {
      const s = c.createGain();
      s.gain.value = verb;
      node.connect(s);
      s.connect(this.verbIn);
    }
    return g;
  }

  // filtered noise burst
  nz(o) {
    if (!this.ready) return;
    const c = this.ctx;
    const t = c.currentTime + (o.delay || 0);
    const src = c.createBufferSource();
    src.buffer = this[o.buf || 'white'];
    src.playbackRate.value = o.rate || 1;
    const f = c.createBiquadFilter();
    f.type = o.type || 'bandpass';
    f.frequency.setValueAtTime(o.f || 1000, t);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + (o.a || 0.005) + (o.d || 0.1));
    f.Q.value = o.q ?? 1;
    const g = this.out(o.bus, o.pan, o.verb);
    const a = o.a || 0.005,
      d = o.d || 0.1;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.gain ?? 0.2, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    src.connect(f);
    f.connect(g);
    src.start(t, Math.random() * Math.max(0, src.buffer.duration / (o.rate || 1) - a - d - 0.1));
    src.stop(t + a + d + 0.05);
  }

  // oscillator tone with pitch glide
  tone(o) {
    if (!this.ready) return;
    const c = this.ctx;
    const t = c.currentTime + (o.delay || 0);
    const osc = c.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    const a = o.a || 0.005,
      d = o.d || 0.2;
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + a + d * (o.glide || 1));
    if (o.detune) osc.detune.value = o.detune;
    const g = this.out(o.bus, o.pan, o.verb);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.gain ?? 0.1, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    let node = osc;
    if (o.lp) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.lp;
      osc.connect(f);
      node = f;
    }
    node.connect(g);
    osc.start(t);
    osc.stop(t + a + d + 0.05);
  }

  // rate-limit a sound key
  gate(key, ms) {
    const now = performance.now();
    if (this.last[key] && now - this.last[key] < ms) return false;
    this.last[key] = now;
    return true;
  }

  // ------------------------------------------------------------------ ambience
  loopSrc(buf, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.playbackRate.value = rate;
    s.start(0, Math.random() * buf.duration);
    return s;
  }

  layer(buf, rate, filters) {
    const c = this.ctx;
    let node = this.loopSrc(buf, rate);
    const fs = [];
    for (const [type, f, q] of filters) {
      const b = c.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = q;
      node.connect(b);
      node = b;
      fs.push(b);
    }
    const g = c.createGain();
    g.gain.value = 0;
    node.connect(g);
    g.connect(this.ambBus);
    return { g, f: fs };
  }

  buildAmbience() {
    this.amb = {
      wind: this.layer(this.pink, 1, [['bandpass', 420, 0.5]]),
      gust: this.layer(this.white, 1, [['bandpass', 1500, 5]]),
      leaves: this.layer(this.white, 0.85, [['highpass', 2600, 0.5], ['lowpass', 8000, 0.5]]),
      surf: this.layer(this.brown, 1, [['lowpass', 520, 0.7]]),
      hiss: this.layer(this.pink, 1, [['bandpass', 1300, 0.4]]),
      fire: null,
    };
  }

  // s: { alt, speed, air, night, day, water, forest, snow, active }
  update(dt, s) {
    if (!this.ready || !this.amb) return;
    this.t += dt;
    const c = this.ctx;
    const now = c.currentTime;
    const A = this.amb;
    const on = s.active ? 1 : 0.35;
    const gust = 0.55 + 0.45 * Math.sin(this.t * 0.37) * Math.sin(this.t * 0.11 + 1.3);
    const alt = clamp(s.alt / 160, 0, 1);
    const air = clamp(s.speed / 24, 0, 1) * (s.air ? 1 : 0.25);
    const set = (p, v, tc = 0.25) => p.setTargetAtTime(v, now, tc);
    set(A.wind.g.gain, on * (0.05 + 0.09 * gust * (0.4 + alt) + 0.06 * s.snow + 0.3 * air));
    set(A.wind.f[0].frequency, 300 + 260 * gust + 700 * air + 200 * alt, 0.4);
    set(A.gust.g.gain, on * (0.06 * air * air + 0.012 * alt * gust));
    set(A.gust.f[0].frequency, 900 + 1300 * air + 300 * gust, 0.3);
    set(A.leaves.g.gain, on * s.forest * (1 - s.snow) * 0.05 * (0.4 + 0.6 * gust), 0.5);
    const wave = 0.55 + 0.45 * Math.sin(this.t * 0.75) * Math.sin(this.t * 0.31 + 2.0);
    set(A.surf.g.gain, on * s.water * 0.28 * wave, 0.4);
    set(A.hiss.g.gain, on * s.water * 0.05 * wave * wave, 0.4);

    // birds by day around trees and meadows
    this.birdT -= dt;
    if (this.birdT <= 0) {
      const life = s.day * (1 - s.snow) * (0.35 + 0.65 * s.forest) * (1 - alt * 0.8) * on;
      if (Math.random() < life) this.bird();
      this.birdT = rnd(1.2, 4.5);
    }
    // crickets at night on grass
    this.cricketT -= dt;
    if (this.cricketT <= 0) {
      const k = s.night * (1 - s.snow) * (1 - alt) * on;
      if (k > 0.05) this.cricket(k);
      this.cricketT = rnd(0.35, 0.8);
    }
  }

  bird() {
    const pan = rnd(-0.85, 0.85);
    const vol = rnd(0.006, 0.016);
    const kind = Math.floor(Math.random() * 4);
    const base = rnd(2300, 3600);
    if (kind === 0) {
      // quick rising tweets
      const n = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) this.tone({ f: base, f2: base * 1.45, a: 0.006, d: 0.06, gain: vol, pan, delay: i * 0.11, bus: this.ambBus, verb: 0.15 });
    } else if (kind === 1) {
      // warble
      const n = 6 + Math.floor(Math.random() * 6);
      for (let i = 0; i < n; i++) this.tone({ f: base * (i % 2 ? 1.18 : 1), f2: base * (i % 2 ? 1.0 : 1.2), a: 0.004, d: 0.04, gain: vol * 0.8, pan, delay: i * 0.055, bus: this.ambBus, verb: 0.15 });
    } else if (kind === 2) {
      // two-note call
      this.tone({ f: base * 0.62, f2: base * 0.8, a: 0.02, d: 0.22, gain: vol, pan, bus: this.ambBus, verb: 0.25 });
      this.tone({ f: base * 0.8, f2: base * 0.58, a: 0.02, d: 0.28, gain: vol * 0.9, pan, delay: 0.3, bus: this.ambBus, verb: 0.25 });
    } else {
      // descending trill
      for (let i = 0; i < 8; i++) this.tone({ f: base * (1.3 - i * 0.05), f2: base * (1.15 - i * 0.05), a: 0.003, d: 0.035, gain: vol * 0.7, pan, delay: i * 0.045, bus: this.ambBus, verb: 0.2 });
    }
  }

  cricket(k) {
    for (let v = 0; v < 2; v++) {
      if (Math.random() < 0.35) continue;
      const f = v ? 4650 : 4200;
      const pan = v ? 0.6 : -0.5;
      for (let i = 0; i < 3; i++) this.tone({ f, a: 0.004, d: 0.018, gain: 0.012 * k, pan, delay: v * 0.13 + i * 0.034, bus: this.ambBus });
    }
  }

  // ------------------------------------------------------------------ player
  footstep(surface, loud = 1) {
    if (!this.ready || !this.gate('step', 90)) return;
    const v = rnd(0.8, 1.1) * loud;
    const r = rnd(0.9, 1.12);
    switch (surface) {
      case 'stone':
        this.nz({ f: 2800 * r, q: 2.5, d: 0.035, gain: 0.07 * v });
        this.tone({ f: 150 * r, f2: 80, d: 0.06, gain: 0.12 * v });
        break;
      case 'wood':
        this.tone({ type: 'triangle', f: 230 * r, f2: 150, d: 0.07, gain: 0.1 * v, lp: 900 });
        this.nz({ f: 900 * r, q: 3, d: 0.05, gain: 0.06 * v });
        break;
      case 'snow':
        for (let i = 0; i < 3; i++) this.nz({ type: 'lowpass', f: 2400 * r, q: 0.8, a: 0.003, d: 0.04, gain: 0.08 * v, delay: i * 0.025 });
        break;
      case 'water':
        this.nz({ f: 750 * r, q: 0.7, a: 0.01, d: 0.16, gain: 0.12 * v, buf: 'pink' });
        this.tone({ f: 420 * r, f2: 900, d: 0.06, gain: 0.035 * v, delay: 0.03 });
        break;
      case 'path':
        this.nz({ f: 1700 * r, q: 1.1, d: 0.05, gain: 0.1 * v });
        this.nz({ type: 'lowpass', f: 300, q: 0.7, d: 0.05, gain: 0.1 * v, buf: 'brown' });
        break;
      default:
        // grass: soft swish plus a muffled thump
        this.nz({ f: 2600 * r, q: 0.7, a: 0.01, d: 0.07, gain: 0.1 * v });
        this.nz({ type: 'lowpass', f: 260, q: 0.7, d: 0.05, gain: 0.15 * v, buf: 'brown' });
    }
  }

  climbGrab() {
    if (!this.gate('grab', 180)) return;
    this.nz({ f: 1400, q: 1.5, d: 0.05, gain: 0.07 });
    this.nz({ type: 'lowpass', f: 400, d: 0.04, gain: 0.06, buf: 'brown' });
  }

  jump() {
    this.nz({ f: 700, f2: 1400, q: 0.8, a: 0.02, d: 0.12, gain: 0.06 });
  }

  land(impact, surface) {
    const k = clamp(impact / 16, 0.25, 1.2);
    this.footstep(surface, 1 + k);
    this.tone({ f: 110, f2: 50, d: 0.12 + k * 0.1, gain: 0.12 * k });
    if (k > 0.6) this.nz({ type: 'lowpass', f: 900, f2: 200, d: 0.3, gain: 0.14 * k, buf: 'brown' });
  }

  glider() {
    for (let i = 0; i < 3; i++) this.nz({ f: 1100 + i * 250, q: 0.8, a: 0.008, d: 0.06, gain: 0.13, delay: i * 0.05 });
    this.nz({ f: 500, f2: 1400, q: 0.6, a: 0.05, d: 0.3, gain: 0.11 });
  }

  splash() {
    if (!this.gate('splash', 200)) return;
    this.nz({ type: 'lowpass', f: 2600, f2: 500, q: 0.6, a: 0.01, d: 0.45, gain: 0.22, buf: 'pink' });
    for (let i = 0; i < 4; i++) this.tone({ f: rnd(300, 600), f2: rnd(900, 1500), d: 0.05, gain: 0.03, delay: 0.05 + i * rnd(0.03, 0.07) });
  }

  dash() {
    this.nz({ f: 1800, f2: 500, q: 0.9, a: 0.01, d: 0.22, gain: 0.1 });
  }

  swap(el) {
    const root = NOTE(EL_ROOT[el] || 72);
    this.tone({ type: 'triangle', f: root, d: 0.25, gain: 0.05, verb: 0.3 });
    this.tone({ type: 'triangle', f: root * 1.5, d: 0.3, gain: 0.04, delay: 0.06, verb: 0.3 });
    this.nz({ type: 'highpass', f: 5000, d: 0.25, gain: 0.03, verb: 0.3 });
  }

  // ------------------------------------------------------------------ combat
  swing(weapon, combo = 0) {
    const heavy = weapon === 'claymore';
    const p = 1 + combo * 0.06;
    if (weapon === 'catalyst') {
      this.tone({ type: 'sine', f: 900 * p, f2: 1500 * p, a: 0.02, d: 0.12, gain: 0.04, verb: 0.2 });
      return;
    }
    this.nz({ f: (heavy ? 350 : 700) * p, f2: (heavy ? 1100 : 2400) * p, q: 1.6, a: heavy ? 0.06 : 0.025, d: heavy ? 0.22 : 0.14, gain: heavy ? 0.3 : 0.22 });
  }

  hit(el = 'phys', crit = false, heavy = false) {
    if (!this.ready || !this.gate('hit', 45)) return;
    const k = heavy ? 1.4 : 1;
    this.tone({ f: 170, f2: 55, d: 0.13 * k, gain: 0.22 * k });
    this.nz({ type: 'lowpass', f: 2200, f2: 500, d: 0.08 * k, gain: 0.16 * k });
    if (crit) this.tone({ type: 'triangle', f: 1750, d: 0.18, gain: 0.05, verb: 0.2 });
    this.elementFlavor(el, 0.6);
  }

  elementFlavor(el, k = 1) {
    switch (el) {
      case 'fire':
        this.nz({ type: 'lowpass', f: 1400, f2: 300, d: 0.3, gain: 0.12 * k, buf: 'brown' });
        for (let i = 0; i < 3; i++) this.nz({ f: rnd(2500, 5000), q: 4, d: 0.02, gain: 0.05 * k, delay: rnd(0.02, 0.2) });
        break;
      case 'water':
        for (let i = 0; i < 3; i++) this.tone({ f: rnd(380, 700), f2: rnd(1000, 1700), d: 0.06, gain: 0.05 * k, delay: i * 0.04 });
        this.nz({ type: 'lowpass', f: 1500, d: 0.15, gain: 0.07 * k, buf: 'pink' });
        break;
      case 'thunder':
        this.tone({ type: 'sawtooth', f: 95, f2: 60, d: 0.18, gain: 0.05 * k, lp: 1800 });
        this.nz({ type: 'highpass', f: 3500, d: 0.12, gain: 0.07 * k });
        this.nz({ type: 'highpass', f: 4500, d: 0.05, gain: 0.06 * k, delay: 0.07 });
        break;
      case 'wind':
        this.nz({ f: 600, f2: 2800, q: 2, a: 0.03, d: 0.25, gain: 0.08 * k });
        break;
      case 'ice':
        this.tone({ type: 'triangle', f: 2600, d: 0.25, gain: 0.04 * k, verb: 0.3 });
        this.tone({ type: 'triangle', f: 3900, d: 0.2, gain: 0.03 * k, delay: 0.03, verb: 0.3 });
        break;
    }
  }

  skill(el) {
    const root = NOTE(EL_ROOT[el] || 72) / 2;
    this.nz({ f: 400, f2: 2600, q: 1.2, a: 0.08, d: 0.35, gain: 0.12, verb: 0.3 });
    this.tone({ type: 'triangle', f: root, f2: root * 2, a: 0.03, d: 0.4, gain: 0.07, verb: 0.4 });
    this.elementFlavor(el, 1.2);
  }

  burst(el) {
    const root = NOTE((EL_ROOT[el] || 72) - 12);
    // rising swell, then impact + bright chord
    this.nz({ f: 200, f2: 3500, q: 1.0, a: 0.5, d: 0.25, gain: 0.14, verb: 0.4 });
    this.tone({ type: 'sawtooth', f: root / 2, f2: root, a: 0.45, d: 0.3, gain: 0.04, lp: 1200, verb: 0.3 });
    this.tone({ f: 120, f2: 40, d: 0.7, gain: 0.3, delay: 0.55 });
    this.nz({ type: 'lowpass', f: 1800, f2: 200, d: 0.8, gain: 0.2, delay: 0.55, buf: 'brown' });
    [1, 1.26, 1.5, 2].forEach((m, i) => this.tone({ type: 'triangle', f: root * 2 * m, a: 0.02, d: 1.2, gain: 0.035, delay: 0.55 + i * 0.03, verb: 0.6 }));
    this.elementFlavor(el, 1.5);
  }

  cast(el) {
    if (!this.gate('cast', 60)) return;
    const root = NOTE(EL_ROOT[el] || 72);
    this.tone({ f: root, f2: root * 1.5, a: 0.01, d: 0.12, gain: 0.04, verb: 0.2 });
  }

  reaction(type) {
    if (!this.ready || !this.gate('react', 80)) return;
    switch (type) {
      case 'vaporize':
      case 'melt':
        this.nz({ type: 'highpass', f: 2500, d: 0.5, a: 0.02, gain: 0.12 });
        this.tone({ type: 'triangle', f: 660, f2: 990, d: 0.3, gain: 0.05, verb: 0.3 });
        break;
      case 'overload':
        this.tone({ f: 90, f2: 30, d: 0.8, gain: 0.35 });
        this.nz({ type: 'lowpass', f: 1500, f2: 150, d: 0.9, gain: 0.3, buf: 'brown' });
        this.nz({ f: 3000, q: 1, d: 0.15, gain: 0.08 });
        break;
      case 'freeze':
        this.nz({ type: 'highpass', f: 4000, d: 0.08, gain: 0.08 });
        [2400, 3200, 4100].forEach((f, i) => this.tone({ type: 'triangle', f, d: 0.35, gain: 0.035, delay: i * 0.03, verb: 0.3 }));
        break;
      case 'charged':
      case 'superconduct':
        this.tone({ type: 'square', f: 110, f2: 70, d: 0.25, gain: 0.04, lp: 2500 });
        this.nz({ type: 'highpass', f: 3000, d: 0.2, gain: 0.1 });
        if (type === 'superconduct') this.tone({ type: 'triangle', f: 2900, d: 0.3, gain: 0.04, verb: 0.3 });
        break;
      case 'swirl':
        this.nz({ f: 300, f2: 3200, q: 2.5, a: 0.06, d: 0.4, gain: 0.12, verb: 0.3 });
        break;
      case 'shatter':
        for (let i = 0; i < 6; i++) this.tone({ type: 'triangle', f: rnd(2500, 5200), d: rnd(0.08, 0.25), gain: 0.04, delay: i * 0.02 });
        this.nz({ type: 'highpass', f: 3500, d: 0.2, gain: 0.12 });
        break;
    }
  }

  enemyDeath() {
    this.nz({ type: 'lowpass', f: 1600, f2: 250, d: 0.4, gain: 0.16, buf: 'pink' });
    this.tone({ f: 340, f2: 110, d: 0.25, gain: 0.08 });
    this.tone({ type: 'triangle', f: 1320, d: 0.3, gain: 0.03, delay: 0.1, verb: 0.3 });
  }

  hurt() {
    if (!this.gate('hurt', 120)) return;
    this.tone({ type: 'square', f: 220, f2: 120, d: 0.12, gain: 0.05, lp: 900 });
    this.nz({ type: 'lowpass', f: 900, d: 0.12, gain: 0.14, buf: 'brown' });
  }

  energy() {
    if (!this.gate('energy', 70)) return;
    this.tone({ f: rnd(1150, 1300), f2: 1900, d: 0.08, gain: 0.035, bus: this.uiBus });
  }

  gem() {
    if (!this.ready) return;
    const now = performance.now();
    this.gemChain = this.last.gem && now - this.last.gem < 400 ? Math.min(this.gemChain + 1, 7) : 0;
    this.last.gem = now;
    const f = NOTE(84 + [0, 2, 4, 7, 9, 12, 14, 16][this.gemChain]);
    this.tone({ type: 'triangle', f, d: 0.22, gain: 0.05, bus: this.uiBus, verb: 0.25 });
    this.tone({ f: f * 2, d: 0.12, gain: 0.02, bus: this.uiBus, delay: 0.02 });
  }

  // ------------------------------------------------------------------ world
  orb() {
    [0, 4, 7, 12, 16].forEach((n, i) => this.tone({ type: 'triangle', f: NOTE(81 + n), d: 0.5, gain: 0.045, delay: i * 0.07, verb: 0.5, bus: this.uiBus }));
    this.nz({ type: 'highpass', f: 6000, a: 0.1, d: 0.6, gain: 0.03, verb: 0.4 });
  }

  chest(tier = 0) {
    // wooden creak, latch, then a little fanfare that grows with the tier
    this.tone({ type: 'sawtooth', f: 95, f2: 70, a: 0.05, d: 0.35, gain: 0.022, lp: 600 });
    this.nz({ f: 900, q: 3, d: 0.04, gain: 0.08, delay: 0.3 });
    const runs = [
      [0, 4, 7],
      [0, 4, 7, 12],
      [0, 4, 7, 11, 14, 19],
    ][Math.min(tier, 2)];
    runs.forEach((n, i) => this.tone({ type: 'triangle', f: NOTE(72 + n), d: 0.45, gain: 0.05, delay: 0.42 + i * 0.08, verb: 0.5, bus: this.uiBus }));
    this.nz({ type: 'highpass', f: 5500, a: 0.15, d: 0.8, gain: 0.03 + tier * 0.01, delay: 0.42, verb: 0.4 });
  }

  unseal() {
    this.tone({ f: NOTE(60), f2: NOTE(72), a: 0.1, d: 0.6, gain: 0.06, verb: 0.5 });
    this.nz({ type: 'highpass', f: 4000, d: 0.5, gain: 0.05, verb: 0.4 });
  }

  waypoint() {
    this.tone({ f: 55, a: 0.3, d: 1.6, gain: 0.18 });
    [57, 64, 69, 73, 76].forEach((n, i) => this.tone({ type: 'triangle', f: NOTE(n + 12), a: 0.25, d: 1.8, gain: 0.03, delay: 0.1 + i * 0.12, verb: 0.7 }));
    this.nz({ f: 300, f2: 4000, q: 0.8, a: 0.6, d: 0.6, gain: 0.08, verb: 0.5 });
  }

  teleport() {
    this.nz({ f: 250, f2: 3200, q: 1.2, a: 0.35, d: 0.3, gain: 0.12, verb: 0.4 });
    this.tone({ type: 'triangle', f: NOTE(72), f2: NOTE(96), a: 0.3, d: 0.3, gain: 0.04, verb: 0.5 });
  }

  bless() {
    [48, 55, 60, 64, 67, 72].forEach((n, i) => this.tone({ type: 'triangle', f: NOTE(n + 12), a: 0.4, d: 2.2, gain: 0.035, delay: i * 0.1, verb: 0.8 }));
  }

  updraft() {
    if (!this.gate('updraft', 1500)) return;
    this.nz({ f: 300, f2: 1600, q: 0.9, a: 0.3, d: 0.8, gain: 0.1 });
  }

  // ------------------------------------------------------------------ UI
  click() {
    this.tone({ f: 1300, f2: 1000, d: 0.05, gain: 0.05, bus: this.uiBus });
  }
  open() {
    this.nz({ f: 1800, q: 0.8, a: 0.02, d: 0.12, gain: 0.06, bus: this.uiBus });
    this.tone({ type: 'triangle', f: NOTE(79), d: 0.18, gain: 0.04, bus: this.uiBus, delay: 0.04 });
  }
  close() {
    this.nz({ f: 1400, q: 0.8, a: 0.01, d: 0.1, gain: 0.05, bus: this.uiBus });
    this.tone({ type: 'triangle', f: NOTE(74), d: 0.15, gain: 0.035, bus: this.uiBus });
  }
}
