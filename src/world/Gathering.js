import * as THREE from 'three';
import { LANDMARKS, SPAWN } from './Terrain.js';
import { mulberry32 } from '../core/noise.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ITEMS } from '../game/Items.js';
import { shared } from '../render/shaders.js';

// Pickable ingredients scattered over the island (they shimmer when you are
// close and grow back a few minutes after picking) and the cooking pots in
// the village and at the meadow camp.

const RESPAWN_MS = 6 * 60 * 1000;
const YIELD = { bellflower: 1, apple: 2, mushroom: 2, berry: 3 };
const LABEL = { bellflower: '꺾기', apple: '줍기', mushroom: '따기', berry: '따기' };

const tint = (geo, hex) => {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = c.r;
    a[i * 3 + 1] = c.g;
    a[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (geo.attributes.uv) geo.deleteAttribute('uv');
  return geo.index ? geo.toNonIndexed() : geo;
};

function plantGeometry(type) {
  const parts = [];
  if (type === 'bellflower') {
    const stem = new THREE.CylinderGeometry(0.012, 0.016, 0.5, 5);
    stem.translate(0, 0.25, 0);
    parts.push(tint(stem, '#3f8a3a'));
    for (const [x, y, z, r] of [
      [0.04, 0.5, 0, 0.3],
      [-0.07, 0.42, 0.04, -0.5],
      [0.02, 0.38, -0.07, 0.9],
    ]) {
      const bell = new THREE.ConeGeometry(0.055, 0.09, 7, 1, true);
      bell.rotateZ(Math.PI + r * 0.3);
      bell.translate(x, y, z);
      parts.push(tint(bell, '#58d6be'));
      const cap = new THREE.SphereGeometry(0.03, 6, 4);
      cap.translate(x, y + 0.04, z);
      parts.push(tint(cap, '#b8fff0'));
    }
    for (const a of [0.4, 2.5, 4.3]) {
      const leaf = new THREE.PlaneGeometry(0.06, 0.2);
      leaf.translate(0, 0.1, 0);
      leaf.rotateX(-0.6);
      leaf.rotateY(a);
      parts.push(tint(leaf, '#5fb04a'));
    }
  } else if (type === 'apple') {
    for (const [x, z, s] of [
      [0, 0, 1],
      [0.22, 0.08, 0.85],
      [-0.1, 0.2, 0.9],
    ]) {
      const ap = new THREE.SphereGeometry(0.12 * s, 10, 8);
      ap.scale(1, 0.9, 1);
      ap.translate(x, 0.1 * s, z);
      parts.push(tint(ap, '#e0503a'));
      const st = new THREE.CylinderGeometry(0.008, 0.008, 0.06, 4);
      st.translate(x, 0.2 * s + 0.02, z);
      parts.push(tint(st, '#6b4630'));
    }
    const leaf = new THREE.PlaneGeometry(0.08, 0.16);
    leaf.rotateX(-1.3);
    leaf.translate(0.02, 0.24, 0.04);
    parts.push(tint(leaf, '#5fb04a'));
  } else if (type === 'mushroom') {
    for (const [x, z, s] of [
      [0, 0, 1],
      [0.16, 0.1, 0.7],
      [-0.12, 0.13, 0.55],
    ]) {
      const st = new THREE.CylinderGeometry(0.035 * s, 0.045 * s, 0.22 * s, 7);
      st.translate(x, 0.11 * s, z);
      parts.push(tint(st, '#f2ead8'));
      const cap = new THREE.SphereGeometry(0.12 * s, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
      cap.scale(1, 0.75, 1);
      cap.translate(x, 0.2 * s, z);
      parts.push(tint(cap, '#5f8ee8'));
    }
  } else {
    const bush = new THREE.IcosahedronGeometry(0.34, 1);
    bush.scale(1.1, 0.7, 1.1);
    bush.translate(0, 0.22, 0);
    parts.push(tint(bush, '#62a84a'));
    const rand = mulberry32(7);
    for (let k = 0; k < 9; k++) {
      const a = rand() * Math.PI * 2,
        e = rand() * 0.9;
      const b = new THREE.OctahedronGeometry(0.05, 0);
      b.translate(Math.cos(a) * 0.34 * Math.cos(e), 0.24 + Math.sin(e) * 0.22, Math.sin(a) * 0.34 * Math.cos(e));
      parts.push(tint(b, '#ff3a5a'));
    }
  }
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
  g.computeVertexNormals();
  return g;
}

function toonGradient() {
  const d = new Uint8Array([90, 170, 255]);
  const t = new THREE.DataTexture(d, 3, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

export class Gathering {
  constructor(game) {
    this.g = game;
    const T = game.terrain;
    const V = LANDMARKS.village;
    // cooking pots: village plaza and the meadow camp near the start
    const a = (100 * Math.PI) / 180;
    this.pots = [
      { x: V.x + Math.cos(a) * 6, z: V.z + Math.sin(a) * 6, name: '마을 요리 솥' },
      { x: SPAWN.x + 5, z: SPAWN.z - 3, name: '야영지 요리 솥' },
    ];
    for (const p of this.pots) {
      p.y = T.heightAt(p.x, p.z);
      T.addBlocker(p.x, p.z, 2.2);
    }
  }

  // after vegetation exists so spots can avoid tree trunks
  build() {
    const g = this.g;
    const T = g.terrain;
    const rand = mulberry32(2718);
    const trees = g.vegetation.colliders;
    const free = (x, z, r) => {
      if (T.blocked(x, z, r)) return false;
      for (const c of trees.query(x, z)) if (Math.hypot(c.x - x, c.z - z) < c.r + r) return false;
      return true;
    };
    const V = LANDMARKS.village;
    const rules = {
      bellflower: { n: 46, ok: (x, z, h) => h > 6 && h < 70 && T.grassAt(x, z) > 0.55 && T.forestAt(x, z) < 0.35 },
      apple: { n: 34, ok: (x, z, h) => h > 3 && h < 60 && T.forestAt(x, z) > 0.3 && T.forestAt(x, z) < 0.7 },
      mushroom: { n: 36, ok: (x, z, h) => h > 3 && h < 75 && T.forestAt(x, z) > 0.62 },
      berry: { n: 32, ok: (x, z, h) => h > 2 && h < 60 && T.grassAt(x, z) > 0.3 && T.pathDistance(x, z) > 3 && T.pathDistance(x, z) < 8 },
    };
    this.spots = [];
    this.groups = {};
    const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient() });
    const glowMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: mat.gradientMap, emissive: new THREE.Color('#3f7cff'), emissiveIntensity: 0 });
    this.glowMat = glowMat;
    for (const [type, R] of Object.entries(rules)) {
      const list = [];
      // a few guaranteed bellflowers near the village and the start (quest)
      if (type === 'bellflower') {
        for (let k = 0, tries = 0; k < 10 && tries < 400; tries++) {
          const near = k < 7 ? V : SPAWN;
          const ang = rand() * Math.PI * 2,
            r = (k < 7 ? 26 : 12) + rand() * 26;
          const x = near.x + Math.cos(ang) * r,
            z = near.z + Math.sin(ang) * r;
          const h = T.heightAt(x, z);
          if (h < 3 || T.grassAt(x, z) < 0.4 || !free(x, z, 1.2)) continue;
          list.push({ x, z, y: h });
          k++;
        }
      }
      for (let tries = 0; list.length < R.n && tries < 20000; tries++) {
        const x = (rand() - 0.5) * 940,
          z = (rand() - 0.5) * 940;
        const h = T.heightAt(x, z);
        if (!R.ok(x, z, h) || T.normalAt(x, z).y < 0.82 || !free(x, z, 1.2)) continue;
        if (list.some((s) => Math.abs(s.x - x) < 14 && Math.abs(s.z - z) < 14)) continue;
        list.push({ x, z, y: h });
      }
      const geo = plantGeometry(type);
      const mesh = new THREE.InstancedMesh(geo, type === 'mushroom' ? glowMat : mat, list.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const grp = { mesh, type };
      this.groups[type] = grp;
      list.forEach((s, i) => {
        const spot = { id: `${type}:${i}`, type, i, pos: new THREE.Vector3(s.x, s.y, s.z), rot: rand() * Math.PI * 2, scale: type === 'berry' ? 1.25 : 1.45, picked: false };
        this.spots.push(spot);
        this.place(spot, true);
      });
      mesh.computeBoundingSphere();
      g.scene.add(mesh);
    }
    // restore picked state
    const picked = g.explore.progress.picked || (g.explore.progress.picked = {});
    const now = Date.now();
    for (const s of this.spots) {
      const t = picked[s.id];
      if (t && now - t < RESPAWN_MS) {
        s.picked = true;
        this.place(s, false);
      } else if (t) delete picked[s.id];
    }
    for (const grp of Object.values(this.groups)) grp.mesh.instanceMatrix.needsUpdate = true;
    this.buildPots();
    this.glintT = 0;
    this.checkT = 0;
  }

  place(s, show) {
    const m = new THREE.Matrix4().compose(s.pos, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.rot), new THREE.Vector3().setScalar(show ? s.scale : 0));
    this.groups[s.type].mesh.setMatrixAt(s.i, m);
    this.groups[s.type].mesh.instanceMatrix.needsUpdate = true;
  }

  buildPots() {
    const g = this.g;
    const metal = new THREE.MeshToonMaterial({ color: '#3a3a44', gradientMap: this.glowMat.gradientMap });
    const wood = new THREE.MeshToonMaterial({ color: '#7a5232', gradientMap: this.glowMat.gradientMap });
    const soup = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd48a').multiplyScalar(1.1) });
    const fire = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff9a3a').multiplyScalar(2.2), transparent: true, opacity: 0.9, depthWrite: false });
    this.flames = [];
    for (const p of this.pots) {
      const grp = new THREE.Group();
      grp.position.set(p.x, p.y, p.z);
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.5, 5), wood);
        leg.position.set(Math.cos(a) * 0.55, 0.7, Math.sin(a) * 0.55);
        leg.rotation.set(Math.sin(a) * 0.38, 0, -Math.cos(a) * 0.38);
        leg.castShadow = true;
        grp.add(leg);
      }
      const pot = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 10, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.65), metal);
      pot.position.y = 0.72;
      pot.castShadow = true;
      grp.add(pot);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.035, 6, 20), metal);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 0.92;
      grp.add(rim);
      const top = new THREE.Mesh(new THREE.CircleGeometry(0.34, 18), soup);
      top.rotation.x = -Math.PI / 2;
      top.position.y = 0.88;
      grp.add(top);
      for (let k = 0; k < 4; k++) {
        const log = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.7, 6), wood);
        log.rotation.set(Math.PI / 2, (k / 4) * Math.PI, 0);
        log.position.y = 0.07;
        grp.add(log);
      }
      const fl = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.42, 7), fire);
      fl.position.y = 0.26;
      grp.add(fl);
      this.flames.push(fl);
      g.scene.add(grp);
      g.structures.solids.addCircle(p.x, p.z, 0.65, p.y + 0.95);
      p.pos = new THREE.Vector3(p.x, p.y, p.z);
    }
  }

  // interaction candidates for the shared prompt
  consider(P, consider) {
    for (const s of this.spots) {
      if (s.picked) continue;
      if (Math.abs(s.pos.x - P.x) > 2.2 || Math.abs(s.pos.z - P.z) > 2.2) continue;
      consider(s.pos, 1.9, `${ITEMS[s.type].name} ${LABEL[s.type]}`, () => this.pick(s));
    }
    for (const p of this.pots) consider(p.pos, 2.4, '요리하기', () => this.g.openCook(p));
  }

  pick(s) {
    const g = this.g;
    s.picked = true;
    this.place(s, false);
    g.explore.progress.picked[s.id] = Date.now();
    const n = YIELD[s.type];
    g.bag.add(s.type, n);
    g.combat.vfx.sparkle(s.pos.clone().add(new THREE.Vector3(0, 0.4, 0)), '#fff3c0', 10, 0.6);
    g.sfx.pick();
    g.hud.toast(`획득 · <b>${ITEMS[s.type].name}</b> ×${n}`, '#9cff7a');
    if (g.quest) g.quest.onEvent('gather', s.type);
    if (g.achievements) g.achievements.add('gathered');
  }

  update(dt) {
    const g = this.g;
    if (!this.spots) return;
    const P = g.player.pos;
    this.t = (this.t || 0) + dt;
    this.glowMat.emissiveIntensity = 0.15 + 0.85 * shared.uNight.value;
    this.flames.forEach((f, i) => f.scale.set(1 + Math.sin(this.t * 13 + i) * 0.08, 1 + Math.sin(this.t * 17 + i) * 0.15, 1));
    // shimmer on nearby pickables, like a wink from the island
    this.glintT -= dt;
    if (this.glintT <= 0) {
      this.glintT = 0.9;
      for (const s of this.spots) {
        if (s.picked) continue;
        const d = Math.abs(s.pos.x - P.x) + Math.abs(s.pos.z - P.z);
        if (d < 24) g.combat.vfx.sparkle(_v.copy(s.pos).add(_up), '#fff6c8', 2, 0.5);
      }
    }
    // regrow
    this.checkT -= dt;
    if (this.checkT <= 0) {
      this.checkT = 5;
      const now = Date.now();
      const picked = g.explore.progress.picked;
      for (const s of this.spots) {
        if (!s.picked) continue;
        const t = picked[s.id];
        if (!t || now - t > RESPAWN_MS) {
          if (Math.hypot(s.pos.x - P.x, s.pos.z - P.z) < 25) continue; // never pop in under your nose
          s.picked = false;
          delete picked[s.id];
          this.place(s, true);
        }
      }
    }
  }

  // minimap: show nearby ingredients as tiny dots
  minimapMarkers(P, out) {
    for (const s of this.spots) {
      if (s.picked) continue;
      if (Math.abs(s.pos.x - P.x) < 40 && Math.abs(s.pos.z - P.z) < 40) out.push({ x: s.pos.x, z: s.pos.z, color: '#b8ffb0', r: 2 });
    }
    for (const p of this.pots) out.push({ x: p.x, z: p.z, color: '#ffb35a', r: 3.5 });
  }
}

const _v = new THREE.Vector3();
const _up = new THREE.Vector3(0, 0.5, 0);
