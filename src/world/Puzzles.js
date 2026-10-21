import * as THREE from 'three';
import { LANDMARKS } from './Terrain.js';
import { toonMaterial, outlineMaterial } from '../render/materials.js';

// Small environmental puzzles that guard reward chests:
//  - four cold braziers on the forest ruins: light them all with fire
//    (water puts them out again) before they burn down
//  - three wind pinwheels on the meadow path: set them all spinning with wind
//  - a timed gliding trial through the updraft near the meadow

const TAU = Math.PI * 2;
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

const addMesh = (parent, geo, mat, outline = '#2a2230') => {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  if (outline) {
    const o = new THREE.Mesh(geo, outlineMaterial(outline, 1.1));
    m.add(o);
  }
  parent.add(m);
  return m;
};

const glowMat = (c, o = 0.9) =>
  new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(2), transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false });

export class Puzzles {
  // keep trees and plants off the puzzle sites (call before vegetation)
  static reserve(terrain) {
    terrain.addBlocker(-110, 100, 8.5);
    terrain.addBlocker(0, 92, 3);
    terrain.addBlocker(73, 121.3, 3);
  }

  constructor(game) {
    this.g = game;
    const prog = game.explore.progress;
    this.solved = prog.puzzles || (prog.puzzles = {});
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.list = [];
    this.stone = toonMaterial({ color: '#bdb6a2', rim: 0.2, shadowTint: '#a9a0b8' });
    this.dark = toonMaterial({ color: '#4a4440', rim: 0.2 });
    this.gold = toonMaterial({ color: '#d9b45a', spec: 0.8, rim: 0.4 });
    this.buildTorches();
    this.buildPinwheels();
    this.buildTrial();
    this.hinted = {};
  }

  ground(x, z) {
    return this.g.ground.heightAt(x, z);
  }

  // ------------------------------------------------------------- braziers
  buildTorches() {
    const S = this.g.structures;
    const R = LANDMARKS.ruins;
    const rot = S.ruins.rot;
    const local = (lx, lz) => V3(R.x + lx * Math.cos(rot) + lz * Math.sin(rot), 0, R.z - lx * Math.sin(rot) + lz * Math.cos(rot));
    const p = { id: 'pz-torch', kind: 'torch', name: '꺼진 화로', hint: '꺼진 화로 4개에 모두 불을 붙여 보세요 · 불 원소 (렌의 원소 스킬·폭발)', items: [] };
    for (const [lx, lz] of [
      [-5.9, -5.9],
      [5.9, -5.9],
      [-5.9, 5.6],
      [5.9, 5.6],
    ]) {
      const pos = local(lx, lz);
      pos.y = this.ground(pos.x, pos.z);
      const grp = new THREE.Group();
      grp.position.copy(pos);
      addMesh(grp, new THREE.CylinderGeometry(0.32, 0.45, 0.9, 8).translate(0, 0.45, 0), this.stone);
      addMesh(grp, new THREE.CylinderGeometry(0.62, 0.3, 0.42, 10, 1, true).translate(0, 1.1, 0), this.dark);
      addMesh(grp, new THREE.TorusGeometry(0.62, 0.06, 6, 20).rotateX(Math.PI / 2).translate(0, 1.31, 0), this.gold, null);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.95, 8), glowMat('#ff9a3a'));
      flame.position.y = 1.65;
      const inner = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.6, 8), glowMat('#fff0a0'));
      inner.position.y = 1.5;
      flame.visible = inner.visible = false;
      grp.add(flame, inner);
      this.group.add(grp);
      this.g.structures.solids.addCircle(pos.x, pos.z, 0.55, pos.y + 1.3);
      p.items.push({ pos, grp, flame, inner, lit: 0 });
    }
    const cp = local(4.4, -4.6);
    p.chestPos = V3(cp.x, this.ground(cp.x, cp.z), cp.z);
    p.tier = 1;
    p.center = local(0, 0);
    this.list.push(p);
    if (this.solved[p.id]) for (const it of p.items) it.lit = 1e9;
  }

  // ------------------------------------------------------------ pinwheels
  buildPinwheels() {
    const c = V3(-110, 0, 100);
    const p = { id: 'pz-wind', kind: 'wind', name: '멈춘 바람개비', hint: '바람개비 3개를 동시에 돌려 보세요 · 바람 원소 (아리아의 원소 스킬·폭발)', items: [] };
    const white = toonMaterial({ color: '#f6f2e8', rim: 0.3 });
    const teal = toonMaterial({ color: '#4fc7b0', rim: 0.3 });
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * TAU + 0.4;
      const pos = V3(c.x + Math.cos(a) * 5.5, 0, c.z + Math.sin(a) * 5.5);
      pos.y = this.ground(pos.x, pos.z);
      const grp = new THREE.Group();
      grp.position.copy(pos);
      grp.rotation.y = Math.atan2(c.x - pos.x, c.z - pos.z) + Math.PI;
      addMesh(grp, new THREE.CylinderGeometry(0.08, 0.1, 3.2, 6).translate(0, 1.6, 0), this.stone);
      addMesh(grp, new THREE.CylinderGeometry(0.4, 0.5, 0.25, 8).translate(0, 0.12, 0), this.stone);
      const rotor = new THREE.Group();
      rotor.position.set(0, 3.15, 0.16);
      for (let b = 0; b < 4; b++) {
        const blade = new THREE.Group();
        blade.rotation.z = (b / 4) * TAU;
        const sail = addMesh(blade, new THREE.BoxGeometry(0.42, 1.15, 0.03).translate(0.21, 0.62, 0), b % 2 ? white : teal);
        sail.rotation.y = 0.35;
        rotor.add(blade);
      }
      addMesh(rotor, new THREE.SphereGeometry(0.13, 10, 8), this.gold, null);
      grp.add(rotor);
      this.group.add(grp);
      this.g.structures.solids.addCircle(pos.x, pos.z, 0.45, pos.y + 0.25);
      p.items.push({ pos, grp, rotor, spin: 0, speed: 0 });
    }
    p.chestPos = V3(c.x, this.ground(c.x, c.z), c.z);
    p.tier = 1;
    p.center = c;
    this.g.terrain.addBlocker(c.x, c.z, 8);
    this.list.push(p);
    if (this.solved[p.id]) for (const it of p.items) it.spin = 1e9;
  }

  // ------------------------------------------------------- timed glide trial
  buildTrial() {
    const u = { x: -6, z: 96, h: 36 };
    const base = this.ground(u.x, u.z);
    const top = base + u.h;
    const p = { id: 'pz-trial', kind: 'trial', name: '바람길 도전', hint: '도전 시작 비석을 조사하면 시간 제한 도전이 시작됩니다', items: [], time: 50 };
    const start = V3(u.x + 6, 0, u.z - 4);
    start.y = this.ground(start.x, start.z);
    p.start = start;
    // the waystone that starts the trial
    const grp = new THREE.Group();
    grp.position.copy(start);
    addMesh(grp, new THREE.CylinderGeometry(0.35, 0.55, 1.6, 6).translate(0, 0.8, 0), this.stone);
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), glowMat('#ffd56a'));
    gem.position.y = 2.0;
    grp.add(gem);
    this.group.add(grp);
    p.gem = gem;
    this.g.structures.solids.addCircle(start.x, start.z, 0.55, start.y + 1.6);
    // motes: up the updraft, then a gliding line to the east
    const pts = [];
    for (const h of [10, 20, 30]) pts.push(V3(u.x, base + h, u.z));
    const dir = V3(1, 0, 0.32).normalize();
    let y = top - 2;
    let x = u.x,
      z = u.z;
    for (let k = 0; k < 5; k++) {
      x += dir.x * 15;
      z += dir.z * 15;
      y -= 3.2;
      y = Math.max(y, this.ground(x, z) + 3.5);
      pts.push(V3(x, y, z));
    }
    const mote = new THREE.SphereGeometry(0.42, 16, 12);
    for (const q of pts) {
      const m = new THREE.Mesh(mote, glowMat('#ffd56a', 0.95));
      m.position.copy(q);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.05, 6, 32), glowMat('#fff2c0', 0.8));
      m.add(ring);
      m.visible = false;
      this.group.add(m);
      p.items.push({ pos: q, mesh: m, ring, got: false });
    }
    const end = pts[pts.length - 1];
    const ex = end.x + dir.x * 8,
      ez = end.z + dir.z * 8;
    p.chestPos = V3(ex, this.ground(ex, ez), ez);
    p.tier = 2;
    p.center = start;
    p.active = false;
    this.list.push(p);
  }

  // ------------------------------------------------------- element events
  onElement(x, z, r, el) {
    if (!el || el === 'phys') return;
    for (const p of this.list) {
      if (this.solved[p.id]) continue;
      if (Math.abs(p.center.x - x) > 30 || Math.abs(p.center.z - z) > 30) continue;
      for (const it of p.items) {
        const d = Math.hypot(it.pos.x - x, it.pos.z - z);
        if (d > r + 1.1) continue;
        if (p.kind === 'torch') {
          if (el === 'fire' && it.lit <= 0) {
            it.lit = 25;
            this.g.combat.vfx.burst(_v.copy(it.pos).setY(it.pos.y + 1.4), '#ffb35a', 18, { speed: 3, size: 0.2, life: 0.6, up: 1.5 });
            this.g.sfx.torch();
          } else if (el === 'water' && it.lit > 0) {
            it.lit = 0;
            this.g.combat.vfx.burst(_v.copy(it.pos).setY(it.pos.y + 1.4), '#cfe8ff', 14, { speed: 2, size: 0.3, life: 0.8, up: 1.2 });
          }
        } else if (p.kind === 'wind' && el === 'wind') {
          if (it.spin <= 0) this.g.sfx.updraft();
          it.spin = 15;
        }
      }
      this.check(p);
    }
  }

  check(p) {
    if (this.solved[p.id]) return;
    let ok = false;
    if (p.kind === 'torch') ok = p.items.every((it) => it.lit > 0);
    else if (p.kind === 'wind') ok = p.items.every((it) => it.spin > 0);
    else if (p.kind === 'trial') ok = p.items.every((it) => it.got);
    if (ok) this.solve(p);
  }

  solve(p) {
    const g = this.g;
    this.solved[p.id] = true;
    if (p.kind === 'torch') for (const it of p.items) it.lit = 1e9;
    if (p.kind === 'wind') for (const it of p.items) it.spin = 1e9;
    if (p.kind === 'trial') {
      p.active = false;
      g.hud.setTimer(null);
    }
    g.hud.flashCenter(p.kind === 'trial' ? '도전 성공!' : '봉인이 풀렸다!', 2000);
    g.sfx.questStep();
    setTimeout(() => g.explore.spawnChest(p.id, p.chestPos, p.tier), 700);
    g.explore.save();
  }

  // trial start interaction
  consider(P, consider) {
    for (const p of this.list) {
      if (p.kind !== 'trial' || this.solved[p.id] || p.active) continue;
      consider(p.start, 2.6, '도전 시작 · 바람길', () => this.startTrial(p));
    }
  }

  startTrial(p) {
    p.active = true;
    p.t = p.time;
    for (const it of p.items) {
      it.got = false;
      it.mesh.visible = true;
    }
    this.g.hud.flashCenter('도전 시작 · 상승 기류를 타고 빛 구슬을 모두 모으세요', 2400);
    this.g.sfx.questStep();
  }

  failTrial(p) {
    p.active = false;
    for (const it of p.items) it.mesh.visible = false;
    this.g.hud.setTimer(null);
    this.g.hud.flashCenter('도전 실패', 1600);
  }

  update(dt) {
    const g = this.g;
    const P = g.player.pos;
    this.t = (this.t || 0) + dt;
    for (const p of this.list) {
      const near = Math.hypot(P.x - p.center.x, P.z - p.center.z);
      if (!this.solved[p.id] && near < 14 && !this.hinted[p.id] && g.state === 'playing') {
        this.hinted[p.id] = true;
        g.hud.toast(`<b>${p.name}</b> · ${p.hint}`, '#ffd56a');
      }
      if (p.kind === 'torch') {
        for (const it of p.items) {
          if (it.lit > 0 && it.lit < 1e8) it.lit -= dt;
          const on = it.lit > 0;
          it.flame.visible = it.inner.visible = on;
          if (on) {
            const f = 1 + Math.sin(this.t * 14 + it.pos.x) * 0.1;
            it.flame.scale.set(f, 1 + Math.sin(this.t * 11 + it.pos.z) * 0.15, f);
            // dying flames shrink in the last seconds
            if (it.lit < 5) it.flame.scale.multiplyScalar(0.5 + it.lit / 10);
            if (near < 60 && Math.random() < dt * 6) g.combat.vfx.particles.spawn(_v.copy(it.pos).setY(it.pos.y + 1.7), _w.set(0, 1.4, 0), g.combat.vfx.color.set('#ffb35a'), 0.12, 0.8, { drag: 1 });
          }
        }
      } else if (p.kind === 'wind') {
        for (const it of p.items) {
          if (it.spin > 0 && it.spin < 1e8) it.spin -= dt;
          const target = it.spin > 0 ? 9 : 0.3 + Math.sin(this.t * 0.7) * 0.2;
          it.speed += (target - it.speed) * Math.min(1, dt * 1.5);
          it.rotor.rotation.z += it.speed * dt;
        }
      } else if (p.kind === 'trial') {
        p.gem.visible = !this.solved[p.id] && !p.active;
        p.gem.rotation.y += dt;
        p.gem.position.y = 2.0 + Math.sin(this.t * 2) * 0.1;
        if (!p.active) continue;
        p.t -= dt;
        const got = p.items.filter((it) => it.got).length;
        g.hud.setTimer(`${p.name} · ${Math.ceil(p.t)}초 · ${got}/${p.items.length}`);
        for (const it of p.items) {
          if (it.got) continue;
          it.ring.rotation.x = this.t * 1.5;
          it.ring.rotation.y = this.t;
          if (it.pos.distanceTo(P) < 2.0) {
            it.got = true;
            it.mesh.visible = false;
            g.combat.vfx.burst(it.pos.clone(), '#ffe8a0', 16, { speed: 4, size: 0.2, life: 0.5, gravity: 0 });
            g.sfx.gem();
          }
        }
        this.check(p);
        if (p.active && p.t <= 0) this.failTrial(p);
      }
    }
  }

  minimapMarkers(P, out) {
    for (const p of this.list) {
      if (this.solved[p.id]) continue;
      if (Math.abs(p.center.x - P.x) < 90 && Math.abs(p.center.z - P.z) < 90) out.push({ x: p.center.x, z: p.center.z, color: '#ffd56a', r: 4 });
      if (p.active) for (const it of p.items) if (!it.got) out.push({ x: it.pos.x, z: it.pos.z, color: '#fff2c0', r: 2.5 });
    }
  }
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
