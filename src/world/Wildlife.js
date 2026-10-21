import * as THREE from 'three';
import { shared, terrainUniforms, TERRAIN_SAMPLE_GLSL } from '../render/shaders.js';
import { LANDMARKS } from './Terrain.js';
import { mulberry32, smoothstep, clamp } from '../core/noise.js';

// Small life around the island: butterflies over the flowers by day, bird
// flocks that peck in the meadows and scatter when you run at them, gulls
// circling the coast, fish in the mirror lake that leap now and then, and
// fireflies drifting over the grass at night.

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// One shader for every flapping / swimming creature. Wings bend around the
// body axis by |x|; fish wiggle their tail along -z.
const CRITTER_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec4 aP; // xyz position, w yaw
attribute vec4 aQ; // x phase, y amplitude, z scale, w pitch
attribute float aB; // wing base angle (fold)
attribute vec3 aCol;
uniform float uTime;
uniform float uFreq;
varying vec3 vCol;
varying vec2 vUv;
varying float vLocalY;
varying float vWorldY;
void main(){
  vec3 p = position;
  float ph = uTime * uFreq + aQ.x;
  #ifdef FISH
    float tail = smoothstep(0.05, -0.4, p.z);
    p.x += sin(ph - p.z * 9.0) * 0.1 * tail * aQ.y;
  #else
    float side = sign(p.x);
    float a = aB + sin(ph) * aQ.y;
    float r = abs(p.x);
    p = vec3(side * r * cos(a), p.y + r * sin(a), p.z);
  #endif
  vLocalY = position.y;
  p *= aQ.z;
  float cp = cos(aQ.w), sp = sin(aQ.w);
  p = vec3(p.x, p.y * cp - p.z * sp, p.y * sp + p.z * cp);
  float cy = cos(aP.w), sy = sin(aP.w);
  p = vec3(p.x * cy + p.z * sy, p.y, -p.x * sy + p.z * cy);
  vec3 wp = p + aP.xyz;
  vWorldY = wp.y;
  vCol = aCol;
  vUv = uv;
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const CRITTER_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uSunColor;
uniform vec3 uSkyAmb;
uniform float uNight;
varying vec3 vCol;
varying vec2 vUv;
varying float vLocalY;
varying float vWorldY;
void main(){
  vec3 col = vCol;
  float alpha = 1.0;
  #ifdef BUTTERFLY
    // fore and hind wing lobes, dark rim, pale spots near the tip
    vec2 q = vUv;
    float fore = length((q - vec2(0.48, 0.34)) / vec2(0.55, 0.36));
    float hind = length((q - vec2(0.36, 0.76)) / vec2(0.4, 0.3));
    float m = min(fore, hind);
    if (m > 1.0) discard;
    col = mix(col, vec3(0.08, 0.06, 0.07), smoothstep(0.72, 0.9, m));
    float spot = smoothstep(0.12, 0.06, length(q - vec2(0.78, 0.3)));
    col = mix(col, vec3(1.0), spot * 0.8);
    col *= 0.75 + 0.35 * q.x;
  #endif
  #ifdef FISH
    col = mix(col * 1.6 + 0.15, col, smoothstep(-0.6, 0.4, vLocalY));
    float under = smoothstep(0.05, -0.2, vWorldY);
    col = mix(col, vec3(0.05, 0.3, 0.35), under * 0.55);
    alpha = mix(1.0, 0.62, under);
  #endif
  vec3 light = uSkyAmb * 0.95 + uSunColor * 0.55;
  gl_FragColor = vec4(col * light, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

const FLY_VERT = /* glsl */ `
${TERRAIN_SAMPLE_GLSL}
attribute vec4 aSeed;
uniform float uTime;
uniform float uBox;
uniform float uPx;
uniform float uAmt;
varying float vA;
void main(){
  vec3 c = cameraPosition;
  vec2 xz;
  float t = uTime * 0.12 + aSeed.w * 30.0;
  vec2 drift = vec2(sin(t * 1.3 + aSeed.x * 9.0), cos(t * 1.1 + aSeed.z * 7.0)) * 1.5;
  xz.x = c.x + (fract(aSeed.x - c.x / uBox) - 0.5) * uBox + drift.x;
  xz.y = c.z + (fract(aSeed.z - c.z / uBox) - 0.5) * uBox + drift.y;
  float th = terrainHeight(xz);
  float y = max(th, 0.0) + 0.4 + aSeed.y * 2.3 + sin(t * 2.1 + aSeed.w * 20.0) * 0.35;
  vec4 mv = viewMatrix * vec4(xz.x, y, xz.y, 1.0);
  gl_Position = projectionMatrix * mv;
  float blink = 0.25 + 0.75 * pow(max(sin(uTime * (1.2 + aSeed.w) + aSeed.w * 40.0), 0.0), 3.0);
  float d = length(vec2(xz.x, xz.y) - c.xz);
  vA = blink * uAmt * smoothstep(uBox * 0.5, uBox * 0.3, d) * smoothstep(95.0, 70.0, th);
  gl_PointSize = clamp(0.22 * uPx / -mv.z, 1.5, 18.0) * (0.6 + 0.4 * blink);
}`;

const FLY_FRAG = /* glsl */ `
varying float vA;
void main(){
  vec2 q = gl_PointCoord - 0.5;
  float r = length(q) * 2.0;
  float g = smoothstep(1.0, 0.0, r);
  float a = (g * g * 0.8 + smoothstep(0.35, 0.0, r)) * vA;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(0.75, 1.0, 0.35) * 1.6 * a, 1.0);
}`;

function critterMaterial(defs, freq) {
  return new THREE.ShaderMaterial({
    vertexShader: CRITTER_VERT,
    fragmentShader: CRITTER_FRAG,
    defines: defs,
    uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), {
      uTime: shared.uTime,
      uFreq: { value: freq },
      uSunColor: shared.uSunColor,
      uSkyAmb: shared.uSkyAmb,
      uNight: shared.uNight,
    }),
    side: THREE.DoubleSide,
    fog: true,
    transparent: !!defs.FISH,
    depthWrite: !defs.FISH,
  });
}

// instanced geometry with per-instance dynamic attributes
function critterGeometry(base, n) {
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute('position', base.attributes.position);
  g.setAttribute('uv', base.attributes.uv || new THREE.Float32BufferAttribute(new Float32Array(base.attributes.position.count * 2), 2));
  const mk = (size) => {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(n * size), size);
    a.setUsage(THREE.DynamicDrawUsage);
    return a;
  };
  g.setAttribute('aP', mk(4));
  g.setAttribute('aQ', mk(4));
  g.setAttribute('aB', mk(1));
  g.setAttribute('aCol', mk(3));
  g.instanceCount = n;
  return g;
}

function setInst(g, i, pos, yaw, phase, amp, scale, pitch, base) {
  const P = g.attributes.aP.array,
    Q = g.attributes.aQ.array;
  P[i * 4] = pos.x;
  P[i * 4 + 1] = pos.y;
  P[i * 4 + 2] = pos.z;
  P[i * 4 + 3] = yaw;
  Q[i * 4] = phase;
  Q[i * 4 + 1] = amp;
  Q[i * 4 + 2] = scale;
  Q[i * 4 + 3] = pitch;
  g.attributes.aB.array[i] = base;
}

function setCol(g, i, c) {
  const C = g.attributes.aCol.array;
  C[i * 3] = c.r;
  C[i * 3 + 1] = c.g;
  C[i * 3 + 2] = c.b;
}

function wingsGeometry() {
  // two wing quads hinged on the body axis (x = 0), uv.x = span
  const pos = [],
    uv = [],
    idx = [];
  for (const s of [1, -1]) {
    const b = pos.length / 3;
    pos.push(0, 0, 0.55, s, 0, 0.55, s, 0, -0.55, 0, 0, -0.55);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function birdGeometry() {
  const p = [
    // body
    0, 0, 0.18, 0.035, 0, 0, 0, 0.035, 0,
    0, 0, 0.18, 0, 0.035, 0, -0.035, 0, 0,
    0, 0, 0.18, 0, -0.03, 0, 0.035, 0, 0,
    0, 0, 0.18, -0.035, 0, 0, 0, -0.03, 0,
    0, 0, -0.2, 0, 0.035, 0, 0.035, 0, 0,
    0, 0, -0.2, -0.035, 0, 0, 0, 0.035, 0,
    0, 0, -0.2, 0.035, 0, 0, 0, -0.03, 0,
    0, 0, -0.2, 0, -0.03, 0, -0.035, 0, 0,
    // tail fan
    0, 0, -0.17, 0.06, 0, -0.29, -0.06, 0, -0.29,
  ];
  // wings (inner + outer panel per side)
  for (const s of [1, -1]) {
    p.push(s * 0.03, 0, 0.07, s * 0.2, 0, 0.04, s * 0.03, 0, -0.07);
    p.push(s * 0.03, 0, -0.07, s * 0.2, 0, 0.04, s * 0.2, 0, -0.08);
    p.push(s * 0.2, 0, 0.04, s * 0.36, 0, -0.02, s * 0.2, 0, -0.08);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setIndex([...Array(p.length / 3).keys()]);
  return g;
}

function fishGeometry() {
  const body = new THREE.SphereGeometry(1, 12, 8);
  body.scale(0.065, 0.085, 0.27);
  const tail = new THREE.BufferGeometry();
  tail.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.22, 0, 0.1, -0.4, 0, -0.1, -0.4], 3));
  tail.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 2));
  tail.setAttribute('normal', new THREE.Float32BufferAttribute([1, 0, 0, 1, 0, 0, 1, 0, 0], 3));
  tail.setIndex([0, 1, 2]);
  const parts = [body, tail];
  // manual merge (both indexed)
  const pos = [],
    uv = [],
    idx = [];
  let off = 0;
  for (const g of parts) {
    const P = g.attributes.position,
      U = g.attributes.uv;
    for (let i = 0; i < P.count; i++) {
      pos.push(P.getX(i), P.getY(i), P.getZ(i));
      uv.push(U.getX(i), U.getY(i));
    }
    for (const k of g.index.array) idx.push(k + off);
    off += P.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export class Wildlife {
  constructor(game) {
    this.g = game;
    this.rand = mulberry32(909);
    this.t = 0;
    this.buildButterflies();
    this.buildBirds();
    this.buildFish();
    this.buildFireflies();
  }

  // ----------------------------------------------------------- butterflies
  buildButterflies() {
    const N = 26;
    this.bfGeo = critterGeometry(wingsGeometry(), N);
    this.bfMesh = new THREE.Mesh(this.bfGeo, critterMaterial({ BUTTERFLY: '' }, 15));
    this.bfMesh.frustumCulled = false;
    this.g.scene.add(this.bfMesh);
    const pal = ['#ffd24a', '#ff8fb8', '#9fd8ff', '#ffffff', '#ffa54a', '#c7a6ff'].map((c) => new THREE.Color(c));
    this.butterflies = [];
    for (let i = 0; i < N; i++) {
      this.butterflies.push({ pos: V3(), vel: V3(), home: V3(), target: V3(), t: 0, yaw: 0, phase: this.rand() * 6.28, alive: false });
      setCol(this.bfGeo, i, pal[i % pal.length]);
    }
  }

  spawnButterfly(b, P) {
    const T = this.g.terrain;
    const fl = this.g.vegetation.flowerItems || [];
    let x = 0,
      z = 0,
      ok = false;
    for (let k = 0; k < 24 && !ok; k++) {
      if (fl.length && k < 16) {
        const f = fl[Math.floor(this.rand() * fl.length)];
        if (Math.abs(f.x - P.x) < 34 && Math.abs(f.z - P.z) < 34 && Math.hypot(f.x - P.x, f.z - P.z) > 6) {
          x = f.x;
          z = f.z;
          ok = true;
        }
      } else {
        const a = this.rand() * Math.PI * 2,
          r = 8 + this.rand() * 24;
        x = P.x + Math.sin(a) * r;
        z = P.z + Math.cos(a) * r;
        ok = T.grassAt(x, z) > 0.55 && T.heightAt(x, z) > 1;
      }
    }
    if (!ok) return;
    b.home.set(x, T.heightAt(x, z), z);
    b.pos.copy(b.home).add(V3((this.rand() - 0.5) * 3, 0.8 + this.rand(), (this.rand() - 0.5) * 3));
    b.target.copy(b.pos);
    b.vel.set(0, 0, 0);
    b.alive = true;
  }

  updateButterflies(dt, P, show) {
    const T = this.g.terrain;
    const G = this.bfGeo;
    this.bfMesh.visible = show > 0.01;
    if (!this.bfMesh.visible) return;
    this.butterflies.forEach((b, i) => {
      if (!b.alive || b.pos.distanceToSquared(P) > 48 * 48) this.spawnButterfly(b, P);
      if (!b.alive) {
        setInst(G, i, b.pos, 0, 0, 0, 0, 0, 0);
        return;
      }
      b.t -= dt;
      if (b.t <= 0) {
        b.t = 0.8 + this.rand() * 2;
        b.target.set(b.home.x + (this.rand() - 0.5) * 5, 0, b.home.z + (this.rand() - 0.5) * 5);
        b.target.y = T.heightAt(b.target.x, b.target.z) + 0.35 + this.rand() * 1.4;
      }
      const d = _a.copy(b.target).sub(b.pos);
      const want = d.length() > 0.05 ? d.normalize().multiplyScalar(1.5) : d.set(0, 0, 0);
      b.vel.lerp(want, 1 - Math.exp(-dt * 2.2));
      b.vel.x += (this.rand() - 0.5) * 9 * dt;
      b.vel.y += (this.rand() - 0.5) * 9 * dt;
      b.vel.z += (this.rand() - 0.5) * 9 * dt;
      // shy of the player
      const fx = b.pos.x - P.x,
        fz = b.pos.z - P.z;
      const fd = Math.hypot(fx, fz);
      if (fd < 2.6) {
        b.vel.x += (fx / (fd || 1)) * 9 * dt;
        b.vel.z += (fz / (fd || 1)) * 9 * dt;
        b.vel.y += 6 * dt;
      }
      b.pos.addScaledVector(b.vel, dt);
      const floor = T.heightAt(b.pos.x, b.pos.z) + 0.15;
      if (b.pos.y < floor) {
        b.pos.y = floor;
        b.vel.y = Math.abs(b.vel.y);
      }
      if (b.vel.x * b.vel.x + b.vel.z * b.vel.z > 0.01) b.yaw = Math.atan2(b.vel.x, b.vel.z);
      setInst(G, i, b.pos, b.yaw, b.phase, 1.05, 0.085 * show, -0.25, 0.25);
    });
    G.attributes.aP.needsUpdate = true;
    G.attributes.aQ.needsUpdate = true;
    G.attributes.aB.needsUpdate = true;
    G.attributes.aCol.needsUpdate = true;
  }

  // ----------------------------------------------------------------- birds
  buildBirds() {
    const T = this.g.terrain;
    const rand = mulberry32(4711);
    this.flocks = [];
    const want = 10;
    // candidates: points along the dirt paths and on bare beaches, so the
    // birds are not lost in tall grass
    const cand = [];
    for (const poly of T.paths || []) {
      for (let k = 0; k < poly.length - 1; k++) {
        const [ax, az] = poly[k],
          [bx, bz] = poly[k + 1];
        const L = Math.hypot(bx - ax, bz - az);
        for (let d = 0; d < L; d += 22) cand.push([ax + ((bx - ax) * d) / L, az + ((bz - az) * d) / L]);
      }
    }
    for (let k = 0; k < 500; k++) cand.push([(rand() - 0.5) * 900, (rand() - 0.5) * 900]);
    for (let i = cand.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [cand[i], cand[j]] = [cand[j], cand[i]];
    }
    for (const [x, z] of cand) {
      if (this.flocks.length >= want) break;
      const h = T.heightAt(x, z);
      if (h < 1.2 || h > 70 || T.forestAt(x, z) > 0.3 || T.blocked(x, z, 6)) continue;
      if (T.grassAt(x, z) > 0.25 && T.pathDistance(x, z) > 1.8) continue;
      if (T.normalAt(x, z).y < 0.93) continue;
      if (this.flocks.some((f) => Math.hypot(f.x - x, f.z - z) < 70)) continue;
      this.flocks.push({ x, z, state: 'ground', t: 0, birds: [] });
    }
    const brown = [new THREE.Color('#8a6a4a'), new THREE.Color('#6f5a48'), new THREE.Color('#9c8466'), new THREE.Color('#5a4c44')];
    let n = 0;
    for (const f of this.flocks) {
      const count = 4 + Math.floor(rand() * 4);
      for (let i = 0; i < count; i++) f.birds.push({ i: n++, off: V3((rand() - 0.5) * 4, 0, (rand() - 0.5) * 4), pos: V3(), vel: V3(), yaw: rand() * 6.28, phase: rand() * 6.28, peck: rand() * 3, col: brown[i % 4] });
    }
    // gulls circling over the lake and the coasts
    this.gulls = [];
    const centers = [
      [LANDMARKS.lake.x, LANDMARKS.lake.z, 40],
      [LANDMARKS.lake.x + 30, LANDMARKS.lake.z - 20, 26],
      [330, 40, 50],
      [-60, 360, 45],
      [-380, 60, 55],
      [180, -330, 50],
    ];
    for (const [cx, cz, r] of centers) this.gulls.push({ i: n++, cx, cz, r, h: 42 + rand() * 30, a: rand() * 6.28, w: (0.1 + rand() * 0.08) * (rand() < 0.5 ? -1 : 1), phase: rand() * 6.28, flapT: rand() * 6 });
    this.birdGeo = critterGeometry(birdGeometry(), n);
    this.birdMesh = new THREE.Mesh(this.birdGeo, critterMaterial({ BIRD: '' }, 20));
    this.birdMesh.frustumCulled = false;
    this.g.scene.add(this.birdMesh);
    for (const f of this.flocks) for (const b of f.birds) setCol(this.birdGeo, b.i, b.col);
    const white = new THREE.Color('#f4f6f8');
    for (const s of this.gulls) setCol(this.birdGeo, s.i, white);
    this.birdGeo.attributes.aCol.needsUpdate = true;
  }

  updateBirds(dt, P, day, running) {
    const T = this.g.terrain;
    const G = this.birdGeo;
    for (const f of this.flocks) {
      const dp = Math.hypot(P.x - f.x, P.z - f.z);
      if (f.state === 'ground') {
        const fight = !!this.g.combat.action;
        const alarm = dp < 6.5 || (running && dp < 11) || (fight && dp < 14);
        if (alarm && day > 0.5) {
          f.state = 'fly';
          f.t = 0;
          for (const b of f.birds) {
            const ax = b.pos.x - P.x,
              az = b.pos.z - P.z;
            const l = Math.hypot(ax, az) || 1;
            b.vel.set((ax / l) * 4 + (this.rand() - 0.5) * 3, 3.5 + this.rand() * 2, (az / l) * 4 + (this.rand() - 0.5) * 3);
          }
          if (dp < 30) this.g.sfx.flutter();
        }
      } else if (f.state === 'fly') {
        f.t += dt;
        if (f.t > 9) {
          f.state = 'gone';
          f.t = 40 + this.rand() * 50;
        }
      } else if (f.state === 'gone') {
        f.t -= dt;
        if (f.t <= 0 && dp > 40) f.state = 'ground';
      }
      const show = f.state !== 'gone' && dp < 140 && day > 0.5;
      for (const b of f.birds) {
        if (!show) {
          setInst(G, b.i, b.pos, 0, 0, 0, 0, 0, 0);
          continue;
        }
        if (f.state === 'ground') {
          const x = f.x + b.off.x,
            z = f.z + b.off.z;
          b.peck -= dt;
          let hop = 0;
          if (b.peck < 0) {
            b.peck = 0.6 + this.rand() * 2.5;
            if (this.rand() < 0.3) {
              b.yaw += (this.rand() - 0.5) * 2;
              b.off.x += Math.sin(b.yaw) * 0.25;
              b.off.z += Math.cos(b.yaw) * 0.25;
              b.off.clampLength(0, 3);
            }
          }
          if (b.peck < 0.25) hop = Math.sin((b.peck / 0.25) * Math.PI) * 0.06;
          b.pos.set(x, T.heightAt(x, z) + 0.035 + hop, z);
          const pecking = Math.sin(this.t * 9 + b.phase) > 0.4 && b.peck > 0.4 ? 0.6 : 0;
          setInst(G, b.i, b.pos, b.yaw, 0, 0, 0.55, pecking, -1.45);
        } else {
          b.vel.y += (2.2 - b.vel.y * 0.3) * dt;
          const hs = Math.hypot(b.vel.x, b.vel.z);
          if (hs < 8) {
            b.vel.x *= 1 + dt * 0.6;
            b.vel.z *= 1 + dt * 0.6;
          }
          b.pos.addScaledVector(b.vel, dt);
          b.yaw = Math.atan2(b.vel.x, b.vel.z);
          const pitch = -Math.atan2(b.vel.y, hs) * 0.6;
          setInst(G, b.i, b.pos, b.yaw, b.phase, 1.0, 0.55, pitch, 0.15);
        }
      }
    }
    for (const s of this.gulls) {
      s.a += s.w * dt;
      const x = s.cx + Math.cos(s.a) * s.r,
        z = s.cz + Math.sin(s.a) * s.r;
      _a.set(x, s.h + Math.sin(s.a * 2) * 3, z);
      const yaw = Math.atan2(-Math.sin(s.a) * Math.sign(s.w), Math.cos(s.a) * Math.sign(s.w));
      s.flapT -= dt;
      if (s.flapT < -1.6) s.flapT = 4 + this.rand() * 5;
      const amp = s.flapT < 0 ? 0.7 : 0.04;
      const vis = day > 0.5 ? 1 : 0;
      setInst(G, s.i, _a, yaw, s.phase, amp, vis, 0, 0.12);
    }
    G.attributes.aP.needsUpdate = true;
    G.attributes.aQ.needsUpdate = true;
    G.attributes.aB.needsUpdate = true;
  }

  // ------------------------------------------------------------------ fish
  buildFish() {
    const N = 14;
    this.fishGeo = critterGeometry(fishGeometry(), N);
    this.fishMesh = new THREE.Mesh(this.fishGeo, critterMaterial({ FISH: '' }, 9));
    this.fishMesh.frustumCulled = false;
    this.fishMesh.renderOrder = 3; // after the water surface
    this.g.scene.add(this.fishMesh);
    const cols = ['#5d7f9a', '#7a8f6a', '#c9874a', '#8a9aae'].map((c) => new THREE.Color(c));
    this.fish = [];
    for (let i = 0; i < N; i++) {
      const f = { pos: V3(), target: V3(), yaw: 0, speed: 1, phase: this.rand() * 6.28, jump: null, depth: 0.35 + this.rand() * 0.5 };
      this.pickFishTarget(f, true);
      f.pos.copy(f.target);
      this.fish.push(f);
      setCol(this.fishGeo, i, cols[i % cols.length]);
    }
    this.fishGeo.attributes.aCol.needsUpdate = true;
    this.jumpT = 6;
  }

  pickFishTarget(f) {
    const T = this.g.terrain;
    const L = LANDMARKS.lake;
    for (let k = 0; k < 30; k++) {
      const a = this.rand() * Math.PI * 2,
        r = Math.sqrt(this.rand()) * L.r * 0.85;
      const x = L.x + Math.cos(a) * r,
        z = L.z + Math.sin(a) * r;
      const h = T.heightAt(x, z);
      if (h < -1.1) {
        f.target.set(x, Math.max(h + 0.35, -f.depth), z);
        return;
      }
    }
  }

  updateFish(dt, P) {
    const G = this.fishGeo;
    const near = Math.hypot(P.x - LANDMARKS.lake.x, P.z - LANDMARKS.lake.z) < 180;
    this.fishMesh.visible = near;
    if (!near) return;
    this.jumpT -= dt;
    if (this.jumpT <= 0) {
      this.jumpT = 7 + this.rand() * 12;
      const f = this.fish[Math.floor(this.rand() * this.fish.length)];
      if (!f.jump) {
        const dx = Math.sin(f.yaw),
          dz = Math.cos(f.yaw);
        f.jump = { t: 0, from: f.pos.clone(), dx, dz };
        this.splash(f.pos);
      }
    }
    this.fish.forEach((f, i) => {
      if (f.jump) {
        const J = f.jump;
        J.t += dt / 0.95;
        const t = Math.min(J.t, 1);
        f.pos.set(J.from.x + J.dx * 2.6 * t, J.from.y + Math.sin(t * Math.PI) * 1.7, J.from.z + J.dz * 2.6 * t);
        const pitch = (t - 0.5) * 2.4;
        setInst(G, i, f.pos, f.yaw, f.phase, 1.6, 1, pitch, 0);
        if (J.t >= 1) {
          this.splash(f.pos);
          f.jump = null;
          this.pickFishTarget(f);
        }
        return;
      }
      const dx = f.target.x - f.pos.x,
        dy = f.target.y - f.pos.y,
        dz = f.target.z - f.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.8) this.pickFishTarget(f);
      // flee a swimmer
      const px = f.pos.x - P.x,
        pz = f.pos.z - P.z;
      const pd = Math.hypot(px, pz);
      let speed = 0.9;
      let want = Math.atan2(dx, dz);
      if (pd < 5 && P.y < 1.5) {
        want = Math.atan2(px, pz);
        speed = 3;
      }
      let da = want - f.yaw;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      f.yaw += clamp(da, -2.5 * dt, 2.5 * dt);
      f.speed += (speed - f.speed) * Math.min(1, dt * 2);
      f.pos.x += Math.sin(f.yaw) * f.speed * dt;
      f.pos.z += Math.cos(f.yaw) * f.speed * dt;
      f.pos.y += dy * Math.min(1, dt);
      setInst(G, i, f.pos, f.yaw, f.phase, 0.6 + f.speed * 0.5, 1, 0, 0);
    });
    G.attributes.aP.needsUpdate = true;
    G.attributes.aQ.needsUpdate = true;
  }

  splash(p) {
    if (p.distanceTo(this.g.camera.position) > 70) return;
    this.g.combat.vfx.burst(_b.set(p.x, 0.1, p.z), '#cfefff', 12, { speed: 2.5, size: 0.12, life: 0.5, up: 1.5, gravity: 9 });
    this.g.sfx.fishSplash();
  }

  // ------------------------------------------------------------- fireflies
  buildFireflies() {
    const N = this.g.quality.grass > 150000 ? 300 : 150;
    const g = new THREE.BufferGeometry();
    const seed = new Float32Array(N * 4);
    for (let i = 0; i < N * 4; i++) seed[i] = Math.random();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(N * 3), 3));
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 4));
    this.flyMat = new THREE.ShaderMaterial({
      vertexShader: FLY_VERT,
      fragmentShader: FLY_FRAG,
      uniforms: { uTime: shared.uTime, uBox: { value: 64 }, uPx: { value: 600 }, uAmt: { value: 0 }, ...terrainUniforms },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.flies = new THREE.Points(g, this.flyMat);
    this.flies.frustumCulled = false;
    this.flies.renderOrder = 6;
    this.g.scene.add(this.flies);
  }

  update(dt) {
    this.t += dt;
    const g = this.g;
    const P = g.state === 'playing' || g.state === 'paused' || g.state === 'map' ? g.player.pos : g.camera.position;
    const rain = g.weather ? g.weather.rain : 0;
    const day = smoothstep(-0.02, 0.12, g.env.sunDir.y);
    const calm = 1 - smoothstep(0.15, 0.45, rain);
    const running = g.player.speed > 6;
    this.updateButterflies(dt, P, day * calm);
    this.updateBirds(dt, P, day * (0.4 + 0.6 * calm), running);
    this.updateFish(dt, P);
    const night = shared.uNight.value;
    this.flyMat.uniforms.uAmt.value = night * calm;
    this.flies.visible = night * calm > 0.02;
    const cam = g.camera;
    this.flyMat.uniforms.uPx.value = (g.renderer.domElement.height * 0.5) / Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
  }
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
