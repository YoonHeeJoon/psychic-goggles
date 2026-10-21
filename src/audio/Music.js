// Procedural score: four small themes written on the fly with oscillators and
// cross-faded by situation.
//   day    — F major, flute melody over harp arpeggios and a warm string pad
//   night  — A minor, slow sparse harp and pad, the odd soft flute phrase
//   battle — D minor, driving strings, bass ostinato and drums
//   boss   — C minor, heavier drums, low brass drone and staccato strings
//   highland — D dorian, plucked koto and bamboo flute over a soft frame drum
//              (the autumn highlands by day)
//   festival — G major, bright koto and flute over a festival drum and bells
//              (the harbour lantern festival at night)
// Exploration themes play a phrase and then rest, like an open-world score.

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOTE = { C: 0, 'C#': 1, Db: 1, D: 2, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 };
// chord symbol -> pitch classes relative to C
function chord(sym) {
  const m = /^([A-G][b#]?)(m?)$/.exec(sym);
  const r = NOTE[m[1]];
  return m[2] ? [r, r + 3, r + 7] : [r, r + 4, r + 7];
}

const THEMES = {
  day: { bpm: 78, key: 5, scale: [0, 2, 4, 7, 9], prog: [['F', 'C', 'Dm', 'Bb'], ['Bb', 'C', 'Am', 'Dm'], ['F', 'C', 'Dm', 'Bb'], ['Bb', 'C', 'F', 'F']], seed: 11, play: 16, rest: 10 },
  night: { bpm: 62, key: 9, scale: [0, 3, 5, 7, 10], prog: [['Am', 'F', 'C', 'G'], ['Dm', 'Am', 'F', 'E']], seed: 23, play: 8, rest: 8 },
  battle: { bpm: 132, key: 2, scale: [0, 2, 3, 5, 7, 8, 10], prog: [['Dm', 'Bb', 'C', 'A'], ['Gm', 'Dm', 'Bb', 'A']], seed: 37, play: 1e9, rest: 0 },
  highland: { bpm: 84, key: 2, scale: [0, 2, 3, 7, 9], prog: [['Dm', 'C', 'Bb', 'C'], ['Dm', 'Am', 'Bb', 'A'], ['F', 'C', 'Dm', 'Am'], ['Bb', 'C', 'Dm', 'Dm']], seed: 67, play: 16, rest: 8 },
  festival: { bpm: 104, key: 7, scale: [0, 2, 4, 7, 9], prog: [['G', 'C', 'D', 'G'], ['Em', 'C', 'D', 'D'], ['C', 'D', 'Bm', 'Em'], ['C', 'D', 'G', 'G']], seed: 89, play: 32, rest: 4 },
  boss: { bpm: 140, key: 0, scale: [0, 2, 3, 5, 7, 8, 10], prog: [['Cm', 'Ab', 'Bb', 'G'], ['Cm', 'Ab', 'Fm', 'G']], seed: 51, play: 1e9, rest: 0 },
};

export class Music {
  constructor(sound) {
    this.s = sound;
    this.volume = 0.55;
    try {
      const v = parseFloat(localStorage.getItem('starwind.music'));
      if (v >= 0 && v <= 1) this.volume = v;
    } catch (e) {}
    this.want = 'day';
    this.tracks = {};
  }

  setVolume(v) {
    this.volume = v;
    try {
      localStorage.setItem('starwind.music', String(v));
    } catch (e) {}
    if (this.bus) this.bus.gain.setTargetAtTime(v * 0.55, this.s.ctx.currentTime, 0.2);
  }

  init() {
    const s = this.s;
    if (this.bus || !s.ctx) return;
    const c = s.ctx;
    this.bus = c.createGain();
    this.bus.gain.value = this.volume * 0.55;
    this.bus.connect(s.master);
    const send = c.createGain();
    send.gain.value = 0.35;
    this.bus.connect(send);
    send.connect(s.verbIn);
    for (const [name, T] of Object.entries(THEMES)) {
      const g = c.createGain();
      g.gain.value = 0;
      g.connect(this.bus);
      this.tracks[name] = { name, T, g, level: 0, next: 0, step: 0, bar: 0, melody: this.compose(T), resting: 0, live: false };
    }
  }

  // pre-compose a melody per 4-bar phrase: [bar][eighth] = midi or 0
  compose(T) {
    const r = rng(T.seed);
    const phrases = T.prog.map((prog) => {
      const bars = [];
      let deg = 2 + Math.floor(r() * 3);
      for (let b = 0; b < 4; b++) {
        const tones = chord(prog[b]).map((p) => p % 12);
        const pattern = [
          [1, 0, 1, 0, 1, 1, 1, 0],
          [1, 0, 0, 1, 1, 0, 1, 0],
          [1, 0, 0, 0, 1, 0, 1, 1],
          [1, 1, 1, 0, 1, 0, 0, 0],
          [1, 0, 0, 0, 0, 0, 1, 0],
        ][b === 3 ? 4 : Math.floor(r() * 4)];
        const row = [];
        for (let i = 0; i < 8; i++) {
          if (!pattern[i]) {
            row.push(0);
            continue;
          }
          deg += Math.round((r() - 0.5) * 3.2);
          deg = Math.max(0, Math.min(T.scale.length * 2 - 1, deg));
          let pc = T.scale[deg % T.scale.length] + T.key;
          let oct = Math.floor(deg / T.scale.length);
          // strong beats lean onto the nearest chord tone
          if (i % 4 === 0) {
            const dist = (a, b2) => {
              const d = Math.abs(a - b2) % 12;
              return Math.min(d, 12 - d);
            };
            pc = tones.reduce((best, t) => (dist(t % 12, pc % 12) < dist(best % 12, pc % 12) ? t : best), tones[0]);
          }
          let note = 60 + (pc % 12) + 12 * oct;
          if (note < 67) note += 12;
          row.push(note);
        }
        bars.push(row);
      }
      return bars;
    });
    return phrases;
  }

  setTheme(name) {
    this.want = name;
  }

  // ------------------------------------------------------------- instruments
  env(g, t, a, peak, hold, rel) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setValueAtTime(peak, t + a + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + rel);
  }

  voice(tr, type, f, t, a, peak, hold, rel, opts = {}) {
    const c = this.s.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (opts.detune) o.detune.value = opts.detune;
    if (opts.f2) o.frequency.exponentialRampToValueAtTime(opts.f2, t + (opts.glide || a + hold));
    let node = o;
    if (opts.lp) {
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = opts.lp;
      lp.Q.value = opts.q || 0.7;
      o.connect(lp);
      node = lp;
    }
    const g = c.createGain();
    this.env(g, t, a, peak, hold, rel);
    node.connect(g);
    g.connect(tr.g);
    if (opts.vib) {
      const l = c.createOscillator();
      const lg = c.createGain();
      l.frequency.value = 5.2;
      lg.gain.value = opts.vib;
      l.connect(lg);
      lg.connect(o.detune);
      l.start(t);
      l.stop(t + a + hold + rel + 0.1);
    }
    o.start(t);
    o.stop(t + a + hold + rel + 0.1);
  }

  pad(tr, notes, t, dur, level, bright = 1100) {
    for (const n of notes) {
      for (const d of [-7, 7]) this.voice(tr, 'sawtooth', midi(n), t, dur * 0.35, level, dur * 0.4, dur * 0.6, { lp: bright, detune: d });
    }
  }

  harp(tr, n, t, level) {
    this.voice(tr, 'triangle', midi(n), t, 0.006, level, 0.02, 0.9);
    this.voice(tr, 'sine', midi(n + 12), t, 0.004, level * 0.35, 0.01, 0.5);
  }

  flute(tr, n, t, dur, level) {
    this.voice(tr, 'sine', midi(n), t, 0.07, level, Math.max(0.05, dur - 0.12), 0.25, { vib: 9 });
    this.voice(tr, 'triangle', midi(n), t, 0.09, level * 0.25, Math.max(0.05, dur - 0.12), 0.2, { lp: 2400 });
  }

  pluckStr(tr, n, t, level) {
    this.voice(tr, 'sawtooth', midi(n), t, 0.004, level, 0.04, 0.12, { lp: 2600 });
  }

  // plucked zither: bright attack, quick decay, a little pitch sag
  koto(tr, n, t, level) {
    const f = midi(n);
    this.voice(tr, 'triangle', f, t, 0.003, level, 0.03, 0.75, { f2: f * 0.994, glide: 0.4 });
    this.voice(tr, 'sawtooth', f, t, 0.002, level * 0.22, 0.01, 0.22, { lp: 3400 });
    this.voice(tr, 'sine', f * 2, t, 0.002, level * 0.18, 0.01, 0.35);
  }

  bass(tr, n, t, dur, level) {
    this.voice(tr, 'triangle', midi(n), t, 0.01, level, dur * 0.6, 0.12);
    this.voice(tr, 'sawtooth', midi(n), t, 0.01, level * 0.3, dur * 0.4, 0.1, { lp: 500 });
  }

  drum(tr, kind, t, level) {
    const s = this.s;
    const c = s.ctx;
    if (kind === 'kick' || kind === 'taiko') {
      this.voice(tr, 'sine', kind === 'kick' ? 130 : 95, t, 0.003, level, 0.02, kind === 'kick' ? 0.22 : 0.45, { f2: kind === 'kick' ? 42 : 55, glide: 0.18 });
    }
    if (kind === 'snare' || kind === 'hat' || kind === 'taiko') {
      const src = c.createBufferSource();
      src.buffer = s.white;
      const f = c.createBiquadFilter();
      f.type = kind === 'hat' ? 'highpass' : 'bandpass';
      f.frequency.value = kind === 'hat' ? 7500 : kind === 'taiko' ? 400 : 1800;
      f.Q.value = 0.8;
      const g = c.createGain();
      const d = kind === 'hat' ? 0.04 : kind === 'taiko' ? 0.3 : 0.16;
      this.env(g, t, 0.002, level * (kind === 'hat' ? 0.35 : 0.7), 0.005, d);
      src.connect(f);
      f.connect(g);
      g.connect(tr.g);
      src.start(t, Math.random() * 1.5);
      src.stop(t + d + 0.05);
      if (kind === 'snare') this.voice(tr, 'triangle', 190, t, 0.002, level * 0.4, 0.01, 0.1, { f2: 140, glide: 0.08 });
    }
  }

  // one sixteenth step of a theme
  play(tr, t, sixteenth) {
    const T = tr.T;
    const step = tr.step;
    const bar = Math.floor(step / 16);
    const i16 = step % 16;
    const phrase = Math.floor(bar / 4) % T.prog.length;
    const b4 = bar % 4;
    const sym = T.prog[phrase][b4];
    const tones = chord(sym);
    const root = 48 + (tones[0] % 12);
    const name = tr.name;
    // exploration themes breathe: play `play` bars then rest `rest` bars
    const cycle = T.play + T.rest;
    const inRest = bar % cycle >= T.play;
    if (inRest) return;
    const barLen = sixteenth * 16;
    if (name === 'highland') {
      if (i16 === 0) this.pad(tr, tones.map((p) => 60 + (p % 12)), t, barLen * 1.05, 0.016, 950);
      if (i16 === 0 || i16 === 8) this.bass(tr, root - 12 + (i16 === 8 ? 7 : 0), t, barLen * 0.45, 0.055);
      // frame drum and a soft shaker
      if (i16 === 0 || i16 === 10) this.drum(tr, 'taiko', t, i16 === 0 ? 0.2 : 0.12);
      if (i16 % 4 === 2) this.drum(tr, 'hat', t, 0.07);
      // koto: rolling chord tones, the melody echoed in the second half
      const row = tr.melody[phrase][b4];
      if (i16 % 2 === 0) {
        const e = i16 / 2;
        if (b4 < 2) {
          const seq = [0, 2, 1, 2, 0, 1, 2, 1];
          if (e % 2 === 0 || Math.random() < 0.5) this.koto(tr, 60 + (tones[seq[e]] % 12) + (e >= 6 ? 12 : 0), t, 0.04);
          const n = row[e];
          if (n) {
            let len = 1;
            while (e + len < 8 && !row[e + len]) len++;
            this.flute(tr, n, t, len * sixteenth * 2, 0.045);
          }
        } else if (row[e]) this.koto(tr, row[e], t, 0.06);
      }
      return;
    }
    if (name === 'festival') {
      if (i16 === 0) this.pad(tr, tones.map((p) => 60 + (p % 12)), t, barLen * 1.05, 0.014, 1300);
      // drum: boom on 1, light double hit on the and-of-3, claps on 2 and 4
      if (i16 === 0 || i16 === 10 || i16 === 11) this.drum(tr, 'taiko', t, i16 === 0 ? 0.26 : 0.13);
      if (i16 === 4 || i16 === 12) this.drum(tr, 'snare', t, 0.12);
      if (i16 % 2 === 1) this.drum(tr, 'hat', t, 0.08);
      if (i16 % 4 === 0) this.bass(tr, root - 12 + (i16 === 8 ? 7 : 0), t, sixteenth * 3, 0.05);
      const row = tr.melody[phrase][b4];
      if (i16 % 2 === 0) {
        const e = i16 / 2;
        const seq = [0, 1, 2, 1, 2, 1, 0, 2];
        this.koto(tr, 60 + (tones[seq[e]] % 12) + 12, t, 0.03);
        const n = row[e];
        if (n) {
          let len = 1;
          while (e + len < 8 && !row[e + len]) len++;
          this.flute(tr, n, t, len * sixteenth * 2, 0.05);
        }
      }
      // little bells on the first beat of every other bar
      if (i16 === 0 && bar % 2 === 0) for (let k = 0; k < 3; k++) this.harp(tr, 84 + (tones[k] % 12), t + k * sixteenth * 0.5, 0.025);
      return;
    }
    if (name === 'day' || name === 'night') {
      const night = name === 'night';
      if (i16 === 0) this.pad(tr, tones.map((p) => 60 + (p % 12)), t, barLen * 1.05, night ? 0.018 : 0.022, night ? 800 : 1200);
      if (i16 === 0) this.bass(tr, root - 12, t, barLen * 0.9, night ? 0.05 : 0.06);
      // harp arpeggio
      const arpEvery = night ? 4 : 2;
      if (i16 % arpEvery === 0) {
        const k = i16 / arpEvery;
        const seq = [0, 1, 2, 1, 0, 2, 1, 2];
        const n = 60 + (tones[seq[k % 8]] % 12) + (k % 4 === 3 ? 12 : 0);
        if (!night || Math.random() < 0.8) this.harp(tr, n, t, night ? 0.05 : 0.045);
      }
      // melody (night only in the second half of each phrase)
      if (i16 % 2 === 0 && (!night || b4 >= 2)) {
        const row = tr.melody[phrase][b4];
        const e = i16 / 2;
        const n = row[e];
        if (n) {
          let len = 1;
          while (e + len < 8 && !row[e + len]) len++;
          this.flute(tr, n + (night ? -12 : 0), t, len * sixteenth * 2, night ? 0.035 : 0.05);
        }
      }
    } else {
      const boss = name === 'boss';
      // drums
      if (i16 % 8 === 0 || (boss && i16 === 10)) this.drum(tr, boss ? 'taiko' : 'kick', t, boss ? 0.5 : 0.42);
      if (i16 % 8 === 4) this.drum(tr, 'snare', t, 0.3);
      if (i16 % 2 === 1) this.drum(tr, 'hat', t, 0.18);
      if (boss && i16 === 14) this.drum(tr, 'taiko', t, 0.35);
      // bass ostinato on eighths
      if (i16 % 2 === 0) {
        const pat = boss ? [0, 0, 0, 12, 0, 0, 7, 0] : [0, 0, 12, 0, 7, 0, 12, 10];
        this.bass(tr, root - 12 + pat[(i16 / 2) % 8], t, sixteenth * 1.6, 0.08);
      }
      // staccato strings on sixteenths
      const st = [0, 2, 1, 2, 0, 2, 1, 2, 0, 2, 1, 2, 2, 1, 2, 1];
      this.pluckStr(tr, 60 + (tones[st[i16]] % 12) + (i16 >= 12 ? 12 : 0), t, 0.025);
      if (i16 === 0) this.pad(tr, tones.map((p) => (boss ? 48 : 60) + (p % 12)), t, barLen, boss ? 0.03 : 0.02, boss ? 700 : 1500);
      // a brass-like line on the downbeats
      if (i16 === 0 || i16 === 8) {
        const row = tr.melody[phrase][b4];
        const n = row[i16 / 2] || row[0] || 72;
        this.voice(tr, 'sawtooth', midi(n - (boss ? 24 : 12)), t, 0.05, 0.03, sixteenth * 5, 0.2, { lp: boss ? 900 : 1600 });
      }
    }
  }

  update(dt, ready) {
    const s = this.s;
    if (!ready || !s.ctx) return;
    if (!this.bus) this.init();
    const c = s.ctx;
    const now = c.currentTime;
    for (const tr of Object.values(this.tracks)) {
      const on = tr.name === this.want;
      const target = on ? 1 : 0;
      if (tr.target !== target) {
        tr.target = target;
        tr.g.gain.cancelScheduledValues(now);
        tr.g.gain.setTargetAtTime(target, now, on ? 1.0 : 1.4);
        if (on && !tr.live) {
          tr.live = true;
          tr.step = 0;
          tr.next = now + 0.15;
        }
        if (!on) tr.stopAt = now + 6;
      }
      if (!tr.live) continue;
      if (!on && now > tr.stopAt) {
        tr.live = false;
        continue;
      }
      const sixteenth = 60 / tr.T.bpm / 4;
      while (tr.next < now + 0.25) {
        this.play(tr, tr.next, sixteenth);
        tr.next += sixteenth;
        tr.step++;
      }
    }
  }
}
