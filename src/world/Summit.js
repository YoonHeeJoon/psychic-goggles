import * as THREE from 'three';
import { Builder, M, cyl } from './Structures.js';
import { LANDMARKS } from './Terrain.js';
import { toonMaterial } from '../render/materials.js';

// The frozen summit: three wind-fire braziers on the way up the mountain
// (light them with fire for warmth against the biting cold — one sits on a
// tall rock spire), and the ice-ringed ledge east of the peak where the frost
// giant sleeps.

const TAU = Math.PI * 2;
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const BRAZIERS = [
  { x: 100, z: -220 },
  { x: 92, z: -238, spire: 7.5 },
  { x: 70, z: -278 },
];
const WARM_R = 7.5;

const glow = (c, o = 0.95) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(2.2), transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false });

export class Summit {
  static reserve(terrain) {
    const S = LANDMARKS.summit;
    terrain.addBlocker(S.x, S.z, S.r + 8);
    for (const b of BRAZIERS) terrain.addBlocker(b.x, b.z, 4);
  }

  constructor(game) {
    this.g = game;
    const prog = game.explore.progress;
    this.d = prog.summit || (prog.summit = { lit: [false, false, false] });
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.solids = game.structures.solids;
    this.stone = toonMaterial({ color: '#a9b2bc', color2: '#7d8794', rim: 0.25, shadowTint: '#8a8fb8' });
    this.dark = toonMaterial({ color: '#3a3f4a', rim: 0.2 });
    this.gold = toonMaterial({ color: '#d9b45a', spec: 0.8, rim: 0.4 });
    this.t = 0;
    this.buildArena();
    this.braziers = BRAZIERS.map((b, i) => this.buildBrazier(b, i));
  }

  // ---------------------------------------------------------------- arena
  buildArena() {
    const g = this.g;
    const S = LANDMARKS.summit;
    const top = g.terrain.heightAt(S.x, S.z) + 0.25;
    const R = S.r - 1.5;
    const b = new Builder();
    b.add('stone', cyl(R, R + 0.4, 0.8, 64), { m: M(S.x, top - 0.8, S.z), color: '#cfd6de', uvScale: 0.35 });
    for (const r of [5, 11, 16.5]) {
      const tg = new THREE.TorusGeometry(r, 0.08, 4, 96);
      tg.rotateX(Math.PI / 2);
      b.add('gold', tg, { m: M(S.x, top + 0.02, S.z), color: '#9fc8e8' });
    }
    // snow drifts on the floor
    let seed = 99;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 40; k++) {
      const a = rand() * TAU,
        r = 4 + Math.sqrt(rand()) * (R - 5);
      const s = 1.4 + rand() * 2.2;
      b.add('plain', new THREE.SphereGeometry(1, 10, 6, 0, TAU, 0, Math.PI / 2), { m: M(S.x + Math.cos(a) * r, top - 0.05, S.z + Math.sin(a) * r, 0, rand() * TAU, 0, s, 0.18 + rand() * 0.15, s * (0.6 + rand() * 0.5)), color: '#f4f8ff' });
    }
    b.build(g.structures.mats, this.group);
    this.solids.addCircle(S.x, S.z, R + 0.3, top);
    // a ring of leaning ice crystals
    const ice = toonMaterial({ color: '#dff6ff', color2: '#6fb4e0', rim: 0.8, spec: 1 });
    this.crystals = [];
    const gate = Math.atan2(BRAZIERS[2].z - S.z, BRAZIERS[2].x - S.x);
    for (let k = 0; k < 11; k++) {
      const a = (k / 11) * TAU + 0.2;
      // leave the way in from the last brazier open
      if (Math.abs(Math.atan2(Math.sin(a - gate), Math.cos(a - gate))) < 0.4) continue;
      const x = S.x + Math.cos(a) * (R + 2.2),
        z = S.z + Math.sin(a) * (R + 2.2);
      const gy = g.terrain.heightAt(x, z) - 0.5;
      const h = 4 + rand() * 4;
      const grp = new THREE.Group();
      grp.position.set(x, gy, z);
      for (let c = 0; c < 3; c++) {
        const m = new THREE.Mesh(new THREE.ConeGeometry(0.5 + rand() * 0.5, h * (c ? 0.55 + rand() * 0.3 : 1), 6), ice);
        m.position.set((c - 1) * 0.7, (h * (c ? 0.55 : 1)) / 2, (rand() - 0.5) * 0.8);
        m.rotation.set((rand() - 0.5) * 0.4, rand(), (c - 1) * 0.3 + (rand() - 0.5) * 0.2);
        m.castShadow = true;
        grp.add(m);
      }
      this.group.add(grp);
      this.solids.addCircle(x, z, 1.2, gy + h);
      this.crystals.push(grp);
    }
    this.arena = { center: V3(S.x, top, S.z), r: R, top };
  }

  // ---------------------------------------------------------------- braziers
  buildBrazier(def, i) {
    const g = this.g;
    let y = g.terrain.heightAt(def.x, def.z);
    if (def.spire) {
      // a tall stack of weathered rock with the brazier on top
      const b = new Builder();
      let h = 0;
      let seed = 7 + i;
      const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const base = y - 1;
      while (h < def.spire) {
        const s = 1.6 - h * 0.05 + rand() * 0.3;
        const geo = new THREE.DodecahedronGeometry(s, 0);
        geo.scale(1, 0.75, 1);
        b.add('stone', geo, { m: M(def.x + (rand() - 0.5) * 0.5, base + h + s * 0.6, def.z + (rand() - 0.5) * 0.5, rand(), rand(), rand()), color: '#8f98a4', uvScale: 0.6 });
        h += s * 1.1;
      }
      b.build(g.structures.mats, this.group);
      y = base + def.spire;
      this.solids.addCircle(def.x, def.z, 1.45, y);
    }
    const grp = new THREE.Group();
    grp.position.set(def.x, y, def.z);
    const add = (geo, mat) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      grp.add(m);
      return m;
    };
    add(new THREE.CylinderGeometry(0.42, 0.62, 1.0, 8).translate(0, 0.5, 0), this.stone);
    add(new THREE.CylinderGeometry(0.85, 0.42, 0.5, 10, 1, true).translate(0, 1.25, 0), this.dark);
    add(new THREE.TorusGeometry(0.85, 0.08, 6, 24).rotateX(Math.PI / 2).translate(0, 1.5, 0), this.gold);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU + 0.4;
      add(new THREE.ConeGeometry(0.1, 0.5, 4).translate(Math.cos(a) * 0.8, 1.75, Math.sin(a) * 0.8), this.gold);
    }
    // frost on the cold bowl, flames once lit
    const frost = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.12, 10), new THREE.MeshBasicMaterial({ color: '#dff4ff' }));
    frost.position.y = 1.42;
    grp.add(frost);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.4, 10), glow('#ff8a2a'));
    flame.position.y = 2.1;
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.85, 8), glow('#fff0a0'));
    inner.position.y = 1.9;
    const halo = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), glow('#ffb060', 0.12));
    halo.position.y = 2;
    halo.scale.setScalar(2.4);
    grp.add(flame, inner, halo);
    this.group.add(grp);
    if (!def.spire) this.solids.addCircle(def.x, def.z, 0.7, y + 1.5);
    const it = { ...def, i, pos: V3(def.x, y, def.z), grp, flame, inner, halo, frost, lit: !!this.d.lit[i], pop: 0 };
    this.setLit(it, it.lit, true);
    return it;
  }

  setLit(it, on, instant = false) {
    it.lit = on;
    this.d.lit[it.i] = on;
    it.flame.visible = it.inner.visible = it.halo.visible = on;
    it.frost.visible = !on;
    if (on && !instant) {
      const g = this.g;
      it.pop = 1;
      g.combat.vfx.burst(V3(it.pos.x, it.pos.y + 2, it.pos.z), '#ffb35a', 40, { speed: 5, size: 0.28, life: 0.8, up: 1.5, gravity: -1 });
      g.combat.vfx.ring(V3(it.pos.x, it.pos.y + 0.1, it.pos.z), '#ffb35a', WARM_R, 0.8, { inner: 0.92 });
      g.sfx.torch && g.sfx.torch();
      g.sfx.unseal();
      g.hud.toast(`<b>바람불 화로</b>에 불이 붙었다 · ${this.litCount()}/3`, '#ffb35a');
      if (g.quest) g.quest.onEvent('brazier');
      g.explore.save();
    }
  }

  litCount() {
    return this.braziers.filter((b) => b.lit).length;
  }

  // fire lights a brazier when the flame reaches its bowl (you have to be up
  // on the spire for the high one)
  onElement(x, z, r, el) {
    if (el !== 'fire') return;
    const P = this.g.player.pos;
    for (const it of this.braziers) {
      if (it.lit) continue;
      if (Math.hypot(it.pos.x - x, it.pos.z - z) > r + 1.4) continue;
      if (Math.abs(P.y - it.pos.y) > 3.5) continue;
      this.setLit(it, true);
    }
  }

  consider(P, consider) {
    for (const it of this.braziers) {
      if (it.lit) continue;
      consider(it.pos, 3.2, '꺼진 바람불 화로 · 불 원소로 불붙이기', () => this.g.hud.flashCenter('불 원소 공격(렌의 원소 스킬 등)으로 화로에 불을 붙일 수 있습니다'));
    }
  }

  // is this point warmed by a lit brazier?
  warmAt(p) {
    for (const it of this.braziers) if (it.lit && Math.hypot(p.x - it.pos.x, p.z - it.pos.z) < WARM_R && Math.abs(p.y - it.pos.y) < 6) return true;
    return false;
  }

  nextUnlit() {
    return this.braziers.find((b) => !b.lit) || null;
  }

  update(dt) {
    this.t += dt;
    const t = this.t;
    for (const it of this.braziers) {
      if (!it.lit) continue;
      it.pop = Math.max(0, it.pop - dt * 2);
      const f = 1 + Math.sin(t * 9 + it.i) * 0.08 + it.pop * 0.6;
      it.flame.scale.set(f, 1 + Math.sin(t * 13 + it.i * 2) * 0.14 + it.pop, f);
      it.inner.scale.set(1, 1 + Math.sin(t * 17 + it.i) * 0.2, 1);
      it.halo.material.opacity = 0.1 + Math.sin(t * 5 + it.i) * 0.03 + it.pop * 0.2;
      if (Math.random() < dt * 6) {
        const p = V3(it.pos.x + (Math.random() - 0.5) * 0.6, it.pos.y + 2.4, it.pos.z + (Math.random() - 0.5) * 0.6);
        this.g.combat.vfx.particles.spawn(p, V3((Math.random() - 0.5) * 0.4, 2.2, (Math.random() - 0.5) * 0.4), this.g.combat.vfx.color.set('#ffb35a'), 0.12, 0.9, { drag: 1 });
      }
    }
  }

  minimapMarkers(P, out) {
    for (const it of this.braziers) {
      if (Math.abs(it.pos.x - P.pos.x) < 80 && Math.abs(it.pos.z - P.pos.z) < 80) out.push({ x: it.pos.x, z: it.pos.z, color: it.lit ? '#ffb35a' : '#9fb4c8', r: 3.5 });
    }
  }
}

