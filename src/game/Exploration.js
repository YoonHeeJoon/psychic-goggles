import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LANDMARKS, SPAWN, CAMPS, BRIDGE, PORT_LEN, portWorld } from '../world/Terrain.js';
import { toonMaterial } from '../render/materials.js';
import { NOISE_GLSL, shared } from '../render/shaders.js';
import { smoothstep } from '../core/noise.js';
import { SAVE_KEY } from './Save.js';

const V3 = THREE.Vector3;
const TAU = Math.PI * 2;
const _v = new V3();
const _c = new THREE.Color();


// Starwind Eyes on peaks and hard-to-reach spots. `y` (absolute) is filled in
// at build time; `lift` is the height above the ground.
const ORB_PEAKS = [
  [14, -316],
  [-64, -340],
  [110, -250],
  [-70, -244],
  [2, -178],
  [-106, -136],
  [278, -196],
  [380, -118],
  [-340, 254],
  [-70, 338],
  [92, 56],
  [26, 302],
  [380, 14],
  [-376, 80],
  [32, 188],
  [-46, 248],
  [170, -106],
  [-148, -244],
];

// Wind currents: x, z, height
const UPDRAFTS = [
  { x: -6, z: 96, h: 36 },
  { x: 58, z: 8, h: 32 },
  { x: -159, z: 215, h: 40 },
  { x: 28, z: -140, h: 62 },
  { x: -248, z: -72, h: 34 },
  { x: -128, z: -58, h: 46 },
  { x: 200, z: 60, h: 34 },
];

const TIERS = [
  { name: '평범한 보물상자', wood: '#a06a3c', band: '#9097a3', gem: null, drops: 4, glow: '#ffe2a0' },
  { name: '정교한 보물상자', wood: '#7a4a2c', band: '#e2b552', gem: '#5fd0ff', drops: 8, glow: '#ffd36a' },
  { name: '진귀한 보물상자', wood: '#9b3b35', band: '#f0c25a', gem: '#c08cff', drops: 16, glow: '#ffc94a' },
];

// Statue blessing thresholds (total eyes offered) -> +20 stamina per level
const BLESSING = [0, 2, 5, 9, 14, 20, 26];

function loadProgress() {
  const empty = { wp: [], orbs: [], chests: [], offered: 0, held: 0, gems: 0 };
  if (new URLSearchParams(location.search).has('fresh')) return empty;
  try {
    const p = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    return p ? Object.assign(empty, p) : empty;
  } catch (e) {
    return empty;
  }
}

// ---------------------------------------------------------------------------
// Shaders for wind currents and light beams (additive, unlit)
// ---------------------------------------------------------------------------
const WIND_VERT = /* glsl */ `
varying vec2 vUv;
varying float vFacing;
void main(){
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize(normalMatrix * normal);
  vFacing = abs(dot(n, normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
}`;
const WIND_FRAG = /* glsl */ `
${NOISE_GLSL}
uniform float uTime;
uniform float uFade;
uniform float uSpeed;
uniform float uMode;
uniform vec3 uColor;
varying vec2 vUv;
varying float vFacing;
void main(){
  float alpha;
  float soft = smoothstep(0.0, 0.55, vFacing);
  if (uMode < 0.5) {
    float y = vUv.y;
    float s1 = fract(vUv.x * 3.0 + y * 2.2 - uTime * 0.55 * uSpeed);
    float st1 = smoothstep(0.0, 0.06, s1) * smoothstep(0.3, 0.06, s1);
    float s2 = fract(vUv.x * 5.0 + y * 3.4 - uTime * 0.8 * uSpeed + 0.37);
    float st2 = smoothstep(0.0, 0.04, s2) * smoothstep(0.16, 0.04, s2);
    float n = snoise(vec2(vUv.x * 9.0, y * 5.0 - uTime * 1.6 * uSpeed)) * 0.5 + 0.5;
    alpha = (st1 * 0.55 + st2 * 0.4) * (0.35 + 0.65 * n);
    alpha *= smoothstep(0.0, 0.1, y) * smoothstep(1.0, 0.75, y) * (0.25 + 0.75 * soft);
  } else if (uMode < 1.5) {
    vec2 p = vUv - 0.5;
    float r = length(p) * 2.0;
    float a = atan(p.y, p.x);
    float sw = fract(a / 6.2831 * 3.0 + r * 1.4 - uTime * 0.7);
    float band = smoothstep(0.0, 0.08, sw) * smoothstep(0.35, 0.08, sw);
    alpha = band * smoothstep(1.0, 0.55, r) * smoothstep(0.05, 0.35, r) * 0.7;
  } else {
    // light beam: bright core fading upward
    float y = vUv.y;
    alpha = pow(1.0 - y, 1.6) * pow(soft, 2.0) * 0.55;
    float n = snoise(vec2(vUv.x * 10.0, y * 4.0 - uTime * 3.0)) * 0.5 + 0.5;
    alpha *= 0.7 + 0.3 * n;
  }
  gl_FragColor = vec4(uColor * alpha * uFade, 1.0);
}`;

function windMaterial(color, mode, speed = 1) {
  return new THREE.ShaderMaterial({
    vertexShader: WIND_VERT,
    fragmentShader: WIND_FRAG,
    uniforms: {
      uTime: shared.uTime,
      uFade: { value: 1 },
      uSpeed: { value: speed },
      uMode: { value: mode },
      uColor: { value: new THREE.Color(color) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

export class Exploration {
  constructor(game) {
    this.g = game;
    this.terrain = game.terrain;
    this.S = game.structures;
    this.progress = loadProgress();
    this.orbs = [];
    this.chests = [];
    this.updrafts = [];
    this.promptText = '';
    this.saveTimer = 0;
    this.sparkleT = 0;
    this.defineSpots();
  }

  get blessing() {
    let lv = 0;
    for (let i = 0; i < BLESSING.length; i++) if (this.progress.offered >= BLESSING[i]) lv = i;
    return lv;
  }

  // positions only (before vegetation is planted, so trees avoid them)
  defineSpots() {
    const S = this.S;
    const G = LANDMARKS.giantTree;
    const V = LANDMARKS.village;
    // eyes
    const spots = ORB_PEAKS.map(([x, z], i) => ({ id: 'p' + i, x, z, lift: 1.6 }));
    const mill = S.windmills[0];
    spots.push({ id: 'mill', x: mill.x, z: mill.z, y: mill.top + 1.2 });
    spots.push({ id: 'statue', x: S.statue.center.x, z: S.statue.center.z, y: S.statue.top + 1.6 });
    spots.push({ id: 'ring', x: S.ringTop.x, z: S.ringTop.z, y: S.ringTop.y + 1.3 });
    spots.push({ id: 'tree', x: G.x, z: G.z, tree: true });
    const roof = S.houses[2];
    spots.push({ id: 'roof', x: roof.x, z: roof.z, y: roof.top + 1.3 });
    spots.push({ id: 'lake', x: LANDMARKS.lake.x, z: LANDMARKS.lake.z, y: 4.5 });
    for (const k of [0, 3, 5]) {
      const u = UPDRAFTS[k];
      spots.push({ id: 'u' + k, x: u.x, z: u.z, upTop: k });
    }
    // autumn highlands: lighthouse lantern room, a watchtower roof, the bridge
    if (S.lighthouse) spots.push({ id: 'lighthouse', x: S.lighthouse.x, z: S.lighthouse.z, y: S.lighthouse.y + 3.6 });
    if (CAMPS[1].tower) spots.push({ id: 'towerB', x: CAMPS[1].tower.x, z: CAMPS[1].tower.z, y: CAMPS[1].tower.y + 4.6 });
    if (S.bridge) {
      const m = S.bridge.deck(0.5);
      spots.push({ id: 'bridge', x: m.x, z: m.z, y: m.y + 2.2 });
    }
    const top = S.port && S.port.lots[0];
    if (top) spots.push({ id: 'portRoof', x: top.x, z: top.z, y: S.houses.find((h) => Math.hypot(h.x - top.x, h.z - top.z) < 0.5).top + 1.3 });
    this.orbSpots = spots;

    // chests
    const barn = S.barn;
    const ruins = S.ruins;
    const ruinFront = new V3(Math.sin(ruins.rot), 0, Math.cos(ruins.rot));
    this.chestSpots = [
      { id: 'c-spawn', tier: 0, x: -46, z: 96 },
      { id: 'c-lake', tier: 0, x: 104, z: 62 },
      { id: 'c-vill', tier: 0, x: V.x - 16, z: V.z + 25 },
      { id: 'c-barn', tier: 1, x: barn.x + 6, z: barn.z + 7 },
      { id: 'c-tree', tier: 1, x: G.x + 7.5, z: G.z + 6 },
      { id: 'c-gob', tier: 1, x: 60, z: -40, guard: { x: 60, z: -40, r: 22 } },
      { id: 'c-ruins', tier: 2, x: ruins.center.x + ruinFront.x * 2.5, z: ruins.center.z + ruinFront.z * 2.5, guard: { x: -259, z: -78, r: 26 } },
      { id: 'c-slime', tier: 1, x: 120, z: 190, guard: { x: 120, z: 190, r: 20 } },
      { id: 'c-slime2', tier: 0, x: -160, z: 80, guard: { x: -160, z: 80, r: 20 } },
      { id: 'c-peak', tier: 1, x: 5, z: -176 },
      { id: 'c-summit', tier: 2, x: 17, z: -313 },
      { id: 'c-beach', tier: 0, x: 0, z: 345 },
      { id: 'c-east', tier: 1, x: 203, z: 82 },
      { id: 'c-gate', tier: 0, x: 61, z: -93 },
      { id: 'c-campA', tier: 2, x: CAMPS[0].x - 2.5, z: CAMPS[0].z + 7, guard: { x: CAMPS[0].x, z: CAMPS[0].z, r: 20 } },
      { id: 'c-campB', tier: 2, x: CAMPS[1].x + 1.5, z: CAMPS[1].z - 7, guard: { x: CAMPS[1].x, z: CAMPS[1].z, r: 20 } },
      { id: 'c-bridge', tier: 0, x: BRIDGE.ax - 9, z: BRIDGE.az - 7 },
      { id: 'c-port', tier: 1, x: portWorld(PORT_LEN + 10, -13.5)[0], z: portWorld(PORT_LEN + 10, -13.5)[1] },
      { id: 'c-maple', tier: 1, x: 214, z: 296 },
      { id: 'c-cliffs', tier: 1, x: 294, z: 260, guard: { x: 294, z: 260, r: 18 } },
    ];
    for (const c of this.chestSpots) this.terrain.addBlocker(c.x, c.z, 2.5);
    for (const u of UPDRAFTS) this.terrain.addBlocker(u.x, u.z, 4);
  }

  // ------------------------------------------------------------------ build
  build() {
    const g = this.g;
    this.vfx = g.combat.vfx;
    this.scene = g.scene;
    this.group = new THREE.Group();
    this.scene.add(this.group);
    const ground = g.ground;

    // wind currents
    const colGeo = new THREE.CylinderGeometry(1, 1, 1, 32, 1, true);
    colGeo.translate(0, 0.5, 0);
    const discGeo = new THREE.CircleGeometry(1, 40);
    discGeo.rotateX(-Math.PI / 2);
    for (const u of UPDRAFTS) {
      const base = this.terrain.heightAt(u.x, u.z);
      const grp = new THREE.Group();
      grp.position.set(u.x, base, u.z);
      const r = 3.4;
      const mats = [windMaterial('#bff7ec', 0, 1), windMaterial('#e8fffa', 0, 1.5), windMaterial('#9ff0e0', 1)];
      const outer = new THREE.Mesh(colGeo, mats[0]);
      outer.scale.set(r, u.h, r);
      const inner = new THREE.Mesh(colGeo, mats[1]);
      inner.scale.set(r * 0.55, u.h * 0.92, r * 0.55);
      inner.rotation.y = 1.3;
      const disc = new THREE.Mesh(discGeo, mats[2]);
      disc.scale.setScalar(r * 1.5);
      disc.position.y = 0.15;
      for (const m of [outer, inner, disc]) {
        m.renderOrder = 4;
        m.frustumCulled = true;
        grp.add(m);
      }
      this.group.add(grp);
      this.updrafts.push({ ...u, base, top: base + u.h, r, grp, mats });
    }

    // Starwind Eyes
    const coreGeo = new THREE.OctahedronGeometry(1, 0);
    const ringGeo = new THREE.TorusGeometry(0.42, 0.022, 6, 48);
    const coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#7ff5dc').multiplyScalar(2.4) });
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffe7a8').multiplyScalar(1.7) });
    const haloMat = new THREE.SpriteMaterial({ map: this.vfx.glowTex, color: new THREE.Color('#5fe3c0').multiplyScalar(1.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const treeTop = g.vegetation.giantTree ? new THREE.Box3().setFromObject(g.vegetation.giantTree).max.y : 60;
    for (const s of this.orbSpots) {
      if (this.progress.orbs.includes(s.id)) continue;
      let y = s.y;
      if (s.tree) y = treeTop + 1.4;
      else if (s.upTop !== undefined) y = this.updrafts[s.upTop].top - 1.5;
      else if (y === undefined) y = ground.heightAt(s.x, s.z) + s.lift;
      const grp = new THREE.Group();
      grp.position.set(s.x, y, s.z);
      const core = new THREE.Mesh(coreGeo, coreMat);
      core.scale.set(0.2, 0.38, 0.2);
      const r1 = new THREE.Mesh(ringGeo, ringMat);
      const r2 = new THREE.Mesh(ringGeo, ringMat);
      r2.scale.setScalar(0.8);
      const halo = new THREE.Sprite(haloMat);
      halo.scale.setScalar(1.9);
      grp.add(core, r1, r2, halo);
      this.group.add(grp);
      this.orbs.push({ ...s, y, grp, core, r1, r2, phase: Math.random() * TAU, pos: new V3(s.x, y, s.z), taken: false });
    }

    // chests
    for (const c of this.chestSpots) {
      if (this.progress.chests.includes(c.id)) continue;
      const chest = this.buildChest(c.tier);
      const y = ground.heightAt(c.x, c.z);
      chest.group.position.set(c.x, y, c.z);
      const n = this.terrain.normalAt(c.x, c.z);
      // face roughly toward spawn / the open side, tilted to the slope
      chest.group.rotation.y = Math.atan2(SPAWN.x - c.x, SPAWN.z - c.z) + (Math.random() - 0.5) * 0.6;
      chest.group.rotation.x = Math.atan2(n.z, n.y) * 0.6;
      chest.group.rotation.z = -Math.atan2(n.x, n.y) * 0.6;
      this.group.add(chest.group);
      const entry = { ...c, ...chest, pos: new V3(c.x, y, c.z), opened: false, t: 0, sealed: !!c.guard };
      if (entry.sealed) {
        const seal = new THREE.Mesh(new THREE.RingGeometry(1.25, 1.5, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color('#a98bff').multiplyScalar(1.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        seal.rotation.x = -Math.PI / 2;
        seal.position.set(c.x, y + 0.12, c.z);
        this.group.add(seal);
        entry.seal = seal;
      }
      this.chests.push(entry);
    }

    // restore saved state
    for (const wp of this.S.waypoints) if (this.progress.wp.includes(wp.id)) this.setWaypointActive(wp, false);
    g.gems = this.progress.gems || 0;
    this.applyBlessing();
  }

  buildChest(tier) {
    const T = TIERS[tier];
    const group = new THREE.Group();
    const wood = toonMaterial({ color: T.wood, rim: 0.25, shadowTint: '#b49ab0' });
    const band = toonMaterial({ color: T.band, spec: 0.8, rim: 0.45, shadowTint: '#b0a0a8' });
    const w = 1.1,
      d = 0.72,
      h = 0.55,
      r = d / 2;
    const parts = { bw: [], bb: [], lw: [], lb: [] };
    const put = (key, geo, x, y, z) => {
      geo.translate(x, y, z);
      parts[key].push(geo.index ? geo.toNonIndexed() : geo);
    };
    put('bw', new THREE.BoxGeometry(w, h, d), 0, h / 2, 0);
    put('bb', new THREE.BoxGeometry(w + 0.04, 0.07, d + 0.04), 0, 0.035, 0);
    put('bb', new THREE.BoxGeometry(w + 0.03, 0.05, d + 0.03), 0, h - 0.025, 0);
    for (const s of [-1, 1]) {
      put('bb', new THREE.BoxGeometry(0.09, h + 0.01, d + 0.03), s * 0.36, h / 2, 0);
      for (const sz of [-1, 1]) put('bb', new THREE.BoxGeometry(0.1, h + 0.02, 0.1), s * (w / 2 - 0.03), h / 2, sz * (d / 2 - 0.03));
    }
    // lid (half cylinder) on a pivot at the back edge
    const half = (rad, len) => {
      const g = new THREE.CylinderGeometry(rad, rad, len, 18, 1, false, 0, Math.PI);
      g.rotateZ(Math.PI / 2);
      return g;
    };
    put('lw', half(r, w), 0, 0, d / 2);
    for (const s of [-1, 1]) {
      put('lb', half(r + 0.014, 0.09), s * 0.36, 0, d / 2);
      put('lb', half(r + 0.012, 0.05), s * (w / 2 - 0.02), 0, d / 2);
    }
    put('lb', new THREE.BoxGeometry(0.17, 0.2, 0.06), 0, -0.02, d + 0.02);
    if (tier === 2) {
      const crest = new THREE.TorusGeometry(0.12, 0.025, 6, 20);
      crest.rotateX(-0.8);
      put('lb', crest, 0, r * 0.75, d / 2 + r * 0.66);
    }
    const mesh = (key, mat, parent) => {
      const m = new THREE.Mesh(mergeGeometries(parts[key]), mat);
      m.castShadow = true;
      parent.add(m);
    };
    mesh('bw', wood, group);
    mesh('bb', band, group);
    // glowing treasure inside, revealed when the lid opens
    const inner = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.12, d - 0.12), new THREE.MeshBasicMaterial({ color: new THREE.Color(T.glow).multiplyScalar(1.5) }));
    inner.rotation.x = -Math.PI / 2;
    inner.position.y = h + 0.003;
    group.add(inner);
    const pivot = new THREE.Group();
    pivot.position.set(0, h, -d / 2);
    group.add(pivot);
    mesh('lw', toonMaterial({ color: T.wood, rim: 0.25, shadowTint: '#b49ab0', side: THREE.DoubleSide }), pivot);
    mesh('lb', band, pivot);
    if (T.gem) {
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.07, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(T.gem).multiplyScalar(1.8) }));
      gem.position.set(0, -0.02, d + 0.06);
      gem.scale.set(1, 1.3, 0.6);
      pivot.add(gem);
    }
    return { group, lid: pivot };
  }

  // ----------------------------------------------------------------- update
  // Called before the player update so updraft lift applies this frame.
  preUpdate(dt) {
    const P = this.g.player;
    let lift = 0;
    for (const u of this.updrafts) {
      const d = Math.hypot(P.pos.x - u.x, P.pos.z - u.z);
      if (d < u.r + 0.6 && P.pos.y > u.base - 1 && P.pos.y < u.top + 2) {
        lift = Math.max(lift, 1 + 10 * smoothstep(u.top + 1, u.top - 12, P.pos.y));
      }
    }
    if (lift > 0 && !(P.updraft > 0)) this.g.sfx.updraft();
    P.updraft = lift;
  }

  update(dt, input) {
    const g = this.g;
    const P = g.player;
    const cam = g.camera.position;
    const t = shared.uTime.value;

    // wind currents: fade with distance, rising motes nearby
    for (const u of this.updrafts) {
      const dist = Math.hypot(cam.x - u.x, cam.z - u.z);
      const fade = THREE.MathUtils.clamp(1.25 - dist / 260, 0, 1);
      u.grp.visible = fade > 0.01;
      for (const m of u.mats) m.uniforms.uFade.value = fade;
      if (dist < 110) {
        u.acc = (u.acc || 0) + dt * 18;
        while (u.acc > 1) {
          u.acc -= 1;
          const a = Math.random() * TAU,
            rr = Math.sqrt(Math.random()) * u.r;
          _v.set(u.x + Math.cos(a) * rr, u.base + Math.random() * u.h * 0.25, u.z + Math.sin(a) * rr);
          const vel = new V3(-Math.sin(a) * 1.2, 9 + Math.random() * 4, Math.cos(a) * 1.2);
          this.vfx.particles.spawn(_v, vel, _c.set('#d8fff6'), 0.1 + Math.random() * 0.08, u.h / 11, { gravity: 0, drag: 0.05, intensity: 1.3, alpha: 0.8 });
        }
      }
    }

    // eyes
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i];
      if (o.taken) {
        o.t += dt;
        const k = Math.min(1, o.t / 0.35);
        _v.set(P.pos.x, P.pos.y + 1.1, P.pos.z);
        o.grp.position.lerpVectors(o.pos, _v, k * k);
        o.grp.scale.setScalar(1 - k * 0.85);
        if (k >= 1) {
          this.group.remove(o.grp);
          this.orbs.splice(i, 1);
          this.vfx.sparkle(_v, '#7ff5dc', 14, 0.8);
        }
        continue;
      }
      const far = Math.abs(o.x - cam.x) + Math.abs(o.z - cam.z) > 150;
      o.core.visible = o.r1.visible = o.r2.visible = !far;
      if (far) continue;
      const bob = Math.sin(t * 1.8 + o.phase) * 0.15;
      o.grp.position.set(o.x, o.y + bob, o.z);
      o.core.rotation.y = t * 1.4 + o.phase;
      o.r1.rotation.set(t * 1.1 + o.phase, t * 0.7, 0);
      o.r2.rotation.set(-t * 0.9, t * 1.3 + o.phase, 0.6);
      const dx = P.pos.x - o.x,
        dy = P.pos.y + 0.9 - (o.y + bob),
        dz = P.pos.z - o.z;
      if (dx * dx + dz * dz < 1.6 * 1.6 && Math.abs(dy) < 1.7) this.collectOrb(o);
    }

    // chests: idle glints, seals, opening animation
    this.sparkleT -= dt;
    const glint = this.sparkleT <= 0;
    if (glint) this.sparkleT = 0.5;
    const enemies = g.combat.enemies.list;
    for (let i = this.chests.length - 1; i >= 0; i--) {
      const c = this.chests[i];
      c.group.visible = Math.abs(c.x - cam.x) + Math.abs(c.z - cam.z) < 180;
      if (c.sealed) {
        let alive = false;
        for (const e of enemies) if (e.alive && Math.hypot(e.pos.x - c.guard.x, e.pos.z - c.guard.z) < c.guard.r) alive = true;
        if (c.seal) {
          c.seal.material.opacity = 0.55 + Math.sin(t * 3) * 0.25;
          c.seal.rotation.z = t * 0.4;
        }
        if (!alive) this.unseal(c);
      }
      if (c.opened) {
        c.t += dt;
        const k = Math.min(1, c.t / 0.55);
        const back = 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2);
        c.lid.rotation.x = -1.95 * back;
        if (c.t > 3.2) {
          const s = Math.max(0, 1 - (c.t - 3.2) / 0.6);
          c.group.scale.setScalar(s);
          if (glint) this.vfx.sparkle(_v.copy(c.pos).add(new V3(0, 0.4, 0)), '#ffe2a0', 4, 1);
          if (s <= 0) {
            this.group.remove(c.group);
            this.chests.splice(i, 1);
          }
        }
        continue;
      }
      if (glint && !c.sealed && c.pos.distanceToSquared(P.pos) < 70 * 70) this.vfx.sparkle(_v.copy(c.pos).add(new V3(0, 0.7, 0)), TIERS[c.tier].glow, 2, 1.1);
    }

    // interaction prompt
    const it = this.nearestInteractable();
    const text = it ? it.label : '';
    if (text !== this.promptText) {
      this.promptText = text;
      g.hud.setPrompt(text);
    }
    if (it && input.hit('KeyF') && !P.locked) it.act();

    this.saveTimer += dt;
    if (this.saveTimer > 15) this.save();
  }

  nearestInteractable() {
    const P = this.g.player;
    if (P.state !== 'ground' && P.state !== 'swim') return null;
    let best = null,
      bd = 1e9;
    const consider = (pos, r, label, act) => {
      const d = Math.hypot(P.pos.x - pos.x, P.pos.z - pos.z);
      if (d < r && Math.abs(P.pos.y - pos.y) < 3.5 && d < bd) {
        bd = d;
        best = { label, act };
      }
    };
    for (const c of this.chests) {
      if (c.opened) continue;
      if (c.sealed) consider(c.pos, 3, '봉인된 보물상자', () => this.g.hud.flashCenter('주변의 적을 모두 처치하면 봉인이 풀립니다'));
      else consider(c.pos, 2.4, TIERS[c.tier].name + ' 열기', () => this.openChest(c));
    }
    for (const wp of this.S.waypoints) {
      if (!wp.active) consider(wp.pos, 3.6, '순간이동 포인트 활성화', () => this.activateWaypoint(wp));
      else consider(wp.pos, 3.0, '지도 열기 · 순간이동', () => this.g.openMap(wp));
    }
    // villagers, pickable plants, cooking pots, quest spots
    for (const prov of [this.g.npcs, this.g.gathering, this.g.quest, this.g.puzzles, this.g.domain, this.g.commissions, this.g.festival, this.g.fishing, this.g.boat]) if (prov) prov.consider(P.pos, consider);
    const st = this.S.statue;
    const d = Math.hypot(P.pos.x - st.center.x, P.pos.z - st.center.z);
    if (d < 9 && d < bd && P.pos.y < st.center.y + 4) best = { label: '바람의 수호상 · 기도하기', act: () => this.pray() };
    return best;
  }

  // ---------------------------------------------------------------- actions
  collectOrb(o) {
    o.taken = true;
    o.t = 0;
    this.progress.orbs.push(o.id);
    this.progress.held++;
    const total = this.orbSpots.length;
    const got = this.progress.orbs.length;
    this.vfx.burst(o.pos, '#7ff5dc', 26, { speed: 5, size: 0.22, life: 0.8, gravity: 0, up: 0.2 });
    this.vfx.ring(o.pos, '#9ff0e0', 2.2, 0.6);
    this.vfx.flash(o.pos, '#ffffff', 1.2, 0.25);
    this.g.hud.toast(`<b>별바람의 눈</b> 획득 · ${got} / ${total}`, '#5fe3c0');
    this.g.sfx.orb();
    if (got === 1) setTimeout(() => this.g.hud.flashCenter('바람의 수호상에 바치면 최대 기력이 늘어납니다', 2600), 900);
    this.save();
  }

  unseal(c) {
    c.sealed = false;
    if (c.seal) {
      this.vfx.ring(c.pos, '#c3a8ff', 3.2, 0.7);
      this.vfx.burst(_v.copy(c.pos).add(new V3(0, 0.5, 0)), '#c3a8ff', 30, { speed: 5, size: 0.2, life: 0.7, up: 0.6 });
      this.group.remove(c.seal);
      c.seal.geometry.dispose();
      c.seal.material.dispose();
      c.seal = null;
      const P = this.g.player;
      if (c.pos.distanceTo(P.pos) < 60) {
        this.g.hud.toast('<b>봉인 해제</b> · 보물상자가 나타났습니다', '#c3a8ff');
        this.g.sfx.unseal();
      }
    }
  }

  // a reward chest that appears with a flourish (puzzles, boss, domain)
  spawnChest(id, pos, tier, temp = false) {
    if (!temp && this.progress.chests.includes(id)) return null;
    if (this.chests.some((c) => c.id === id)) return null;
    const chest = this.buildChest(tier);
    const y = pos.y !== undefined ? pos.y : this.g.ground.heightAt(pos.x, pos.z);
    chest.group.position.set(pos.x, y, pos.z);
    const P = this.g.player.pos;
    chest.group.rotation.y = Math.atan2(P.x - pos.x, P.z - pos.z);
    this.group.add(chest.group);
    const entry = { id, tier, temp, ...chest, x: pos.x, z: pos.z, pos: new V3(pos.x, y, pos.z), opened: false, t: 0, sealed: false };
    this.chests.push(entry);
    this.beam(entry.pos.clone(), TIERS[tier].glow, 9, 0.6, 1.6);
    this.vfx.burst(entry.pos.clone().add(new V3(0, 0.6, 0)), TIERS[tier].glow, 30, { speed: 5, size: 0.24, life: 0.8, up: 1.2, gravity: 4 });
    this.vfx.ring(entry.pos.clone().add(new V3(0, 0.15, 0)), TIERS[tier].glow, 2.6, 0.6);
    this.g.sfx.unseal();
    return entry;
  }

  openChest(c) {
    if (c.opened) return;
    c.opened = true;
    c.t = 0;
    if (!c.temp) this.progress.chests.push(c.id);
    const T = TIERS[c.tier];
    const top = _v.copy(c.pos).add(new V3(0, 0.8, 0)).clone();
    this.vfx.burst(top, T.glow, 30 + c.tier * 20, { speed: 6, size: 0.24, life: 0.9, up: 1.4, gravity: 5 });
    this.vfx.ring(c.pos, T.glow, 2.4 + c.tier, 0.6);
    this.beam(c.pos.clone().add(new V3(0, 0.5, 0)), T.glow, 5 + c.tier * 3, 0.38 + c.tier * 0.1, 1.4);
    setTimeout(() => this.g.combat.spawnGems(top, T.drops), 220);
    // gear: domain and boss chests carry their own, richer loot
    const src = c.id.startsWith('domain:') ? 'domain' : c.id.startsWith('boss:') ? 'boss' : 'chest';
    setTimeout(() => this.g.gear && this.g.gear.drop(src, c.tier), 700);
    if (this.g.rep && !c.temp) this.g.rep.onChest(c);
    this.g.hud.toast(`<b>${T.name}</b> 획득`, T.glow);
    this.g.sfx.chest(c.tier);
    this.g.cameraCtl.shake(0.05, 0.15);
    this.save();
  }

  activateWaypoint(wp) {
    this.setWaypointActive(wp, true);
    this.progress.wp.push(wp.id);
    this.save();
  }

  setWaypointActive(wp, fx) {
    wp.active = true;
    wp.crystal.material = new THREE.MeshBasicMaterial({ color: new THREE.Color('#7ff5dc').multiplyScalar(2.2) });
    wp.runeMat.color.set('#6ff0d2').multiplyScalar(1.7);
    if (!wp.halo) {
      wp.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.vfx.glowTex, color: new THREE.Color('#5fe3c0').multiplyScalar(1.3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      wp.halo.scale.setScalar(2.4);
      wp.crystal.add(wp.halo);
      wp.halo.scale.set(2.4 / 0.3, 2.4 / 0.6, 1);
    }
    if (fx) {
      const top = wp.pos.clone().add(new V3(0, 3.7, 0));
      this.beam(wp.pos, '#9ff0e0', 22, 0.9, 1.8);
      this.vfx.ring(wp.pos.clone().add(new V3(0, 0.6, 0)), '#9ff0e0', 4, 0.8);
      this.vfx.burst(top, '#9ff0e0', 40, { speed: 6, size: 0.22, life: 0.9, gravity: 0, up: 0.4 });
      this.g.hud.showBanner(`${wp.name} · 순간이동 포인트 활성화`);
      this.g.sfx.waypoint();
      this.g.hud.toast('<b>M</b> 지도에서 순간이동할 수 있습니다', '#5fe3c0');
    }
  }

  pray() {
    const g = this.g;
    const P = g.player;
    for (const p of P.party) p.hp = p.maxHp;
    g.hud.setParty(P.party, P.active);
    const st = this.S.statue;
    this.beam(st.center, '#9ff0e0', 28, 2.2, 2.2);
    this.vfx.ring(st.center.clone().add(new V3(0, 1.6, 0)), '#9ff0e0', 9, 1.0);
    this.vfx.burst(st.orbPos, '#7ff5dc', 50, { speed: 7, size: 0.25, life: 1, gravity: 0, up: 0.5 });
    g.flashScreen('#cffff4', 0.25);
    g.sfx.bless();
    if (g.quest) g.quest.onEvent('pray');
    const wp = this.S.waypoints.find((w) => w.statue);
    if (wp && !wp.active) this.activateWaypoint(wp);
    const before = this.blessing;
    if (this.progress.held > 0) {
      this.progress.offered += this.progress.held;
      const n = this.progress.held;
      this.progress.held = 0;
      const after = this.blessing;
      if (after > before) {
        this.applyBlessing();
        g.hud.showBanner(`바람의 가호 Lv.${after}`);
        g.hud.toast(`최대 기력 <b>+${(after - before) * 20}</b>`, '#9ff0e0');
      } else {
        const next = BLESSING[after + 1];
        g.hud.toast(`별바람의 눈 ${n}개를 바쳤습니다${next ? ` · 다음 단계까지 ${next - this.progress.offered}개` : ''}`, '#9ff0e0');
      }
    } else {
      g.hud.flashCenter('수호상의 바람이 상처를 치유합니다');
    }
    P.stamina = P.maxStamina;
    this.save();
  }

  applyBlessing() {
    const P = this.g.player;
    P.maxStamina = 100 + this.blessing * 20;
    P.stamina = Math.min(P.stamina, P.maxStamina);
  }

  beam(pos, color, height, radius, dur) {
    const geo = new THREE.CylinderGeometry(radius, radius * 1.15, 1, 24, 1, true);
    geo.translate(0, 0.5, 0);
    const mat = windMaterial(color, 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    mesh.scale.set(1, 0.01, 1);
    mesh.renderOrder = 6;
    this.scene.add(mesh);
    let t = 0;
    this.vfx.add({
      update: (dt) => {
        t += dt;
        const k = t / dur;
        mesh.scale.set(1 + k * 0.4, height * Math.min(1, t / 0.25), 1 + k * 0.4);
        mat.uniforms.uFade.value = Math.min(1, t / 0.1) * (1 - k) * 1.4;
        return k < 1;
      },
      dispose: () => {
        this.scene.remove(mesh);
        geo.dispose();
        mat.dispose();
      },
    });
  }

  // ------------------------------------------------------------------ data
  stats() {
    return {
      wp: this.S.waypoints.filter((w) => w.active).length,
      wpTotal: this.S.waypoints.length,
      orbs: this.progress.orbs.length,
      orbTotal: this.orbSpots.length,
      chests: this.progress.chests.length,
      chestTotal: this.chestSpots.length + (this.g.puzzles ? this.g.puzzles.list.length : 0),
      blessing: this.blessing,
      held: this.progress.held,
    };
  }

  minimapMarkers(P, out) {
    for (const wp of this.S.waypoints) out.push({ x: wp.x, z: wp.z, shape: 'wp', active: wp.active });
    const st = this.S.statue.center;
    out.push({ x: st.x, z: st.z, shape: 'statue' });
    // nearby eyes resonate on the minimap
    for (const o of this.orbs) {
      if (o.taken) continue;
      if (Math.abs(o.x - P.pos.x) < 45 && Math.abs(o.z - P.pos.z) < 45) out.push({ x: o.x, z: o.z, color: '#7ff5dc', r: 3.2, pulse: true });
    }
    return out;
  }

  save() {
    this.saveTimer = 0;
    if (this.g.loadedFromFile) return; // an imported save is about to load
    this.progress.gems = this.g.gems;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.progress));
    } catch (e) {}
  }
}
