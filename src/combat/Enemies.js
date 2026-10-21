import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { shared, litUniforms, VERT_HEAD, FRAG_HEAD, FRAG_TAIL, CLOUD_GLSL } from '../render/shaders.js';
import { toonMaterial, outlineMaterial, outlineColorFor } from '../render/materials.js';
import { lathe, smooth, strand, withGrad } from '../character/CharacterModel.js';
import { resolveReaction, ELEMENT_COLORS } from './elements.js';
import { clamp, damp, dampAngle, lerp, smoothstep, mulberry32 } from '../core/noise.js';
import { SPAWN, LANDMARKS, SEA_LEVEL } from '../world/Terrain.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const _v = new THREE.Vector3();

// ---------------------------------------------------------------------------
// Slime material: jelly toon with rim glow + glossy highlight
// ---------------------------------------------------------------------------
const SLIME_VERT = /* glsl */ `
${VERT_HEAD}
varying vec3 vNormalW;
varying vec3 vWorldPos;
void main(){
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vec3 transformedNormal = normalMatrix * normal;
  vNormalW = inverseTransformDirection(transformedNormal, viewMatrix);
  vWorldPos = worldPosition.xyz;
  #include <shadowmap_vertex>
  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const SLIME_FRAG = /* glsl */ `
${FRAG_HEAD}
uniform vec3 uColor;
uniform vec3 uColor2;
uniform vec3 uSunDir;
uniform vec3 uCharLit;
uniform vec3 uCharShade;
uniform float uFlash;
uniform float uFrozen;
uniform float uOpacity;
varying vec3 vNormalW;
varying vec3 vWorldPos;
${CLOUD_GLSL}
void main(){
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float ndl = dot(N, uSunDir);
  float shadow = getShadowMask() * cloudShadow(vWorldPos, uSunDir);
  float lit = smoothstep(-0.2, 0.25, ndl) * mix(1.0, shadow, 0.8);
  vec3 col = mix(uColor * 0.5 * uCharShade, uColor * 1.02 * uCharLit, lit);
  float fr = pow(1.0 - max(dot(N, V), 0.0), 2.2);
  col += uColor2 * fr * 0.9 * uCharLit;
  col += uColor * pow(max(dot(N, V), 0.0), 4.0) * 0.18;
  vec3 H = normalize(uSunDir + V);
  col += uCharLit * smoothstep(0.92, 0.965, dot(N, H)) * 0.85;
  col = mix(col, vec3(0.75, 0.92, 1.0) * uCharLit, uFrozen * 0.55);
  col = mix(col, vec3(1.0), uFlash);
  gl_FragColor = vec4(col, uOpacity);
  ${FRAG_TAIL}
}`;

function slimeMaterial(color, color2) {
  return new THREE.ShaderMaterial({
    vertexShader: SLIME_VERT,
    fragmentShader: SLIME_FRAG,
    uniforms: Object.assign(litUniforms(), {
      uColor: { value: new THREE.Color(color) },
      uColor2: { value: new THREE.Color(color2) },
      uSunDir: shared.uSunDir,
      uCharLit: shared.uCharLit,
      uCharShade: shared.uCharShade,
      uFlash: { value: 0 },
      uFrozen: { value: 0 },
      uOpacity: { value: 1 },
      uCloudTex: shared.uCloudTex,
      uCloudOff: shared.uCloudOff,
      uCloudShadow: shared.uCloudShadow,
      uCloudCov: shared.uCloudCov,
    }),
    lights: true,
    fog: true,
  });
}

const SLIME_COLORS = {
  fire: ['#ff8a3c', '#ffd27a'],
  water: ['#3d9cff', '#b8ecff'],
  ice: ['#8fdcff', '#f0fdff'],
  thunder: ['#a86bff', '#f0d0ff'],
  wind: ['#4fdcb8', '#d8fff2'],
};

function addOutlined(parent, geo, mat, outlineCol, width = 1.2) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  const o = new THREE.Mesh(geo, outlineMaterial(outlineCol, width));
  m.add(o);
  parent.add(m);
  return m;
}

function buildSlime(el) {
  const [c1, c2] = SLIME_COLORS[el];
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  let g = new THREE.SphereGeometry(0.55, 40, 28);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i);
    if (y < -0.2) {
      const t = (y + 0.2) / -0.35;
      y = -0.2 - (y + 0.2) * -0.45;
      x *= 1 + t * 0.08;
      z *= 1 + t * 0.08;
    }
    if (y > 0.3) {
      const t = (y - 0.3) / 0.25;
      x *= 1 - t * 0.18;
      z *= 1 - t * 0.18;
      y += t * 0.06;
    }
    p.setXYZ(i, x, y, z);
  }
  g = smooth(g);
  g.translate(0, 0.36, 0);
  const mat = slimeMaterial(c1, c2);
  const bodyMesh = addOutlined(body, g, mat, outlineColorFor(c1), 1.3);
  // eyes
  const eyeMat = toonMaterial({ color: '#1b1626', rim: 0, spec: 0 });
  const hlMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  for (const s of [-1, 1]) {
    const eg = new THREE.SphereGeometry(0.075, 16, 12);
    eg.scale(0.75, 1.25, 0.45);
    const eye = new THREE.Mesh(eg, eyeMat);
    eye.position.set(s * 0.17, 0.46, 0.49);
    eye.rotation.y = s * 0.3;
    body.add(eye);
    const hl = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), hlMat);
    hl.position.set(-0.02, 0.035, 0.03);
    eye.add(hl);
  }
  // element topper
  const accMat = toonMaterial({ color: c2, emissive: 0.6, rim: 0.5, spec: 0.5 });
  const accOutline = outlineColorFor(c1);
  if (el === 'fire') {
    for (let i = 0; i < 3; i++) {
      const fg = new THREE.ConeGeometry(0.12 - i * 0.025, 0.42 - i * 0.08, 10);
      const m = addOutlined(body, fg, toonMaterial({ color: i === 0 ? '#ffb347' : '#ffe08a', emissive: 1.1, rim: 0.3 }), '#8a3a10');
      m.position.set((i - 1) * 0.09, 0.98 - Math.abs(i - 1) * 0.08, -0.02);
      m.rotation.z = (1 - i) * 0.35;
    }
  } else if (el === 'water') {
    const dg = new THREE.SphereGeometry(0.13, 16, 12);
    dg.scale(1, 1.4, 1);
    const d = addOutlined(body, dg, accMat, accOutline);
    d.position.set(0.05, 1.0, 0);
    const curl = withGrad(strand([V3(0, 0.88, 0), V3(0.08, 1.08, 0), V3(0.2, 1.12, 0.02), V3(0.26, 1.02, 0.04)], 0.05, 0.03, V3(0, 0.8, 0)));
    addOutlined(body, curl, accMat, accOutline);
  } else if (el === 'ice') {
    for (let i = 0; i < 4; i++) {
      const cg = new THREE.OctahedronGeometry(0.11, 0);
      cg.scale(0.7, 2.0, 0.7);
      const m = addOutlined(body, cg, toonMaterial({ color: '#e8fbff', emissive: 0.5, spec: 1, rim: 0.6 }), '#3a7a9a');
      const a = (i / 4) * Math.PI * 2;
      m.position.set(Math.cos(a) * 0.14, 0.92, Math.sin(a) * 0.14);
      m.rotation.set(Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4);
    }
  } else if (el === 'thunder') {
    const rod = new THREE.CylinderGeometry(0.02, 0.025, 0.36, 6);
    const r = addOutlined(body, rod, toonMaterial({ color: '#4a3a6a' }), '#1a1030');
    r.position.set(0, 1.02, 0);
    const ball = new THREE.SphereGeometry(0.09, 14, 10);
    const b = addOutlined(body, ball, toonMaterial({ color: '#f0d8ff', emissive: 1.2 }), '#5a2a8a');
    b.position.set(0, 1.22, 0);
  } else if (el === 'wind') {
    for (const s of [-1, 1]) {
      const lg = withGrad(strand([V3(0, 0.88, 0), V3(s * 0.12, 1.06, 0.02), V3(s * 0.3, 1.1, 0.04), V3(s * 0.42, 1.0, 0.06)], 0.09, 0.02, V3(0, 0.6, 0)));
      addOutlined(body, lg, toonMaterial({ color: '#8ff0c8', emissive: 0.4 }), '#1f6a50');
    }
  }
  return { root, body, mats: [mat], bodyMesh, height: 0.95, radius: 0.55 };
}

function maskTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = '#efe4cc';
  g.fillRect(0, 0, 256, 256);
  // wood grain
  g.strokeStyle = 'rgba(150,120,80,0.25)';
  g.lineWidth = 2;
  for (let i = 0; i < 14; i++) {
    g.beginPath();
    g.moveTo(0, 20 + i * 17);
    g.bezierCurveTo(80, 10 + i * 17, 170, 30 + i * 17, 256, 16 + i * 17);
    g.stroke();
  }
  // eye holes
  g.fillStyle = '#1a1210';
  g.beginPath();
  g.ellipse(88, 118, 24, 15, -0.25, 0, Math.PI * 2);
  g.ellipse(168, 118, 24, 15, 0.25, 0, Math.PI * 2);
  g.fill();
  // war paint
  g.strokeStyle = '#b8322a';
  g.lineWidth = 9;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(128, 40);
  g.lineTo(128, 92);
  g.moveTo(70, 160);
  g.quadraticCurveTo(128, 200, 186, 160);
  g.stroke();
  g.lineWidth = 6;
  for (const s of [-1, 1]) {
    g.beginPath();
    g.moveTo(128 + s * 60, 78);
    g.lineTo(128 + s * 95, 92);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let MASK_TEX = null;

function buildGoblin() {
  if (!MASK_TEX) MASK_TEX = maskTexture();
  const skin = '#a0805a';
  const fur = '#6b4a2e';
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.55;
  root.add(body);
  const j = {};
  for (const n of ['hips', 'spine', 'head', 'armL', 'armR', 'foreR', 'legL', 'legR']) j[n] = new THREE.Group();
  body.add(j.hips);
  j.hips.add(j.spine);
  j.spine.position.y = 0.05;
  j.spine.rotation.x = 0.25;
  j.spine.add(j.head);
  j.head.position.set(0, 0.42, 0.04);
  const mat = (c, o = {}) => toonMaterial({ color: c, shadowTint: '#b0a0c0', rim: 0.35, ...o });
  const add = (parent, geo, c, pos, rot, o = {}) => {
    const m = addOutlined(parent, geo, o.material ?? mat(c, o), outlineColorFor(c));
    if (pos) m.position.copy(pos);
    if (rot) m.rotation.set(rot.x, rot.y, rot.z);
    return m;
  };
  // torso
  const torso = lathe([
    [0, -0.05],
    [0.15, -0.04],
    [0.19, 0.08],
    [0.2, 0.22],
    [0.17, 0.34],
    [0.09, 0.4],
    [0, 0.42],
  ]);
  torso.scale(1, 1, 0.8);
  add(j.spine, torso, skin);
  // loincloth
  const cloth = new THREE.CylinderGeometry(0.17, 0.26, 0.3, 14, 2, true);
  cloth.translate(0, -0.1, 0);
  add(j.hips, cloth, fur, null, null, { side: THREE.DoubleSide });
  const belt = new THREE.TorusGeometry(0.17, 0.025, 6, 16);
  belt.rotateX(Math.PI / 2);
  add(j.hips, belt, '#4a3020', V3(0, 0.04, 0));
  // head + mask + hair
  const head = new THREE.SphereGeometry(0.17, 20, 16);
  add(j.head, head, skin);
  const mg = new THREE.SphereGeometry(0.17, 24, 18, Math.PI * 0.18, Math.PI * 0.64, Math.PI * 0.18, Math.PI * 0.62);
  mg.scale(1.05, 1.12, 1.0);
  const maskMat = toonMaterial({ color: '#ffffff', map: MASK_TEX, rim: 0.3, unique: true });
  add(j.head, mg, '#efe4cc', V3(0, 0.0, 0.035), null, { material: maskMat });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI - Math.PI / 2;
    const hs = withGrad(strand([V3(Math.sin(a) * 0.1, 0.12, -0.04), V3(Math.sin(a) * 0.16, 0.24, -0.12), V3(Math.sin(a) * 0.2, 0.2, -0.26)], 0.05, 0.02, V3(0, 0, 0)));
    add(j.head, hs, '#2a2018');
  }
  // arms
  for (const [s, arm] of [
    [1, 'armL'],
    [-1, 'armR'],
  ]) {
    j.spine.add(j[arm]);
    j[arm].position.set(s * 0.2, 0.3, 0);
    const ua = lathe([
      [0, -0.3],
      [0.045, -0.28],
      [0.055, -0.1],
      [0.06, 0],
      [0, 0.04],
    ]);
    add(j[arm], ua, skin);
    const hand = new THREE.SphereGeometry(0.06, 10, 8);
    add(j[arm], hand, skin, V3(0, -0.33, 0));
  }
  // club in right hand
  const club = new THREE.Group();
  j.armR.add(club);
  club.position.set(0, -0.34, 0.02);
  club.rotation.x = Math.PI / 2 - 0.2;
  const cg = lathe([
    [0.03, -0.12],
    [0.035, 0.1],
    [0.07, 0.4],
    [0.085, 0.58],
    [0.05, 0.66],
    [0.0, 0.67],
  ]);
  add(club, cg, '#8a5a32');
  // legs
  for (const [s, leg] of [
    [1, 'legL'],
    [-1, 'legR'],
  ]) {
    j.hips.add(j[leg]);
    j[leg].position.set(s * 0.1, -0.05, 0);
    const lg = lathe([
      [0, -0.5],
      [0.05, -0.48],
      [0.06, -0.3],
      [0.075, -0.1],
      [0.07, 0],
      [0, 0.04],
    ]);
    add(j[leg], lg, skin);
    const foot = new THREE.SphereGeometry(0.06, 10, 8);
    foot.scale(1, 0.6, 1.6);
    add(j[leg], foot, '#3a2a1a', V3(0, -0.5, 0.04));
  }
  return { root, body, j, height: 1.25, radius: 0.45, mats: [] };
}

// ---------------------------------------------------------------------------
// Enemy
// ---------------------------------------------------------------------------
export class Enemy {
  constructor(mgr, type, el, x, z, level = 18) {
    this.mgr = mgr;
    this.type = type;
    this.selfEl = el;
    this.level = level;
    this.home = V3(x, 0, z);
    this.pos = V3(x, mgr.ground.heightAt(x, z), z);
    this.home.y = this.pos.y;
    this.vel = V3(0, 0, 0);
    this.yaw = Math.random() * Math.PI * 2;
    this.model = type === 'slime' ? buildSlime(el) : buildGoblin();
    this.radius = this.model.radius;
    this.height = this.model.height;
    this.maxHp = Math.round((type === 'slime' ? 9200 : 17500) * (1 + (level - 18) * 0.05));
    this.hp = this.maxHp;
    this.alive = true;
    this.state = 'idle';
    this.stateT = Math.random() * 2;
    this.attackCd = 1.5;
    this.aura = el && el !== 'wind' ? el : null;
    this.auraT = el ? 1e9 : 0;
    this.auraRegen = 0;
    this.frozenT = 0;
    this.chargedT = 0;
    this.chargeTick = 0;
    this.superT = 0;
    this.stunT = 0;
    this.flashT = 0;
    this.deadT = 0;
    this.airborne = false;
    this.hopT = Math.random();
    this.squash = 0;
    this.t = Math.random() * 10;
    this.aggro = false;
    this.mgr.scene.add(this.model.root);
    this.iceShell = null;
  }

  get headPos() {
    return _v.set(this.pos.x, this.pos.y + this.height + 0.35, this.pos.z);
  }

  center(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + this.height * 0.5, this.pos.z);
  }

  // apply an element and report which reaction (if any) happened
  applyElement(el) {
    if (!el || el === 'phys') return null;
    if (this.frozenT > 0 && el !== 'wind') {
      if (el === 'fire') {
        this.unfreeze();
        return { type: 'melt', mult: 2 };
      }
      return null;
    }
    const r = resolveReaction(this.aura, el);
    if (!r) {
      if (el !== 'wind') {
        this.aura = el;
        this.auraT = this.selfEl === el ? 1e9 : 9;
      }
      return null;
    }
    // reactions consume the aura (a slime's own aura grows back)
    if (r.type !== 'charged') {
      this.aura = null;
      this.auraRegen = 2.5;
    } else {
      this.aura = el;
      this.auraT = 4;
    }
    return r;
  }

  freeze(t = 3) {
    this.frozenT = t;
    if (!this.iceShell) {
      const g = new THREE.IcosahedronGeometry(1, 1);
      const m = new THREE.Mesh(
        g,
        new THREE.MeshBasicMaterial({ color: new THREE.Color('#bff4ff').multiplyScalar(1.2), transparent: true, opacity: 0.45, depthWrite: false })
      );
      m.scale.set(this.radius * 1.3, this.height * 0.75, this.radius * 1.3);
      m.position.y = this.height * 0.45;
      this.model.root.add(m);
      this.iceShell = m;
    }
    this.iceShell.visible = true;
  }

  unfreeze() {
    this.frozenT = 0;
    if (this.iceShell) this.iceShell.visible = false;
  }

  hit(dmg, knock, launch) {
    this.hp -= dmg;
    this.flashT = 0.12;
    this.aggro = true;
    if (this.frozenT <= 0) {
      if (knock) {
        this.vel.x += knock.x;
        this.vel.z += knock.z;
      }
      if (launch) {
        this.vel.y = Math.max(this.vel.y, launch);
        this.airborne = true;
      }
      if (this.type === 'goblin' && (knock && knock.length() > 3)) this.stunT = 0.45;
      if (this.type === 'slime') this.squash = 0.35;
    }
    if (this.hp <= 0) this.die();
  }

  die() {
    if (!this.alive) return;
    this.alive = false;
    this.deadT = 0;
    this.mgr.onDeath(this);
  }

  update(dt, player) {
    const T = this.mgr.ground;
    this.t += dt;
    if (!this.alive) {
      this.deadT += dt;
      const k = Math.min(this.deadT / 0.6, 1);
      this.model.root.scale.setScalar(1 - k * 0.9);
      this.model.root.position.y = this.pos.y + k * 0.4;
      this.setFlash(1 - k * 0.3);
      if (k >= 1) this.model.root.visible = false;
      return;
    }
    // status timers
    if (this.auraT < 1e8) {
      this.auraT -= dt;
      if (this.auraT <= 0) this.aura = null;
    }
    if (!this.aura && this.selfEl && this.selfEl !== 'wind') {
      this.auraRegen -= dt;
      if (this.auraRegen <= 0) {
        this.aura = this.selfEl;
        this.auraT = 1e9;
      }
    }
    this.superT = Math.max(0, this.superT - dt);
    if (this.frozenT > 0) {
      this.frozenT -= dt;
      if (this.frozenT <= 0) this.unfreeze();
    }
    if (this.chargedT > 0) {
      this.chargedT -= dt;
      this.chargeTick -= dt;
      if (this.chargeTick <= 0) {
        this.chargeTick = 1;
        this.mgr.onChargedTick(this);
      }
    }
    this.flashT = Math.max(0, this.flashT - dt);
    this.setFlash(this.flashT > 0 ? 0.65 : 0);
    if (this.model.mats[0]) this.model.mats[0].uniforms.uFrozen.value = this.frozenT > 0 ? 1 : 0;

    const toP = (this._toP || (this._toP = new THREE.Vector3())).set(player.pos.x - this.pos.x, 0, player.pos.z - this.pos.z);
    const dist = toP.length();
    const homeD = Math.hypot(this.pos.x - this.home.x, this.pos.z - this.home.z);
    if (dist < 13 && player.state !== 'swim') this.aggro = true;
    if (homeD > 34 || dist > 30 || player.dead) this.aggro = false;
    const frozen = this.frozenT > 0;
    this.stunT = Math.max(0, this.stunT - dt);

    if (!frozen && this.stunT <= 0) {
      if (this.type === 'slime') this.updateSlime(dt, player, toP, dist, homeD);
      else this.updateGoblin(dt, player, toP, dist, homeD);
    }

    // physics
    const g = 22;
    this.vel.y -= g * dt;
    const fr = this.airborne ? 0.4 : 8;
    this.vel.x *= Math.exp(-fr * dt);
    this.vel.z *= Math.exp(-fr * dt);
    if (frozen) {
      this.vel.x = 0;
      this.vel.z = 0;
    }
    this.pos.addScaledVector(this.vel, dt);
    this.mgr.colliders.resolve(this.pos, this.radius * 0.8);
    const gh = Math.max(T.heightAt(this.pos.x, this.pos.z), SEA_LEVEL - 0.3);
    if (this.pos.y <= gh) {
      if (this.airborne && this.vel.y < -2) this.onLand();
      this.pos.y = gh;
      this.vel.y = 0;
      this.airborne = false;
    }

    // visuals
    const r = this.model.root;
    r.position.copy(this.pos);
    r.rotation.y = this.yaw;
    if (this.type === 'slime') this.animateSlime(dt);
    else this.animateGoblin(dt, dist);
  }

  setFlash(v) {
    for (const m of this.model.mats) m.uniforms.uFlash.value = v;
    if (this.type === 'goblin') {
      if (!this._gobMats) {
        this._gobMats = [];
        this.model.root.traverse((o) => {
          if (o.material && o.material.uniforms && o.material.uniforms.uFlash && !this._gobMats.includes(o.material)) this._gobMats.push(o.material);
        });
      }
    }
    if (this._gobMats) for (const m of this._gobMats) m.uniforms.uFlash.value = v;
  }

  // ---- slime AI
  updateSlime(dt, player, toP, dist, homeD) {
    this.stateT -= dt;
    this.attackCd -= dt;
    if (this.state === 'windup') {
      this.squash = lerp(this.squash, -0.28, 1 - Math.exp(-dt * 10));
      if (this.stateT <= 0) {
        // leap at the player
        const d = Math.max(dist, 0.1);
        const tFlight = 0.55;
        this.vel.x = (toP.x / d) * Math.min(d, 6) / tFlight;
        this.vel.z = (toP.z / d) * Math.min(d, 6) / tFlight;
        this.vel.y = 6.2;
        this.airborne = true;
        this.state = 'leap';
        this.squash = 0.35;
      }
      return;
    }
    if (this.state === 'leap') return; // landing handled in onLand
    if (this.aggro) {
      this.yaw = dampAngle(this.yaw, Math.atan2(toP.x, toP.z), 6, dt);
      if (dist < 3.2 && this.attackCd <= 0 && !this.airborne) {
        this.state = 'windup';
        this.stateT = 0.6;
        this.mgr.telegraph(this);
        return;
      }
      this.hopT -= dt;
      if (this.hopT <= 0 && !this.airborne && dist > 2.0) {
        this.hopT = 0.75 + Math.random() * 0.3;
        const d = Math.max(dist, 0.1);
        this.vel.x = (toP.x / d) * 3.6;
        this.vel.z = (toP.z / d) * 3.6;
        this.vel.y = 4.2;
        this.airborne = true;
        this.squash = 0.3;
      }
    } else {
      // idle wander / return home
      this.hopT -= dt;
      if (this.hopT <= 0 && !this.airborne) {
        this.hopT = 1.6 + Math.random() * 2.5;
        let dx = (Math.random() - 0.5) * 2,
          dz = (Math.random() - 0.5) * 2;
        if (homeD > 6) {
          dx = this.home.x - this.pos.x;
          dz = this.home.z - this.pos.z;
          if (this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.2);
        }
        const l = Math.hypot(dx, dz) || 1;
        this.vel.x = (dx / l) * 2;
        this.vel.z = (dz / l) * 2;
        this.vel.y = 3;
        this.airborne = true;
        this.yaw = Math.atan2(dx, dz);
        this.squash = 0.25;
      }
    }
  }

  onLand() {
    this.squash = -0.35;
    if (this.type === 'slime' && this.state === 'leap') {
      this.state = 'chase';
      this.attackCd = 2.4 + Math.random();
      this.mgr.slam(this, 2.3, 900 + this.level * 20);
    }
  }

  animateSlime(dt) {
    this.squash = damp(this.squash, 0, 7, dt);
    const wob = Math.sin(this.t * 3.2) * 0.04;
    const s = this.squash + wob;
    const b = this.model.body;
    b.scale.set(1 + s * 0.6, 1 - s, 1 + s * 0.6);
    if (this.airborne) b.scale.set(0.9, 1.15, 0.9);
  }

  // ---- goblin AI
  updateGoblin(dt, player, toP, dist, homeD) {
    this.stateT -= dt;
    this.attackCd -= dt;
    const j = this.model.j;
    if (this.state === 'windup') {
      if (this.stateT <= 0) {
        this.state = 'strike';
        this.stateT = 0.35;
        this.struck = false;
      }
      return;
    }
    if (this.state === 'strike') {
      if (!this.struck && this.stateT < 0.25) {
        this.struck = true;
        this.mgr.swing(this, 2.5, 1.1, 1250 + this.level * 25);
      }
      if (this.stateT <= 0) {
        this.state = 'recover';
        this.stateT = 0.6;
      }
      return;
    }
    if (this.state === 'recover') {
      if (this.stateT <= 0) this.state = 'chase';
      return;
    }
    this.moving = false;
    if (this.aggro) {
      this.yaw = dampAngle(this.yaw, Math.atan2(toP.x, toP.z), 7, dt);
      if (dist < 2.2 && this.attackCd <= 0) {
        this.state = 'windup';
        this.stateT = 0.6;
        this.attackCd = 2.2 + Math.random() * 1.2;
        this.mgr.telegraph(this);
        return;
      }
      if (dist > 1.7) {
        const sp = 3.3;
        this.vel.x = damp(this.vel.x, (toP.x / dist) * sp, 8, dt);
        this.vel.z = damp(this.vel.z, (toP.z / dist) * sp, 8, dt);
        this.moving = true;
      }
    } else if (homeD > 3) {
      const dx = this.home.x - this.pos.x,
        dz = this.home.z - this.pos.z;
      this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 5, dt);
      this.vel.x = damp(this.vel.x, (dx / homeD) * 2, 6, dt);
      this.vel.z = damp(this.vel.z, (dz / homeD) * 2, 6, dt);
      this.moving = true;
      if (this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.1 * dt);
    }
  }

  animateGoblin(dt, dist) {
    const j = this.model.j;
    const k = 1 - Math.exp(-dt * 14);
    const set = (o, x, y, z) => {
      o.rotation.x = lerp(o.rotation.x, x, k);
      o.rotation.y = lerp(o.rotation.y, y, k);
      o.rotation.z = lerp(o.rotation.z, z, k);
    };
    const t = this.t;
    if (this.state === 'windup') {
      set(j.armR, -2.7, 0, -0.3);
      set(j.armL, -0.4, 0, 0.5);
      set(j.spine, 0.0, 0.3, 0);
    } else if (this.state === 'strike') {
      set(j.armR, -0.5, 0, -0.2);
      set(j.armL, 0.3, 0, 0.4);
      set(j.spine, 0.6, -0.2, 0);
    } else if (this.stunT > 0) {
      set(j.spine, -0.3, 0, 0.1);
      set(j.armR, 0.4, 0, -0.6);
      set(j.armL, 0.4, 0, 0.6);
    } else if (this.moving) {
      const ph = t * 9;
      set(j.legL, Math.sin(ph) * 0.7, 0, 0);
      set(j.legR, -Math.sin(ph) * 0.7, 0, 0);
      set(j.armL, -Math.sin(ph) * 0.6, 0, 0.3);
      set(j.armR, Math.sin(ph) * 0.4 - 0.4, 0, -0.3);
      set(j.spine, 0.4, 0, 0);
      this.model.body.position.y = 0.55 + Math.abs(Math.sin(ph)) * 0.05;
    } else {
      set(j.legL, 0, 0, 0.08);
      set(j.legR, 0, 0, -0.08);
      set(j.armL, 0.1 + Math.sin(t * 2) * 0.05, 0, 0.35);
      set(j.armR, -0.3, 0, -0.35);
      set(j.spine, 0.3 + Math.sin(t * 2) * 0.03, Math.sin(t * 0.7) * 0.2, 0);
      set(j.head, 0, Math.sin(t * 0.9) * 0.4, 0);
    }
  }

  respawn() {
    this.pos.copy(this.home);
    this.vel.set(0, 0, 0);
    this.hp = this.maxHp;
    this.alive = true;
    this.state = 'idle';
    this.aggro = false;
    this.aura = this.selfEl && this.selfEl !== 'wind' ? this.selfEl : null;
    this.auraT = 1e9;
    this.unfreeze();
    this.model.root.visible = true;
    this.model.root.scale.setScalar(1);
    this.setFlash(0);
  }
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------
const GROUPS = [
  { x: -12, z: 18, kind: 'slime', els: ['water', 'water', 'fire'] },
  { x: -70, z: 95, kind: 'slime', els: ['wind', 'wind', 'thunder'] },
  { x: 25, z: 120, kind: 'slime', els: ['fire', 'fire'] },
  { x: 72, z: 70, kind: 'slime', els: ['water', 'water', 'water'] },
  { x: 60, z: -40, kind: 'goblin', els: [null, null, null], extra: ['fire'] },
  { x: -95, z: -60, kind: 'goblin', els: [null, null], extra: ['wind', 'thunder'] },
  { x: 20, z: -150, kind: 'slime', els: ['ice', 'ice', 'thunder'] },
  { x: -40, z: -200, kind: 'slime', els: ['ice', 'ice'] },
  { x: 150, z: 20, kind: 'goblin', els: [null, null, null], extra: [] },
  { x: 120, z: 190, kind: 'slime', els: ['water', 'fire', 'thunder'] },
  { x: -160, z: 80, kind: 'slime', els: ['fire', 'thunder', 'water'] },
  { x: -200, z: -130, kind: 'goblin', els: [null, null], extra: ['ice'] },
  { x: 210, z: -120, kind: 'slime', els: ['thunder', 'thunder', 'ice'] },
];

export class EnemyManager {
  // Far enemies drop their outline shells (sub-pixel there anyway) and stop
  // casting shadows, which removes most of their draw calls.
  lod(e, d) {
    const k = (d > 36 ? 1 : 0) + (d > 55 ? 2 : 0);
    if (e._lod === k) return;
    e._lod = k;
    if (!e._outlines) {
      e._outlines = [];
      e._casters = [];
      e.model.root.traverse((o) => {
        if (!o.isMesh) return;
        if (o.material && o.material.uniforms && o.material.uniforms.uOutlineColor) e._outlines.push(o);
        else if (o.castShadow) e._casters.push(o);
      });
    }
    for (const o of e._outlines) o.visible = !(k & 1);
    for (const o of e._casters) o.castShadow = !(k & 2);
  }

  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.terrain = game.terrain;
    this.ground = game.ground || game.terrain; // terrain + walkable structures
    this.colliders = game.vegetation.colliders;
    this.list = [];
    this.listeners = {};
    this.respawnQueue = [];
    const rand = mulberry32(4242);
    for (const g of GROUPS) {
      const spots = [];
      const all = [...g.els.map((e) => [g.kind, e]), ...(g.extra || []).map((e) => ['slime', e])];
      all.forEach(([kind, el], i) => {
        let x, z, tries = 0;
        do {
          const a = rand() * Math.PI * 2;
          const r = 2 + rand() * 5;
          x = g.x + Math.cos(a) * r;
          z = g.z + Math.sin(a) * r;
          tries++;
        } while (tries < 20 && (this.terrain.heightAt(x, z) < 0.6 || this.terrain.normalAt(x, z).y < 0.8));
        // stronger the further from the meadow where the journey starts
        const far = Math.hypot(g.x - SPAWN.x, g.z - SPAWN.z);
        const lv = Math.min(34, Math.max(15, 14 + Math.round(far / 26) + Math.floor(rand() * 3)));
        this.list.push(new Enemy(this, kind, el, x, z, lv));
      });
    }
  }

  on(type, fn) {
    this.listeners[type] = fn;
  }
  emit(type, ...a) {
    if (this.listeners[type]) this.listeners[type](...a);
  }

  onDeath(e) {
    this.emit('death', e);
    if (!e.isBoss && !e.temp) this.respawnQueue.push({ e, t: 60 });
  }

  // summoned / wave enemies that never respawn
  spawn(kind, el, x, z, level) {
    const e = new Enemy(this, kind, el, x, z, level);
    e.temp = true;
    e.aggro = true;
    this.list.push(e);
    return e;
  }

  remove(e) {
    const i = this.list.indexOf(e);
    if (i >= 0) this.list.splice(i, 1);
    this.scene.remove(e.model.root);
    const ui = this.game.combat && this.game.combat.ui;
    const b = ui && ui.bars.get(e);
    if (b) {
      b.el.remove();
      ui.bars.delete(e);
    }
  }
  onChargedTick(e) {
    this.emit('chargedTick', e);
  }
  slam(e, r, dmg) {
    this.emit('slam', e, r, dmg);
  }
  swing(e, r, arc, dmg) {
    this.emit('swing', e, r, arc, dmg);
  }
  telegraph(e) {
    this.emit('telegraph', e);
  }

  near(x, z, r) {
    const out = [];
    for (const e of this.list) {
      if (!e.alive) continue;
      const d = Math.hypot(e.pos.x - x, e.pos.z - z);
      if (d < r + e.radius) out.push(e);
    }
    return out;
  }

  nearest(x, z, r, fx = 0, fz = 0, frontBias = 0) {
    let best = null,
      bs = 1e9;
    for (const e of this.list) {
      if (!e.alive) continue;
      const dx = e.pos.x - x,
        dz = e.pos.z - z;
      const d = Math.hypot(dx, dz);
      if (d > r) continue;
      const front = d > 0.01 ? (dx * fx + dz * fz) / d : 1;
      const score = d - front * frontBias;
      if (score < bs) {
        bs = score;
        best = e;
      }
    }
    return best;
  }

  update(dt, player) {
    for (const e of this.list) {
      const d = Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z);
      if (d > 110 && e.alive && !e.aggro) {
        e.model.root.visible = d < 220;
        continue;
      }
      if (e.alive) e.model.root.visible = true;
      this.lod(e, d);
      e.update(dt, player);
    }
    // simple separation between enemies and from the player
    for (let i = 0; i < this.list.length; i++) {
      const a = this.list[i];
      if (!a.alive) continue;
      const dxp = a.pos.x - player.pos.x,
        dzp = a.pos.z - player.pos.z;
      const dp = Math.hypot(dxp, dzp);
      const mp = a.radius + 0.35;
      if (dp < mp && dp > 1e-4 && Math.abs(a.pos.y - player.pos.y) < 1.5) {
        const push = (mp - dp) * 0.5;
        a.pos.x += (dxp / dp) * push;
        a.pos.z += (dzp / dp) * push;
        player.pos.x -= (dxp / dp) * push;
        player.pos.z -= (dzp / dp) * push;
      }
      for (let k = i + 1; k < this.list.length; k++) {
        const b = this.list[k];
        if (!b.alive) continue;
        const dx = a.pos.x - b.pos.x,
          dz = a.pos.z - b.pos.z;
        const d = Math.hypot(dx, dz);
        const m = a.radius + b.radius;
        if (d < m && d > 1e-4) {
          const push = (m - d) * 0.5;
          a.pos.x += (dx / d) * push;
          a.pos.z += (dz / d) * push;
          b.pos.x -= (dx / d) * push;
          b.pos.z -= (dz / d) * push;
        }
      }
    }
    // respawns happen out of sight
    for (let i = this.respawnQueue.length - 1; i >= 0; i--) {
      const r = this.respawnQueue[i];
      r.t -= dt;
      if (r.t <= 0 && Math.hypot(r.e.home.x - player.pos.x, r.e.home.z - player.pos.z) > 55) {
        r.e.respawn();
        this.respawnQueue.splice(i, 1);
      }
    }
  }
}
