import * as THREE from 'three';
import { fxMat, crystalMaterial } from './Boss.js';
import { resolveReaction } from './elements.js';
import { toonMaterial } from '../render/materials.js';
import { clamp, damp } from '../core/noise.js';

// 서리 거인 · 그라실 — a giant of frozen rock asleep on the summit ledge.
// Lumbers after you and fights with heavy blows: a two-fisted slam, lines of
// ice spikes from a stomp, a hurled ice boulder and a spinning sweep. At half
// health it grows ice armour (melt it with fire) and starts to breathe frost,
// whipping up a blizzard that chills the whole ledge. Breaking the armour
// knocks it to its knees.

const TAU = Math.PI * 2;
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

function rock(r, sx, sy, sz, seed) {
  const g = new THREE.DodecahedronGeometry(r, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i);
    const k = 1 + Math.sin(x * 3.1 + seed) * 0.06 + Math.cos(y * 2.7 + z * 1.9 + seed) * 0.06;
    p.setXYZ(i, x * sx * k, y * sy * k, z * sz * k);
  }
  g.computeVertexNormals();
  return g;
}

export class FrostGiant {
  constructor(game, arena) {
    this.g = game;
    this.mgr = game.combat.enemies;
    this.isBoss = true;
    this.type = 'boss';
    this.name = '서리 거인 · 그라실';
    this.title = '설산 정상을 지키는 얼음 심장';
    this.selfEl = 'ice';
    this.level = 40;
    this.killKey = 'giantKills';
    this.home = arena.center.clone();
    this.arenaR = arena.r;
    this.pos = this.home.clone();
    this.vel = V3();
    this.yaw = Math.atan2(70 - this.home.x, -278 - this.home.z);
    this.radius = 2.3;
    this.height = 7.6;
    this.maxHp = 320000;
    this.hp = this.maxHp;
    this.alive = true;
    this.aggro = false;
    this.aura = 'ice';
    this.auraT = 1e9;
    this.auraRegen = 0;
    this.frozenT = 0;
    this.chargedT = 0;
    this.chargeTick = 0;
    this.superT = 0;
    this.airborne = false;
    this.state = 'dormant';
    this.st = 0;
    this.t = 0;
    this.phase = 1;
    this.shield = 0;
    this.shieldMax = this.maxHp * 0.13;
    this.cool = 2;
    this.last = '';
    this.away = 0;
    this.respawnT = 0;
    this.walkPh = 0;
    this.cur = {};
    this.build();
    this.mgr.list.push(this);
  }

  // ---------------------------------------------------------------- visuals
  build() {
    const g = this.g;
    const stone = toonMaterial({ color: '#7d8ea6', color2: '#3e4b60', rim: 0.35, shadowTint: '#6c74b0', unique: true });
    const ice = crystalMaterial('#173452', '#9fe8ff', 0.35);
    this.stoneMat = stone;
    this.iceMat = ice;
    const root = new THREE.Group();
    this.model = { root, mats: [] };
    const mesh = (geo, mat, parent, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    const grp = (parent, x = 0, y = 0, z = 0) => {
      const o = new THREE.Group();
      o.position.set(x, y, z);
      parent.add(o);
      return o;
    };
    const spike = (parent, x, y, z, rx, rz, h = 1.2, r = 0.3) => {
      const m = mesh(new THREE.ConeGeometry(r, h, 5), ice, parent, x, y, z);
      m.rotation.set(rx, 0, rz);
      return m;
    };
    const body = (this.body = grp(root, 0, 2.6, 0));
    mesh(rock(1.2, 1.25, 0.8, 1.0, 1), stone, body, 0, 0, 0);
    const torso = (this.torso = grp(body, 0, 0.4, 0));
    mesh(rock(1.9, 1.3, 1.05, 0.95, 2), stone, torso, 0, 1.7, 0);
    // a heart of ice glowing through the chest
    this.heart = mesh(new THREE.OctahedronGeometry(0.55, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color('#bff4ff').multiplyScalar(2.4) }), torso, 0, 1.9, 1.55);
    // crystals growing out of the back and shoulders
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI - Math.PI / 2;
      spike(torso, Math.sin(a) * 1.5, 2.6 + Math.cos(a) * 0.6, -1.2, -0.6, -Math.sin(a) * 0.6, 1.4 + (k % 3) * 0.6, 0.35);
    }
    const head = (this.head = grp(torso, 0, 3.35, 0.55));
    mesh(rock(0.85, 1.1, 0.9, 1.0, 3), stone, head, 0, 0.3, 0);
    const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#9fe8ff').multiplyScalar(3) });
    this.eyeMat = eyeMat;
    for (const s of [-1, 1]) mesh(new THREE.SphereGeometry(0.13, 10, 8), eyeMat, head, s * 0.33, 0.38, 0.82);
    this.mouth = grp(head, 0, 0.05, 0.85);
    for (let k = 0; k < 5; k++) spike(head, (k - 2) * 0.32, 1.0 + (k === 2 ? 0.3 : 0), -0.1, -0.2, (k - 2) * -0.2, 0.9 + (k === 2 ? 0.5 : 0), 0.16);
    this.arms = [];
    for (const s of [-1, 1]) {
      const sh = grp(torso, s * 2.15, 2.5, 0);
      mesh(rock(0.95, 1.0, 0.9, 1.0, 4 + s), stone, sh, 0, 0, 0);
      mesh(rock(0.75, 0.95, 1.55, 0.95, 5 + s), stone, sh, s * 0.15, -1.15, 0);
      const el = grp(sh, s * 0.2, -2.2, 0);
      mesh(rock(0.8, 1.05, 1.5, 1.05, 6 + s), stone, el, 0, -0.85, 0);
      const fist = mesh(rock(1.0, 1.15, 1.0, 1.15, 7 + s), stone, el, 0, -2.0, 0);
      for (let k = 0; k < 3; k++) spike(fist, (k - 1) * 0.45, -0.3, 0.75, 1.4, 0, 0.7, 0.18);
      spike(sh, 0, 0.7, 0, 0, -s * 0.3, 1.5, 0.35);
      this.arms.push({ s, sh, el, fist });
    }
    this.legs = [];
    for (const s of [-1, 1]) {
      const hip = grp(body, s * 1.05, -0.2, 0);
      mesh(rock(0.95, 1.0, 1.45, 1.0, 9 + s), stone, hip, 0, -1.2, 0);
      mesh(rock(0.8, 1.2, 0.5, 1.5, 10 + s), stone, hip, 0, -2.3, 0.3);
      this.legs.push({ s, hip });
    }
    // ice armour plates (phase 2)
    this.armor = [];
    const plate = (parent, x, y, z, rx, ry, s) => {
      const m = mesh(new THREE.IcosahedronGeometry(0.7, 0), ice, parent, x, y, z);
      m.scale.set(s * 1.3, s, s * 0.6);
      m.rotation.set(rx, ry, 0);
      m.visible = false;
      this.armor.push({ m, s });
    };
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      plate(torso, Math.sin(a) * 1.9, 1.3 + (k % 2) * 1.0, Math.cos(a) * 1.5, 0.2, a, 1.1);
    }
    for (const A of this.arms) {
      plate(A.sh, 0, -1.1, 0.5, 0.2, 0, 0.9);
      plate(A.el, 0, -0.9, 0.55, 0.2, 0, 0.9);
    }
    g.scene.add(root);
    this.root = root;
    // telegraphs and effects
    this.decals = [];
    this.spikes = [];
    this.boulders = [];
  }

  decal(kind, color = '#9fe8ff') {
    let d = this.decals.find((x) => !x.mesh.visible && x.kind === kind);
    if (!d) {
      const geo = new THREE.PlaneGeometry(1, 1);
      geo.rotateX(-Math.PI / 2);
      if (kind === 'line') geo.translate(0, 0, 0.5);
      const mesh = new THREE.Mesh(geo, fxMat(color, kind === 'line' ? 1 : 0));
      mesh.renderOrder = 3;
      this.g.scene.add(mesh);
      d = { kind, mesh };
      this.decals.push(d);
    }
    d.mesh.visible = true;
    d.mesh.material.uniforms.uColor.value.set(color);
    d.mesh.material.uniforms.uProg.value = 0;
    d.mesh.material.uniforms.uAlpha.value = 1;
    return d;
  }
  clearDecals() {
    for (const d of this.decals) d.mesh.visible = false;
  }

  spikeMesh() {
    let s = this.spikes.find((x) => !x.m.visible);
    if (!s) {
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.55, 2.6, 6), this.iceMat);
      m.castShadow = true;
      this.g.scene.add(m);
      s = { m };
      this.spikes.push(s);
    }
    s.m.visible = true;
    return s;
  }

  // ---------------------------------------------------------------- combat API
  center(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + 4.2, this.pos.z);
  }
  applyElement(el) {
    if (!el || el === 'phys') return null;
    const r = resolveReaction(this.aura, el);
    this.lastReact = r ? (r.type === 'melt' ? 2 : 1) : el === 'fire' ? 0.5 : 0;
    if (!r) return null;
    if (r.type !== 'charged') {
      this.aura = null;
      this.auraRegen = 1.5;
    }
    return r;
  }
  freeze() {}
  unfreeze() {
    this.frozenT = 0;
  }
  setFlash(v) {
    this.stoneMat.uniforms.uFlash && (this.stoneMat.uniforms.uFlash.value = v);
    this.iceMat.uniforms.uFlash.value = v * 0.6;
  }
  hit(dmg) {
    if (!this.alive || this.state === 'dormant' || this.state === 'intro') return;
    this.flash = 0.1;
    this.aggro = true;
    if (this.shield > 0) {
      // the ice armour shrugs off most blows; fire melts it
      const eff = this.lastReact === 2 ? 3.4 : this.lastReact === 1 ? 1.1 : this.lastReact === 0.5 ? 1.6 : 0.35;
      this.shield -= dmg * eff;
      this.lastReact = 0;
      this.shieldHit = 0.2;
      if (this.shield <= 0) this.breakArmor();
      return;
    }
    this.lastReact = 0;
    this.hp -= dmg * (this.state === 'stunned' ? 1.5 : 1);
    if (this.phase === 1 && !this.armorDone && this.hp <= this.maxHp * 0.5) {
      this.armorDone = true;
      this.hp = this.maxHp * 0.5;
      this.enter('armor');
    }
    if (this.hp <= 0) this.die();
  }
  die() {
    if (!this.alive) return;
    this.hp = 0;
    this.alive = false;
    this.enter('dead');
    this.mgr.onDeath(this);
    this.g.onBossDefeated(this);
    if (this.g.cold) this.g.cold.storm = 0;
  }

  // ---------------------------------------------------------------- states
  enter(s) {
    this.state = s;
    this.st = 0;
    this.hitDone = false;
    this.clearDecals();
    this.atk = null;
    const g = this.g;
    if (s === 'armor') {
      this.phase = 2;
      this.shield = this.shieldMax;
      g.hud.flashCenter('서리 거인이 얼음 갑옷을 두릅니다 · 불로 녹이세요!', 2800);
      g.sfx.bossShield();
      g.sfx.bossRoar();
      g.cameraCtl.shake(0.4, 0.6);
    }
    if (s === 'stunned') {
      g.cameraCtl.shake(0.45, 0.4);
      g.sfx.bossBreak();
    }
  }

  wake() {
    if (this.state !== 'dormant') return;
    this.enter('intro');
    this.aggro = true;
    this.g.bossIntro(this);
  }

  reset() {
    this.hp = this.maxHp;
    this.shield = 0;
    this.phase = 1;
    this.armorDone = false;
    this.alive = true;
    this.aggro = false;
    this.root.visible = true;
    this.root.scale.setScalar(1);
    this.pos.copy(this.home);
    for (const a of this.armor) a.m.visible = false;
    for (const s of this.spikes) s.m.visible = false;
    for (const b of this.boulders) this.g.scene.remove(b.m);
    this.boulders.length = 0;
    this.enter('dormant');
    this.away = 0;
    if (this.g.cold) this.g.cold.storm = 0;
  }

  breakArmor() {
    this.shield = 0;
    const g = this.g;
    const c = this.center(_v).clone();
    g.combat.vfx.explosion(c, '#bff0ff', 5.5, 0.6);
    g.combat.vfx.burst(c, '#e8fbff', 70, { speed: 11, size: 0.32, life: 1.0, up: 0.4, gravity: 8 });
    for (const a of this.armor) a.m.visible = false;
    g.hud.flashCenter('얼음 갑옷 파괴!', 1600);
    g.combat.hitStop = 0.12;
    this.enter('stunned');
  }

  strike(cond, dmg, cold = 0) {
    const P = this.g.player;
    if (cond(P.pos)) {
      const scale = 1 + (this.level - 20) * 0.03;
      this.g.combat.hurtPlayer(Math.round(dmg * scale), { pos: this.pos });
      if (cold && this.g.cold) this.g.cold.v = Math.min(100, this.g.cold.v + cold);
      return true;
    }
    return false;
  }

  pickAttack(d) {
    let opts = ['slam', 'spikes', 'boulder'];
    if (this.phase === 2) opts.push('breath', 'spikes');
    if (d < 6.5) opts = ['sweep', 'slam', ...(this.phase === 2 ? ['breath'] : [])];
    else if (d > 13) opts = ['boulder', 'spikes', ...(this.phase === 2 ? ['breath'] : [])];
    opts = opts.filter((a) => a !== this.last);
    const pick = opts[Math.floor(Math.random() * opts.length)];
    this.last = pick;
    this.enter(pick);
  }

  front(d) {
    return V3(this.pos.x + Math.sin(this.yaw) * d, this.home.y, this.pos.z + Math.cos(this.yaw) * d);
  }

  // ---------------------------------------------------------------- update
  update(dt, player) {
    const g = this.g;
    this.t += dt;
    this.st += dt;
    const sp = this.phase === 2 ? 1.25 : 1;
    const P = player.pos;
    const fromHome = Math.hypot(P.x - this.home.x, P.z - this.home.z);
    const dist = Math.hypot(P.x - this.pos.x, P.z - this.pos.z);
    if (!this.aura) {
      this.auraRegen -= dt;
      if (this.auraRegen <= 0) this.aura = 'ice';
    }
    if (this.chargedT > 0) {
      this.chargedT -= dt;
      this.chargeTick -= dt;
      if (this.chargeTick <= 0) {
        this.chargeTick = 1;
        this.mgr.onChargedTick(this);
      }
    }
    this.flash = Math.max(0, (this.flash || 0) - dt);
    this.setFlash(this.flash > 0 ? 0.5 : 0);
    this.shieldHit = Math.max(0, (this.shieldHit || 0) - dt);
    this.updateSpikes(dt);
    this.updateBoulders(dt);
    if (this.state === 'dead') return this.updateDead(dt);

    if (this.state === 'dormant') {
      if (fromHome < this.arenaR - 2 && Math.abs(P.y - this.home.y) < 6 && g.state === 'playing') this.wake();
    } else {
      this.away = fromHome > this.arenaR + 25 ? this.away + dt : 0;
      if (this.away > 4 || player.dead) {
        g.hud.flashCenter('도전 실패 · 서리 거인이 다시 잠들었습니다', 2000);
        g.onBossReset(this);
        this.reset();
        return;
      }
      // the giant's blizzard chills the ledge
      if (g.cold) g.cold.storm = fromHome < this.arenaR + 6 ? (this.phase === 2 ? 1 : 0.35) : 0;
    }

    const active = this.state !== 'dormant' && this.state !== 'intro' && this.state !== 'stunned' && this.state !== 'armor';
    // turn to face the player (slowly while winding up an attack)
    if (active) {
      const want = Math.atan2(P.x - this.pos.x, P.z - this.pos.z);
      let dy = want - this.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const turn = this.state === 'idle' ? 2.2 : this.state === 'breath' ? 0.9 : this.st < 0.6 ? 1.5 : 0.2;
      this.yaw += clamp(dy, -turn * dt, turn * dt);
    }
    this.moving = false;
    switch (this.state) {
      case 'intro':
        if (this.st > 4) this.enter('idle');
        break;
      case 'idle': {
        // close in, then pick something heavy to do
        if (dist > 7.5) {
          const speed = (this.phase === 2 ? 3.0 : 2.4) * sp;
          const nx = this.pos.x + Math.sin(this.yaw) * speed * dt,
            nz = this.pos.z + Math.cos(this.yaw) * speed * dt;
          if (Math.hypot(nx - this.home.x, nz - this.home.z) < this.arenaR - 3) {
            this.pos.x = nx;
            this.pos.z = nz;
            this.moving = true;
          }
        }
        this.cool -= dt * sp;
        if (this.cool <= 0) {
          this.cool = this.phase === 2 ? 1.1 : 1.8;
          this.pickAttack(dist);
        }
        break;
      }
      case 'slam':
        this.updateSlam(dt, sp);
        break;
      case 'spikes':
        this.updateSpikesAttack(dt, sp);
        break;
      case 'boulder':
        this.updateBoulder(dt, sp);
        break;
      case 'breath':
        this.updateBreath(dt);
        break;
      case 'sweep':
        this.updateSweep(dt, sp);
        break;
      case 'armor':
        // ice creeps over the body, then a roar shockwave
        for (const [i, a] of this.armor.entries()) {
          const k = clamp((this.st - i * 0.08) / 0.4, 0, 1);
          a.m.visible = k > 0;
          a.m.scale.set(a.s * 1.3 * k, a.s * k, a.s * 0.6 * k);
        }
        if (this.st > 1.6 && !this.hitDone) {
          this.hitDone = true;
          const c = V3(this.pos.x, this.home.y + 0.2, this.pos.z);
          g.combat.vfx.ring(c, '#bff0ff', 9, 0.6, { inner: 0.85 });
          g.combat.vfx.burst(c.setY(c.y + 2), '#ffffff', 60, { speed: 12, size: 0.3, life: 0.8, up: 0.4 });
          this.strike((p) => Math.hypot(p.x - this.pos.x, p.z - this.pos.z) < 9, 900, 25);
          g.cameraCtl.shake(0.5, 0.5);
        }
        if (this.st > 2.6) this.enter('idle');
        break;
      case 'stunned':
        if (this.st > 7) {
          g.hud.flashCenter('서리 거인이 분노합니다!', 1600);
          g.sfx.bossRoar();
          this.enter('idle');
        }
        break;
    }
    this.pos.y = this.home.y;
    this.animate(dt);
  }

  // both fists overhead, then down onto a marked circle in front
  updateSlam(dt, sp) {
    const st = this.st * sp;
    if (!this.atk) {
      const p = this.front(4.6);
      p.y = this.g.ground.heightAt(p.x, p.z);
      const d = this.decal('circle');
      d.mesh.position.set(p.x, p.y + 0.06, p.z);
      d.mesh.scale.setScalar(9);
      this.atk = { p, d };
      this.g.sfx.bossCharge();
    }
    const A = this.atk;
    A.d.mesh.material.uniforms.uProg.value = clamp(st / 1.05, 0, 1);
    if (st >= 1.1 && !this.hitDone) {
      this.hitDone = true;
      A.d.mesh.visible = false;
      const g = this.g;
      g.combat.vfx.explosion(_v.copy(A.p).setY(A.p.y + 0.5), '#cfefff', 4.5, 0.5);
      g.combat.vfx.ring(_v.copy(A.p), '#bff0ff', 6, 0.5, { inner: 0.8 });
      g.combat.vfx.burst(_v.copy(A.p).setY(A.p.y + 0.4), '#e8fbff', 40, { speed: 9, size: 0.3, life: 0.7, up: 1.2, gravity: 14 });
      this.strike((p) => Math.hypot(p.x - A.p.x, p.z - A.p.z) < 4.6 && p.y - A.p.y < 3, 1600);
      g.cameraCtl.shake(0.5, 0.4);
      g.sfx.bossImpact(1);
      g.sfx.land(10, 'stone');
    }
    if (st > 2.2) this.enter('idle');
  }

  // a stomp sends lines of ice spikes racing out towards the player
  updateSpikesAttack(dt, sp) {
    const st = this.st * sp;
    if (!this.atk) {
      const P = this.g.player.pos;
      const base = Math.atan2(P.x - this.pos.x, P.z - this.pos.z);
      const angles = this.phase === 2 ? [base - 0.42, base, base + 0.42] : [base - 0.2, base + 0.2];
      this.atk = { lines: angles.map((a) => ({ a, d: this.decal('line'), n: 0, hit: false })) };
      for (const L of this.atk.lines) {
        L.d.mesh.position.set(this.pos.x, this.home.y + 0.07, this.pos.z);
        L.d.mesh.rotation.y = L.a;
        L.d.mesh.scale.set(2.4, 1, 20);
      }
      this.g.sfx.bossCharge();
    }
    const A = this.atk;
    for (const L of A.lines) L.d.mesh.material.uniforms.uProg.value = clamp(st / 0.9, 0, 1);
    if (st > 0.95) {
      if (!this.hitDone) {
        this.hitDone = true;
        this.g.cameraCtl.shake(0.3, 0.3);
        this.g.sfx.bossImpact(0.7);
        for (const L of A.lines) L.d.mesh.visible = false;
      }
      // spikes erupt one after another along each line
      const want = Math.min(12, Math.floor((st - 0.95) / 0.05) + 1);
      for (const L of A.lines) {
        while (L.n < want) {
          L.n++;
          const r = 1.6 + L.n * 1.6;
          const x = this.pos.x + Math.sin(L.a) * r,
            z = this.pos.z + Math.cos(L.a) * r;
          const y = this.g.ground.heightAt(x, z);
          const s = this.spikeMesh();
          s.x = x;
          s.y = y;
          s.z = z;
          s.t = 0;
          s.m.rotation.set((Math.random() - 0.5) * 0.4, Math.random(), (Math.random() - 0.5) * 0.4);
          this.g.combat.vfx.burst(_v.set(x, y + 0.3, z), '#e8fbff', 6, { speed: 4, size: 0.18, life: 0.4, up: 1.2, gravity: 10 });
          if (!L.hit && !A.hit) L.hit = A.hit = this.strike((p) => Math.hypot(p.x - x, p.z - z) < 1.4 && p.y - y < 2.4, 1300);
        }
      }
    }
    if (st > 2.0) this.enter('idle');
  }

  updateSpikes(dt) {
    for (const s of this.spikes) {
      if (!s.m.visible) continue;
      s.t += dt;
      const up = Math.min(1, s.t / 0.1);
      const down = clamp((s.t - 1.2) / 0.4, 0, 1);
      s.m.position.set(s.x, s.y - 1.4 + 2.6 * up * (1 - down), s.z);
      if (down >= 1) s.m.visible = false;
    }
  }

  // tears a block of ice off its back and hurls it where the player stands
  updateBoulder(dt, sp) {
    const st = this.st * sp;
    if (!this.atk) {
      this.atk = { n: 0 };
      this.g.sfx.bossCharge();
    }
    const A = this.atk;
    const throws = this.phase === 2 ? [1.0, 1.7] : [1.0];
    while (A.n < throws.length && st >= throws[A.n]) {
      const P = this.g.player;
      // lead the target a little
      const tx = P.pos.x + P.vel.x * 0.6 + (A.n ? (Math.random() - 0.5) * 6 : 0),
        tz = P.pos.z + P.vel.z * 0.6 + (A.n ? (Math.random() - 0.5) * 6 : 0);
      const ty = this.g.ground.heightAt(tx, tz);
      const hand = this.arms[1].fist.getWorldPosition(new THREE.Vector3());
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1.15, 0), this.iceMat);
      m.position.copy(hand);
      m.castShadow = true;
      this.g.scene.add(m);
      const d = this.decal('circle');
      d.mesh.position.set(tx, ty + 0.06, tz);
      d.mesh.scale.setScalar(6.6);
      this.boulders.push({ m, from: hand, to: V3(tx, ty, tz), t: 0, dur: 1.0, d });
      A.n++;
      this.g.sfx.swing && this.g.sfx.swing('claymore', 2);
    }
    if (st > 2.2 + (throws.length - 1) * 0.7) this.enter('idle');
  }

  updateBoulders(dt) {
    for (let i = this.boulders.length - 1; i >= 0; i--) {
      const b = this.boulders[i];
      b.t += dt / b.dur;
      const k = Math.min(1, b.t);
      b.m.position.lerpVectors(b.from, b.to, k);
      b.m.position.y += Math.sin(k * Math.PI) * 9;
      b.m.rotation.x += dt * 5;
      b.m.rotation.z += dt * 3;
      b.d.mesh.material.uniforms.uProg.value = k;
      if (k >= 1) {
        const g = this.g;
        const p = b.to;
        b.d.mesh.visible = false;
        g.scene.remove(b.m);
        b.m.geometry.dispose();
        g.combat.vfx.explosion(_v.copy(p).setY(p.y + 0.6), '#cfefff', 3.6, 0.45);
        g.combat.vfx.burst(_v.copy(p).setY(p.y + 0.5), '#e8fbff', 36, { speed: 8, size: 0.3, life: 0.7, up: 1, gravity: 14 });
        this.strike((q) => Math.hypot(q.x - p.x, q.z - p.z) < 3.3 && q.y - p.y < 3, 1700, 10);
        g.cameraCtl.shake(0.35, 0.3);
        g.sfx.bossImpact(0.8);
        this.boulders.splice(i, 1);
      }
    }
  }

  // phase 2: a sweeping cone of freezing breath
  updateBreath(dt) {
    const st = this.st;
    const g = this.g;
    if (!this.atk) {
      this.atk = { d: this.decal('line'), tick: 0 };
      g.sfx.bossCharge();
    }
    const A = this.atk;
    const L = 13;
    A.d.mesh.position.set(this.pos.x, this.home.y + 0.07, this.pos.z);
    A.d.mesh.rotation.y = this.yaw;
    A.d.mesh.scale.set(6.5, 1, L);
    A.d.mesh.material.uniforms.uProg.value = clamp(st / 0.9, 0, 1);
    if (st > 0.9 && st < 2.9) {
      A.d.mesh.material.uniforms.uAlpha.value = 0.35;
      // the stream of frost from the mouth
      const mouth = this.mouth.getWorldPosition(_w);
      for (let i = 0; i < 8; i++) {
        const spread = (Math.random() - 0.5) * 0.6;
        const a = this.yaw + spread;
        const sp = 14 + Math.random() * 6;
        g.combat.vfx.particles.spawn(mouth, _v.set(Math.sin(a) * sp, -4 - Math.random() * 3, Math.cos(a) * sp), g.combat.vfx.color.set(Math.random() < 0.5 ? '#ffffff' : '#bff0ff'), 0.35 + Math.random() * 0.3, 0.7, { drag: 1.6 });
      }
      A.tick -= dt;
      if (A.tick <= 0) {
        A.tick = 0.4;
        this.strike((p) => {
          const rx = p.x - this.pos.x,
            rz = p.z - this.pos.z;
          const along = rx * Math.sin(this.yaw) + rz * Math.cos(this.yaw);
          const across = Math.abs(rx * Math.cos(this.yaw) - rz * Math.sin(this.yaw));
          return along > 0 && along < L && across < 1.2 + along * 0.25 && p.y - this.home.y < 4;
        }, 380, 14);
      }
    }
    if (st > 3.3) this.enter('idle');
  }

  // a full turn with both arms out when you crowd it
  updateSweep(dt, sp) {
    const st = this.st * sp;
    if (!this.atk) {
      const d = this.decal('circle', '#ff7aa0');
      d.mesh.position.set(this.pos.x, this.home.y + 0.06, this.pos.z);
      d.mesh.scale.setScalar(13.5);
      this.atk = { d };
      this.g.sfx.bossCharge();
    }
    this.atk.d.mesh.material.uniforms.uProg.value = clamp(st / 0.75, 0, 1);
    if (st >= 0.8 && !this.hitDone) {
      this.hitDone = true;
      this.atk.d.mesh.visible = false;
      this.strike((p) => Math.hypot(p.x - this.pos.x, p.z - this.pos.z) < 6.6 && p.y - this.home.y < 3.5, 1250);
      this.g.combat.vfx.ring(V3(this.pos.x, this.home.y + 0.3, this.pos.z), '#e8fbff', 6.8, 0.4, { inner: 0.7 });
      this.g.cameraCtl.shake(0.3, 0.3);
      this.g.sfx.swing && this.g.sfx.swing('claymore', 1);
    }
    if (st > 1.6) this.enter('idle');
  }

  updateDead(dt) {
    const k = Math.min(1, this.st / 2.6);
    // topples forward, then crumbles into ice and snow
    this.body.rotation.x = damp(this.body.rotation.x, 0.9, 2, dt);
    this.body.position.y = damp(this.body.position.y, 1.2, 2, dt);
    this.eyeMat.color.setRGB(0.6 * (1 - k), 1.2 * (1 - k), 1.4 * (1 - k));
    if (this.st > 2.0 && this.root.visible) {
      const c = this.center(_v).clone();
      this.g.combat.vfx.explosion(c, '#cfefff', 6, 0.7);
      this.g.combat.vfx.burst(c, '#e8fbff', 90, { speed: 10, size: 0.35, life: 1.2, up: 0.6, gravity: 10 });
      this.root.visible = false;
      this.respawnT = 150;
    }
    if (!this.root.visible) {
      this.respawnT -= dt;
      const P = this.g.player.pos;
      if (this.respawnT <= 0 && Math.hypot(P.x - this.home.x, P.z - this.home.z) > 70) {
        this.body.rotation.x = 0;
        this.reset();
      }
    }
    this.root.position.copy(this.pos);
  }

  // ---------------------------------------------------------------- animation
  animate(dt) {
    const st = this.st;
    const s = this.state;
    const T = { by: 2.6, tx: 0.05, ty: 0, hx: 0, shx: [0.15, 0.15], shz: [0.25, -0.25], elx: [-0.25, -0.25], lg: [0, 0], blend: 6 };
    const breathe = Math.sin(this.t * 1.4) * 0.05;
    T.by += breathe;
    if (s === 'dormant') {
      Object.assign(T, { by: 1.5, tx: 0.75, hx: 0.35, shx: [-0.5, -0.5], shz: [0.15, -0.15], elx: [-0.9, -0.9], lg: [-0.7, -0.7], blend: 3 });
    } else if (s === 'intro') {
      const k = clamp(st / 1.6, 0, 1);
      Object.assign(T, { by: 1.5 + 1.2 * k, tx: 0.75 - 0.95 * k, hx: 0.35 - 0.8 * k, shx: [-0.5 - 1.4 * k, -0.5 - 1.4 * k], shz: [0.15 + 0.9 * k, -0.15 - 0.9 * k], elx: [-0.9 + 0.5 * k, -0.9 + 0.5 * k], lg: [-0.7 + 0.7 * k, -0.7 + 0.7 * k], blend: 4 });
      if (st > 1.8 && !this.roared) {
        this.roared = true;
        this.g.sfx.bossRoar();
        this.g.cameraCtl.shake(0.4, 0.8);
      }
    } else if (s === 'idle' && this.moving) {
      this.walkPh += dt * 3.2;
      const w = Math.sin(this.walkPh);
      T.lg = [w * 0.45, -w * 0.45];
      T.shx = [-w * 0.3 + 0.1, w * 0.3 + 0.1];
      T.by += Math.abs(Math.cos(this.walkPh)) * 0.15 - 0.1;
      T.ty = w * 0.08;
      if (Math.sign(Math.cos(this.walkPh)) !== this.stepSign) {
        this.stepSign = Math.sign(Math.cos(this.walkPh));
        const P = this.g.player.pos;
        if (Math.hypot(P.x - this.pos.x, P.z - this.pos.z) < 30) this.g.cameraCtl.shake(0.06, 0.12);
      }
    } else if (s === 'slam') {
      const sp = this.phase === 2 ? 1.25 : 1;
      const k = st * sp;
      if (k < 1.0) Object.assign(T, { by: 2.8, tx: -0.3, hx: -0.3, shx: [-2.9, -2.9], shz: [0.15, -0.15], elx: [-0.5, -0.5], blend: 5 });
      else if (k < 1.5) Object.assign(T, { by: 1.9, tx: 0.75, hx: 0.2, shx: [-1.2, -1.2], shz: [0.1, -0.1], elx: [-0.1, -0.1], blend: 22 });
    } else if (s === 'spikes') {
      const k = st * (this.phase === 2 ? 1.25 : 1);
      if (k < 0.9) Object.assign(T, { by: 2.8, tx: -0.1, shx: [-0.6, -0.6], shz: [0.9, -0.9], lg: [0, -1.0], blend: 6 });
      else if (k < 1.4) Object.assign(T, { by: 2.2, tx: 0.3, shx: [-0.3, -0.3], shz: [0.7, -0.7], lg: [0, 0.15], blend: 24 });
    } else if (s === 'boulder') {
      const k = st * (this.phase === 2 ? 1.25 : 1);
      const ph = k % 0.7;
      if (k < 1.0 || (this.phase === 2 && k > 1.2 && k < 1.7)) Object.assign(T, { ty: 0.5, tx: -0.15, shx: [-0.3, -2.7], shz: [0.4, -0.2], elx: [-0.4, -0.6], blend: 6 });
      else Object.assign(T, { ty: -0.45, tx: 0.3, shx: [-0.2, -1.1], shz: [0.4, -0.1], elx: [-0.4, 0], blend: 18 });
      void ph;
    } else if (s === 'breath') {
      if (st < 0.9) Object.assign(T, { tx: -0.25, hx: -0.55, shx: [-0.4, -0.4], shz: [0.6, -0.6], blend: 5 });
      else Object.assign(T, { tx: 0.2, hx: 0.3, ty: Math.sin((st - 0.9) * 2.4) * 0.25, shx: [-0.2, -0.2], shz: [0.5, -0.5], blend: 6 });
    } else if (s === 'sweep') {
      const k = st * (this.phase === 2 ? 1.25 : 1);
      if (k < 0.75) Object.assign(T, { ty: 1.1, shx: [-1.3, -1.3], shz: [1.3, -1.3], elx: [0, 0], blend: 7 });
      else if (k < 1.2) Object.assign(T, { ty: -2.6, shx: [-1.4, -1.4], shz: [1.4, -1.4], elx: [0, 0], blend: 14 });
    } else if (s === 'armor') {
      Object.assign(T, { by: 2.9, tx: -0.35, hx: -0.6, shx: [-2.2, -2.2], shz: [1.0, -1.0], elx: [-0.6, -0.6], blend: 5 });
    } else if (s === 'stunned') {
      Object.assign(T, { by: 1.4, tx: 0.85, hx: 0.5, shx: [-0.8, -0.8], shz: [0.2, -0.2], elx: [-0.4, -0.4], lg: [-1.0, -0.4], blend: 4 });
    }
    const b = T.blend;
    this.body.position.y = damp(this.body.position.y, T.by, b, dt);
    this.torso.rotation.x = damp(this.torso.rotation.x, T.tx, b, dt);
    this.torso.rotation.y = damp(this.torso.rotation.y, T.ty, b, dt);
    this.head.rotation.x = damp(this.head.rotation.x, T.hx, b, dt);
    this.arms.forEach((A, i) => {
      A.sh.rotation.x = damp(A.sh.rotation.x, T.shx[i], b, dt);
      A.sh.rotation.z = damp(A.sh.rotation.z, T.shz[i], b, dt);
      A.el.rotation.x = damp(A.el.rotation.x, T.elx[i], b, dt);
    });
    this.legs.forEach((L, i) => (L.hip.rotation.x = damp(L.hip.rotation.x, T.lg[i], b, dt)));
    // eyes and heart glow brighter when awake and angry
    const glowK = s === 'dormant' ? 0.25 : s === 'stunned' ? 0.4 : this.phase === 2 ? 1.4 : 1;
    this.eyeMat.color.setRGB(0.55 * glowK * 2.2, 0.9 * glowK * 2.2, 1.0 * glowK * 2.4);
    this.heart.rotation.y += dt * 1.5;
    this.heart.scale.setScalar(1 + Math.sin(this.t * 3) * 0.08 * glowK);
    if (this.shield > 0) for (const a of this.armor) a.m.material.uniforms.uFlash.value = this.shieldHit > 0 ? 0.5 : 0;
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
  }
}
