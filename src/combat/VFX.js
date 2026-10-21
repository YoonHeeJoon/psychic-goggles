import * as THREE from 'three';
import { NOISE_GLSL } from '../render/shaders.js';
import { clamp, lerp, smoothstep } from '../core/noise.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

function glowTexture() {
  const S = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const r = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(cv);
  return t;
}

// ---------------------------------------------------------------------------
// CPU-simulated additive point particles
// ---------------------------------------------------------------------------
class Particles {
  constructor(scene, max = 6000) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aColor', this.colAttr);
    geo.setAttribute('aSize', this.sizeAttr);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.uniforms = { uScale: { value: 600 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        attribute vec4 aColor;
        attribute float aSize;
        uniform float uScale;
        varying vec4 vColor;
        void main(){
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec4 vColor;
        void main(){
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          float a = smoothstep(0.5, 0.0, d);
          a *= a;
          vec3 col = vColor.rgb * (1.0 + 1.5 * smoothstep(0.22, 0.0, d));
          gl_FragColor = vec4(col * vColor.a * a, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  spawn(p, v, color, size = 0.3, life = 0.8, opts = {}) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x;
    this.vel[i * 3 + 1] = v.y;
    this.vel[i * 3 + 2] = v.z;
    const c = color;
    const k = opts.intensity ?? 1.6;
    this.col[i * 4] = c.r * k;
    this.col[i * 4 + 1] = c.g * k;
    this.col[i * 4 + 2] = c.b * k;
    this.a0[i] = opts.alpha ?? 1;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.s0[i] = size;
    this.s1[i] = opts.size1 ?? size * 0.2;
    this.grav[i] = opts.gravity ?? 0;
    this.drag[i] = opts.drag ?? 1.5;
  }

  update(dt, height) {
    this.uniforms.uScale.value = height * 0.9;
    const P = this.pos,
      V = this.vel;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        if (this.size[i] !== 0) {
          this.size[i] = 0;
          this.col[i * 4 + 3] = 0;
        }
        continue;
      }
      this.life[i] -= dt;
      const t = 1 - Math.max(this.life[i], 0) / this.maxLife[i];
      const dr = Math.exp(-this.drag[i] * dt);
      V[i * 3] *= dr;
      V[i * 3 + 1] = V[i * 3 + 1] * dr - this.grav[i] * dt;
      V[i * 3 + 2] *= dr;
      P[i * 3] += V[i * 3] * dt;
      P[i * 3 + 1] += V[i * 3 + 1] * dt;
      P[i * 3 + 2] += V[i * 3 + 2] * dt;
      this.size[i] = lerp(this.s0[i], this.s1[i], t);
      this.col[i * 4 + 3] = this.a0[i] * (1 - t * t) * smoothstep(0, 0.08, t + 0.02);
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Weapon trail ribbon (Catmull-Rom smoothed between sampled blade positions)
// ---------------------------------------------------------------------------
export class Trail {
  constructor(scene, color) {
    this.N = 12;
    this.SUB = 4;
    this.samples = [];
    const verts = (this.N - 1) * this.SUB + 1;
    this.verts = verts;
    this.positions = new Float32Array(verts * 2 * 3);
    this.alphas = new Float32Array(verts * 2);
    this.side = new Float32Array(verts * 2);
    const idx = [];
    for (let i = 0; i < verts - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    for (let i = 0; i < verts; i++) {
      this.side[i * 2] = 0;
      this.side[i * 2 + 1] = 1;
    }
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aAlpha', this.alphaAttr);
    geo.setAttribute('aSide', new THREE.BufferAttribute(this.side, 1));
    geo.setIndex(idx);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.color = new THREE.Color(color);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: this.color }, uFade: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float aAlpha;
        attribute float aSide;
        varying float vA;
        varying float vS;
        void main(){ vA = aAlpha; vS = aSide; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uFade;
        varying float vA;
        varying float vS;
        void main(){
          float edge = smoothstep(0.0, 1.0, vS);
          vec3 c = mix(uColor * 0.6, vec3(1.0) * 1.6 + uColor, pow(edge, 3.0));
          float a = vA * uFade * (0.15 + 0.85 * edge);
          gl_FragColor = vec4(c * a, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    scene.add(this.mesh);
    this.active = false;
    this.fade = 0;
  }

  push(base, tip) {
    this.samples.push({ b: base.clone(), t: tip.clone() });
    if (this.samples.length > this.N) this.samples.shift();
    this.active = true;
    this.fade = 1;
  }

  stop() {
    this.active = false;
  }

  update(dt) {
    if (!this.active) {
      this.fade = Math.max(0, this.fade - dt * 5);
      if (this.fade <= 0) this.samples.length = 0;
    }
    this.mat.uniforms.uFade.value = this.fade;
    const S = this.samples;
    const n = S.length;
    this.mesh.visible = n >= 2 && this.fade > 0;
    if (!this.mesh.visible) return;
    const SUB = this.SUB;
    const get = (i) => S[clamp(i, 0, n - 1)];
    let k = 0;
    const emit = (i, t) => {
      const p0 = get(i - 1),
        p1 = get(i),
        p2 = get(i + 1),
        p3 = get(i + 2);
      cr(p0.b, p1.b, p2.b, p3.b, t, _v);
      cr(p0.t, p1.t, p2.t, p3.t, t, _v2);
      this.positions[k * 6] = _v.x;
      this.positions[k * 6 + 1] = _v.y;
      this.positions[k * 6 + 2] = _v.z;
      this.positions[k * 6 + 3] = _v2.x;
      this.positions[k * 6 + 4] = _v2.y;
      this.positions[k * 6 + 5] = _v2.z;
      const a = Math.pow((i + t) / Math.max(n - 1, 1), 1.6);
      this.alphas[k * 2] = a;
      this.alphas[k * 2 + 1] = a;
      k++;
    };
    const cr = (p0, p1, p2, p3, t, out) => {
      const t2 = t * t,
        t3 = t2 * t;
      return out.set(
        0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
        0.5 * (2 * p1.z + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3)
      );
    };
    for (let i = 0; i < n - 1; i++) for (let s = 0; s < SUB; s++) emit(i, s / SUB);
    emit(n - 1, 0);
    // collapse unused vertices onto the newest sample
    for (; k < this.verts; k++) {
      for (let j = 0; j < 6; j++) this.positions[k * 6 + j] = this.positions[(k - 1) * 6 + j];
      this.alphas[k * 2] = 0;
      this.alphas[k * 2 + 1] = 0;
    }
    this.posAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Shared shaders for one-shot effects
// ---------------------------------------------------------------------------
const SHELL_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  vP = position;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const SHELL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
uniform float uCore;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
${NOISE_GLSL}
void main(){
  float fr = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  float n = snoise(vP.xy * 3.1 + vP.z * 2.3 + uTime * 4.0) * 0.5 + 0.5;
  float n2 = snoise(vP.yz * 5.3 - uTime * 6.0) * 0.5 + 0.5;
  // the shell breaks into wisps as it fades
  float thr = mix(0.75, 0.25, uOpacity);
  float wisp = smoothstep(thr, thr + 0.25, n * 0.65 + n2 * 0.45);
  float a = (uCore + pow(fr, 1.6) * 1.1) * mix(1.0, wisp, 1.0 - uCore) * uOpacity;
  vec3 hot = vec3(1.0, 0.96, 0.86);
  vec3 c = mix(uColor, hot, (1.0 - fr) * 0.55 * uOpacity + uCore * 0.4) * 1.9;
  gl_FragColor = vec4(c * a, 1.0);
}`;

const RING_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uInner;
varying vec2 vUv;
varying vec3 vLocal;
void main(){
  float r = length(vLocal.xy);
  float a = smoothstep(uInner, mix(uInner, 1.0, 0.6), r) * smoothstep(1.0, 0.93, r);
  gl_FragColor = vec4(uColor * 1.8 * a * uOpacity, 1.0);
}`;
const RING_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vLocal;
void main(){ vUv = uv; vLocal = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const TORNADO_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
uniform float uSpeed;
varying vec2 vUv;
${NOISE_GLSL}
void main(){
  vec2 q = vec2(vUv.x * 6.0 + vUv.y * 3.5 + uTime * uSpeed * 0.6, vUv.y * 2.2 - uTime * 1.6);
  float a = snoise(q) * 0.65 + snoise(q * 2.3 + 4.0) * 0.35;
  float s = smoothstep(0.2, 0.8, a);
  float fade = smoothstep(0.0, 0.15, vUv.y) * smoothstep(1.0, 0.55, vUv.y);
  vec3 c = mix(uColor, vec3(1.0), s * 0.45) * 1.4;
  gl_FragColor = vec4(c * s * fade * uOpacity * 0.75, 1.0);
}`;
const UV_VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

function additive(frag, vert, uniforms, side = THREE.FrontSide) {
  return new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side,
  });
}

// ---------------------------------------------------------------------------
// VFX manager
// ---------------------------------------------------------------------------
export class VFX {
  constructor(scene, camera, renderer) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.particles = new Particles(scene);
    this.effects = [];
    this.time = 0;
    this.glowTex = glowTexture();
    this.sphereGeo = new THREE.IcosahedronGeometry(1, 3);
    this.ringGeoXY = new THREE.CircleGeometry(1, 64);
    this.tornadoGeo = (() => {
      const g = new THREE.CylinderGeometry(1.0, 0.25, 1, 32, 12, true);
      g.translate(0, 0.5, 0);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        const a = y * 2.4;
        const x = p.getX(i),
          z = p.getZ(i);
        p.setXYZ(i, x * Math.cos(a) - z * Math.sin(a), y, x * Math.sin(a) + z * Math.cos(a));
      }
      g.computeVertexNormals();
      return g;
    })();
    this.color = new THREE.Color();
  }

  add(effect) {
    this.effects.push(effect);
    return effect;
  }

  update(dt) {
    this.time += dt;
    const h = this.renderer.domElement.height;
    this.particles.update(dt, h);
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      if (!e.update(dt)) {
        if (e.dispose) e.dispose();
        this.effects.splice(i, 1);
      }
    }
  }

  // --- particles -----------------------------------------------------------
  burst(pos, color, count = 20, o = {}) {
    const c = this.color.set(color);
    const sp = o.speed ?? 6;
    for (let i = 0; i < count; i++) {
      _v.set(Math.random() - 0.5, Math.random() - 0.5 + (o.up ?? 0.3), Math.random() - 0.5).normalize().multiplyScalar(sp * (0.4 + Math.random() * 0.8));
      this.particles.spawn(pos, _v, c, (o.size ?? 0.25) * (0.6 + Math.random() * 0.8), (o.life ?? 0.6) * (0.6 + Math.random() * 0.7), {
        gravity: o.gravity ?? 6,
        drag: o.drag ?? 2.5,
        intensity: o.intensity ?? 1.8,
      });
    }
  }

  sparkle(pos, color, count = 6, radius = 0.6) {
    const c = this.color.set(color);
    for (let i = 0; i < count; i++) {
      _v2.set(pos.x + (Math.random() - 0.5) * radius, pos.y + (Math.random() - 0.5) * radius, pos.z + (Math.random() - 0.5) * radius);
      _v.set(0, 0.6 + Math.random(), 0);
      this.particles.spawn(_v2, _v, c, 0.12 + Math.random() * 0.12, 0.5 + Math.random() * 0.5, { gravity: 0, drag: 1, intensity: 2.2 });
    }
  }

  hitSpark(pos, color, dir) {
    this.burst(pos, color, 14, { speed: 9, size: 0.18, life: 0.35, gravity: 4, up: 0.1 });
    this.burst(pos, '#ffffff', 6, { speed: 6, size: 0.12, life: 0.25, gravity: 0 });
    this.flash(pos, color, 0.9, 0.14);
  }

  // --- shells --------------------------------------------------------------
  flash(pos, color, radius = 1, dur = 0.2) {
    const mat = additive(SHELL_FRAG, SHELL_VERT, {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: 1 },
      uTime: { value: 0 },
      uCore: { value: 1 },
    });
    const m = new THREE.Mesh(this.sphereGeo, mat);
    m.position.copy(pos);
    m.renderOrder = 6;
    this.scene.add(m);
    let t = 0;
    return this.add({
      update: (dt) => {
        t += dt;
        const k = t / dur;
        m.scale.setScalar(radius * (0.3 + 0.7 * Math.sqrt(Math.min(k, 1))));
        mat.uniforms.uOpacity.value = 1 - k;
        return k < 1;
      },
      dispose: () => {
        this.scene.remove(m);
        mat.dispose();
      },
    });
  }

  explosion(pos, color, radius = 3, dur = 0.55) {
    const mat = additive(SHELL_FRAG, SHELL_VERT, {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: 1 },
      uTime: { value: Math.random() * 10 },
      uCore: { value: 0.0 },
    });
    const m = new THREE.Mesh(this.sphereGeo, mat);
    m.position.copy(pos);
    m.renderOrder = 6;
    this.scene.add(m);
    this.ring(pos.clone().setY(pos.y - 0.4), color, radius * 1.3, dur * 1.1);
    this.flash(pos, '#fff4dc', radius * 0.45, 0.13);
    this.burst(pos, color, 45, { speed: radius * 4.5, size: 0.38, life: 0.65, gravity: 2, up: 0.45 });
    this.burst(pos, '#fff2c8', 25, { speed: radius * 3, size: 0.22, life: 0.45, gravity: 0, up: 0.3 });
    this.burst(pos, color, 20, { speed: radius * 2, size: 0.12, life: 1.3, gravity: 7, up: 1.2, drag: 1 });
    let t = 0;
    return this.add({
      update: (dt) => {
        t += dt;
        const k = Math.min(t / dur, 1);
        mat.uniforms.uTime.value += dt;
        m.scale.setScalar(radius * 0.8 * (1 - Math.pow(1 - k, 3)));
        mat.uniforms.uOpacity.value = Math.pow(1 - k, 1.2);
        return k < 1;
      },
      dispose: () => {
        this.scene.remove(m);
        mat.dispose();
      },
    });
  }

  ring(pos, color, radius = 3, dur = 0.5, opts = {}) {
    const mat = additive(RING_FRAG, RING_VERT, {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: 1 },
      uInner: { value: opts.inner ?? 0.7 },
    }, THREE.DoubleSide);
    const m = new THREE.Mesh(this.ringGeoXY, mat);
    m.position.copy(pos);
    m.position.y += 0.15;
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = 6;
    this.scene.add(m);
    let t = 0;
    return this.add({
      update: (dt) => {
        t += dt;
        const k = Math.min(t / dur, 1);
        m.scale.setScalar(radius * (opts.static ? 1 : 1 - Math.pow(1 - k, 3)));
        mat.uniforms.uOpacity.value = opts.static ? Math.min(1, (1 - k) * 4) * (opts.opacity ?? 1) : 1 - k;
        return k < 1;
      },
      dispose: () => {
        this.scene.remove(m);
        mat.dispose();
      },
    });
  }

  // --- lightning -----------------------------------------------------------
  lightning(from, to, color = '#d7a6ff', width = 0.22, dur = 0.32) {
    const pts = [];
    const segs = 14;
    const dir = _v.copy(to).sub(from);
    const len = dir.length();
    const perpA = new THREE.Vector3(1, 0, 0);
    const perpB = new THREE.Vector3(0, 0, 1);
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const p = new THREE.Vector3().copy(from).lerp(to, t);
      if (i > 0 && i < segs) {
        const j = len * 0.075 * Math.sin(t * Math.PI) * (0.5 + Math.random());
        p.addScaledVector(perpA, (Math.random() - 0.5) * 2 * j);
        p.addScaledVector(perpB, (Math.random() - 0.5) * 2 * j);
      }
      pts.push(p);
    }
    const build = (w) => {
      const pos = [];
      const idx = [];
      const view = _v2.copy(this.camera.position);
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const tan = (i < pts.length - 1 ? pts[i + 1].clone().sub(p) : p.clone().sub(pts[i - 1])).normalize();
        const vd = view.clone().sub(p).normalize();
        const side = new THREE.Vector3().crossVectors(tan, vd).normalize().multiplyScalar(w * (1 - (i / pts.length) * 0.4));
        pos.push(p.x - side.x, p.y - side.y, p.z - side.z, p.x + side.x, p.y + side.y, p.z + side.z);
        if (i < pts.length - 1) {
          const a = i * 2;
          idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      return g;
    };
    const core = new THREE.Mesh(build(width * 0.18), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffffff').multiplyScalar(3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    const glow = new THREE.Mesh(build(width * 0.7), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.6), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    core.renderOrder = glow.renderOrder = 7;
    core.frustumCulled = glow.frustumCulled = false;
    this.scene.add(core, glow);
    this.flash(to, color, 1.6, 0.25);
    this.burst(to, color, 24, { speed: 8, size: 0.2, life: 0.45 });
    let t = 0;
    return this.add({
      update: (dt) => {
        t += dt;
        const k = t / dur;
        const flick = Math.random() > 0.25 ? 1 : 0.3;
        core.material.opacity = (1 - k) * flick;
        glow.material.opacity = 0.5 * (1 - k) * flick;
        return k < 1;
      },
      dispose: () => {
        this.scene.remove(core, glow);
        core.geometry.dispose();
        glow.geometry.dispose();
        core.material.dispose();
        glow.material.dispose();
      },
    });
  }

  // --- persistent fields ---------------------------------------------------
  tornado(color, radius = 2.5, height = 7) {
    const group = new THREE.Group();
    const mats = [];
    for (let i = 0; i < 3; i++) {
      const mat = additive(TORNADO_FRAG, UV_VERT, {
        uColor: { value: new THREE.Color(color) },
        uOpacity: { value: 0 },
        uTime: { value: i * 3.3 },
        uSpeed: { value: 3 + i * 1.5 },
      }, THREE.DoubleSide);
      mats.push(mat);
      const m = new THREE.Mesh(this.tornadoGeo, mat);
      const s = 1 - i * 0.22;
      m.scale.set(radius * s, height * (1 - i * 0.1), radius * s);
      m.renderOrder = 6;
      group.add(m);
    }
    this.scene.add(group);
    const fx = {
      group,
      mats,
      setColor: (c) => mats.forEach((m) => m.uniforms.uColor.value.set(c)),
      opacity: 0,
      alive: true,
      update: (dt) => {
        mats.forEach((m) => (m.uniforms.uTime.value += dt));
        group.rotation.y += dt * 5;
        fx.opacityCur = lerp(fx.opacityCur ?? 0, fx.alive ? 1 : 0, 1 - Math.exp(-dt * 6));
        mats.forEach((m) => (m.uniforms.uOpacity.value = fx.opacityCur));
        return fx.alive || fx.opacityCur > 0.02;
      },
      dispose: () => {
        this.scene.remove(group);
        mats.forEach((m) => m.dispose());
      },
    };
    return this.add(fx);
  }

  orb(color, size = 0.25) {
    const g = new THREE.Group();
    const mat = new THREE.SpriteMaterial({ map: this.glowTex, color: new THREE.Color(color).multiplyScalar(2.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const s = new THREE.Sprite(mat);
    s.scale.setScalar(size * 3);
    s.renderOrder = 6;
    g.add(s);
    const core = new THREE.Mesh(this.sphereGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.6).multiplyScalar(2), fog: false }));
    core.scale.setScalar(size * 0.45);
    g.add(core);
    this.scene.add(g);
    return g;
  }

  removeObj(o) {
    this.scene.remove(o);
    o.traverse((c) => {
      if (c.material) c.material.dispose();
    });
  }
}
