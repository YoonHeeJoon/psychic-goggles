import * as THREE from 'three';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { shared, litUniforms, VERT_HEAD, FRAG_HEAD, FRAG_TAIL, CLOUD_GLSL } from '../render/shaders.js';
import { toonMaterial, outlineMaterial, outlineColorFor } from '../render/materials.js';
import { lathe, smooth, strand, withGrad } from '../character/CharacterModel.js';
import { resolveReaction, ELEMENT_COLORS } from './elements.js';
import { clamp, damp, dampAngle, lerp, smoothstep, mulberry32 } from '../core/noise.js';
import { SPAWN, LANDMARKS, SEA_LEVEL, CAMPS } from '../world/Terrain.js';

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

function buildGoblin(o = {}) {
  if (!MASK_TEX) MASK_TEX = maskTexture();
  const skin = o.skin ?? '#a0805a';
  const fur = o.fur ?? '#6b4a2e';
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
  const mat = (c, mo = {}) => toonMaterial({ color: c, shadowTint: '#b0a0c0', rim: 0.35, unique: true, ...mo });
  const add = (parent, geo, c, pos, rot, mo = {}) => {
    const m = addOutlined(parent, geo, mo.material ?? mat(c, mo), outlineColorFor(c));
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
  const extra = {};
  if (o.weapon === 'bow') {
    // short bow in the left hand, quiver on the back
    const bow = new THREE.Group();
    j.armL.add(bow);
    bow.position.set(0, -0.34, 0.04);
    const arc = new THREE.TorusGeometry(0.42, 0.022, 6, 20, Math.PI * 0.9);
    arc.rotateZ(Math.PI / 2 - Math.PI * 0.45);
    arc.rotateY(Math.PI / 2);
    add(bow, arc, '#6b4226');
    const str = new THREE.CylinderGeometry(0.005, 0.005, 0.8, 4);
    const sm = add(bow, str, '#e8e0c8', V3(0, 0, -0.05));
    extra.bow = bow;
    extra.string = sm;
    const quiver = new THREE.CylinderGeometry(0.07, 0.06, 0.42, 10);
    add(j.spine, quiver, '#5a3a22', V3(0.08, 0.25, -0.17), V3(0.35, 0, -0.3));
    for (let k = 0; k < 3; k++) add(j.spine, new THREE.ConeGeometry(0.03, 0.08, 4), '#e8e0c8', V3(0.1 + k * 0.02, 0.5, -0.24 + k * 0.01), V3(0.35, 0, -0.3));
  } else if (o.weapon === 'axe') {
    const axe = new THREE.Group();
    j.armR.add(axe);
    axe.position.set(0, -0.34, 0.02);
    axe.rotation.x = Math.PI / 2 - 0.2;
    add(axe, new THREE.CylinderGeometry(0.035, 0.04, 0.95, 8).translate(0, 0.3, 0), '#6b4226');
    const blade = new THREE.CylinderGeometry(0.26, 0.26, 0.05, 16, 1, false, -0.9, 1.8);
    blade.rotateZ(Math.PI / 2);
    add(axe, blade, '#b8b8c0', V3(-0.02, 0.68, 0.0), null, { spec: 0.8 });
    extra.axe = axe;
  } else {
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
  }
  if (o.shield) {
    // round plank shield with an iron boss on the left forearm
    const sh = new THREE.Group();
    j.armL.add(sh);
    sh.position.set(0.07, -0.22, 0.12);
    sh.rotation.set(0, Math.PI / 2 - 0.25, 0);
    const disc = new THREE.CylinderGeometry(0.36, 0.36, 0.06, 18);
    disc.rotateX(Math.PI / 2);
    add(sh, disc, '#8a5a36');
    const rim = new THREE.TorusGeometry(0.36, 0.03, 6, 22);
    add(sh, rim, '#5a5a62', V3(0, 0, 0.0), null, { spec: 0.6 });
    add(sh, new THREE.SphereGeometry(0.09, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2), '#8a8a92', V3(0, 0, 0.03), null, { spec: 0.9 });
    extra.shield = sh;
  }
  if (o.hood) {
    const hood = new THREE.SphereGeometry(0.205, 18, 12, Math.PI * 0.75, Math.PI * 1.5, 0, Math.PI * 0.62);
    add(j.head, hood, o.hood, V3(0, 0.02, -0.02), null, { side: THREE.DoubleSide });
    const cape = new THREE.CylinderGeometry(0.16, 0.3, 0.42, 12, 1, true, Math.PI * 0.6, Math.PI * 0.8);
    add(j.spine, cape, o.hood, V3(0, 0.22, -0.02), null, { side: THREE.DoubleSide });
  }
  if (o.helmet) {
    const helm = new THREE.SphereGeometry(0.19, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.45);
    add(j.head, helm, '#7a7a84', V3(0, 0.03, 0), null, { spec: 0.6 });
    for (const sx of [-1, 1]) {
      const horn = new THREE.ConeGeometry(0.045, 0.24, 8);
      add(j.head, horn, '#efe4cc', V3(sx * 0.15, 0.17, 0), V3(0, 0, -sx * 0.7));
    }
    for (const sx of [-1, 1]) add(j.spine, new THREE.SphereGeometry(0.11, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), '#6a6a74', V3(sx * 0.21, 0.33, 0), V3(0, 0, -sx * 0.4), { spec: 0.5 });
  }
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
  const sc = o.scale ?? 1;
  root.scale.setScalar(sc);
  return { root, body, j, height: 1.25 * sc, radius: 0.45 * sc, mats: [], ...extra };
}

// Floating spirit-caster: a bell-shaped robe with a masked hood, glowing
// eyes and a staff tipped with an element crystal.
function buildCaster(el) {
  if (!MASK_TEX) MASK_TEX = maskTexture();
  const [c1, c2] = SLIME_COLORS[el] || SLIME_COLORS.fire;
  const robeCol = new THREE.Color(c1).lerp(new THREE.Color('#2a2238'), 0.62).getStyle();
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const j = {};
  const mat = (c, mo = {}) => toonMaterial({ color: c, shadowTint: '#a898c8', rim: 0.5, unique: true, ...mo });
  const add = (parent, geo, c, pos, rot, mo = {}) => {
    const m = addOutlined(parent, geo, mo.material ?? mat(c, mo), outlineColorFor(c));
    if (pos) m.position.copy(pos);
    if (rot) m.rotation.set(rot.x, rot.y, rot.z);
    return m;
  };
  const robe = lathe(
    [
      [0.38, -0.02],
      [0.42, 0.02],
      [0.32, 0.25],
      [0.24, 0.55],
      [0.2, 0.8],
      [0.12, 0.92],
      [0.0, 0.95],
    ],
    26
  );
  add(body, robe, robeCol);
  // trim
  const trim = new THREE.TorusGeometry(0.4, 0.03, 6, 26);
  trim.rotateX(Math.PI / 2);
  add(body, trim, c2, V3(0, 0.02, 0));
  // hood + mask + eyes
  j.head = new THREE.Group();
  j.head.position.y = 1.08;
  body.add(j.head);
  add(j.head, new THREE.SphereGeometry(0.21, 18, 14), robeCol);
  const mg = new THREE.SphereGeometry(0.2, 22, 16, Math.PI * 0.2, Math.PI * 0.6, Math.PI * 0.22, Math.PI * 0.55);
  add(j.head, mg, '#efe4cc', V3(0, -0.02, 0.04), null, { material: toonMaterial({ color: '#ffffff', map: MASK_TEX, rim: 0.3, unique: true }) });
  const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(c2).multiplyScalar(2.4) });
  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), eyeMat);
    e.position.set(sx * 0.07, 0.0, 0.2);
    j.head.add(e);
  }
  const hoodTip = new THREE.ConeGeometry(0.14, 0.32, 12);
  add(j.head, hoodTip, robeCol, V3(0, 0.2, -0.1), V3(-0.7, 0, 0));
  // floating hands and the staff
  for (const [sx, k] of [
    [1, 'handL'],
    [-1, 'handR'],
  ]) {
    j[k] = new THREE.Group();
    j[k].position.set(sx * 0.36, 0.7, 0.12);
    body.add(j[k]);
    add(j[k], new THREE.SphereGeometry(0.065, 10, 8), '#3a3048');
  }
  const staff = new THREE.Group();
  j.handR.add(staff);
  staff.position.set(0, -0.05, 0);
  add(staff, new THREE.CylinderGeometry(0.025, 0.03, 1.3, 6).translate(0, 0.2, 0), '#4a3428');
  const crystalMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(c1).multiplyScalar(2.2) });
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.11, 0), crystalMat);
  crystal.position.y = 0.95;
  staff.add(crystal);
  j.staff = staff;
  return { root, body, j, height: 1.4, radius: 0.45, mats: [], crystal, crystalMat, eyeMat };
}

// enemy projectile meshes
let ARROW_GEO = null,
  ARROW_MAT = null;
function arrowMesh() {
  if (!ARROW_GEO) {
    const shaft = new THREE.CylinderGeometry(0.018, 0.018, 0.8, 5);
    shaft.rotateX(Math.PI / 2);
    const head = new THREE.ConeGeometry(0.05, 0.14, 6);
    head.rotateX(Math.PI / 2);
    head.translate(0, 0, 0.46);
    const f1 = new THREE.PlaneGeometry(0.1, 0.16);
    f1.rotateY(Math.PI / 2);
    f1.translate(0, 0, -0.34);
    const f2 = f1.clone().rotateZ(Math.PI / 2);
    const parts = [shaft, head, f1, f2].map((g) => {
      g.deleteAttribute('uv');
      return g.index ? g.toNonIndexed() : g;
    });
    ARROW_GEO = mergeGeometries(parts);
    ARROW_MAT = new THREE.MeshBasicMaterial({ color: '#d8c8a0', side: THREE.DoubleSide });
  }
  return new THREE.Mesh(ARROW_GEO, ARROW_MAT);
}

const _a2 = new THREE.Vector3(),
  _b2 = new THREE.Vector3(),
  _c2 = new THREE.Vector3(),
  _up = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------------
// Enemy
// ---------------------------------------------------------------------------
const BASE_HP = { slime: 9200, goblin: 17500, archer: 12500, brute: 44000, caster: 16000 };
const GOBLIN_LOOKS = {
  goblin: {},
  archer: { weapon: 'bow', hood: '#4f6a3a', skin: '#94895a' },
  brute: { weapon: 'axe', shield: true, helmet: true, scale: 1.5, skin: '#8a6a52', fur: '#4a3424' },
};

export class Enemy {
  constructor(mgr, type, el, x, z, level = 18, opts = {}) {
    this.mgr = mgr;
    this.type = type;
    this.selfEl = el;
    this.level = level;
    this.elite = !!opts.elite;
    this.home = V3(x, 0, z);
    this.pos = V3(x, mgr.ground.heightAt(x, z), z);
    this.home.y = this.pos.y;
    this.vel = V3(0, 0, 0);
    this.yaw = opts.yaw ?? Math.random() * Math.PI * 2;
    this.model = type === 'slime' ? buildSlime(el) : type === 'caster' ? buildCaster(el) : buildGoblin(GOBLIN_LOOKS[type] || {});
    this.humanoid = type === 'goblin' || type === 'archer' || type === 'brute';
    if (this.elite) {
      this.model.root.scale.multiplyScalar(1.25);
      this.model.radius *= 1.25;
      this.model.height *= 1.25;
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.95, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd36a').multiplyScalar(1.6), transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.06;
      ring.renderOrder = 4;
      this.model.root.add(ring);
      this.eliteRing = ring;
    }
    this.radius = this.model.radius;
    this.height = this.model.height;
    this.baseScale = this.model.root.scale.x;
    this.dmgMul = this.elite ? 1.5 : 1;
    this.maxHp = Math.round((BASE_HP[type] || 17500) * (1 + (level - 18) * 0.05) * (this.elite ? 3 : 1));
    // shield brutes guard their front until the guard is broken
    if (type === 'brute') {
      this.guardMax = this.elite ? 150 : 100;
      this.guard = this.guardMax;
      this.brokenT = 0;
    }
    // archers on a watchtower stay put
    this.perch = mgr.ground.heightAt(x, z) - mgr.terrain.heightAt(x, z) > 2;
    this.hover = type === 'caster' ? 0.9 : 0;
    this.blinkCd = 0;
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
      if ((this.type === 'goblin' || this.type === 'archer') && knock && knock.length() > 3) this.stunT = 0.45;
      if (this.type === 'slime') this.squash = 0.35;
    }
    if (this.hp <= 0) this.die();
  }

  // shield guard: frontal hits are mostly blocked and wear the guard down;
  // reactions and heavy blows wear it fastest. Returns a damage multiplier.
  guardCheck(h, reaction) {
    if (this.type !== 'brute' || !this.alive) return 1;
    if (this.brokenT > 0) return 1.3;
    let frontal = false;
    if (h.dir) {
      const fx = Math.sin(this.yaw),
        fz = Math.cos(this.yaw);
      frontal = -(h.dir[0] * fx + h.dir[1] * fz) > 0.3;
    }
    const wear = reaction ? 34 : h.heavy ? 24 : h.el && h.el !== 'phys' ? 12 : 7;
    if (!frontal) {
      if (reaction) this.guard -= wear * 0.5;
      if (this.guard <= 0) this.breakGuard();
      return 1;
    }
    this.guard -= wear;
    if (this.guard <= 0) {
      this.breakGuard();
      return 1;
    }
    this.mgr.emit('block', this);
    return 0.15;
  }

  breakGuard() {
    this.guard = 0;
    this.brokenT = 4.5;
    this.stunT = 4.5;
    this.state = 'chase';
    this.mgr.emit('guardBreak', this);
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
      this.model.root.scale.setScalar(this.baseScale * (1 - k * 0.9));
      if (this.aim) this.aim.visible = false;
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
    const sight = this.type === 'archer' ? (this.perch ? 24 : 19) : this.type === 'caster' ? 17 : 13;
    if (dist < sight && player.state !== 'swim') this.aggro = true;
    if (homeD > 34 || dist > (this.perch ? 32 : 30) || player.dead) this.aggro = false;
    const frozen = this.frozenT > 0;
    this.stunT = Math.max(0, this.stunT - dt);
    if (this.brokenT > 0) {
      this.brokenT -= dt;
      if (this.brokenT <= 0) {
        this.guard = this.guardMax;
        this.mgr.emit('guardUp', this);
      }
    }

    if (!frozen && this.stunT <= 0) {
      if (this.type === 'slime') this.updateSlime(dt, player, toP, dist, homeD);
      else if (this.type === 'archer') this.updateArcher(dt, player, toP, dist, homeD);
      else if (this.type === 'brute') this.updateBrute(dt, player, toP, dist, homeD);
      else if (this.type === 'caster') this.updateCaster(dt, player, toP, dist, homeD);
      else this.updateGoblin(dt, player, toP, dist, homeD);
    } else if (this.aim) this.aim.visible = false;
    if (this.perch) {
      this.vel.x = 0;
      this.vel.z = 0;
    }

    // physics (casters float above the ground)
    if (this.hover > 0) {
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      this.vel.x *= Math.exp(-6 * dt);
      this.vel.z *= Math.exp(-6 * dt);
      if (frozen) this.vel.set(0, 0, 0);
      this.mgr.colliders.resolve(this.pos, this.radius * 0.8);
      const gy = Math.max(T.heightAt(this.pos.x, this.pos.z), SEA_LEVEL);
      const target = gy + this.hover + (frozen ? -0.6 : Math.sin(this.t * 1.8) * 0.15);
      this.pos.y = damp(this.pos.y, target, frozen ? 6 : 4, dt);
      const r = this.model.root;
      r.position.copy(this.pos);
      r.rotation.y = this.yaw;
      this.animateCaster(dt);
      return;
    }
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
    else if (this.type === 'archer') this.animateArcher(dt, dist);
    else if (this.type === 'brute') this.animateBrute(dt, dist);
    else this.animateGoblin(dt, dist);
    if (this.eliteRing) {
      this.eliteRing.rotation.z = this.t * 0.8;
      this.eliteRing.material.opacity = 0.5 + Math.sin(this.t * 3) * 0.2;
    }
  }

  setFlash(v) {
    for (const m of this.model.mats) m.uniforms.uFlash.value = v;
    if (this.type !== 'slime') {
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

  // ---------------------------------------------------------- archer
  updateArcher(dt, player, toP, dist, homeD) {
    this.stateT -= dt;
    this.attackCd -= dt;
    if (!this.aim) this.makeAim();
    if (this.state === 'aim') {
      this.yaw = dampAngle(this.yaw, Math.atan2(toP.x, toP.z), 10, dt);
      this.updateAim(player, 1 - Math.max(0, this.stateT) / this.aimDur);
      if (this.stateT <= 0) {
        this.state = 'loose';
        this.stateT = 0.35;
        this.aim.visible = false;
        this.mgr.shootArrow(this, player);
      }
      return;
    }
    if (this.state === 'loose') {
      if (this.stateT <= 0) this.state = 'chase';
      return;
    }
    this.aim.visible = false;
    this.moving = false;
    if (this.aggro) {
      this.yaw = dampAngle(this.yaw, Math.atan2(toP.x, toP.z), 7, dt);
      if (this.attackCd <= 0 && dist < (this.perch ? 26 : 20)) {
        this.state = 'aim';
        this.aimDur = this.stateT = this.elite ? 0.8 : 1.05;
        this.attackCd = 2.3 + Math.random() * 1.2;
        return;
      }
      if (this.perch) return;
      const want = dist < 7 ? -1 : dist > 15 ? 1 : 0;
      if (want) {
        const sp = want > 0 ? 3.0 : 3.4;
        this.vel.x = damp(this.vel.x, (toP.x / dist) * sp * want, 8, dt);
        this.vel.z = damp(this.vel.z, (toP.z / dist) * sp * want, 8, dt);
      } else {
        const sd = Math.sin(this.t * 0.6) > 0 ? 1 : -1;
        this.vel.x = damp(this.vel.x, (toP.z / dist) * 1.3 * sd, 6, dt);
        this.vel.z = damp(this.vel.z, (-toP.x / dist) * 1.3 * sd, 6, dt);
      }
      this.moving = true;
    } else if (homeD > 3 && !this.perch) this.goHome(dt, homeD);
  }

  makeAim() {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 6, 1, true).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff7a4a').multiplyScalar(2), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.renderOrder = 6;
    m.frustumCulled = false;
    m.visible = false;
    this.mgr.scene.add(m);
    this.aim = m;
  }

  // a glowing sight line that firms up as the archer draws
  updateAim(player, k) {
    const a = this.aim;
    const from = _a2.set(this.pos.x + Math.sin(this.yaw) * 0.3, this.pos.y + this.height * 0.72, this.pos.z + Math.cos(this.yaw) * 0.3);
    const to = _b2.set(player.pos.x, player.pos.y + 1.0, player.pos.z);
    const d = _c2.subVectors(to, from);
    const L = d.length();
    a.position.copy(from);
    a.quaternion.setFromUnitVectors(_up, d.normalize());
    a.scale.set(1 + k, L, 1 + k);
    a.material.opacity = 0.15 + k * 0.5;
    a.visible = true;
  }

  goHome(dt, homeD) {
    const dx = this.home.x - this.pos.x,
      dz = this.home.z - this.pos.z;
    this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 5, dt);
    this.vel.x = damp(this.vel.x, (dx / homeD) * 2, 6, dt);
    this.vel.z = damp(this.vel.z, (dz / homeD) * 2, 6, dt);
    this.moving = true;
    if (this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.1 * dt);
  }

  animateArcher(dt, dist) {
    const j = this.model.j;
    const k = 1 - Math.exp(-dt * 14);
    const set = (o, x, y, z) => {
      o.rotation.x = lerp(o.rotation.x, x, k);
      o.rotation.y = lerp(o.rotation.y, y, k);
      o.rotation.z = lerp(o.rotation.z, z, k);
    };
    const t = this.t;
    this.model.body.position.y = 0.55;
    if (this.state === 'aim' || this.state === 'loose') {
      const draw = this.state === 'aim' ? 1 : 0;
      set(j.armL, -1.5, 0.0, 0.25);
      set(j.armR, -1.45 + (1 - draw) * 0.3, 0.9 * draw, -0.2);
      set(j.spine, 0.1, -0.35, 0);
      set(j.head, 0, 0.3, 0);
      if (this.model.string) this.model.string.position.z = -0.05 - draw * 0.16;
    } else if (this.stunT > 0) {
      set(j.spine, -0.3, 0, 0.1);
      set(j.armR, 0.4, 0, -0.6);
      set(j.armL, 0.4, 0, 0.6);
    } else if (this.moving) {
      const ph = t * 9;
      set(j.legL, Math.sin(ph) * 0.65, 0, 0);
      set(j.legR, -Math.sin(ph) * 0.65, 0, 0);
      set(j.armL, -0.5, 0, 0.3);
      set(j.armR, Math.sin(ph) * 0.5, 0, -0.3);
      set(j.spine, 0.3, 0, 0);
      this.model.body.position.y = 0.55 + Math.abs(Math.sin(ph)) * 0.05;
    } else {
      set(j.legL, 0, 0, 0.08);
      set(j.legR, 0, 0, -0.08);
      set(j.armL, -0.3, 0, 0.3);
      set(j.armR, -0.1 + Math.sin(t * 2) * 0.05, 0, -0.3);
      set(j.spine, 0.2 + Math.sin(t * 2) * 0.03, Math.sin(t * 0.6) * 0.3, 0);
      set(j.head, 0, Math.sin(t * 0.9) * 0.5, 0);
    }
    if (this.model.string && this.state !== 'aim') this.model.string.position.z = -0.05;
  }

  // ----------------------------------------------------------- brute
  updateBrute(dt, player, toP, dist, homeD) {
    this.stateT -= dt;
    this.attackCd -= dt;
    const R = this.elite ? 3.8 : 3.2;
    if (this.state === 'windup') {
      this.yaw = dampAngle(this.yaw, Math.atan2(toP.x, toP.z), 3, dt);
      if (this.stateT <= 0) {
        this.state = 'slam';
        this.stateT = 0.35;
        this.struck = false;
      }
      return;
    }
    if (this.state === 'slam') {
      if (!this.struck && this.stateT < 0.22) {
        this.struck = true;
        this.mgr.slam(this, R, (2100 + this.level * 40) * this.dmgMul);
        this.mgr.emit('quake', this, R);
      }
      if (this.stateT <= 0) {
        this.state = 'recover';
        this.stateT = 0.9;
      }
      return;
    }
    if (this.state === 'bashWind') {
      this.yaw = dampAngle(this.yaw, Math.atan2(toP.x, toP.z), 8, dt);
      if (this.stateT <= 0) {
        this.state = 'bash';
        this.stateT = 0.6;
        this.struck = false;
      }
      return;
    }
    if (this.state === 'bash') {
      const fx = Math.sin(this.yaw),
        fz = Math.cos(this.yaw);
      this.vel.x = fx * 8;
      this.vel.z = fz * 8;
      this.moving = true;
      if (!this.struck && dist < 2.3) {
        this.struck = true;
        this.mgr.swing(this, 2.6, 1.0, (1300 + this.level * 25) * this.dmgMul);
      }
      if (this.stateT <= 0) {
        this.state = 'recover';
        this.stateT = 0.7;
      }
      return;
    }
    if (this.state === 'recover') {
      if (this.stateT <= 0) this.state = 'chase';
      return;
    }
    this.moving = false;
    if (this.aggro) {
      this.yaw = dampAngle(this.yaw, Math.atan2(toP.x, toP.z), 5, dt);
      if (dist < 3.0 && this.attackCd <= 0) {
        this.state = 'windup';
        this.stateT = 1.05;
        this.attackCd = 3.0 + Math.random();
        this.mgr.telegraph(this);
        return;
      }
      if (dist > 4.5 && dist < 10 && this.attackCd <= 0 && Math.random() < dt * 1.2) {
        this.state = 'bashWind';
        this.stateT = 0.65;
        this.attackCd = 3.4;
        this.mgr.telegraph(this);
        return;
      }
      if (dist > 2.4) {
        const sp = 2.3;
        this.vel.x = damp(this.vel.x, (toP.x / dist) * sp, 6, dt);
        this.vel.z = damp(this.vel.z, (toP.z / dist) * sp, 6, dt);
        this.moving = true;
      }
    } else if (homeD > 3) this.goHome(dt, homeD);
  }

  animateBrute(dt, dist) {
    const j = this.model.j;
    const k = 1 - Math.exp(-dt * 12);
    const set = (o, x, y, z) => {
      o.rotation.x = lerp(o.rotation.x, x, k);
      o.rotation.y = lerp(o.rotation.y, y, k);
      o.rotation.z = lerp(o.rotation.z, z, k);
    };
    const t = this.t;
    this.model.body.position.y = 0.55;
    if (this.brokenT > 0) {
      // guard broken: shield arm hangs, staggering
      set(j.spine, -0.25 + Math.sin(t * 5) * 0.08, Math.sin(t * 3) * 0.3, Math.sin(t * 4) * 0.12);
      set(j.armL, 0.5, 0, 0.7);
      set(j.armR, 0.4, 0, -0.6);
      set(j.head, 0.3, Math.sin(t * 6) * 0.4, 0);
    } else if (this.state === 'windup') {
      set(j.armR, -2.9, 0, -0.2);
      set(j.armL, -2.6, 0, 0.3);
      set(j.spine, -0.2, 0, 0);
    } else if (this.state === 'slam') {
      set(j.armR, -0.4, 0, -0.1);
      set(j.armL, -0.6, 0, 0.3);
      set(j.spine, 0.75, 0, 0);
    } else if (this.state === 'bashWind' || this.state === 'bash') {
      set(j.armL, -1.5, 0.3, 0.2);
      set(j.armR, 0.3, 0, -0.5);
      set(j.spine, this.state === 'bash' ? 0.55 : 0.3, -0.3, 0);
      if (this.state === 'bash') {
        const ph = t * 14;
        set(j.legL, Math.sin(ph) * 0.8, 0, 0);
        set(j.legR, -Math.sin(ph) * 0.8, 0, 0);
      }
    } else if (this.stunT > 0) {
      set(j.spine, -0.3, 0, 0.1);
    } else if (this.moving) {
      const ph = t * 6.5;
      set(j.legL, Math.sin(ph) * 0.55, 0, 0);
      set(j.legR, -Math.sin(ph) * 0.55, 0, 0);
      set(j.armL, -1.05, 0.2, 0.35);
      set(j.armR, Math.sin(ph) * 0.3 - 0.5, 0, -0.35);
      set(j.spine, 0.35, 0, 0);
      this.model.body.position.y = 0.55 + Math.abs(Math.sin(ph)) * 0.06;
    } else {
      set(j.legL, 0, 0, 0.12);
      set(j.legR, 0, 0, -0.12);
      set(j.armL, -1.0, 0.25, 0.35);
      set(j.armR, -0.4, 0, -0.4);
      set(j.spine, 0.25 + Math.sin(t * 1.5) * 0.04, 0, 0);
      set(j.head, 0, Math.sin(t * 0.7) * 0.3, 0);
    }
  }

  // ---------------------------------------------------------- caster
  updateCaster(dt, player, toP, dist, homeD) {
    this.stateT -= dt;
    this.attackCd -= dt;
    this.blinkCd -= dt;
    if (this.state === 'cast') {
      this.yaw = dampAngle(this.yaw, Math.atan2(toP.x, toP.z), 8, dt);
      if (this.stateT <= 0) {
        for (let i = 0; i < 3; i++) this.mgr.shootOrb(this, player, i - 1);
        this.state = 'recover';
        this.stateT = 0.8;
      }
      return;
    }
    if (this.state === 'recover') {
      if (this.stateT <= 0) this.state = 'chase';
      return;
    }
    this.moving = false;
    if (this.aggro) {
      this.yaw = dampAngle(this.yaw, Math.atan2(toP.x, toP.z), 6, dt);
      if (dist < 4.5 && this.blinkCd <= 0 && this.blink(player)) return;
      if (this.attackCd <= 0 && dist < 18) {
        this.state = 'cast';
        this.stateT = 0.95;
        this.attackCd = 3.2 + Math.random() * 1.2;
        this.mgr.emit('cast', this);
        return;
      }
      const want = dist < 7 ? -1 : dist > 12 ? 1 : 0;
      if (want) {
        this.vel.x = damp(this.vel.x, (toP.x / dist) * 2.6 * want, 5, dt);
        this.vel.z = damp(this.vel.z, (toP.z / dist) * 2.6 * want, 5, dt);
      } else {
        const sd = Math.sin(this.t * 0.45) > 0 ? 1 : -1;
        this.vel.x = damp(this.vel.x, (toP.z / dist) * 1.6 * sd, 4, dt);
        this.vel.z = damp(this.vel.z, (-toP.x / dist) * 1.6 * sd, 4, dt);
      }
      this.moving = true;
    } else if (homeD > 3) this.goHome(dt, homeD);
  }

  // vanish and reappear a safe distance away
  blink(player) {
    const T = this.mgr.ground;
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 8 + Math.random() * 3;
      const x = player.pos.x + Math.cos(a) * r,
        z = player.pos.z + Math.sin(a) * r;
      if (Math.hypot(x - this.home.x, z - this.home.z) > 26) continue;
      const h = T.heightAt(x, z);
      if (h < 0.5 || Math.abs(h + this.hover - this.pos.y) > 6) continue;
      const from = this.pos.clone();
      this.pos.set(x, h + this.hover, z);
      this.blinkCd = 5 + Math.random() * 2;
      this.mgr.emit('blink', this, from);
      return true;
    }
    this.blinkCd = 1.5;
    return false;
  }

  animateCaster(dt) {
    const m = this.model;
    const j = m.j;
    const t = this.t;
    const k = 1 - Math.exp(-dt * 10);
    const casting = this.state === 'cast';
    m.body.rotation.z = Math.sin(t * 1.3) * 0.05;
    m.body.rotation.x = lerp(m.body.rotation.x, this.moving ? 0.15 : 0, k);
    j.handL.position.y = lerp(j.handL.position.y, 0.7 + Math.sin(t * 2.1) * 0.05 + (casting ? 0.25 : 0), k);
    j.handR.position.y = lerp(j.handR.position.y, 0.75 + Math.sin(t * 2.1 + 1) * 0.05 + (casting ? 0.4 : 0), k);
    j.handR.position.z = lerp(j.handR.position.z, casting ? 0.3 : 0.12, k);
    j.staff.rotation.x = lerp(j.staff.rotation.x, casting ? 0.5 : 0.15, k);
    const glow = casting ? 1 + (1 - Math.max(0, this.stateT) / 0.95) * 1.6 : 1;
    m.crystal.scale.setScalar(glow);
    m.crystal.rotation.y = t * 2;
    j.head.rotation.y = Math.sin(t * 0.8) * 0.25;
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
    this.model.root.scale.setScalar(this.baseScale);
    if (this.type === 'brute') {
      this.guard = this.guardMax;
      this.brokenT = 0;
    }
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

// autumn highlands: camps and patrols with set spots, levels and elites
function highlandGroups() {
  const [A, B] = CAMPS;
  return [
    {
      id: 'campA',
      lv: 30,
      spots: [
        { kind: 'brute', x: A.x - 2, z: A.z + 2, elite: true },
        { kind: 'goblin', x: A.x + 3, z: A.z + 4 },
        { kind: 'goblin', x: A.x - 4, z: A.z - 2 },
        { kind: 'archer', x: A.x + 4.5, z: A.z - 3.5 },
        { kind: 'archer', x: A.x - 6, z: A.z + 5 },
      ],
    },
    {
      id: 'campB',
      lv: 31,
      spots: [
        { kind: 'caster', el: 'fire', x: B.x, z: B.z + 3 },
        { kind: 'caster', el: 'water', x: B.x - 4, z: B.z - 2 },
        { kind: 'brute', x: B.x + 2, z: B.z + 5 },
        { kind: 'goblin', x: B.x - 2, z: B.z + 6 },
        { kind: 'archer', x: B.x + 4.5, z: B.z - 3.5 },
      ],
    },
    { id: 'maples', lv: 28, spots: [{ kind: 'slime', el: 'fire', x: 192, z: 288 }, { kind: 'slime', el: 'wind', x: 196, z: 284 }, { kind: 'slime', el: 'fire', x: 188, z: 292 }] },
    { id: 'ridge', lv: 29, spots: [{ kind: 'caster', el: 'thunder', x: 238, z: 178 }, { kind: 'slime', el: 'thunder', x: 234, z: 183 }, { kind: 'slime', el: 'ice', x: 242, z: 184 }] },
    { id: 'westbank', lv: 27, spots: [{ kind: 'archer', x: 98, z: 258 }, { kind: 'goblin', x: 104, z: 252 }, { kind: 'goblin', x: 100, z: 263 }] },
    { id: 'cliffs', lv: 30, spots: [{ kind: 'brute', x: 292, z: 256 }, { kind: 'archer', x: 288, z: 265 }, { kind: 'caster', el: 'ice', x: 298, z: 262 }] },
  ];
}

const ARROW_G = 7;
const _z = new THREE.Vector3(0, 0, 1);

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
    this.groups = {};
    for (const g of highlandGroups()) {
      this.groups[g.id] = [];
      for (const sp of g.spots) {
        const e = new Enemy(this, sp.kind, sp.el ?? null, sp.x, sp.z, g.lv + (sp.elite ? 2 : 0), { elite: sp.elite });
        e.group = g.id;
        this.groups[g.id].push(e);
        this.list.push(e);
      }
    }
    this.shots = [];
    this.stuck = [];
  }

  // all members of a camp / patrol defeated (and not yet back)
  groupCleared(id) {
    const g = this.groups[id];
    return !!g && g.every((e) => !e.alive);
  }

  // ---------------------------------------------------- enemy projectiles
  shootArrow(e, player) {
    const from = new THREE.Vector3(e.pos.x + Math.sin(e.yaw) * 0.4, e.pos.y + e.height * 0.72, e.pos.z + Math.cos(e.yaw) * 0.4);
    const tgt = new THREE.Vector3(player.pos.x, player.pos.y + 1.0, player.pos.z);
    const speed = 26;
    const tFly = from.distanceTo(tgt) / speed;
    tgt.x += player.vel.x * tFly * 0.5;
    tgt.z += player.vel.z * tFly * 0.5;
    const vel = tgt.sub(from).normalize().multiplyScalar(speed);
    vel.y += 0.5 * ARROW_G * tFly;
    const mesh = arrowMesh();
    mesh.position.copy(from);
    this.scene.add(mesh);
    this.shots.push({ kind: 'arrow', pos: from, vel, mesh, life: 3, dmg: (850 + e.level * 22) * e.dmgMul, src: e });
    this.emit('shoot', e);
  }

  shootOrb(e, player, i) {
    const vfx = this.game.combat && this.game.combat.vfx;
    if (!vfx) return;
    const color = ELEMENT_COLORS[e.selfEl] || '#ffffff';
    e.model.crystal.updateWorldMatrix(true, false);
    const from = e.model.crystal.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3(player.pos.x - from.x, player.pos.y + 1 - from.y, player.pos.z - from.z).normalize();
    dir.applyAxisAngle(_up, i * 0.34);
    const mesh = vfx.orb(color, 0.26);
    mesh.position.copy(from);
    this.shots.push({ kind: 'orb', pos: from, vel: dir.multiplyScalar(9), mesh, life: 3.2, dmg: (1000 + e.level * 22) * e.dmgMul, src: e, color, el: e.selfEl });
  }

  updateShots(dt, player) {
    const vfx = this.game.combat && this.game.combat.vfx;
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.life -= dt;
      if (s.kind === 'arrow') s.vel.y -= ARROW_G * dt;
      else {
        if (s.life > 1.7) {
          const to = _a2.set(player.pos.x - s.pos.x, player.pos.y + 1 - s.pos.y, player.pos.z - s.pos.z).normalize().multiplyScalar(9);
          s.vel.lerp(to, 1 - Math.exp(-dt * 1.5));
        }
        if (vfx && Math.random() < 0.6) vfx.particles.spawn(s.pos, _b2.set(0, 0.2, 0), vfx.color.set(s.color), 0.15, 0.35, { drag: 3 });
      }
      s.pos.addScaledVector(s.vel, dt);
      s.mesh.position.copy(s.pos);
      if (s.kind === 'arrow') s.mesh.quaternion.setFromUnitVectors(_z, _a2.copy(s.vel).normalize());
      const dx = player.pos.x - s.pos.x,
        dy = player.pos.y + 0.95 - s.pos.y,
        dz = player.pos.z - s.pos.z;
      const r = s.kind === 'orb' ? 0.75 : 0.6;
      const hit = !player.dead && dx * dx + dz * dz + dy * dy * 0.45 < r * r;
      const gy = this.ground.heightAt(s.pos.x, s.pos.z);
      if (!hit && s.life > 0 && s.pos.y > gy) continue;
      this.shots.splice(i, 1);
      if (hit) this.emit('shotHit', s);
      else this.emit('shotEnd', s);
      if (s.kind === 'orb') {
        if (vfx) vfx.removeObj(s.mesh);
      } else if (!hit && s.pos.y <= gy + 0.3) this.stuck.push({ mesh: s.mesh, t: 4 });
      else this.scene.remove(s.mesh);
    }
    for (let i = this.stuck.length - 1; i >= 0; i--) {
      const st = this.stuck[i];
      st.t -= dt;
      if (st.t <= 0) {
        this.scene.remove(st.mesh);
        this.stuck.splice(i, 1);
      }
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
    this.updateShots(dt, player);
    for (const e of this.list) {
      const d = Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z);
      if (d > 110 && e.alive && !e.aggro) {
        // far and idle: frozen in place, outlines and shadows dropped
        e.model.root.visible = d < 200;
        if (e.model.root.visible) this.lod(e, d);
        if (e.aim) e.aim.visible = false;
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
