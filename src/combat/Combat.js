import * as THREE from 'three';
import { VFX, Trail } from './VFX.js';
import { EnemyManager } from './Enemies.js';
import { REACTIONS, ELEMENT_COLORS } from './elements.js';
import { ELEMENTS } from '../character/characters.js';
import { WorldUI } from '../ui/WorldUI.js';
import { clamp, lerp, smoothstep } from '../core/noise.js';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Pose library. A = wind-up, B = end of strike. Values are Euler XYZ radians.
// ---------------------------------------------------------------------------
const STANCE = { thighL: [-0.45, 0, 0.06], shinL: [0.6, 0, 0], footL: [-0.15, 0, 0], thighR: [0.35, 0, -0.08], shinR: [0.35, 0, 0] };
const POSES = {
  slashA: {
    A: { spine: [0.1, -0.25, 0], chest: [0.05, -0.6, 0], uArmR: [-0.15, -0.5, -1.35], fArmR: [-0.3, 0, 0], handR: [1.25, 0, 0], uArmL: [0.25, 0, 0.55], fArmL: [-0.7, 0, 0] },
    B: { spine: [0.15, 0.25, 0], chest: [0.1, 0.6, 0], uArmR: [-0.1, 1.75, -1.3], fArmR: [-0.1, 0, 0], handR: [1.35, 0, 0], uArmL: [0.45, 0, 0.4], fArmL: [-0.4, 0, 0] },
  },
  slashB: {
    A: { spine: [0.1, 0.25, 0], chest: [0.05, 0.65, 0], uArmR: [-0.3, 1.9, -1.1], fArmR: [-1.0, 0, 0], handR: [1.2, 0, 0], uArmL: [0.3, 0, 0.4], fArmL: [-0.5, 0, 0] },
    B: { spine: [0.15, -0.25, 0], chest: [0.1, -0.65, 0], uArmR: [-0.1, -0.7, -1.45], fArmR: [-0.1, 0, 0], handR: [1.3, 0, 0], uArmL: [0.15, 0, 0.65], fArmL: [-0.5, 0, 0] },
  },
  overhead: {
    A: { spine: [-0.18, 0, 0], chest: [-0.1, 0, 0], neck: [0.1, 0, 0], uArmR: [-2.9, 0, -0.25], fArmR: [-0.3, 0, 0], handR: [0.9, 0, 0], uArmL: [-2.5, 0, 0.35], fArmL: [-0.6, 0, 0] },
    B: { spine: [0.38, 0, 0], chest: [0.15, 0, 0], neck: [-0.2, 0, 0], uArmR: [-0.75, 0, -0.15], fArmR: [-0.05, 0, 0], handR: [1.4, 0, 0], uArmL: [-0.4, 0, 0.35], fArmL: [-0.4, 0, 0] },
  },
  spin: {
    spin: true,
    A: { hips: [0, -0.5, 0], spine: [0.1, 0, 0], uArmR: [-0.1, 0.2, -1.45], fArmR: [-0.1, 0, 0], handR: [1.35, 0, 0], uArmL: [0, 0, 1.3], fArmL: [-0.1, 0, 0] },
    B: { hips: [0, -0.5, 0], spine: [0.15, 0, 0], uArmR: [-0.1, 0.2, -1.45], fArmR: [-0.1, 0, 0], handR: [1.35, 0, 0], uArmL: [0, 0, 1.3], fArmL: [-0.1, 0, 0] },
  },
  heavyOverhead: {
    A: { spine: [-0.25, 0, 0], chest: [-0.12, 0, 0], uArmR: [-3.0, 0, -0.08], fArmR: [-0.2, 0, 0], handR: [0.8, 0, 0], uArmL: [-2.9, -0.2, 0.15], fArmL: [-0.4, 0, 0] },
    B: { spine: [0.5, 0, 0], chest: [0.15, 0, 0], uArmR: [-0.55, 0, -0.05], fArmR: [-0.05, 0, 0], handR: [1.45, 0, 0], uArmL: [-0.6, -0.3, 0.1], fArmL: [-0.3, 0, 0] },
  },
  heavySweep: {
    A: { spine: [0.1, -0.35, 0], chest: [0.0, -0.9, 0], uArmR: [-0.3, -0.8, -1.3], fArmR: [-0.2, 0, 0], handR: [1.3, 0, 0], uArmL: [-0.8, -0.9, 0.4], fArmL: [-0.6, 0, 0] },
    B: { spine: [0.2, 0.35, 0], chest: [0.05, 0.8, 0], uArmR: [-0.2, 1.6, -1.25], fArmR: [-0.1, 0, 0], handR: [1.35, 0, 0], uArmL: [-0.6, 1.2, 0.2], fArmL: [-0.5, 0, 0] },
  },
  thrust: {
    A: { chest: [0.05, -0.5, 0], spine: [0.05, -0.3, 0], uArmR: [-0.1, 0, -0.25], fArmR: [-1.47, 0, 0], handR: [1.5, 0, 0], uArmL: [-1.0, 0.6, 0.35], fArmL: [-0.9, 0, 0] },
    B: { chest: [0.15, 0.25, 0], spine: [0.2, 0.1, 0], uArmR: [-1.45, 0, -0.1], fArmR: [-0.12, 0, 0], handR: [1.5, 0, 0], uArmL: [-1.2, 0.35, 0.2], fArmL: [-0.35, 0, 0] },
  },
  castR: {
    A: { chest: [0, -0.4, 0], uArmR: [-0.7, 0.3, -0.6], fArmR: [-1.0, 0, 0], uArmL: [0.2, 0, 0.3] },
    B: { chest: [0.05, 0.25, 0], uArmR: [-1.5, -0.1, -0.2], fArmR: [-0.1, 0, 0], uArmL: [0.3, 0, 0.4] },
  },
  castL: {
    A: { chest: [0, 0.4, 0], uArmL: [-0.7, -0.3, 0.6], fArmL: [-1.0, 0, 0], uArmR: [0.2, 0, -0.3] },
    B: { chest: [0.05, -0.25, 0], uArmL: [-1.5, 0.1, 0.2], fArmL: [-0.1, 0, 0], uArmR: [0.3, 0, -0.4] },
  },
  castBoth: {
    A: { spine: [-0.1, 0, 0], uArmR: [-2.4, 0, -0.4], uArmL: [-2.4, 0, 0.4], fArmR: [-0.4, 0, 0], fArmL: [-0.4, 0, 0] },
    B: { spine: [0.15, 0, 0], uArmR: [-1.45, 0, -0.15], uArmL: [-1.45, 0, 0.15], fArmR: [-0.05, 0, 0], fArmL: [-0.05, 0, 0] },
  },
  castUp: {
    A: { uArmR: [-0.4, 0, -0.4], fArmR: [-1.2, 0, 0], uArmL: [0.2, 0, 0.4] },
    B: { chest: [-0.12, 0, 0], neck: [0.25, 0, 0], uArmR: [-3.0, 0, -0.2], fArmR: [-0.05, 0, 0], handR: [0.4, 0, 0], uArmL: [0.1, 0, 0.6], fArmL: [-0.3, 0, 0] },
  },
  dash: {
    A: { spine: [0.45, 0, 0], chest: [0.1, 0, 0], uArmR: [0.6, 0, -0.5], fArmR: [-0.3, 0, 0], handR: [1.4, 0, 0], uArmL: [0.5, 0, 0.5] },
    B: { spine: [0.15, 0.25, 0], chest: [0.1, 0.6, 0], uArmR: [-0.1, 1.75, -1.3], fArmR: [-0.1, 0, 0], handR: [1.35, 0, 0], uArmL: [0.45, 0, 0.4] },
  },
  plunge: {
    A: { uArmR: [-2.6, 0, -0.2], uArmL: [-2.4, 0, 0.3], fArmR: [-0.3, 0, 0], handR: [1.0, 0, 0], thighL: [-0.9, 0, 0], shinL: [1.2, 0, 0], thighR: [-0.3, 0, 0], shinR: [0.6, 0, 0] },
    B: { spine: [0.4, 0, 0], uArmR: [-0.6, 0, -0.1], uArmL: [-0.5, 0, 0.2], handR: [1.6, 0, 0], thighL: [-0.9, 0, 0], shinL: [1.2, 0, 0], thighR: [-0.3, 0, 0], shinR: [0.6, 0, 0] },
  },
};

const COMBOS = {
  sword: [
    { pose: 'slashA', dur: 0.46, w: 0.12, s: 0.24, hits: [0.2], mult: 0.9, range: 2.8, arc: 2.6, step: 2.4 },
    { pose: 'slashB', dur: 0.46, w: 0.1, s: 0.22, hits: [0.18], mult: 0.95, range: 2.8, arc: 2.6, step: 2.4 },
    { pose: 'overhead', dur: 0.56, w: 0.18, s: 0.3, hits: [0.27], mult: 1.25, range: 2.9, arc: 1.5, step: 2.8, knock: 4 },
    { pose: 'spin', dur: 0.72, w: 0.12, s: 0.46, hits: [0.26, 0.42], mult: 0.85, range: 3.2, arc: TAU, step: 1.2, knock: 5 },
  ],
  claymore: [
    { pose: 'heavyOverhead', dur: 0.82, w: 0.3, s: 0.45, hits: [0.42], mult: 1.8, range: 3.3, arc: 1.7, step: 2.0, knock: 5, heavy: true },
    { pose: 'heavySweep', dur: 0.8, w: 0.25, s: 0.42, hits: [0.38], mult: 1.9, range: 3.4, arc: 3.0, step: 2.0, knock: 5, heavy: true },
    { pose: 'spin', dur: 1.05, w: 0.2, s: 0.75, hits: [0.4, 0.62], mult: 1.4, range: 3.6, arc: TAU, step: 1.0, knock: 7, heavy: true },
  ],
  polearm: [
    { pose: 'thrust', dur: 0.38, w: 0.1, s: 0.18, hits: [0.16], mult: 0.75, range: 3.6, arc: 1.0, step: 2.6 },
    { pose: 'thrust', dur: 0.38, w: 0.1, s: 0.18, hits: [0.16], mult: 0.8, range: 3.6, arc: 1.0, step: 2.6 },
    { pose: 'slashA', dur: 0.48, w: 0.12, s: 0.26, hits: [0.22], mult: 1.0, range: 3.3, arc: 2.6, step: 2.0 },
    { pose: 'thrust', dur: 0.46, w: 0.1, s: 0.3, hits: [0.16, 0.26], mult: 0.65, range: 3.8, arc: 1.0, step: 2.0 },
    { pose: 'spin', dur: 0.7, w: 0.12, s: 0.46, hits: [0.3, 0.44], mult: 0.9, range: 3.6, arc: TAU, step: 1.0, knock: 5 },
  ],
  catalyst: [
    { pose: 'castR', dur: 0.5, w: 0.12, s: 0.22, proj: [0.2], mult: 0.95, step: 0 },
    { pose: 'castL', dur: 0.5, w: 0.12, s: 0.22, proj: [0.2], mult: 1.0, step: 0 },
    { pose: 'castBoth', dur: 0.75, w: 0.2, s: 0.34, proj: [0.3, 0.34, 0.38], mult: 0.7, step: 0 },
  ],
};

const BLADE = {
  sword: [0.12, 0.8],
  claymore: [0.15, 1.08],
  polearm: [0.9, 1.6],
};

const easeOut = (x) => 1 - Math.pow(1 - x, 3);

export class Combat {
  constructor(game) {
    this.g = game;
    this.player = game.player;
    this.scene = game.scene;
    this.vfx = new VFX(game.scene, game.camera, game.renderer);
    this.enemies = new EnemyManager(game);
    this.ui = new WorldUI(game.container, game.camera);
    this.action = null;
    this.combo = 0;
    this.comboTimer = 0;
    this.queued = false;
    this.weaponT = 0;
    this.trails = new Map();
    this.projectiles = [];
    this.fields = [];
    this.orbs = [];
    this.drops = [];
    this.hitStop = 0;
    this.iframe = 0;
    this.stats = { atk: 1150, critRate: 0.3, critDmg: 0.9 };
    this.gemToast = 0;
    this.gemTimer = 0;
    this.downTimer = 0;
    const E = this.enemies;
    E.on('death', (e) => this.onEnemyDeath(e));
    E.on('slam', (e, r, dmg) => this.onSlam(e, r, dmg));
    E.on('swing', (e, r, arc, dmg) => this.onSwing(e, r, arc, dmg));
    E.on('chargedTick', (e) => this.onChargedTick(e));
    E.on('telegraph', () => {});
    // highland enemies: arrows and orbs, shield guards, blinking casters
    E.on('shotHit', (s) => {
      this.vfx.burst(s.pos, s.kind === 'orb' ? s.color : '#f0e2c0', 14, { speed: 4, size: 0.2, life: 0.4 });
      this.hurtPlayer(s.dmg, s.src);
    });
    E.on('shotEnd', (s) => {
      if (s.kind === 'orb') this.vfx.burst(s.pos, s.color, 10, { speed: 3, size: 0.18, life: 0.35 });
      else this.vfx.burst(s.pos, '#c8b896', 5, { speed: 2, size: 0.12, life: 0.3, up: 0.6 });
    });
    E.on('shoot', () => this.g.sfx.bow());
    E.on('cast', (e) => {
      this.g.sfx.enemyCast(e.selfEl);
      this.vfx.flash(e.model.crystal.getWorldPosition(new THREE.Vector3()), ELEMENT_COLORS[e.selfEl], 0.8, 0.9);
    });
    E.on('blink', (e, from) => {
      const col = ELEMENT_COLORS[e.selfEl] || '#c9a8ff';
      for (const p of [from.clone().setY(from.y + 0.7), e.pos.clone().setY(e.pos.y + 0.7)]) this.vfx.burst(p, col, 22, { speed: 5, size: 0.22, life: 0.5, gravity: 0 });
      this.g.sfx.blink();
    });
    E.on('block', (e) => {
      if (this.blockT > 0) return;
      this.blockT = 0.25;
      const c = e.center(new THREE.Vector3());
      this.ui.text(c.setY(c.y + e.height * 0.4), '막음', '#cfd6e0', { small: true });
      this.vfx.burst(c, '#fff4d6', 10, { speed: 5, size: 0.14, life: 0.25 });
      this.g.sfx.block();
    });
    E.on('guardBreak', (e) => {
      const c = e.center(new THREE.Vector3());
      this.ui.text(c.clone().setY(c.y + e.height * 0.7), '방어 붕괴!', '#ffd36a', { reaction: true });
      this.vfx.ring(c.clone().setY(e.pos.y + 0.2), '#ffd36a', 3.5, 0.4, { inner: 0.8 });
      this.vfx.burst(c, '#ffe6a0', 34, { speed: 7, size: 0.26, life: 0.6 });
      this.hitStop = Math.max(this.hitStop, 0.12);
      this.g.cameraCtl.shake(0.25, 0.25);
      this.g.sfx.guardBreak();
      if (this.g.achievements) this.g.achievements.add('guardBreaks');
    });
    E.on('quake', (e, r) => {
      const P = this.player;
      if (Math.hypot(P.pos.x - e.pos.x, P.pos.z - e.pos.z) < r * 4) this.g.cameraCtl.shake(0.22, 0.25);
    });
    this.blockT = 0;
  }

  // ======================================================================
  // per-frame
  // ======================================================================
  update(dt, input) {
    const P = this.player;
    this.blockT = Math.max(0, this.blockT - dt);
    for (const c of P.party) {
      c.skillCd = Math.max(0, c.skillCd - dt);
      c.burstCd = Math.max(0, c.burstCd - dt);
    }
    this.iframe = Math.max(0, this.iframe - dt);
    this.comboTimer -= dt;
    if (this.comboTimer <= 0 && !this.action) this.combo = 0;

    if (this.downTimer > 0) {
      this.downTimer -= dt;
      if (this.downTimer <= 0) this.reviveParty();
    } else if (input.enabled) this.handleInput(input);

    this.updateAction(dt, input);
    this.updateWeapon(dt);
    this.updateProjectiles(dt);
    for (let i = this.fields.length - 1; i >= 0; i--) if (!this.fields[i].update(dt)) this.fields.splice(i, 1);
    this.updateOrbs(dt);
    this.updateDrops(dt);
  }

  // enemies / vfx / ui run after the player has moved
  lateUpdate(dt, dtReal) {
    this.enemies.update(dt, this.player);
    this.vfx.update(dtReal);
    for (const t of this.trails.values()) t.update(dtReal);
    this.ui.update(dtReal, this.enemies.list, this.player);
    if (this.gemTimer > 0) {
      this.gemTimer -= dtReal;
      if (this.gemTimer <= 0 && this.gemToast > 0) {
        this.g.hud.toast(`획득 · <b>별빛 결정</b> ×${this.gemToast}`, '#9fe8ff');
        this.gemToast = 0;
      }
    }
  }

  handleInput(input) {
    const P = this.player;
    if (input.hit('ShiftLeft') || input.hit('ShiftRight')) {
      this.iframe = Math.max(this.iframe, 0.3);
      if (P.state === 'ground') this.g.sfx.dash();
      if (this.action && this.action.t > this.action.s) this.endAction();
    }
    const atk = input.mouseHit(0);
    if (atk) {
      const gh = this.g.ground.heightAt(P.pos.x, P.pos.z);
      if (this.action && (this.action.kind === 'attack')) this.queued = true;
      else if (!this.action) {
        if (P.state === 'glide' || (P.state === 'air' && P.pos.y - gh > 2.2)) this.startPlunge();
        else if (P.state === 'ground') this.startAttack();
      }
    }
    if (input.hit('KeyE')) this.startSkill();
    if (input.hit('KeyQ')) this.startBurst();
  }

  // ======================================================================
  // actions
  // ======================================================================
  canStart(cancelAttacks = false) {
    const P = this.player;
    if (P.state !== 'ground') return false;
    const a = this.action;
    return !a || a.t > a.s + 0.02 || (cancelAttacks && a.kind === 'attack');
  }

  autoAim(range = 7) {
    const P = this.player;
    const fx = Math.sin(P.yaw),
      fz = Math.cos(P.yaw);
    const e = this.enemies.nearest(P.pos.x, P.pos.z, range, fx, fz, 2.5);
    if (e) P.yaw = Math.atan2(e.pos.x - P.pos.x, e.pos.z - P.pos.z);
    return e;
  }

  begin(def) {
    const P = this.player;
    this.action = Object.assign({ t: 0, done: new Set(), events: [], hits: [], proj: [], step: 0 }, def);
    P.locked = true;
    P.animOverride = (pose, model) => this.poseOverride(pose, model);
    this.weaponT = 3;
  }

  endAction() {
    const P = this.player;
    if (!this.action) return;
    if (this.action.onEnd) this.action.onEnd();
    this.action = null;
    P.locked = false;
    P.animOverride = null;
    const tr = this.trails.get(P.model);
    if (tr) tr.stop();
  }

  startAttack() {
    const P = this.player;
    if (!this.canStart()) return;
    const w = P.current.cfg.weapon;
    const list = COMBOS[w];
    if (this.combo >= list.length) this.combo = 0;
    const def = list[this.combo];
    this.combo++;
    this.comboTimer = 1.0;
    this.queued = false;
    this.autoAim();
    this.begin({ kind: 'attack', ...def, el: w === 'catalyst' ? P.current.cfg.element : 'phys', stance: w !== 'catalyst' });
  }

  startPlunge() {
    const P = this.player;
    P.state = 'air';
    P.vel.set(P.vel.x * 0.15, -26, P.vel.z * 0.15);
    const el = P.current.cfg.weapon === 'catalyst' ? P.current.cfg.element : 'phys';
    this.begin({ kind: 'plunge', pose: 'plunge', dur: 99, w: 0.05, s: 0.18, el, startY: P.pos.y });
  }

  startSkill() {
    const P = this.player;
    const c = P.current;
    if (c.skillCd > 0 || !this.canStart(true)) return;
    if (this.action) this.endAction();
    const kit = KITS[c.cfg.id];
    c.skillCd = kit.skill.cd;
    this.autoAim(10);
    this.begin({ kind: 'skill', stance: true, ...kit.skill.def(this) });
    this.g.sfx.skill(c.cfg.element);
  }

  startBurst() {
    const P = this.player;
    const c = P.current;
    if (c.burstCd > 0 || c.energy < c.maxEnergy || !this.canStart(true)) return;
    if (this.action) this.endAction();
    const kit = KITS[c.cfg.id];
    c.energy = 0;
    c.burstCd = kit.burst.cd;
    this.iframe = Math.max(this.iframe, 1.2);
    this.autoAim(12);
    this.g.cameraCtl.shake(0.15, 0.25);
    this.begin({ kind: 'burst', stance: true, ...kit.burst.def(this) });
    this.g.sfx.burst(c.cfg.element);
    this.g.burstCutIn(c, kit.burst.name);
  }

  poseOverride(Pose, model) {
    const a = this.action;
    if (!a) return null;
    const pd = POSES[a.pose];
    if (!pd) return null;
    const t = a.t;
    const k = t < a.w ? 0 : t < a.s ? easeOut((t - a.w) / Math.max(a.s - a.w, 1e-3)) : 1;
    for (const j in pd.A) {
      const A = pd.A[j];
      const B = pd.B[j] || A;
      Pose[j].set(lerp(A[0], B[0], k), lerp(A[1], B[1], k), lerp(A[2], B[2], k));
    }
    for (const j in pd.B) {
      if (pd.A[j]) continue;
      const B = pd.B[j];
      Pose[j].set(B[0] * k, B[1] * k, B[2] * k);
    }
    if (pd.spin) Pose.hips.y = pd.A.hips[1] + k * TAU;
    if (a.stance && !pd.A.thighL) for (const j in STANCE) Pose[j].set(...STANCE[j]);
    return { blend: a.kind === 'plunge' ? 18 : 26, hipsY: a.lift !== undefined ? a.lift : a.stance ? -0.06 : undefined };
  }

  updateAction(dt, input) {
    const a = this.action;
    const P = this.player;
    if (!a) return;
    const prev = a.t;
    a.t += dt;
    // root motion
    if (a.step && a.t >= a.w && a.t <= a.s + 0.04) P.forced = { x: Math.sin(P.yaw) * a.step, z: Math.cos(P.yaw) * a.step, t: 0.05 };
    if (a.kind === 'attack' && prev < a.w && a.t >= a.w) this.g.sfx.swing(P.current.cfg.weapon, this.combo - 1);
    for (const h of a.hits) {
      if (prev < h && a.t >= h) this.meleeHit(a);
    }
    for (const h of a.proj) {
      if (prev < h && a.t >= h) this.castProjectile(a);
    }
    for (const ev of a.events) {
      if (!ev.done && a.t >= ev.t) {
        ev.done = true;
        ev.fn(this, a);
      }
    }
    if (a.tick) a.tick(this, a, dt);
    // weapon trail
    const tr = this.trailFor(P.model);
    if (tr) {
      if (a.t >= a.w - 0.03 && a.t <= a.s + 0.06 && P.model.weapon.visible) {
        const blade = BLADE[P.current.cfg.weapon];
        P.model.weapon.updateWorldMatrix(true, false);
        tr.push(P.model.weapon.localToWorld(_a.set(0, blade[0], 0)), P.model.weapon.localToWorld(_b.set(0, blade[1], 0)));
      } else tr.stop();
    }
    // chaining & cancelling
    if (a.kind === 'attack' && this.queued && a.t >= a.s + 0.03) {
      this.endAction();
      this.startAttack();
      return;
    }
    if (a.t > a.s + 0.12 && input && (Math.abs(input.moveVector().x) + Math.abs(input.moveVector().y) > 0.2 || input.hit('Space'))) {
      if (a.kind !== 'plunge') {
        this.endAction();
        return;
      }
    }
    if (a.t >= a.dur) this.endAction();
  }

  updateWeapon(dt) {
    const P = this.player;
    this.weaponT -= dt;
    for (const c of P.party) {
      const m = c.model;
      const show = c === P.current && (this.weaponT > 0 || !!this.action);
      if (m.weapon.visible !== show) {
        m.weapon.visible = show;
        if (show && c === P.current) {
          m.weapon.updateWorldMatrix(true, false);
          this.vfx.sparkle(m.weapon.getWorldPosition(_c), ELEMENTS[c.cfg.element].color, 10, 0.5);
        }
      }
    }
  }

  trailFor(model) {
    const w = model.cfg.weapon;
    if (w === 'catalyst') return null;
    let t = this.trails.get(model);
    if (!t) {
      t = new Trail(this.scene, ELEMENTS[model.cfg.element].glow);
      this.trails.set(model, t);
    }
    return t;
  }

  // ======================================================================
  // hits & damage
  // ======================================================================
  // tell puzzles (braziers, pinwheels) where an element landed
  emitElement(x, z, r, el) {
    if (this.g.puzzles && el && el !== 'phys') this.g.puzzles.onElement(x, z, r, el);
  }

  meleeHit(a) {
    const P = this.player;
    const fx = Math.sin(P.yaw),
      fz = Math.cos(P.yaw);
    const range = a.range ?? 2.8;
    this.emitElement(P.pos.x + fx * range * 0.5, P.pos.z + fz * range * 0.5, range * 0.6, a.el);
    let any = false;
    for (const e of this.enemies.near(P.pos.x + fx * 0.5, P.pos.z + fz * 0.5, range)) {
      const dx = e.pos.x - P.pos.x,
        dz = e.pos.z - P.pos.z;
      const d = Math.hypot(dx, dz);
      if (Math.abs(e.pos.y - P.pos.y) > 2.6) continue;
      if ((a.arc ?? TAU) < 6.2 && d > 0.7) {
        const ang = Math.acos(clamp((dx * fx + dz * fz) / d, -1, 1));
        if (ang > (a.arc ?? TAU) / 2) continue;
      }
      any = true;
      this.damage(e, { mult: a.mult, el: a.el, knock: a.knock ?? 2.2, dir: [dx / (d || 1), dz / (d || 1)], heavy: a.heavy });
    }
    if (any) this.g.cameraCtl.shake(a.heavy ? 0.18 : 0.08, 0.12);
  }

  castProjectile(a) {
    const P = this.player;
    const m = P.model;
    const el = P.current.cfg.element;
    const color = ELEMENTS[el].color;
    const target = this.enemies.nearest(P.pos.x, P.pos.z, 16, Math.sin(P.yaw), Math.cos(P.yaw), 4);
    m.weapon.updateWorldMatrix(true, false);
    const start = m.weapon.getWorldPosition(new THREE.Vector3());
    if (!m.weapon.visible) start.set(P.pos.x, P.pos.y + 1.2, P.pos.z);
    const dir = new THREE.Vector3(Math.sin(P.yaw), 0.05, Math.cos(P.yaw)).normalize();
    dir.x += (Math.random() - 0.5) * 0.3;
    dir.z += (Math.random() - 0.5) * 0.3;
    const mesh = this.vfx.orb(color, 0.22);
    mesh.position.copy(start);
    this.g.sfx.cast(el);
    this.projectiles.push({ pos: start, vel: dir.multiplyScalar(13), el, mult: a.mult, target, life: 1.6, mesh, color });
  }

  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      if (p.target && p.target.alive) {
        p.target.center(_a).sub(p.pos).normalize().multiplyScalar(16);
        p.vel.lerp(_a, 1 - Math.exp(-dt * 7));
      }
      p.pos.addScaledVector(p.vel, dt);
      p.mesh.position.copy(p.pos);
      if (Math.random() < 0.7) this.vfx.particles.spawn(p.pos, _b.set(0, 0.3, 0), this.vfx.color.set(p.color), 0.16, 0.35, { drag: 3 });
      let hit = null;
      for (const e of this.enemies.near(p.pos.x, p.pos.z, 0.6)) {
        if (Math.abs(e.pos.y + e.height * 0.5 - p.pos.y) < e.height * 0.7 + 0.4) {
          hit = e;
          break;
        }
      }
      const gh = this.g.terrain.heightAt(p.pos.x, p.pos.z);
      if (hit || p.life <= 0 || p.pos.y < gh) {
        this.emitElement(p.pos.x, p.pos.z, 1.2, p.el);
        if (hit) this.damage(hit, { mult: p.mult, el: p.el, knock: 1.2, dir: [p.vel.x / 16, p.vel.z / 16] });
        this.vfx.burst(p.pos, p.color, 12, { speed: 4, size: 0.18, life: 0.4 });
        this.vfx.removeObj(p.mesh);
        this.projectiles.splice(i, 1);
      }
    }
  }

  // Apply damage with element + reaction handling. Returns reaction info.
  damage(e, h) {
    if (!e.alive) return null;
    const el = h.el || 'phys';
    const center = e.center(new THREE.Vector3());
    if (e.selfEl && el === e.selfEl) {
      this.ui.text(center.clone().setY(center.y + e.height * 0.6), '면역', '#d8d8d8', { small: true });
      return null;
    }
    let rmult = 1;
    let reaction = null;
    if (el !== 'phys') reaction = e.applyElement(el);
    if (reaction) {
      const R = REACTIONS[reaction.type];
      this.g.sfx.reaction(reaction.type);
      if (this.g.achievements) this.g.achievements.reaction(reaction.type);
      this.ui.text(center.clone().setY(center.y + e.height * 0.7), R.name, R.color, { reaction: true });
      if (reaction.type === 'vaporize' || reaction.type === 'melt') {
        rmult = reaction.mult;
        this.vfx.burst(center, R.color, 30, { speed: 7, size: 0.3, life: 0.6, up: 0.6 });
        this.vfx.flash(center, R.color, 1.6, 0.2);
      } else if (reaction.type === 'overload') this.overload(e, center);
      else if (reaction.type === 'freeze') {
        e.freeze(3.5);
        this.vfx.burst(center, '#cff6ff', 26, { speed: 5, size: 0.22, life: 0.6 });
      } else if (reaction.type === 'charged') {
        e.chargedT = 4;
        e.chargeTick = 0.25;
      } else if (reaction.type === 'superconduct') this.superconduct(e, center);
      else if (reaction.type === 'swirl') this.swirl(e, center, reaction.el);
    }
    let mult = h.mult;
    const gmul = e.guardCheck ? e.guardCheck(h, reaction) : 1;
    mult *= gmul;
    if (h.heavy && e.frozenT > 0) {
      e.unfreeze();
      mult *= 1.6;
      this.ui.text(center.clone().setY(center.y + e.height * 0.9), REACTIONS.shatter.name, REACTIONS.shatter.color, { reaction: true });
      this.g.sfx.reaction('shatter');
      if (this.g.achievements) this.g.achievements.reaction('shatter');
      this.vfx.burst(center, '#e8fbff', 30, { speed: 8, size: 0.25, life: 0.6 });
    }
    // character attack, talent level for skills/bursts, and the level gap
    const cur = this.player.current;
    if (this.action && this.action.kind === 'skill') mult *= cur.skillMul || 1;
    else if (this.action && this.action.kind === 'burst') mult *= cur.burstMul || 1;
    const lvF = clamp(1 + ((cur.level || 20) - (e.level || 20)) * 0.02, 0.6, 1.5);
    const crit = !h.noCrit && Math.random() < this.stats.critRate;
    let dmg = this.atk() * mult * rmult * lvF * (crit ? 1 + this.stats.critDmg : 1) * (0.93 + Math.random() * 0.14);
    if (el === 'phys' && e.superT > 0) dmg *= 1.4;
    dmg = Math.max(1, Math.round(dmg));
    let knock = null;
    if (h.knock && h.dir && gmul >= 1) knock = new THREE.Vector3(h.dir[0] * h.knock, 0, h.dir[1] * h.knock);
    e.hit(dmg, knock, h.launch);
    this.ui.text(center.clone().setY(center.y + e.height * 0.45), String(dmg), ELEMENT_COLORS[el], { crit });
    if (!h.quiet) {
      this.g.sfx.hit(el, crit, h.heavy);
      this.vfx.hitSpark(center, el === 'phys' ? '#fff3d6' : ELEMENT_COLORS[el]);
      this.hitStop = Math.max(this.hitStop, h.stop ?? (h.heavy ? 0.075 : 0.045));
    }
    if (h.particles) {
      this.spawnEnergy(center, this.player.current.cfg.element, h.particles);
      h.particles = 0;
    }
    return reaction;
  }

  atk() {
    return (this.player.current.atk || this.stats.atk) * (this.atkBuff || 1);
  }

  rawDamage(e, mult, el, color) {
    if (!e.alive) return;
    const center = e.center(new THREE.Vector3());
    const dmg = Math.round(this.atk() * mult * (0.95 + Math.random() * 0.1));
    e.hit(dmg, null, 0);
    this.ui.text(center.clone().setY(center.y + e.height * 0.45 + Math.random() * 0.3), String(dmg), color || ELEMENT_COLORS[el], {});
  }

  overload(e, center) {
    this.vfx.explosion(center, '#ff6a9a', 3.2, 0.5);
    this.g.cameraCtl.shake(0.3, 0.3);
    for (const o of this.enemies.near(e.pos.x, e.pos.z, 3.2)) {
      this.rawDamage(o, 1.7, 'fire', REACTIONS.overload.color);
      const dx = o.pos.x - e.pos.x,
        dz = o.pos.z - e.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      o.vel.x += (dx / d) * 7;
      o.vel.z += (dz / d) * 7;
      o.vel.y = 4;
      o.airborne = true;
    }
  }

  superconduct(e, center) {
    this.vfx.explosion(center, '#b9b4ff', 2.8, 0.45);
    for (const o of this.enemies.near(e.pos.x, e.pos.z, 3)) {
      this.rawDamage(o, 0.6, 'ice', REACTIONS.superconduct.color);
      o.superT = 12;
    }
  }

  swirl(e, center, el) {
    const col = ELEMENT_COLORS[el];
    this.vfx.ring(center, col, 4.5, 0.5);
    this.vfx.burst(center, col, 40, { speed: 9, size: 0.28, life: 0.7, up: 0.2, gravity: 0 });
    for (const o of this.enemies.near(e.pos.x, e.pos.z, 4.5)) {
      this.rawDamage(o, 0.55, 'wind', REACTIONS.swirl.color);
      if (o !== e) this.damage(o, { mult: 0.55, el, noCrit: true, quiet: true });
    }
  }

  onChargedTick(e) {
    const c = e.center(new THREE.Vector3());
    this.rawDamage(e, 0.45, 'thunder', REACTIONS.charged.color);
    this.vfx.burst(c, '#d9a6ff', 10, { speed: 4, size: 0.14, life: 0.3 });
    for (const o of this.enemies.near(e.pos.x, e.pos.z, 3.5)) {
      if (o !== e && o.aura === 'water') {
        this.vfx.lightning(c, o.center(new THREE.Vector3()), '#d9a6ff', 0.12, 0.2);
        this.rawDamage(o, 0.45, 'thunder', REACTIONS.charged.color);
      }
    }
  }

  aoe(x, z, r, h) {
    const out = [];
    this.emitElement(x, z, r, h.el);
    for (const e of this.enemies.near(x, z, r)) {
      const dx = e.pos.x - x,
        dz = e.pos.z - z;
      const d = Math.hypot(dx, dz) || 1;
      out.push(e);
      this.damage(e, { ...h, dir: [dx / d, dz / d] });
    }
    return out;
  }

  // ======================================================================
  // enemy attacks on the player
  // ======================================================================
  onSlam(e, r, dmg) {
    const c = e.center(new THREE.Vector3());
    c.y = e.pos.y + 0.1;
    this.vfx.ring(c, ELEMENT_COLORS[e.selfEl] || '#ffffff', r, 0.35, { inner: 0.82 });
    this.vfx.burst(c, ELEMENT_COLORS[e.selfEl] || '#ffffff', 14, { speed: 5, size: 0.2, life: 0.4, up: 0.8 });
    const P = this.player;
    if (Math.hypot(P.pos.x - e.pos.x, P.pos.z - e.pos.z) < r && Math.abs(P.pos.y - e.pos.y) < 1.8) this.hurtPlayer(dmg, e);
  }

  onSwing(e, r, arc, dmg) {
    const P = this.player;
    const dx = P.pos.x - e.pos.x,
      dz = P.pos.z - e.pos.z;
    const d = Math.hypot(dx, dz);
    const fx = Math.sin(e.yaw),
      fz = Math.cos(e.yaw);
    const ang = Math.acos(clamp((dx * fx + dz * fz) / (d || 1), -1, 1));
    if (d < r && ang < arc && Math.abs(P.pos.y - e.pos.y) < 1.8) this.hurtPlayer(dmg, e);
    this.vfx.burst(_a.set(e.pos.x + fx * 1.2, e.pos.y + 0.3, e.pos.z + fz * 1.2), '#d8c8a8', 10, { speed: 3, size: 0.3, life: 0.5, up: 0.8, intensity: 0.8 });
  }

  hurtPlayer(dmg, src) {
    const P = this.player;
    if (this.iframe > 0 || this.downTimer > 0) {
      if (this.iframe > 0) this.ui.text(_a.set(P.pos.x, P.pos.y + 2, P.pos.z), '회피', '#ffffff', { small: true });
      return;
    }
    const c = P.current;
    dmg = Math.round(dmg * (0.9 + Math.random() * 0.2) * (c.defMul || 1));
    c.hp = Math.max(0, c.hp - dmg);
    this.g.sfx.hurt();
    this.ui.text(_a.set(P.pos.x, P.pos.y + 1.8, P.pos.z), String(dmg), '#ff6060', {});
    this.iframe = 0.45;
    this.g.flashScreen('#ff2a2a', 0.22);
    this.g.cameraCtl.shake(0.2, 0.2);
    P.model.setFlash(0.5);
    setTimeout(() => P.model.setFlash(0), 90);
    if (src) {
      const dx = P.pos.x - src.pos.x,
        dz = P.pos.z - src.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      P.forced = { x: (dx / d) * 6, z: (dz / d) * 6, t: 0.15 };
    }
    if (c.hp <= 0) this.onCharDown();
  }

  onCharDown() {
    const P = this.player;
    if (this.action) this.endAction();
    const next = P.party.findIndex((p) => p.hp > 0);
    if (next >= 0) {
      P.switchTo(next, true);
      this.g.hud.toast(`<b>${P.party[next].cfg.name}</b> 출전`, ELEMENTS[P.party[next].cfg.element].color);
    } else {
      this.downTimer = 2.2;
      this.g.hud.flashCenter('파티가 쓰러졌습니다...', 2000);
      this.g.flashScreen('#000000', 0.9);
    }
  }

  reviveParty() {
    const P = this.player;
    for (const c of P.party) c.hp = Math.round(c.maxHp * 0.6);
    P.respawn({ x: -30, z: 70 });
    P.switchTo(0, true);
    for (const e of this.enemies.list) e.aggro = false;
  }

  heal(frac) {
    const P = this.player;
    const c = P.current;
    const amt = Math.round(c.maxHp * frac);
    c.hp = Math.min(c.maxHp, c.hp + amt);
    this.ui.text(_a.set(P.pos.x, P.pos.y + 1.9, P.pos.z), '+' + amt, '#9cff7a', { small: true });
  }

  // ======================================================================
  // energy particles & drops
  // ======================================================================
  spawnEnergy(pos, el, n) {
    for (let i = 0; i < n; i++) {
      const mesh = this.vfx.orb(ELEMENTS[el].color, 0.18);
      mesh.position.copy(pos);
      this.orbs.push({
        el,
        mesh,
        pos: pos.clone(),
        vel: new THREE.Vector3((Math.random() - 0.5) * 4, 4 + Math.random() * 2, (Math.random() - 0.5) * 4),
        t: 0,
      });
    }
  }

  updateOrbs(dt) {
    const P = this.player;
    const target = _c.set(P.pos.x, P.pos.y + 1.0, P.pos.z);
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i];
      o.t += dt;
      if (o.t < 0.65) {
        o.vel.y -= 12 * dt;
        o.pos.addScaledVector(o.vel, dt);
        const gh = this.g.ground.heightAt(o.pos.x, o.pos.z) + 0.3;
        if (o.pos.y < gh) {
          o.pos.y = gh;
          o.vel.y *= -0.4;
        }
      } else {
        const sp = 6 + (o.t - 0.65) * 30;
        _a.copy(target).sub(o.pos);
        const d = _a.length();
        if (d < 0.5) {
          for (const c of P.party) {
            const same = c.cfg.element === o.el;
            const gain = c === P.current ? (same ? 3 : 2) : same ? 1.8 : 1.2;
            c.energy = Math.min(c.maxEnergy, c.energy + gain);
          }
          this.vfx.sparkle(o.pos, ELEMENTS[o.el].color, 8, 0.5);
          this.g.sfx.energy();
          this.vfx.removeObj(o.mesh);
          this.orbs.splice(i, 1);
          continue;
        }
        o.pos.addScaledVector(_a.normalize(), Math.min(d, sp * dt));
      }
      o.mesh.position.copy(o.pos);
    }
  }

  onEnemyDeath(e) {
    const c = e.center(new THREE.Vector3());
    const col = e.selfEl ? ELEMENT_COLORS[e.selfEl] : '#ffd27a';
    this.vfx.burst(c, col, 40, { speed: 7, size: 0.3, life: 0.8, up: 0.6 });
    this.vfx.flash(c, '#ffffff', 1.2, 0.2);
    this.g.sfx.enemyDeath();
    if (this.g.achievements) {
      this.g.achievements.add('kills');
      if (e.elite) this.g.achievements.add('elites');
    }
    this.spawnEnergy(c, this.player.current.cfg.element, e.elite ? 3 : 1);
    this.spawnGems(c, (2 + Math.floor(Math.random() * 3)) * (e.elite ? 3 : 1));
    if (e.aim) e.aim.visible = false;
  }

  // star-gem pickups that pop out and then fly to the player (+5 each)
  spawnGems(c, n) {
    for (let i = 0; i < n; i++) {
      const mesh = new THREE.Mesh(this.gemGeo || (this.gemGeo = new THREE.OctahedronGeometry(0.14, 0)), this.gemMat || (this.gemMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#8fe6ff').multiplyScalar(1.6), fog: false })));
      mesh.position.copy(c);
      this.scene.add(mesh);
      const sp = 3 + Math.min(n, 12) * 0.25;
      this.drops.push({ mesh, pos: c.clone(), vel: new THREE.Vector3((Math.random() - 0.5) * sp, 5 + Math.random() * 3, (Math.random() - 0.5) * sp), t: 0, collecting: false });
    }
  }

  updateDrops(dt) {
    const P = this.player;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.t += dt;
      const dist = Math.hypot(d.pos.x - P.pos.x, d.pos.z - P.pos.z);
      if (!d.collecting && d.t > 0.8 && dist < 3) d.collecting = true;
      if (d.collecting) {
        _a.set(P.pos.x, P.pos.y + 1, P.pos.z).sub(d.pos);
        const l = _a.length();
        if (l < 0.4) {
          this.g.gems += 5;
          this.gemToast += 5;
          this.gemTimer = 0.6;
          this.vfx.sparkle(d.pos, '#9fe8ff', 6, 0.4);
          this.g.sfx.gem();
          this.scene.remove(d.mesh);
          this.drops.splice(i, 1);
          continue;
        }
        d.pos.addScaledVector(_a.normalize(), Math.min(l, (10 + d.t * 4) * dt));
      } else {
        d.vel.y -= 14 * dt;
        d.pos.addScaledVector(d.vel, dt);
        d.vel.x *= Math.exp(-2 * dt);
        d.vel.z *= Math.exp(-2 * dt);
        const gh = (this.g.ground || this.g.terrain).heightAt(d.pos.x, d.pos.z) + 0.25;
        if (d.pos.y < gh) {
          d.pos.y = gh;
          d.vel.y = Math.abs(d.vel.y) * 0.35;
        }
      }
      d.mesh.position.copy(d.pos);
      d.mesh.position.y += Math.sin(d.t * 3) * 0.05;
      d.mesh.rotation.y += dt * 2;
      if (d.t > 60) {
        this.scene.remove(d.mesh);
        this.drops.splice(i, 1);
      }
    }
  }

  // player events (landing etc.)
  onPlayerEvent(ev) {
    const a = this.action;
    if (ev.type === 'land' && a && a.kind === 'plunge') {
      const P = this.player;
      const drop = Math.max(0, a.startY - P.pos.y);
      const mult = 1.6 + Math.min(2.5, drop / 8);
      const col = a.el === 'phys' ? '#fff0d0' : ELEMENT_COLORS[a.el];
      _a.set(P.pos.x, P.pos.y + 0.3, P.pos.z);
      this.vfx.ring(_a, col, 4, 0.45);
      this.vfx.burst(_a, col, 40, { speed: 8, size: 0.3, life: 0.6, up: 0.5 });
      this.vfx.flash(_a, col, 2, 0.18);
      this.g.cameraCtl.shake(0.4, 0.3);
      this.aoe(P.pos.x, P.pos.z, 3.6, { mult, el: a.el, knock: 6, heavy: true });
      a.dur = a.t + 0.35;
      a.kind = 'plunge-end';
    }
    if (ev.type === 'switch') {
      if (this.action) this.endAction();
      this.weaponT = 0;
      const P = this.player;
      const col = ELEMENTS[P.current.cfg.element].color;
      this.vfx.sparkle(_a.set(P.pos.x, P.pos.y + 1, P.pos.z), col, 20, 1.2);
      this.vfx.ring(_a.set(P.pos.x, P.pos.y + 0.05, P.pos.z), col, 1.6, 0.4, { inner: 0.85 });
    }
  }
}

// ---------------------------------------------------------------------------
// Character kits (elemental skill E / burst Q)
// ---------------------------------------------------------------------------
function front(C, d) {
  const P = C.player;
  return new THREE.Vector3(P.pos.x + Math.sin(P.yaw) * d, P.pos.y, P.pos.z + Math.cos(P.yaw) * d);
}

const KITS = {
  aria: {
    skill: {
      cd: 6,
      def: () => ({
        pose: 'spin',
        dur: 0.75,
        w: 0.1,
        s: 0.5,
        events: [
          {
            t: 0.28,
            fn: (C) => {
              const P = C.player;
              const c = new THREE.Vector3(P.pos.x, P.pos.y + 0.8, P.pos.z);
              const tor = C.vfx.tornado('#7fffd8', 2.2, 4.5);
              tor.group.position.set(P.pos.x, P.pos.y, P.pos.z);
              setTimeout(() => (tor.alive = false), 550);
              C.vfx.ring(c.clone().setY(P.pos.y), '#7fffd8', 5, 0.5);
              C.vfx.burst(c, '#9fffe6', 50, { speed: 10, size: 0.3, life: 0.7, gravity: -2, up: 0.5 });
              const hit = C.aoe(P.pos.x, P.pos.z, 5, { mult: 2.8, el: 'wind', knock: -3, launch: 6.5, particles: 3 });
              C.g.cameraCtl.shake(0.2, 0.25);
            },
          },
        ],
      }),
    },
    burst: {
      cd: 15,
      name: '폭풍의 눈',
      def: () => ({
        pose: 'castBoth',
        dur: 0.9,
        w: 0.2,
        s: 0.45,
        events: [
          {
            t: 0.42,
            fn: (C) => {
              const P = C.player;
              const pos = front(C, 4);
              const dir = new THREE.Vector3(Math.sin(P.yaw), 0, Math.cos(P.yaw));
              const fx = C.vfx.tornado('#7fffd8', 3.4, 7);
              let t = 0,
                tick = 0,
                absorbed = null;
              C.fields.push({
                update: (dt) => {
                  t += dt;
                  pos.addScaledVector(dir, 1.6 * dt);
                  pos.y = C.g.terrain.heightAt(pos.x, pos.z);
                  fx.group.position.copy(pos);
                  const col = absorbed ? ELEMENT_COLORS[absorbed] : '#9fffe6';
                  for (let i = 0; i < 3; i++) {
                    const a = Math.random() * TAU;
                    const r = 0.5 + Math.random() * 2.5;
                    _a.set(pos.x + Math.cos(a) * r, pos.y + Math.random() * 6, pos.z + Math.sin(a) * r);
                    _b.set(-Math.sin(a) * 8, 2, Math.cos(a) * 8);
                    C.vfx.particles.spawn(_a, _b, C.vfx.color.set(col), 0.22, 0.5, { drag: 2 });
                  }
                  for (const e of C.enemies.near(pos.x, pos.z, 7)) {
                    const dx = pos.x - e.pos.x,
                      dz = pos.z - e.pos.z;
                    const d = Math.hypot(dx, dz) || 1;
                    e.vel.x += (dx / d) * 14 * dt;
                    e.vel.z += (dz / d) * 14 * dt;
                    if (d < 3) {
                      e.vel.y = Math.max(e.vel.y, 2.5);
                      e.airborne = true;
                    }
                  }
                  tick -= dt;
                  if (tick <= 0) {
                    tick = 0.45;
                    for (const e of C.enemies.near(pos.x, pos.z, 3.8)) {
                      const r = C.damage(e, { mult: 0.6, el: 'wind', stop: 0.0, quiet: true, noCrit: false });
                      if (r && r.type === 'swirl' && !absorbed) {
                        absorbed = r.el;
                        fx.setColor(ELEMENT_COLORS[absorbed]);
                      }
                      if (absorbed && e.alive) C.damage(e, { mult: 0.3, el: absorbed, quiet: true, noCrit: true });
                    }
                  }
                  if (t > 7) fx.alive = false;
                  return t < 7;
                },
              });
              C.g.cameraCtl.shake(0.25, 0.4);
            },
          },
        ],
      }),
    },
  },
  ren: {
    skill: {
      cd: 7,
      def: () => ({
        pose: 'dash',
        dur: 0.72,
        w: 0.3,
        s: 0.45,
        events: [
          {
            t: 0.02,
            fn: (C) => {
              C.iframe = Math.max(C.iframe, 0.4);
            },
          },
          {
            t: 0.4,
            fn: (C) => {
              const p = front(C, 1.8);
              p.y += 0.8;
              C.vfx.explosion(p, '#ff8a3c', 3.4, 0.5);
              C.aoe(p.x, p.z, 3.6, { mult: 3.2, el: 'fire', knock: 6, heavy: true, particles: 3 });
              C.g.cameraCtl.shake(0.35, 0.3);
            },
          },
        ],
        tick: (C, a, dt) => {
          const P = C.player;
          if (a.t > 0.05 && a.t < 0.32) {
            P.forced = { x: Math.sin(P.yaw) * 24, z: Math.cos(P.yaw) * 24, t: 0.05 };
            for (let i = 0; i < 4; i++) {
              _a.set(P.pos.x + (Math.random() - 0.5), P.pos.y + 0.3 + Math.random() * 1.2, P.pos.z + (Math.random() - 0.5));
              C.vfx.particles.spawn(_a, _b.set(0, 1.5, 0), C.vfx.color.set('#ff9a4a'), 0.35, 0.5, { drag: 2 });
            }
          }
        },
      }),
    },
    burst: {
      cd: 15,
      name: '불새의 낙인',
      def: () => ({
        pose: 'heavyOverhead',
        dur: 1.25,
        w: 0.55,
        s: 0.78,
        events: [
          {
            t: 0.05,
            fn: (C) => {
              const P = C.player;
              C.vfx.burst(new THREE.Vector3(P.pos.x, P.pos.y + 1, P.pos.z), '#ffb347', 40, { speed: 6, size: 0.3, life: 0.8, gravity: -3 });
            },
          },
          {
            t: 0.76,
            fn: (C) => {
              const p = front(C, 2.2);
              p.y += 0.5;
              C.vfx.explosion(p, '#ff6a2a', 7, 0.7);
              C.vfx.explosion(p, '#ffd27a', 4, 0.45);
              C.aoe(p.x, p.z, 7, { mult: 6.5, el: 'fire', knock: 9, heavy: true, stop: 0.12 });
              C.g.cameraCtl.shake(0.6, 0.5);
              let t = 0,
                tick = 0;
              const ring = C.vfx.ring(p.clone().setY(p.y - 0.4), '#ff7a3a', 5, 5, { static: true, inner: 0.9, opacity: 0.8 });
              C.fields.push({
                update: (dt) => {
                  t += dt;
                  for (let i = 0; i < 4; i++) {
                    const a = Math.random() * TAU,
                      r = Math.sqrt(Math.random()) * 5;
                    _a.set(p.x + Math.cos(a) * r, p.y - 0.4, p.z + Math.sin(a) * r);
                    _a.y = C.g.terrain.heightAt(_a.x, _a.z) + 0.1;
                    C.vfx.particles.spawn(_a, _b.set(0, 2.5 + Math.random() * 2, 0), C.vfx.color.set(Math.random() < 0.5 ? '#ff7a2a' : '#ffd27a'), 0.4, 0.7, { drag: 1, size1: 0.05 });
                  }
                  tick -= dt;
                  if (tick <= 0) {
                    tick = 0.5;
                    for (const e of C.enemies.near(p.x, p.z, 5)) C.damage(e, { mult: 0.35, el: 'fire', quiet: true, noCrit: true });
                  }
                  return t < 5;
                },
              });
            },
          },
        ],
        tick: (C, a) => {
          const P = C.player;
          a.lift = a.t < 0.7 ? Math.sin((a.t / 0.7) * Math.PI) * 0.9 : -0.1;
        },
      }),
    },
  },
  mizu: {
    skill: {
      cd: 9,
      def: () => ({
        pose: 'castUp',
        dur: 0.65,
        w: 0.12,
        s: 0.32,
        events: [
          {
            t: 0.3,
            fn: (C) => {
              const P = C.player;
              const c = new THREE.Vector3(P.pos.x, P.pos.y + 0.5, P.pos.z);
              C.vfx.ring(c, '#5fc8ff', 5.5, 0.55);
              C.vfx.burst(c, '#9fdcff', 50, { speed: 9, size: 0.3, life: 0.7, up: 0.9, gravity: 9 });
              C.aoe(P.pos.x, P.pos.z, 5.5, { mult: 2.2, el: 'water', knock: 4, particles: 3 });
              C.heal(0.14);
              // orbiting water orbs
              const orbs = [0, 1, 2].map(() => C.vfx.orb('#4fc0ff', 0.28));
              const hitCd = new Map();
              let t = 0,
                healT = 0;
              C.fields.push({
                update: (dt) => {
                  t += dt;
                  healT += dt;
                  if (healT > 1) {
                    healT = 0;
                    C.heal(0.02);
                  }
                  orbs.forEach((o, i) => {
                    const a = t * 3 + (i / 3) * TAU;
                    o.position.set(P.pos.x + Math.cos(a) * 2.1, P.pos.y + 1.0 + Math.sin(t * 4 + i) * 0.15, P.pos.z + Math.sin(a) * 2.1);
                    for (const e of C.enemies.near(o.position.x, o.position.z, 0.5)) {
                      const k = hitCd.get(e) || 0;
                      if (performance.now() > k) {
                        hitCd.set(e, performance.now() + 1100);
                        C.damage(e, { mult: 0.6, el: 'water', quiet: false, noCrit: true, stop: 0 });
                      }
                    }
                  });
                  if (t > 8) {
                    orbs.forEach((o) => {
                      C.vfx.burst(o.position, '#9fdcff', 10, { speed: 3, size: 0.18, life: 0.4 });
                      C.vfx.removeObj(o);
                    });
                    return false;
                  }
                  return true;
                },
              });
            },
          },
        ],
      }),
    },
    burst: {
      cd: 15,
      name: '해명의 비',
      def: () => ({
        pose: 'castBoth',
        dur: 1.0,
        w: 0.25,
        s: 0.5,
        events: [
          {
            t: 0.48,
            fn: (C) => {
              const P = C.player;
              const p = new THREE.Vector3(P.pos.x, P.pos.y, P.pos.z);
              C.vfx.ring(p, '#5fc8ff', 9, 8, { static: true, inner: 0.92, opacity: 0.9 });
              C.vfx.explosion(new THREE.Vector3(p.x, p.y + 1, p.z), '#4fc0ff', 4, 0.5);
              let t = 0,
                tick = 0;
              C.fields.push({
                update: (dt) => {
                  t += dt;
                  for (let i = 0; i < 10; i++) {
                    const a = Math.random() * TAU,
                      r = Math.sqrt(Math.random()) * 9;
                    _a.set(p.x + Math.cos(a) * r, p.y + 7 + Math.random() * 2, p.z + Math.sin(a) * r);
                    C.vfx.particles.spawn(_a, _b.set(0, -18, 0), C.vfx.color.set('#a8e6ff'), 0.12, 0.45, { drag: 0, size1: 0.1, intensity: 1.2 });
                  }
                  tick -= dt;
                  if (tick <= 0) {
                    tick = 1;
                    for (const e of C.enemies.near(p.x, p.z, 9)) C.damage(e, { mult: 0.75, el: 'water', quiet: true });
                    if (Math.hypot(P.pos.x - p.x, P.pos.z - p.z) < 9) C.heal(0.04);
                  }
                  return t < 8;
                },
              });
            },
          },
        ],
      }),
    },
  },
  rai: {
    skill: {
      cd: 6,
      def: () => ({
        pose: 'castUp',
        dur: 0.6,
        w: 0.1,
        s: 0.28,
        events: [
          {
            t: 0.26,
            fn: (C) => {
              const P = C.player;
              const targets = C.enemies
                .near(P.pos.x, P.pos.z, 14)
                .sort((a, b) => Math.hypot(a.pos.x - P.pos.x, a.pos.z - P.pos.z) - Math.hypot(b.pos.x - P.pos.x, b.pos.z - P.pos.z))
                .slice(0, 3);
              if (!targets.length) {
                const p = front(C, 5);
                C.vfx.lightning(new THREE.Vector3(p.x, p.y + 14, p.z), p, '#d7a6ff', 0.35, 0.35);
              }
              let first = true;
              for (const e of targets) {
                const p = e.center(new THREE.Vector3());
                C.vfx.lightning(new THREE.Vector3(p.x + (Math.random() - 0.5) * 3, p.y + 14, p.z + (Math.random() - 0.5) * 3), p, '#d7a6ff', 0.35, 0.35);
                C.damage(e, { mult: 2.6, el: 'thunder', knock: 2, particles: first ? 3 : 0 });
                first = false;
              }
              C.g.flashScreen('#c9a0ff', 0.12);
              C.g.cameraCtl.shake(0.25, 0.25);
            },
          },
        ],
      }),
    },
    burst: {
      cd: 15,
      name: '천뢰',
      def: () => ({
        pose: 'spin',
        dur: 0.95,
        w: 0.15,
        s: 0.6,
        events: [
          {
            t: 0.45,
            fn: (C) => {
              const P = C.player;
              const c = new THREE.Vector3(P.pos.x, P.pos.y + 0.8, P.pos.z);
              C.vfx.explosion(c, '#b67bff', 5.5, 0.55);
              C.aoe(P.pos.x, P.pos.z, 5.5, { mult: 4, el: 'thunder', knock: 6, heavy: true, stop: 0.1 });
              C.g.cameraCtl.shake(0.4, 0.4);
              let t = 0,
                n = 0;
              C.fields.push({
                update: (dt) => {
                  t += dt;
                  if (t > 0.35 * (n + 1) && n < 8) {
                    n++;
                    const list = C.enemies.near(P.pos.x, P.pos.z, 12);
                    let p;
                    const e = list[Math.floor(Math.random() * list.length)];
                    if (e) p = e.center(new THREE.Vector3());
                    else {
                      const a = Math.random() * TAU;
                      p = new THREE.Vector3(P.pos.x + Math.cos(a) * 6, 0, P.pos.z + Math.sin(a) * 6);
                      p.y = C.g.terrain.heightAt(p.x, p.z);
                    }
                    C.vfx.lightning(new THREE.Vector3(p.x, p.y + 16, p.z), p, '#d7a6ff', 0.4, 0.3);
                    if (e) C.damage(e, { mult: 1.6, el: 'thunder', knock: 1, stop: 0.03 });
                  }
                  return n < 8;
                },
              });
            },
          },
        ],
      }),
    },
  },
};
