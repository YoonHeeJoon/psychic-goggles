import * as THREE from 'three';
import { shared } from '../render/shaders.js';
import { toonMaterial } from '../render/materials.js';

// Ice and stone in the world:
//  - frost walking: with an ice character in front, water freezes into
//    hexagonal floes underfoot (and wherever ice skills land on water); the
//    floes are real ground for a few seconds, then melt away
//  - a chest locked in ice near the snowy foothills (melt it with fire)
//  - a cracked boulder sealing a chest in the highlands (earth, or heavy blows)

const MAX = 90;
const TOP = 0.12;

const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute float aSeed;
varying vec3 vN;
varying vec3 vW;
varying float vSeed;
void main(){
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vW = wp.xyz;
  vSeed = aSeed;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyAmb;
uniform float uTime;
varying vec3 vN;
varying vec3 vW;
varying float vSeed;
vec2 h2(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
// distance to the nearest voronoi edge: the frost cracks
float edge(vec2 p){
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = h2(i + g);
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return d2 - d1;
}
void main(){
  vec3 N = normalize(vN);
  float top = smoothstep(0.6, 0.9, N.y);
  vec3 V = normalize(cameraPosition - vW);
  float ndl = dot(N, uSunDir);
  float lit = smoothstep(-0.05, 0.15, ndl);
  vec3 deep = vec3(0.42, 0.68, 0.86);
  vec3 pale = vec3(0.86, 0.95, 1.0);
  vec2 q = vW.xz + vSeed * 17.0;
  float e = edge(q * 0.9);
  float e2 = edge(q * 2.7 + 3.1);
  vec3 base = mix(deep, pale, top * (0.55 + 0.45 * smoothstep(0.0, 0.5, e)));
  // white frost along the cracks
  base = mix(base, vec3(1.0), (1.0 - smoothstep(0.0, 0.045, e)) * 0.75 * top);
  base = mix(base, vec3(0.95, 0.99, 1.0), (1.0 - smoothstep(0.0, 0.03, e2)) * 0.35 * top);
  vec3 col = base * (uSkyAmb * 0.85 + uSunColor * 0.42 * lit);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += vec3(0.65, 0.88, 1.0) * fres * 0.45;
  vec3 H = normalize(uSunDir + V);
  col += uSunColor * pow(max(dot(N, H), 0.0), 60.0) * 0.6 * top;
  // glints
  float g = step(0.985, fract(sin(dot(floor(vW.xz * 9.0), vec2(12.9898, 78.233))) * 43758.5453 + uTime * 0.2));
  col += vec3(1.0) * g * 0.8 * top * lit;
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}`;

const ICE_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyAmb;
uniform float uMelt;
varying vec3 vNw;
varying vec3 vW;
void main(){
  vec3 N = normalize(vNw);
  vec3 V = normalize(cameraPosition - vW);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 2.2);
  float lit = smoothstep(-0.1, 0.4, dot(N, uSunDir));
  vec3 col = mix(vec3(0.55, 0.8, 0.95), vec3(0.92, 0.98, 1.0), fres) * (uSkyAmb * 0.8 + uSunColor * 0.4 * lit);
  vec3 H = normalize(uSunDir + V);
  col += uSunColor * pow(max(dot(N, H), 0.0), 40.0) * 0.5;
  gl_FragColor = vec4(col, (0.45 + fres * 0.5) * (1.0 - uMelt));
  #include <fog_fragment>
}`;
const ICE_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
varying vec3 vNw;
varying vec3 vW;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vNw = normalize(mat3(modelMatrix) * normal);
  vW = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const SEALS = [
  { id: 'iceChest', kind: 'ice', x: 68, z: -104, tier: 2 },
  { id: 'rockChest', kind: 'rock', x: 214, z: 270, tier: 2 },
];

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);

export class Frost {
  static reserve(terrain) {
    for (const s of SEALS) terrain.addBlocker(s.x, s.z, 4);
  }

  constructor(game) {
    this.g = game;
    const geo = new THREE.CylinderGeometry(1, 0.9, 0.32, 6, 1);
    geo.translate(0, -0.16, 0);
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1));
    this.uniforms = Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), {
      uSunDir: shared.uSunDir,
      uSunColor: shared.uSunColor,
      uSkyAmb: shared.uSkyAmb,
      uTime: shared.uTime,
    });
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, fog: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    game.scene.add(this.mesh);
    this.floes = [];
    this.seedAttr = geo.attributes.aSeed;
    this.solids = game.structures.solids;
    this.walkT = 0;
    this.buildSeals();
  }

  // ---------------------------------------------------------------- floes
  isWater(x, z) {
    return this.g.terrain.heightAt(x, z) < -0.35;
  }
  covered(x, z, pad = 0.75) {
    for (const f of this.floes) if (f.k > 0.2 && (f.x - x) ** 2 + (f.z - z) ** 2 < (f.r * pad) ** 2) return f;
    return null;
  }

  spawn(x, z, r = 1.7, life = 6) {
    if (!this.isWater(x, z)) return null;
    if (this.floes.length >= MAX) this.removeFloe(this.floes[0]);
    const f = { x, z, r: r * (0.9 + Math.random() * 0.25), rot: Math.random() * Math.PI, sx: 0.9 + Math.random() * 0.25, t: 0, life, k: 0, seed: Math.random() };
    f.solid = this.solids.addCircle(x, z, f.r * 0.92, TOP);
    this.floes.push(f);
    const vfx = this.g.combat.vfx;
    if (Math.random() < 0.6) vfx.burst(_p.set(x, 0.2, z), '#e8fbff', 6, { speed: 1.6, size: 0.12, life: 0.5, up: 0.8, gravity: 1 });
    return f;
  }

  // freeze any water inside a circle (ice skills landing on water)
  freezeArea(x, z, R, life = 7) {
    const step = 2.4;
    for (let i = -R; i <= R; i += step)
      for (let j = -R; j <= R; j += step) {
        if (i * i + j * j > R * R) continue;
        const px = x + i + (Math.random() - 0.5) * 0.6,
          pz = z + j + (Math.random() - 0.5) * 0.6;
        if (!this.covered(px, pz, 0.6)) this.spawn(px, pz, 1.6, life + Math.random());
      }
  }

  removeFloe(f) {
    this.solids.remove(f.solid);
    this.floes.splice(this.floes.indexOf(f), 1);
  }

  updateFloes(dt) {
    const g = this.g;
    const P = g.player;
    const st = g.state;
    // frost walking: freeze the water under and ahead of an ice character
    if ((st === 'playing' || st === 'cine') && P.current.cfg.element === 'ice' && (P.state === 'ground' || P.state === 'swim')) {
      const fx = Math.sin(P.yaw),
        fz = Math.cos(P.yaw);
      const moving = P.speed > 0.5;
      const pts = [[P.pos.x, P.pos.z]];
      if (moving) pts.push([P.pos.x + fx * 1.7, P.pos.z + fz * 1.7], [P.pos.x + fx * 3, P.pos.z + fz * 3]);
      for (const [x, z] of pts) {
        const f = this.covered(x, z);
        if (f) f.life = Math.max(f.life, f.t + 4);
        else if (this.isWater(x, z)) this.spawn(x + fx * 0.4, z + fz * 0.4, 1.75, 5);
      }
      if (moving && this.isWater(P.pos.x, P.pos.z)) {
        if (P.state === 'ground' && g.achievements) g.achievements.add('iceWalk', P.speed * dt);
        this.walkT -= dt;
        if (this.walkT <= 0) {
          this.walkT = 0.28;
          g.combat.vfx.burst(_p.set(P.pos.x, TOP + 0.05, P.pos.z), '#e8fbff', 4, { speed: 1.4, size: 0.1, life: 0.45, up: 0.6, gravity: 2 });
        }
      }
    }
    let n = 0;
    for (let i = this.floes.length - 1; i >= 0; i--) {
      const f = this.floes[i];
      f.t += dt;
      const grow = Math.min(1, f.t / 0.22);
      const melt = Math.max(0, Math.min(1, (f.life - f.t) / 1.2));
      f.k = grow * melt;
      if (f.t > f.life) {
        // the ice gives way under whoever stands on it
        g.water.puff(f.x, f.z, 0.5);
        this.removeFloe(f);
        continue;
      }
      // solid only while thick enough to stand on
      f.solid.top = f.k > 0.35 ? TOP : -5;
    }
    for (const f of this.floes) {
      const s = (0.35 + 0.65 * Math.sqrt(f.k)) * f.r;
      _q.setFromAxisAngle(Y, f.rot);
      _m.compose(_p.set(f.x, TOP - (1 - f.k) * 0.25, f.z), _q, _s.set(s * f.sx, 1, s));
      this.mesh.setMatrixAt(n, _m);
      this.seedAttr.array[n] = f.seed;
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.seedAttr.needsUpdate = true;
  }

  // ---------------------------------------------------------------- seals
  buildSeals() {
    const g = this.g;
    const prog = g.explore.progress;
    this.solved = prog.puzzles || (prog.puzzles = {});
    this.seals = [];
    for (const def of SEALS) {
      const y = g.terrain.heightAt(def.x, def.z);
      const s = { ...def, y, hits: 0, broken: !!this.solved[def.id], t: 0 };
      this.seals.push(s);
      if (s.broken) {
        // solved earlier but the chest was never opened
        if (!prog.chests.includes(def.id)) g.explore.spawnChest(def.id, { x: def.x, y, z: def.z }, def.tier);
        continue;
      }
      const grp = new THREE.Group();
      grp.position.set(def.x, y, def.z);
      g.scene.add(grp);
      s.group = grp;
      if (def.kind === 'ice') {
        // a chest inside a block of clear ice
        const chest = g.explore.buildChest(def.tier);
        chest.group.rotation.y = 0.6;
        grp.add(chest.group);
        const ig = new THREE.IcosahedronGeometry(1, 2);
        const p = ig.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const k = 1 + (Math.sin(p.getX(i) * 7.1) * Math.cos(p.getZ(i) * 5.3)) * 0.07;
          p.setXYZ(i, p.getX(i) * 1.25 * k, Math.max(-0.1, p.getY(i)) * 1.15 * k + 0.5, p.getZ(i) * 1.15 * k);
        }
        ig.computeVertexNormals();
        s.mat = new THREE.ShaderMaterial({
          vertexShader: ICE_VERT,
          fragmentShader: ICE_FRAG,
          uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), { uSunDir: shared.uSunDir, uSunColor: shared.uSunColor, uSkyAmb: shared.uSkyAmb, uMelt: { value: 0 } }),
          transparent: true,
          depthWrite: false,
          fog: true,
        });
        const ice = new THREE.Mesh(ig, s.mat);
        ice.renderOrder = 3;
        grp.add(ice);
        // frost spikes around the base
        const spike = toonMaterial({ color: '#d8f4ff', color2: '#8fc8e8', rim: 0.5, spec: 0.6 });
        for (let k = 0; k < 7; k++) {
          const a = (k / 7) * Math.PI * 2 + 0.3;
          const c = new THREE.Mesh(new THREE.ConeGeometry(0.16 + (k % 3) * 0.05, 0.7 + (k % 2) * 0.4, 5), spike);
          c.position.set(Math.cos(a) * 1.25, 0.25, Math.sin(a) * 1.2);
          c.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
          grp.add(c);
        }
        s.chest = chest;
        s.solid = this.solids.addCircle(def.x, def.z, 1.3, y + 1.6);
      } else {
        // a split boulder with a faint seam of light
        const rg = new THREE.DodecahedronGeometry(1.7, 1);
        const p = rg.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const x = p.getX(i),
            yy = p.getY(i),
            z = p.getZ(i);
          const k = 1 + Math.sin(x * 2.3 + z * 1.7) * 0.08 + Math.cos(yy * 3.1) * 0.06;
          p.setXYZ(i, x * k * 1.1, Math.max(-0.3, yy) * k * 0.85 + 0.9, z * k);
        }
        rg.computeVertexNormals();
        const rock = new THREE.Mesh(rg, toonMaterial({ color: '#9a8e7e', color2: '#6e6458', rim: 0.2, shadowTint: '#8a7a98' }));
        rock.castShadow = true;
        rock.receiveShadow = true;
        grp.add(rock);
        // glowing crack
        const crack = new THREE.Mesh(
          new THREE.TorusGeometry(1.55, 0.035, 4, 24, Math.PI * 1.1),
          new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd27a').multiplyScalar(2.2), transparent: true, opacity: 0.85 })
        );
        crack.position.y = 1.0;
        crack.rotation.set(0.25, 0.4, 1.35);
        grp.add(crack);
        s.crack = crack;
        s.rock = rock;
        s.solid = this.solids.addCircle(def.x, def.z, 1.7, y + 2.3);
      }
    }
  }

  near(s, x, z, r) {
    return Math.hypot(s.x - x, s.z - z) < r + (s.kind === 'ice' ? 1.4 : 1.8);
  }

  // an element landed somewhere (called by combat)
  onElement(x, z, r, el) {
    for (const s of this.seals) {
      if (s.broken || s.melting || !this.near(s, x, z, r)) continue;
      if (s.kind === 'ice' && el === 'fire') {
        s.hits++;
        this.g.combat.vfx.burst(_p.set(s.x, s.y + 1, s.z), '#ffffff', 16, { speed: 2.5, size: 0.3, life: 0.9, up: 1.5, gravity: -1 });
        if (s.hits >= 2) this.open(s);
        else this.g.hud.flashCenter('얼음이 조금 녹았습니다');
      } else if (s.kind === 'rock' && el === 'earth') this.open(s);
      else if (s.kind === 'ice' && el !== 'phys' && el !== 'fire' && !s.hinted) {
        s.hinted = true;
        this.g.hud.flashCenter('단단한 얼음입니다. 불로 녹일 수 있을 것 같아요');
      }
    }
  }

  // heavy blows (claymores, plunges) chip the boulder
  onHeavy(x, z, r) {
    for (const s of this.seals) {
      if (s.broken || s.kind !== 'rock' || !this.near(s, x, z, r)) continue;
      s.hits++;
      this.g.combat.vfx.burst(_p.set(s.x, s.y + 1.2, s.z), '#c9b89a', 14, { speed: 5, size: 0.22, life: 0.6, up: 1, gravity: 9 });
      this.g.cameraCtl.shake(0.15, 0.15);
      if (s.hits >= 3) this.open(s);
    }
  }

  // talk the player through it the first time they walk up
  consider(P, consider) {
    for (const s of this.seals) {
      if (s.broken) continue;
      consider(new THREE.Vector3(s.x, s.y, s.z), 3.6, s.kind === 'ice' ? '얼음에 갇힌 보물상자 · 불로 녹이기' : '금 간 바위 · 바위 원소나 대검으로 부수기', () =>
        this.g.hud.flashCenter(s.kind === 'ice' ? '불 원소 공격을 두 번 맞히면 얼음이 녹습니다' : '바위 원소나 묵직한 공격으로 부술 수 있습니다')
      );
    }
  }

  open(s) {
    const g = this.g;
    s.broken = true;
    this.solved[s.id] = true;
    this.solids.remove(s.solid);
    if (g.achievements) g.achievements.add('seals');
    if (s.kind === 'ice') {
      s.melting = 0.001;
      g.sfx.unseal();
    } else {
      g.combat.vfx.explosion(_p.set(s.x, s.y + 1, s.z), '#d8c39a', 3.4, 0.45);
      g.combat.vfx.burst(_p.set(s.x, s.y + 1, s.z), '#9a8e7e', 50, { speed: 9, size: 0.4, life: 1.0, up: 1.2, gravity: 14 });
      g.cameraCtl.shake(0.35, 0.3);
      g.sfx.land(9, 'stone');
      g.scene.remove(s.group);
      setTimeout(() => g.explore.spawnChest(s.id, { x: s.x, y: s.y, z: s.z }, s.tier), 500);
    }
    g.explore.save();
  }

  updateSeals(dt) {
    const g = this.g;
    for (const s of this.seals) {
      if (s.crack && !s.broken) s.crack.material.opacity = 0.55 + 0.35 * Math.sin(shared.uTime.value * 2.2);
      if (!s.melting) continue;
      s.melting += dt / 1.6;
      s.mat.uniforms.uMelt.value = Math.min(1, s.melting);
      if (Math.random() < 0.6) g.combat.vfx.burst(_p.set(s.x + (Math.random() - 0.5) * 2, s.y + 0.5 + Math.random(), s.z + (Math.random() - 0.5) * 2), '#ffffff', 2, { speed: 1, size: 0.35, life: 1.0, up: 1.5, gravity: -1.5 });
      for (const c of s.group.children) if (c.geometry && c.geometry.type === 'ConeGeometry') c.scale.setScalar(Math.max(0.01, 1 - s.melting));
      if (s.melting >= 1) {
        s.melting = 0;
        g.scene.remove(s.group);
        g.explore.spawnChest(s.id, { x: s.x, y: s.y, z: s.z }, s.tier);
      }
    }
  }

  update(dt) {
    this.updateFloes(dt);
    this.updateSeals(dt);
  }

  minimapMarkers(P, out) {
    for (const s of this.seals) {
      if (s.broken) continue;
      if (Math.abs(s.x - P.pos.x) < 70 && Math.abs(s.z - P.pos.z) < 70) out.push({ x: s.x, z: s.z, color: s.kind === 'ice' ? '#bdf0ff' : '#e8c27a', r: 3.5 });
    }
  }
}
