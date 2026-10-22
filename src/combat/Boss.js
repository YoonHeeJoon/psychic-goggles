import * as THREE from 'three';
import { shared } from '../render/shaders.js';
import { resolveReaction } from './elements.js';
import { clamp, damp, smoothstep } from '../core/noise.js';

// 뇌광의 결정체 · 아르크 — a storm-crystal guardian that sleeps in the eastern
// arena. A floating core with eight orbiting shards that rearrange into
// attacks: shard rain, a sweeping beam, a falling pillar and a ground pulse.
// At half health it hides behind an electro shield (break it with reactions),
// is stunned when the shield breaks, then fights on faster.

const TAU = Math.PI * 2;
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

const CRYSTAL_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
varying vec3 vW;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const CRYSTAL_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uA;
uniform vec3 uB;
uniform float uGlow;
uniform float uFlash;
uniform float uDim;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyAmb;
varying vec3 vW;
void main(){
  vec3 N = normalize(cross(dFdx(vW), dFdy(vW)));
  vec3 V = normalize(cameraPosition - vW);
  if (dot(N, V) < 0.0) N = -N;
  float fr = pow(1.0 - max(dot(N, V), 0.0), 2.0);
  float l = max(dot(N, uSunDir), 0.0);
  vec3 col = mix(uA, uB, fr * 0.85 + 0.15 * (N.y * 0.5 + 0.5));
  col *= uSkyAmb * 0.9 + uSunColor * l * 0.5 + 0.25;
  float pulse = 0.6 + 0.4 * sin(uTime * 3.0 + vW.y * 1.5);
  col += uB * (uGlow * pulse + fr * 0.6) * 0.9;
  vec3 H = normalize(uSunDir + V);
  col += uSunColor * pow(max(dot(N, H), 0.0), 60.0) * 0.8;
  col *= uDim;
  col = mix(col, vec3(1.0, 0.95, 1.0), uFlash);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

const FX_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main(){
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
// mode 0: ground circle (fill grows), 1: ground line, 2: shield bubble, 3: soft glow
const FX_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uProg;
uniform float uAlpha;
uniform float uMode;
uniform float uTime;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main(){
  float a = 0.0;
  if (uMode < 0.5) {
    float r = length(vUv - 0.5) * 2.0;
    if (r > 1.0) discard;
    float rim = smoothstep(0.9, 0.97, r) * smoothstep(1.0, 0.97, r);
    float fill = step(r, uProg) * (0.18 + 0.25 * smoothstep(uProg - 0.08, uProg, r));
    a = rim * 0.9 + fill + 0.06;
  } else if (uMode < 1.5) {
    float x = abs(vUv.x - 0.5) * 2.0;
    float y = 1.0 - vUv.y; // 0 at the boss, 1 at the far end
    float rim = smoothstep(0.86, 0.95, x);
    float fill = step(y, uProg) * 0.25;
    a = rim * 0.8 + fill + 0.05;
    a *= smoothstep(1.0, 0.9, y);
  } else if (uMode < 2.5) {
    float fr = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
    float hex = abs(sin(vUv.x * 60.0 + uTime) * sin(vUv.y * 34.0 - uTime * 0.7));
    a = fr * 0.8 + smoothstep(0.92, 1.0, hex) * 0.25 + 0.05;
  } else if (uMode < 3.5) {
    float fr = pow(abs(dot(normalize(vN), normalize(vV))), 1.5);
    a = fr;
  } else {
    // expanding shock ring on the floor; uProg = radius fraction
    float r = length(vUv - 0.5) * 2.0;
    float band = smoothstep(0.035, 0.0, abs(r - uProg));
    float trail = smoothstep(0.0, 0.12, uProg - r) * step(r, uProg) * 0.15 * smoothstep(uProg - 0.25, uProg, r);
    a = band * 1.2 + trail;
  }
  a *= uAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor * a, a);
}`;

export function fxMat(color, mode) {
  return new THREE.ShaderMaterial({
    vertexShader: FX_VERT,
    fragmentShader: FX_FRAG,
    uniforms: { uColor: { value: new THREE.Color(color) }, uProg: { value: 0 }, uAlpha: { value: 1 }, uMode: { value: mode }, uTime: shared.uTime },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    polygonOffset: mode < 1.5,
    polygonOffsetFactor: -3,
  });
}

function shardGeometry() {
  const g = new THREE.CylinderGeometry(0, 0.55, 2.6, 5, 1);
  const tip = new THREE.CylinderGeometry(0.55, 0, 0.9, 5, 1);
  tip.translate(0, -1.75, 0);
  const pos = [];
  for (const p of [g.toNonIndexed(), tip.toNonIndexed()]) pos.push(...p.attributes.position.array);
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.translate(0, 0.45, 0);
  return out;
}

// the faceted crystal look (also used by the frost giant's ice)
export function crystalMaterial(a, b, glow = 0.4) {
  return new THREE.ShaderMaterial({
    vertexShader: CRYSTAL_VERT,
    fragmentShader: CRYSTAL_FRAG,
    uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), {
      uA: { value: new THREE.Color(a) },
      uB: { value: new THREE.Color(b) },
      uGlow: { value: glow },
      uFlash: { value: 0 },
      uDim: { value: 1 },
      uTime: shared.uTime,
      uSunDir: shared.uSunDir,
      uSunColor: shared.uSunColor,
      uSkyAmb: shared.uSkyAmb,
    }),
    fog: true,
  });
}

export class Boss {
  constructor(game) {
    this.g = game;
    this.mgr = game.combat.enemies;
    this.isBoss = true;
    this.type = 'boss';
    this.name = '뇌광의 결정체 · 아르크';
    this.title = '잠든 폭풍의 핵';
    this.selfEl = 'thunder';
    this.level = 35;
    const A = game.structures.arena;
    this.home = A.center.clone();
    this.arenaR = A.r;
    this.pos = this.home.clone();
    this.vel = V3();
    this.yaw = 0;
    this.radius = 2.4;
    this.height = 7.4;
    this.maxHp = 260000;
    this.hp = this.maxHp;
    this.alive = true;
    this.aggro = false;
    this.aura = 'thunder';
    this.auraT = 1e9;
    this.auraRegen = 0;
    this.frozenT = 0;
    this.chargedT = 0;
    this.chargeTick = 0;
    this.superT = 0;
    this.stunT = 0;
    this.airborne = false;
    this.home.y = this.pos.y;
    this.state = 'dormant';
    this.st = 0; // time in state
    this.t = 0;
    this.phase = 1;
    this.shield = 0;
    this.shieldMax = this.maxHp * 0.16;
    this.cool = 2;
    this.lastAttack = '';
    this.adds = [];
    this.away = 0;
    this.respawnT = 0;
    this.corePos = this.home.clone().add(V3(0, 4, 0));
    this.build();
    this.mgr.list.push(this);
    this.setDormantPose(true);
  }

  // ---------------------------------------------------------------- visuals
  build() {
    const g = this.g;
    const mat = new THREE.ShaderMaterial({
      vertexShader: CRYSTAL_VERT,
      fragmentShader: CRYSTAL_FRAG,
      uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), {
        uA: { value: new THREE.Color('#2a1450') },
        uB: { value: new THREE.Color('#c48bff') },
        uGlow: { value: 0.4 },
        uFlash: { value: 0 },
        uDim: { value: 1 },
        uTime: shared.uTime,
        uSunDir: shared.uSunDir,
        uSunColor: shared.uSunColor,
        uSkyAmb: shared.uSkyAmb,
      }),
      fog: true,
    });
    this.mat = mat;
    const root = new THREE.Group();
    this.model = { root, mats: [] };
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(1.25, 0), mat);
    core.scale.set(1, 1.55, 1);
    core.castShadow = true;
    root.add(core);
    this.core = core;
    const glow = new THREE.Mesh(new THREE.SphereGeometry(2.4, 24, 16), fxMat('#b37bff', 3));
    glow.material.uniforms.uAlpha.value = 0.35;
    core.add(glow);
    this.glow = glow;
    // orbit rings
    this.rings = [];
    for (let k = 0; k < 2; k++) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(2.3 + k * 0.6, 0.05, 6, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color('#d6b0ff').multiplyScalar(1.8), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
      root.add(r);
      this.rings.push(r);
    }
    this.shards = [];
    const sg = shardGeometry();
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(sg, mat);
      m.castShadow = true;
      root.add(m);
      this.shards.push({ mesh: m, pos: V3(), target: V3(), spin: Math.random() * TAU, q: new THREE.Quaternion(), free: false });
    }
    const shield = new THREE.Mesh(new THREE.IcosahedronGeometry(4.2, 3), fxMat('#c08cff', 2));
    shield.visible = false;
    root.add(shield);
    this.shieldMesh = shield;
    g.scene.add(root);
    // pooled telegraphs and effects (world space, not parented)
    this.decals = [];
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1, 16, 1, true), fxMat('#e0b8ff', 3));
    this.beam.visible = false;
    this.beam.renderOrder = 6;
    g.scene.add(this.beam);
    const pg = new THREE.PlaneGeometry(1, 1);
    pg.rotateX(-Math.PI / 2);
    this.pulseMesh = new THREE.Mesh(pg, fxMat('#e0b0ff', 4));
    this.pulseSize = (this.arenaR + 4) * 2;
    this.pulseMesh.scale.set(this.pulseSize, 1, this.pulseSize);
    this.pulseMesh.renderOrder = 3;
    this.pulseMesh.visible = false;
    g.scene.add(this.pulseMesh);
  }

  decal(kind) {
    let d = this.decals.find((x) => !x.mesh.visible && x.kind === kind);
    if (!d) {
      const geo = new THREE.PlaneGeometry(1, 1);
      geo.rotateX(-Math.PI / 2);
      if (kind === 'line') geo.translate(0, 0, 0.5);
      const mesh = new THREE.Mesh(geo, fxMat('#ff4f7a', kind === 'line' ? 1 : 0));
      mesh.renderOrder = 3;
      this.g.scene.add(mesh);
      d = { kind, mesh };
      this.decals.push(d);
    }
    d.mesh.visible = true;
    d.mesh.material.uniforms.uProg.value = 0;
    d.mesh.material.uniforms.uAlpha.value = 1;
    return d;
  }

  clearDecals() {
    for (const d of this.decals) d.mesh.visible = false;
  }

  setDormantPose(snap) {
    // shards stacked into a tall crystal cluster
    this.shards.forEach((s, i) => {
      const a = (i / 8) * TAU;
      const r = i % 2 ? 1.1 : 0.6;
      s.target.set(this.home.x + Math.cos(a) * r, this.home.y + 1.0 + (i % 3) * 0.5, this.home.z + Math.sin(a) * r);
      s.tilt = (i % 2 ? 0.35 : 0.15) * (i % 4 < 2 ? 1 : -1);
      if (snap) s.pos.copy(s.target);
    });
    this.corePos.set(this.home.x, this.home.y + 1.6, this.home.z);
  }

  // ---------------------------------------------------------------- combat API
  center(out = new THREE.Vector3()) {
    return out.copy(this.corePos);
  }
  get headPos() {
    return _v.copy(this.corePos).setY(this.corePos.y + 2.5);
  }
  applyElement(el) {
    if (!el || el === 'phys') return null;
    const r = resolveReaction(this.aura, el);
    this.lastReact = r ? 1 : 0;
    if (!r) return null;
    if (r.type !== 'charged') {
      this.aura = null;
      this.auraRegen = 1.8;
    }
    return r;
  }
  freeze() {}
  unfreeze() {
    this.frozenT = 0;
  }
  hit(dmg) {
    if (!this.alive || this.state === 'dormant' || this.state === 'intro') return;
    this.flash = 0.12;
    this.aggro = true;
    if (this.shield > 0) {
      const eff = this.lastReact ? 3.2 : 0.45;
      this.shield -= dmg * eff;
      this.lastReact = 0;
      this.shieldHit = 0.2;
      if (this.shield <= 0) this.breakShield();
      return;
    }
    this.lastReact = 0;
    this.hp -= dmg * (this.state === 'stunned' ? 1.5 : 1);
    if (this.phase === 1 && !this.shieldDone && this.hp <= this.maxHp * 0.5) {
      this.shieldDone = true;
      this.hp = this.maxHp * 0.5;
      this.enter('shield');
    }
    if (this.hp <= 0) this.die();
  }
  die() {
    if (!this.alive) return;
    this.hp = 0;
    this.alive = false;
    this.enter('dead');
    this.clearAdds();
    this.mgr.onDeath(this);
    this.g.onBossDefeated(this);
  }
  setFlash(v) {
    this.mat.uniforms.uFlash.value = v;
  }

  // ---------------------------------------------------------------- states
  enter(s) {
    this.state = s;
    this.st = 0;
    this.hitDone = false;
    this.clearDecals();
    this.beam.visible = false;
    this.pulseMesh.visible = false;
    for (const sh of this.shards) sh.free = false;
    // per-attack scratch state
    this.zones = null;
    this.beams = null;
    this.beamT = undefined;
    this.col = null;
    this.pulseCharged = false;
    this.pulsing = false;
    this.shookRain = false;
    this.mat.uniforms.uGlow.value = 0.4;
    const g = this.g;
    if (s === 'shield') {
      this.shield = this.shieldMax;
      this.shieldMesh.visible = true;
      g.hud.flashCenter('뇌광의 결정체가 방어막을 둘렀습니다 · 원소 반응으로 깨뜨리세요', 2800);
      g.sfx.bossShield();
      this.summonAdds();
    }
    if (s === 'stunned') {
      this.shieldMesh.visible = false;
      g.cameraCtl.shake(0.35, 0.4);
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
    this.shieldDone = false;
    this.alive = true;
    this.aggro = false;
    this.shieldMesh.visible = false;
    this.model.root.visible = true;
    this.mat.uniforms.uDim.value = 1;
    this.clearAdds();
    this.enter('dormant');
    this.setDormantPose(false);
    this.away = 0;
  }

  summonAdds() {
    const m = this.mgr;
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * TAU + 0.5;
      const e = m.spawn('slime', k === 1 ? 'water' : 'thunder', this.home.x + Math.cos(a) * 9, this.home.z + Math.sin(a) * 9, 30);
      this.adds.push(e);
      this.g.combat.vfx.burst(e.center(new THREE.Vector3()), '#c48bff', 20, { speed: 5, size: 0.22, life: 0.6, up: 0.6 });
    }
  }

  clearAdds() {
    for (const e of this.adds) this.mgr.remove(e);
    this.adds.length = 0;
  }

  breakShield() {
    this.shield = 0;
    this.phase = 2;
    const g = this.g;
    g.combat.vfx.explosion(this.corePos.clone(), '#d8b0ff', 5, 0.6);
    g.combat.vfx.burst(this.corePos.clone(), '#e8d0ff', 60, { speed: 10, size: 0.3, life: 0.9, up: 0.3 });
    g.hud.flashCenter('방어막 파괴!', 1600);
    g.sfx.bossBreak();
    g.combat.hitStop = 0.12;
    this.enter('stunned');
  }

  // damage the player if inside a zone (iframes / dodges handled by combat)
  strike(cond, dmg) {
    const P = this.g.player;
    if (cond(P.pos)) {
      const scale = 1 + (this.level - 20) * 0.03;
      this.g.combat.hurtPlayer(Math.round(dmg * scale), { pos: this.corePos });
    }
  }

  pickAttack() {
    const P = this.g.player.pos;
    const d = Math.hypot(P.x - this.pos.x, P.z - this.pos.z);
    const opts = ['rain', 'beam', 'pillar', 'pulse'].filter((a) => a !== this.lastAttack);
    let pick;
    if (d < 6 && opts.includes('pulse') && Math.random() < 0.6) pick = 'pulse';
    else pick = opts[Math.floor(Math.random() * opts.length)];
    this.lastAttack = pick;
    this.enter(pick);
  }

  // ---------------------------------------------------------------- update
  update(dt, player) {
    const g = this.g;
    this.t += dt;
    this.st += dt;
    const sp = this.phase === 2 ? 1.35 : 1;
    const P = player.pos;
    const fromHome = Math.hypot(P.x - this.home.x, P.z - this.home.z);

    // aura and status timers (charged ticks behave like on other enemies)
    if (!this.aura) {
      this.auraRegen -= dt;
      if (this.auraRegen <= 0) this.aura = 'thunder';
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
    this.setFlash(this.flash > 0 ? 0.6 : 0);
    this.shieldHit = Math.max(0, (this.shieldHit || 0) - dt);

    if (this.state === 'dead') return this.updateDead(dt);

    // wake when someone steps into the arena; give up if they run away
    if (this.state === 'dormant') {
      if (fromHome < this.arenaR - 3 && Math.abs(P.y - this.home.y) < 6 && g.state === 'playing') this.wake();
    } else {
      this.away = fromHome > this.arenaR + 22 ? this.away + dt : 0;
      if (this.away > 4 || player.dead) {
        g.hud.flashCenter('도전 실패 · 결정체가 다시 잠들었습니다', 2000);
        g.onBossReset(this);
        this.reset();
        return;
      }
    }

    // hover position: drift towards the player but stay near the middle
    const coreY = this.home.y + (this.state === 'stunned' ? 1.3 : this.state === 'shield' ? 6.2 : 4.2);
    if (this.state !== 'dormant' && this.state !== 'intro') {
      const tx = this.home.x + clamp(P.x - this.home.x, -9, 9) * (this.state === 'shield' ? 0 : 0.45);
      const tz = this.home.z + clamp(P.z - this.home.z, -9, 9) * (this.state === 'shield' ? 0 : 0.45);
      const mv = this.state === 'idle' ? 1.2 : 0.4;
      this.pos.x = damp(this.pos.x, tx, mv, dt);
      this.pos.z = damp(this.pos.z, tz, mv, dt);
      this.yaw = Math.atan2(P.x - this.pos.x, P.z - this.pos.z);
    }
    const bob = Math.sin(this.t * 1.6) * 0.25;
    this.corePos.x = this.pos.x;
    this.corePos.z = this.pos.z;
    if (this.state === 'dormant') this.corePos.y = damp(this.corePos.y, this.home.y + 1.6, 2, dt);
    else if (this.state === 'intro') this.corePos.y = damp(this.corePos.y, coreY + bob, 1.6, dt);
    else this.corePos.y = damp(this.corePos.y, coreY + bob, 3, dt);
    this.pos.y = this.home.y;

    // default shard orbit
    const orbitR = this.state === 'pulse' && this.st < 0.9 ? 2.2 : 3.6;
    const spin = this.t * (this.phase === 2 ? 1.25 : 0.8);
    this.shards.forEach((s, i) => {
      if (s.free) return;
      if (this.state === 'dormant') return;
      if (this.state === 'stunned') {
        const a = (i / 8) * TAU + 0.3;
        s.target.set(this.home.x + Math.cos(a) * (3 + (i % 3)), this.home.y + 0.5, this.home.z + Math.sin(a) * (3 + (i % 3)));
        return;
      }
      const a = spin + (i / 8) * TAU;
      s.target.set(this.corePos.x + Math.cos(a) * orbitR, this.corePos.y + Math.sin(a * 2 + this.t) * 0.6, this.corePos.z + Math.sin(a) * orbitR);
    });

    switch (this.state) {
      case 'intro':
        if (this.st > 3.6) this.enter('idle');
        break;
      case 'idle':
        this.cool -= dt * sp;
        if (this.cool <= 0) {
          this.cool = this.phase === 2 ? 1.0 : 1.7;
          this.pickAttack();
        }
        break;
      case 'rain':
        this.updateRain(dt, sp);
        break;
      case 'beam':
        this.updateBeam(dt, sp);
        break;
      case 'pillar':
        this.updatePillar(dt, sp);
        break;
      case 'pulse':
        this.updatePulse(dt, sp);
        break;
      case 'shield':
        this.pulseT = (this.pulseT || 0) - dt;
        if (this.st > 2 && this.pulseT <= 0 && !this.pulsing) {
          this.pulseT = 6;
          this.pulsing = true;
          this.pulseStart = this.st;
        }
        if (this.pulsing) {
          const lt = this.st - this.pulseStart;
          this.pulseRing(lt, 1);
          if (lt > 2.4) {
            this.pulsing = false;
            this.pulseMesh.visible = false;
            this.hitDone = false;
          }
        }
        break;
      case 'stunned':
        if (this.st > 7) {
          g.hud.flashCenter('결정체가 격노합니다!', 1600);
          g.sfx.bossRoar();
          this.enter('idle');
        }
        break;
    }
    this.animate(dt);
  }

  // Shard Rain: shards rise and fall on several marked circles
  updateRain(dt, sp) {
    const st = this.st * sp;
    const P = this.g.player.pos;
    if (!this.zones) {
      this.zones = [];
      const n = this.phase === 2 ? 8 : 5;
      for (let k = 0; k < n; k++) {
        const a = Math.random() * TAU,
          r = k === 0 ? 0 : 2.5 + Math.random() * 6;
        const x = P.x + Math.cos(a) * r,
          z = P.z + Math.sin(a) * r;
        const y = this.g.ground.heightAt(x, z);
        const d = this.decal('circle');
        d.mesh.position.set(x, y + 0.06, z);
        d.mesh.scale.setScalar(4.8);
        this.zones.push({ x, y, z, d, shard: this.shards[k % 8], hit: false });
      }
      this.g.sfx.bossCharge();
    }
    for (const zn of this.zones) {
      const s = zn.shard;
      s.free = true;
      zn.d.mesh.material.uniforms.uProg.value = clamp(st / 1.25, 0, 1);
      if (st < 1.25) s.target.set(zn.x, zn.y + 14, zn.z);
      else if (st < 1.45) s.target.set(zn.x, zn.y + 0.8, zn.z);
      if (st >= 1.3 && !zn.hit) {
        zn.hit = true;
        s.pos.set(zn.x, zn.y + 0.8, zn.z);
        zn.d.mesh.visible = false;
        this.g.combat.vfx.burst(_v.set(zn.x, zn.y + 0.4, zn.z), '#d6a8ff', 16, { speed: 6, size: 0.25, life: 0.5, up: 0.8 });
        this.g.combat.vfx.ring(_v.set(zn.x, zn.y + 0.1, zn.z), '#c48bff', 2.6, 0.35);
        this.strike((p) => Math.hypot(p.x - zn.x, p.z - zn.z) < 2.5 && p.y - zn.y < 2.5, 1200);
        this.g.sfx.bossImpact(0.6);
      }
    }
    if (st > 1.3 && !this.shookRain) {
      this.shookRain = true;
      this.g.cameraCtl.shake(0.15, 0.25);
    }
    if (st > 2.3) this.enter('idle');
  }

  // Beam: aim, charge, fire a straight beam (phase 2 adds a second angled beam)
  updateBeam(dt, sp) {
    const st = this.st * sp;
    const P = this.g.player.pos;
    const fire = (lt, k) => {
      const b = this.beams[k];
      const L = 42;
      if (lt < 1.05) {
        b.d.mesh.material.uniforms.uProg.value = clamp(lt / 1.05, 0, 1);
      } else if (!b.fired) {
        b.fired = true;
        b.d.mesh.visible = false;
        const bm = this.beam;
        bm.visible = true;
        const from = this.corePos.clone();
        const to = V3(this.pos.x + b.dir.x * L, this.home.y + 1, this.pos.z + b.dir.z * L);
        bm.position.copy(from).lerp(to, 0.5);
        bm.scale.set(1, from.distanceTo(to), 1);
        bm.quaternion.setFromUnitVectors(V3(0, 1, 0), to.clone().sub(from).normalize());
        this.beamT = 0.4;
        this.strike((p) => {
          const rx = p.x - this.pos.x,
            rz = p.z - this.pos.z;
          const along = rx * b.dir.x + rz * b.dir.z;
          const across = Math.abs(rx * b.dir.z - rz * b.dir.x);
          return along > -1 && along < L && across < 1.5 && p.y - this.home.y < 3.2;
        }, 1500);
        this.g.combat.vfx.burst(to, '#e8c8ff', 20, { speed: 6, size: 0.25, life: 0.5 });
        this.g.cameraCtl.shake(0.12, 0.2);
        this.g.sfx.bossBeam();
      }
    };
    if (!this.beams) {
      this.beams = [];
      const base = Math.atan2(P.x - this.pos.x, P.z - this.pos.z);
      const angles = this.phase === 2 ? [base, base + (Math.random() < 0.5 ? 0.45 : -0.45)] : [base];
      for (const a of angles) {
        const dir = V3(Math.sin(a), 0, Math.cos(a));
        const d = this.decal('line');
        d.mesh.position.set(this.pos.x, this.home.y + 0.07, this.pos.z);
        d.mesh.rotation.y = a;
        d.mesh.scale.set(3.0, 1, 42);
        this.beams.push({ dir, d, fired: false });
      }
      this.g.sfx.bossCharge();
    }
    this.mat.uniforms.uGlow.value = 0.4 + clamp(st / 1.05, 0, 1) * 1.4;
    fire(st, 0);
    if (this.beams[1]) fire(st - 0.5, 1);
    if (this.beamT !== undefined) {
      this.beamT -= dt;
      this.beam.material.uniforms.uAlpha.value = clamp(this.beamT / 0.4, 0, 1) * 1.6;
      if (this.beamT <= 0) this.beam.visible = false;
    }
    if (st > (this.beams[1] ? 2.2 : 1.8)) this.enter('idle');
  }

  // Pillar: all shards gather into a column above the player, then slam down
  updatePillar(dt, sp) {
    const st = this.st * sp;
    const P = this.g.player.pos;
    if (!this.col) {
      this.col = { d: this.decal('circle'), x: P.x, z: P.z, y: this.g.ground.heightAt(P.x, P.z) };
      this.col.d.mesh.scale.setScalar(8.4);
      this.g.sfx.bossCharge();
    }
    const c = this.col;
    if (st < 1.1) {
      c.x = damp(c.x, P.x, 5, dt);
      c.z = damp(c.z, P.z, 5, dt);
      c.y = this.g.ground.heightAt(c.x, c.z);
    }
    c.d.mesh.position.set(c.x, c.y + 0.06, c.z);
    c.d.mesh.material.uniforms.uProg.value = clamp(st / 1.55, 0, 1);
    this.shards.forEach((s, i) => {
      s.free = true;
      const a = (i / 8) * TAU + this.t * 2;
      const drop = st < 1.55 ? 0 : 1;
      const h = drop ? 0.6 + (i % 4) * 0.5 : 12 + (i % 4) * 1.6;
      s.target.set(c.x + Math.cos(a) * 0.9, c.y + h, c.z + Math.sin(a) * 0.9);
      if (drop && !this.hitDone) s.pos.copy(s.target);
    });
    if (st >= 1.6 && !this.hitDone) {
      this.hitDone = true;
      c.d.mesh.visible = false;
      this.g.combat.vfx.explosion(_v.set(c.x, c.y + 0.6, c.z), '#c48bff', 4.2, 0.5);
      this.g.combat.vfx.ring(_v.set(c.x, c.y + 0.1, c.z), '#e0c0ff', 5, 0.45);
      this.strike((p) => Math.hypot(p.x - c.x, p.z - c.z) < 4.2 && p.y - c.y < 3, 1900);
      this.g.cameraCtl.shake(0.4, 0.35);
      this.g.sfx.bossImpact(1);
    }
    if (st > 2.7) this.enter('idle');
  }

  // Pulse: the core charges and releases an expanding ring along the floor
  updatePulse(dt, sp) {
    const st = this.st * sp;
    if (!this.pulseCharged) {
      this.pulseCharged = true;
      this.g.sfx.bossCharge();
    }
    this.mat.uniforms.uGlow.value = st < 0.9 ? 0.4 + st * 1.8 : 0.4;
    if (st >= 0.9) this.pulseRing(st - 0.9, sp);
    if (st > 2.6) this.enter('idle');
  }

  pulseRing(lt, sp) {
    if (lt < 0) return;
    const R = 2 + lt * 17 * sp;
    const m = this.pulseMesh;
    m.visible = R < this.arenaR + 2;
    m.position.set(this.pos.x, this.home.y + 0.08, this.pos.z);
    m.material.uniforms.uProg.value = R / (this.pulseSize / 2);
    m.material.uniforms.uAlpha.value = 1.6 * (1 - R / (this.arenaR + 4));
    if (lt < 0.05 && !this.pulseSnd) {
      this.pulseSnd = true;
      this.g.sfx.bossImpact(0.5);
    }
    if (lt > 0.3) this.pulseSnd = false;
    const P = this.g.player.pos;
    const d = Math.hypot(P.x - this.pos.x, P.z - this.pos.z);
    const air = P.y - this.g.ground.heightAt(P.x, P.z) > 0.8;
    if (!this.hitDone && Math.abs(d - R) < 1.0 && !air) {
      this.hitDone = true;
      this.strike(() => true, 1100);
    }
  }

  updateDead(dt) {
    const k = Math.min(1, this.st / 2.2);
    this.core.scale.set(1 - k, 1.55 * (1 - k), 1 - k);
    this.glow.material.uniforms.uAlpha.value = 0.35 + Math.sin(k * Math.PI) * 1.5;
    this.shards.forEach((s, i) => {
      const a = (i / 8) * TAU;
      s.target.set(this.corePos.x + Math.cos(a) * (3.6 + k * 10), this.corePos.y - k * 3, this.corePos.z + Math.sin(a) * (3.6 + k * 10));
    });
    this.mat.uniforms.uDim.value = 1 - k * 0.7;
    if (k >= 1 && this.model.root.visible) {
      this.model.root.visible = false;
      this.respawnT = 150;
    }
    if (!this.model.root.visible) {
      this.respawnT -= dt;
      const P = this.g.player.pos;
      if (this.respawnT <= 0 && Math.hypot(P.x - this.home.x, P.z - this.home.z) > 60) {
        this.core.scale.set(1, 1.55, 1);
        this.reset();
      }
    }
    this.animate(dt);
  }

  animate(dt) {
    const cp = this.corePos;
    this.core.position.copy(cp);
    this.core.rotation.y += dt * (this.state === 'dormant' ? 0.2 : 0.9);
    const dormant = this.state === 'dormant';
    this.mat.uniforms.uDim.value = damp(this.mat.uniforms.uDim.value, dormant ? 0.55 : this.state === 'dead' ? this.mat.uniforms.uDim.value : 1, 2, dt);
    this.glow.visible = !dormant;
    this.rings.forEach((r, k) => {
      r.visible = !dormant && this.state !== 'stunned' && this.state !== 'dead';
      r.position.copy(cp);
      r.rotation.set(Math.PI / 2 + Math.sin(this.t * 0.7 + k) * 0.5, this.t * (k ? -0.6 : 0.8), Math.cos(this.t * 0.5 + k) * 0.4);
    });
    const fast = this.state === 'rain' || this.state === 'pillar';
    for (const s of this.shards) {
      const rate = s.free ? (fast ? 9 : 5) : dormant ? 1.2 : 4;
      s.pos.x = damp(s.pos.x, s.target.x, rate, dt);
      s.pos.y = damp(s.pos.y, s.target.y, rate * (s.free && s.target.y < s.pos.y ? 2.5 : 1), dt);
      s.pos.z = damp(s.pos.z, s.target.z, rate, dt);
      s.mesh.position.copy(s.pos);
      if (dormant) s.mesh.rotation.set(s.tilt || 0, 0, (s.tilt || 0) * 0.6);
      else if (this.state === 'stunned') s.mesh.rotation.set(1.3, s.spin, 0.2);
      else if (s.free) s.mesh.rotation.set(0, (s.spin += dt * 3), 0);
      else {
        // point outwards from the core
        _v.copy(s.pos).sub(cp).normalize();
        s.q.setFromUnitVectors(_up, _v);
        s.mesh.quaternion.slerp(s.q, 1 - Math.exp(-dt * 6));
      }
    }
    const sh = this.shieldMesh;
    if (sh.visible) {
      sh.position.copy(cp);
      sh.material.uniforms.uAlpha.value = 0.55 + 0.5 * (this.shield / this.shieldMax) + (this.shieldHit > 0 ? 0.6 : 0);
      sh.rotation.y += dt * 0.3;
    }
    this.model.root.position.set(0, 0, 0);
  }
}

const _v = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
