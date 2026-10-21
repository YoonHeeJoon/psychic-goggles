import * as THREE from 'three';
import { damp } from '../core/noise.js';
import { toonMaterial } from '../render/materials.js';

// A small sailing boat moored by the harbour pier. Board it with F, steer
// with WASD (Shift for a gust in the sail), and step off with F next to any
// shore or jetty. Left far behind, it drifts back to its mooring.

const V3 = THREE.Vector3;
const MAX = 8.5;
const BOOST = 13;

const el = (tag, cls, html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

export class Boat {
  constructor(game) {
    this.g = game;
    const S = game.structures;
    this.bt = S.port.boats[0];
    this.grp = this.bt.grp;
    this.home = { x: this.grp.position.x, z: this.grp.position.z, yaw: this.grp.rotation.y };
    this.yaw = this.home.yaw;
    this.speed = 0;
    this.heel = 0;
    this.wakeT = 0;
    this.dist = 0;
    this.proxy = { pos: new V3(), height: 1.5, state: 'boat' };
    this.buildSail();
    this.hint = el('div', 'boat-hint hidden', `<span><kbd>W</kbd><kbd>S</kbd> 속도 · <kbd>A</kbd><kbd>D</kbd> 방향 · <kbd>Shift</kbd> 순풍</span><span class="bh-land"><kbd>F</kbd> 내리기</span><b class="bh-speed"></b>`);
    game.container.appendChild(this.hint);
  }

  // a lateen sail that unfurls from the mast while sailing
  buildSail() {
    // measure the hull in its own frame
    const g = this.grp;
    const keep = { p: g.position.clone(), r: g.rotation.clone() };
    g.position.set(0, 0, 0);
    g.rotation.set(0, 0, 0);
    g.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g);
    g.position.copy(keep.p);
    g.rotation.copy(keep.r);
    g.updateMatrixWorld(true);
    const len = Math.max(4.5, box.max.z - box.min.z);
    this.mast = { z: len * 0.12, y0: 0.95, y1: 3.25, boom: Math.min(2.6, len * 0.42) };
    const NU = 8,
      NV = 8;
    const geo = new THREE.PlaneGeometry(1, 1, NU, NV);
    this.sailGeo = geo;
    this.sailK = 0;
    const mat = toonMaterial({ color: '#f4ecd8', color2: '#e8d6b8', side: THREE.DoubleSide, rim: 0.3 });
    this.sail = new THREE.Mesh(geo, mat);
    this.sail.castShadow = true;
    this.sail.visible = false;
    this.grp.add(this.sail);
    // a coloured band along the foot
    this.billow = 0;
    this.layoutSail(0, 0);
  }

  layoutSail(k, billow) {
    const p = this.sailGeo.attributes.position;
    const m = this.mast;
    const t = performance.now() / 1000;
    for (let i = 0; i < p.count; i++) {
      // plane uv from the original grid layout
      const ix = i % 9,
        iy = Math.floor(i / 9);
      const u = ix / 8,
        v = 1 - iy / 8;
      // furl: the sail gathers up the mast as k -> 0
      const vv = v * k + (1 - k) * (0.85 + v * 0.15);
      const along = u * (1 - vv * 0.92) * m.boom * k;
      const y = m.y0 + vv * (m.y1 - m.y0);
      const side = billow * Math.sin(Math.PI * Math.min(1, u * 1.1)) * Math.sin(Math.PI * Math.min(1, v * 0.9 + 0.1)) + Math.sin(t * 6 + u * 5 + v * 3) * 0.03 * k * (1 - billow);
      p.setXYZ(i, side, y, m.z - 0.08 - along);
    }
    p.needsUpdate = true;
    this.sailGeo.computeVertexNormals();
  }

  get pos() {
    return this.grp.position;
  }

  consider(P, consider) {
    if (this.g.state !== 'playing') return;
    consider(new V3(this.pos.x, P.y, this.pos.z), 3.6, '배 타기', () => this.board());
  }

  // ---------------------------------------------------------------- state
  board() {
    const g = this.g;
    if (g.state !== 'playing') return;
    if (g.combat.action) g.combat.endAction();
    g.state = 'boat';
    this.speed = 0;
    this.yaw = this.grp.rotation.y;
    g.player.model.weapon.visible = false;
    this.prevDist = g.cameraCtl.distTarget;
    g.cameraCtl.distTarget = Math.max(this.prevDist, 8.5);
    g.cameraCtl.initialized = false;
    g.hud.setPrompt('');
    g.explore.promptText = '';
    this.hint.classList.remove('hidden');
    g.hud.layer.classList.add('boating');
    g.sfx.splash();
    g.water.puff(this.pos.x, this.pos.z, 0.8);
  }

  // first free landing spot beside or ahead of the boat
  landingSpot() {
    const g = this.g;
    const G = g.ground;
    const fw = new V3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const right = new V3(fw.z, 0, -fw.x);
    const prev = G.probeY;
    G.probeY = Infinity;
    let best = null;
    const tries = [];
    for (const r of [2.2, 3.2, 4.4]) {
      tries.push(right.clone().multiplyScalar(r), right.clone().multiplyScalar(-r), fw.clone().multiplyScalar(r + 1.5));
    }
    for (const o of tries) {
      const x = this.pos.x + o.x,
        z = this.pos.z + o.z;
      const h = G.heightAt(x, z);
      if (h > 0.35 && h < 4.6) {
        // flat enough to stand on
        const n = Math.abs(G.heightAt(x + 0.6, z) - h) + Math.abs(G.heightAt(x, z + 0.6) - h);
        if (n < 0.9) {
          best = new V3(x, h, z);
          break;
        }
      }
    }
    G.probeY = prev;
    return best;
  }

  leave() {
    const g = this.g;
    const spot = this.landingSpot();
    if (!spot) {
      g.hud.flashCenter('해안이나 부두 가까이에서 내릴 수 있습니다');
      return;
    }
    const P = g.player;
    P.pos.copy(spot);
    P.vel.set(0, 0, 0);
    P.state = 'ground';
    P.yaw = Math.atan2(spot.x - this.pos.x, spot.z - this.pos.z);
    P.lastSafe.copy(P.pos);
    P.fallStartY = P.pos.y;
    this.speed = 0;
    g.cameraCtl.distTarget = this.prevDist || g.cameraCtl.distTarget;
    g.cameraCtl.initialized = false;
    this.hint.classList.add('hidden');
    g.hud.layer.classList.remove('boating');
    g.state = 'playing';
    g.clock.getDelta();
    g.sfx.land(4, 'wood');
    if (this.dist > 1 && g.achievements) g.achievements.add('sail', Math.round(this.dist));
    this.dist = 0;
    g.explore.save();
  }

  // is the water at (x, z) too shallow, or is something built there?
  blocked(x, z) {
    const g = this.g;
    if (g.terrain.heightAt(x, z) > -0.55) return true;
    const G = g.ground;
    const prev = G.probeY;
    G.probeY = Infinity;
    const s = G.solidAt(x, z);
    G.probeY = prev;
    return s > -0.2;
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    const g = this.g;
    const I = g.input;
    if (I.hit('KeyF')) return this.leave();
    const P = g.player;
    // WASD, arrows, touch stick and gamepad all feed the move vector
    const mv = I.moveVector();
    const boost = (I.down('ShiftLeft') || I.down('ShiftRight')) && !P.exhausted && P.stamina > 0 && this.speed > 1;
    if (boost) P.useStamina(10 * dt);
    else P.stamina = Math.min(P.maxStamina, P.stamina + 18 * dt);
    if (P.exhausted && P.stamina > 25) P.exhausted = false;
    let target = 0;
    if (mv.y > 0.2) target = (boost ? BOOST : MAX) * Math.min(1, mv.y * 1.2);
    else if (mv.y < -0.2) target = -2.2;
    this.speed = damp(this.speed, target, target === 0 ? 0.6 : 1.1, dt);
    const turn = Math.abs(mv.x) > 0.15 ? -mv.x : 0;
    const rate = (0.35 + Math.min(1, Math.abs(this.speed) / 5) * 0.75) * Math.sign(this.speed || 1);
    this.yaw += turn * rate * dt;
    // move, sliding back off shallows and jetties
    const fw = new V3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const step = this.speed * dt;
    const nx = this.pos.x + fw.x * step,
      nz = this.pos.z + fw.z * step;
    const bow = Math.sign(this.speed || 1) * 2.8;
    if (!this.blocked(nx + fw.x * bow, nz + fw.z * bow) && !this.blocked(nx, nz)) {
      this.pos.x = nx;
      this.pos.z = nz;
      this.dist += Math.abs(step);
    } else if (Math.abs(this.speed) > 0.5) {
      if (Math.abs(this.speed) > 3) {
        g.cameraCtl.shake(0.12, 0.2);
        g.sfx.land(5, 'wood');
        g.water.puff(nx + fw.x * bow, nz + fw.z * bow, 1);
      }
      this.speed *= -0.25;
    }
    this.grp.rotation.y = this.yaw;
    // the hull heels into the turn and pitches with speed
    this.heel = damp(this.heel, -turn * Math.min(1, Math.abs(this.speed) / 6) * 0.14, 3, dt);
    this.grp.rotation.z += this.heel;
    this.grp.rotation.x -= Math.min(0.05, Math.abs(this.speed) * 0.004);
    // wake
    this.wakeT -= dt;
    if (this.wakeT <= 0 && Math.abs(this.speed) > 0.8) {
      this.wakeT = 0.07;
      const k = Math.min(1, Math.abs(this.speed) / 9);
      g.water.puff(this.pos.x - fw.x * 2.4, this.pos.z - fw.z * 2.4, 0.4 + k * 0.6);
      if (this.speed > 4) {
        const right = new V3(fw.z, 0, -fw.x);
        for (const s of [-1, 1]) g.water.puff(this.pos.x + fw.x * 2 + right.x * s * 0.9, this.pos.z + fw.z * 2 + right.z * s * 0.9, 0.35 * k);
      }
    }
    if (boost && Math.random() < dt * 10) g.combat.vfx.burst(new V3(this.pos.x, 1.6, this.pos.z), '#e8fbff', 2, { speed: 2, size: 0.1, life: 0.5, gravity: -0.5, up: 0.3 });

    // sail fills with the wind as the boat picks up speed
    const want = Math.abs(this.speed) > 0.3 || target > 0 ? 1 : 0.15;
    this.sailK = damp(this.sailK, want, 2.5, dt);
    this.billow = damp(this.billow, Math.min(0.55, Math.abs(this.speed) * 0.05 + (boost ? 0.15 : 0)) * Math.sign(-turn || 1), 3, dt);
    this.sail.visible = this.sailK > 0.03;
    if (this.sail.visible) this.layoutSail(this.sailK, this.billow);
    // the traveller sits at the stern, hand on the tiller
    this.seat(dt, turn);
    this.proxy.pos.copy(P.pos);
    g.cameraCtl.update(dt, I, this.proxy);
    P.vel.set(fw.x * this.speed, 0, fw.z * this.speed);
    const land = this.landingSpot();
    this.hint.querySelector('.bh-land').classList.toggle('on', !!land);
    this.hint.querySelector('.bh-speed').textContent = `${Math.round(Math.abs(this.speed) * 3.6)} km/h`;
  }

  seat(dt, turn) {
    const g = this.g;
    const P = g.player;
    const grp = this.grp;
    grp.updateMatrixWorld(true);
    const seatL = new V3(0, 0.42, -1.75);
    P.pos.copy(seatL.applyMatrix4(grp.matrixWorld));
    P.yaw = this.yaw;
    const m = P.model;
    m.root.position.copy(P.pos);
    m.root.rotation.y = this.yaw;
    m.update(dt, {
      mode: 'idle',
      speed: 0,
      lean: this.heel * 2,
      override: (Pose) => {
        Pose.thighL.set(-1.45, 0, 0.12);
        Pose.thighR.set(-1.45, 0, -0.12);
        Pose.shinL.set(1.5, 0, 0);
        Pose.shinR.set(1.5, 0, 0);
        Pose.uArmR.set(0.25, 0, -0.35 - turn * 0.2);
        Pose.fArmR.set(-0.6, 0, 0);
        Pose.uArmL.set(-0.5, 0, 0.3);
        Pose.fArmL.set(-0.8, 0, 0);
        Pose.spine.x = 0.06;
        return { blend: 10, hipsY: -0.48 };
      },
    });
  }

  // called every frame in any state: the boat finds its way home when left
  idle(dt) {
    if (this.g.state === 'boat') return;
    if (this.sail.visible) {
      this.sailK = damp(this.sailK, 0, 2, dt);
      this.sail.visible = this.sailK > 0.03;
      this.layoutSail(this.sailK, 0);
    }
    const P = this.g.player.pos;
    const away = Math.hypot(P.x - this.pos.x, P.z - this.pos.z) > 160 && Math.hypot(P.x - this.home.x, P.z - this.home.z) > 160;
    if (away && (this.pos.x !== this.home.x || this.pos.z !== this.home.z)) {
      this.pos.x = this.home.x;
      this.pos.z = this.home.z;
      this.yaw = this.home.yaw;
      this.grp.rotation.y = this.yaw;
    }
  }
}
