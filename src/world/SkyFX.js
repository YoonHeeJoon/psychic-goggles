import * as THREE from 'three';

// Night-sky effects: shooting stars streaking across clear nights, firework
// shells (rockets with trails that burst into peonies, rings and golden
// willows) and paper sky lanterns that drift up and out over the sea.

const _a = new THREE.Vector3(),
  _b = new THREE.Vector3(),
  _c = new THREE.Vector3(),
  _m = new THREE.Matrix4(),
  _q = new THREE.Quaternion(),
  _s = new THREE.Vector3();

// ---------------------------------------------------------------- streaks
const STREAK_FRAG = /* glsl */ `
uniform float uAlpha;
varying vec2 vUv;
void main(){
  // bright head at u=1, fading tail towards u=0, thin across v
  float across = 1.0 - abs(vUv.y - 0.5) * 2.0;
  float along = pow(vUv.x, 2.2);
  float a = along * pow(across, 2.5) * uAlpha;
  gl_FragColor = vec4(vec3(0.85, 0.92, 1.0) * 2.4 * a, a);
}`;

// ------------------------------------------------------------- particles
const SPARK_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
attribute float aAlpha;
varying vec3 vColor;
varying float vAlpha;
void main(){
  vColor = aColor;
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = max(aSize * 560.0 / max(-mv.z, 1.0), 2.2 * step(0.01, aAlpha));
  gl_Position = projectionMatrix * mv;
}`;
const SPARK_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main(){
  vec2 p = gl_PointCoord - 0.5;
  float r = length(p) * 2.0;
  float a = smoothstep(1.0, 0.0, r);
  a = a * a * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor * a, a);
}`;

const PALETTE = ['#ff5a5a', '#ffd25a', '#5ad8ff', '#b07aff', '#7aff9a', '#ff9ad8', '#ffffff', '#ffa45a'].map((c) => new THREE.Color(c));

export class SkyFX {
  constructor(scene) {
    this.scene = scene;
    // shooting stars
    this.streaks = [];
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uAlpha: { value: 0 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: STREAK_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      m.frustumCulled = false;
      m.visible = false;
      m.renderOrder = -8;
      scene.add(m);
      this.streaks.push({ mesh: m, t: 0, dur: 0, active: false, start: new THREE.Vector3(), dir: new THREE.Vector3() });
    }
    this.starT = 4;

    // spark particles for fireworks
    const N = (this.N = 3200);
    this.p = {
      pos: new Float32Array(N * 3),
      vel: new Float32Array(N * 3),
      col: new Float32Array(N * 3),
      size: new Float32Array(N),
      alpha: new Float32Array(N),
      life: new Float32Array(N),
      max: new Float32Array(N),
      drag: new Float32Array(N),
      grav: new Float32Array(N),
      trail: new Uint8Array(N),
    };
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.p.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.p.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.p.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.p.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.sparks = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({ vertexShader: SPARK_VERT, fragmentShader: SPARK_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })
    );
    this.sparks.frustumCulled = false;
    this.sparks.renderOrder = 7;
    scene.add(this.sparks);
    this.next = 0;
    this.live = 0;
    this.rockets = [];
    this.onBurst = null;

    // sky lanterns
    const lg = new THREE.CylinderGeometry(0.3, 0.24, 0.62, 10, 1, false);
    const capG = new THREE.CylinderGeometry(0.31, 0.31, 0.05, 10);
    capG.translate(0, 0.32, 0);
    lg.deleteAttribute('uv');
    capG.deleteAttribute('uv');
    const geoL = new THREE.BufferGeometry();
    const merged = [lg.toNonIndexed(), capG.toNonIndexed()];
    const pos = [];
    const glow = [];
    merged.forEach((g, k) => {
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        pos.push(p.getX(i), p.getY(i), p.getZ(i));
        glow.push(k === 0 ? 1 - (p.getY(i) + 0.31) * 0.6 : 0.25);
      }
    });
    geoL.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geoL.setAttribute('aGlow', new THREE.Float32BufferAttribute(glow, 1));
    const LN = (this.LN = 180);
    this.lanternMesh = new THREE.InstancedMesh(
      geoL,
      new THREE.ShaderMaterial({
        vertexShader: `attribute float aGlow; varying float vGlow; varying vec3 vCol;
          void main(){ vGlow = aGlow; vCol = instanceColor; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
        fragmentShader: `varying float vGlow; varying vec3 vCol; void main(){ gl_FragColor = vec4(vCol * (0.35 + vGlow * 1.9), 1.0); }`,
        fog: false,
      }),
      LN
    );
    this.lanternMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(LN * 3), 3);
    this.lanternMesh.frustumCulled = false;
    this.lanternMesh.count = 0;
    scene.add(this.lanternMesh);
    this.lanterns = [];
  }

  // ---------------------------------------------------------- shooting stars
  updateStars(dt, camera, night, clear) {
    this.starT -= dt;
    if (this.starT <= 0 && night > 0.6 && clear) {
      this.starT = 3 + Math.random() * 7;
      const s = this.streaks.find((x) => !x.active);
      if (s) {
        const az = Math.random() * Math.PI * 2;
        const el = 0.45 + Math.random() * 0.6;
        s.start.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
        const side = new THREE.Vector3().crossVectors(s.start, Y).normalize();
        s.dir.copy(side).multiplyScalar(Math.random() < 0.5 ? 1 : -1).addScaledVector(Y, -0.5 - Math.random() * 0.5).normalize();
        s.t = 0;
        s.dur = 0.6 + Math.random() * 0.7;
        s.active = true;
      }
    }
    for (const s of this.streaks) {
      if (!s.active) {
        s.mesh.visible = false;
        continue;
      }
      s.t += dt;
      const k = s.t / s.dur;
      if (k >= 1) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }
      const R = 1500;
      const head = _a.copy(s.start).multiplyScalar(R).addScaledVector(s.dir, 420 * s.t).add(camera.position);
      const len = Math.min(220, 420 * s.t);
      const mid = _b.copy(head).addScaledVector(s.dir, -len / 2);
      const view = _c.subVectors(camera.position, mid).normalize();
      const up = new THREE.Vector3().crossVectors(s.dir, view).normalize();
      const nrm = new THREE.Vector3().crossVectors(s.dir, up);
      _m.makeBasis(s.dir, up, nrm);
      _q.setFromRotationMatrix(_m);
      s.mesh.position.copy(mid);
      s.mesh.quaternion.copy(_q);
      s.mesh.scale.set(len, 2.6, 1);
      s.mesh.material.uniforms.uAlpha.value = Math.sin(k * Math.PI) * night;
      s.mesh.visible = true;
    }
  }

  // ---------------------------------------------------------- particles
  spawn(x, y, z, vx, vy, vz, color, size, life, drag = 1.2, grav = 4, trail = 0) {
    const P = this.p;
    const i = this.next;
    this.next = (this.next + 1) % this.N;
    P.pos[i * 3] = x;
    P.pos[i * 3 + 1] = y;
    P.pos[i * 3 + 2] = z;
    P.vel[i * 3] = vx;
    P.vel[i * 3 + 1] = vy;
    P.vel[i * 3 + 2] = vz;
    P.col[i * 3] = color.r;
    P.col[i * 3 + 1] = color.g;
    P.col[i * 3 + 2] = color.b;
    P.size[i] = size;
    P.life[i] = life;
    P.max[i] = life;
    P.drag[i] = drag;
    P.grav[i] = grav;
    P.trail[i] = trail;
    P.alpha[i] = 1;
  }

  // a shell climbs from (x, y, z) and bursts at height h
  launch(x, y, z, h) {
    this.rockets.push({ pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3((Math.random() - 0.5) * 3, 34 + Math.random() * 6, (Math.random() - 0.5) * 3), top: y + h, t: 0 });
  }

  burst(at) {
    const kinds = ['peony', 'peony', 'ring', 'willow', 'double'];
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    const c1 = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    const c2 = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    const col = new THREE.Color();
    const n = kind === 'willow' ? 170 : kind === 'ring' ? 110 : 220;
    const speed = kind === 'willow' ? 22 : 32 + Math.random() * 8;
    // ring plane
    const ax = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).normalize();
    const u = new THREE.Vector3().crossVectors(ax, Y).normalize();
    const v = new THREE.Vector3().crossVectors(ax, u);
    for (let i = 0; i < n; i++) {
      let d;
      if (kind === 'ring') {
        const a = (i / n) * Math.PI * 2;
        d = _a.copy(u).multiplyScalar(Math.cos(a)).addScaledVector(v, Math.sin(a));
      } else {
        // fibonacci sphere for even coverage
        const t = (i + 0.5) / n;
        const inc = Math.acos(1 - 2 * t);
        const az = Math.PI * (1 + Math.sqrt(5)) * i;
        d = _a.set(Math.sin(inc) * Math.cos(az), Math.cos(inc), Math.sin(inc) * Math.sin(az));
      }
      const sp = speed * (0.85 + Math.random() * 0.3) * (kind === 'double' && i % 2 ? 0.55 : 1);
      if (kind === 'willow') col.setRGB(2.6, 1.6, 0.6);
      else col.copy(kind === 'double' && i % 2 ? c2 : c1).multiplyScalar(2.6);
      const life = kind === 'willow' ? 3.2 + Math.random() : 1.6 + Math.random() * 0.8;
      this.spawn(at.x, at.y, at.z, d.x * sp, d.y * sp, d.z * sp, col, kind === 'willow' ? 0.9 : 1.15, life, kind === 'willow' ? 1.5 : 1.8, kind === 'willow' ? 7 : 4.5, kind === 'willow' ? 1 : 2);
    }
    // flash core
    col.setRGB(3, 2.7, 2.2);
    for (let i = 0; i < 8; i++) this.spawn(at.x, at.y, at.z, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, col, 4.5, 0.25, 4, 0);
    if (this.onBurst) this.onBurst(at, kind);
  }

  updateSparks(dt) {
    // rockets
    const trailCol = new THREE.Color(2.4, 1.7, 1.0);
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.t += dt;
      r.vel.y -= 9 * dt;
      r.pos.addScaledVector(r.vel, dt);
      this.spawn(r.pos.x, r.pos.y, r.pos.z, (Math.random() - 0.5) * 1.5, -2, (Math.random() - 0.5) * 1.5, trailCol, 0.7, 0.5, 2, 2);
      if (r.pos.y >= r.top || r.vel.y < 4) {
        this.burst(r.pos);
        this.rockets.splice(i, 1);
      }
    }
    const P = this.p;
    let live = 0;
    const tCol = new THREE.Color();
    for (let i = 0; i < this.N; i++) {
      if (P.life[i] <= 0) {
        if (P.alpha[i] !== 0) P.alpha[i] = 0;
        continue;
      }
      live++;
      P.life[i] -= dt;
      const k = Math.exp(-P.drag[i] * dt);
      P.vel[i * 3] *= k;
      P.vel[i * 3 + 1] = P.vel[i * 3 + 1] * k - P.grav[i] * dt;
      P.vel[i * 3 + 2] *= k;
      P.pos[i * 3] += P.vel[i * 3] * dt;
      P.pos[i * 3 + 1] += P.vel[i * 3 + 1] * dt;
      P.pos[i * 3 + 2] += P.vel[i * 3 + 2] * dt;
      const f = Math.max(0, P.life[i] / P.max[i]);
      // sparkle near the end of life
      P.alpha[i] = f < 0.35 ? f / 0.35 * (0.6 + 0.4 * Math.sin(P.life[i] * 40 + i)) : 1;
      if (P.trail[i] && Math.random() < (P.trail[i] === 1 ? 0.2 : 0.07)) {
        tCol.setRGB(P.col[i * 3] * 0.6, P.col[i * 3 + 1] * 0.6, P.col[i * 3 + 2] * 0.6);
        this.spawn(P.pos[i * 3], P.pos[i * 3 + 1], P.pos[i * 3 + 2], 0, -0.5, 0, tCol, 0.5, 0.7, 1, 1, 0);
      }
    }
    this.live = live + this.rockets.length;
    const g = this.sparks.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    this.sparks.visible = this.live > 0;
  }

  // ---------------------------------------------------------- sky lanterns
  releaseLantern(x, y, z, drift, opts = {}) {
    let L = this.lanterns.find((l) => l.dead);
    if (!L) {
      if (this.lanterns.length < this.LN) {
        L = {};
        this.lanterns.push(L);
      } else L = this.lanterns.reduce((a, b) => (a.age > b.age ? a : b));
    }
    L.pos = new THREE.Vector3(x, y, z);
    L.vel = new THREE.Vector3(drift.x * (0.4 + Math.random() * 0.4), 0.55 + Math.random() * 0.5, drift.z * (0.4 + Math.random() * 0.4));
    L.age = 0;
    L.life = opts.life ?? 110 + Math.random() * 40;
    L.ph = Math.random() * 10;
    L.scale = opts.scale ?? 0.85 + Math.random() * 0.35;
    L.color = new THREE.Color(opts.color ?? (Math.random() < 0.8 ? '#ffb45a' : '#ff8a6a')).multiplyScalar(1.0);
    L.dead = false;
    return L;
  }

  updateLanterns(dt, t) {
    const M = this.lanternMesh;
    let n = 0;
    for (const L of this.lanterns) {
      if (L.dead) continue;
      L.age += dt;
      if (L.age > L.life) {
        L.dead = true;
        continue;
      }
      L.pos.addScaledVector(L.vel, dt);
      L.pos.x += Math.sin(t * 0.7 + L.ph) * 0.15 * dt;
      L.pos.z += Math.cos(t * 0.6 + L.ph) * 0.15 * dt;
      const fade = Math.min(1, L.age / 1.5) * Math.min(1, (L.life - L.age) / 8);
      const flick = 0.85 + 0.15 * Math.sin(t * 9 + L.ph * 3) * Math.sin(t * 5.3 + L.ph);
      _s.setScalar(L.scale * Math.max(0.05, fade));
      _q.setFromAxisAngle(Y, L.ph + t * 0.2);
      _m.compose(L.pos, _q, _s);
      M.setMatrixAt(n, _m);
      M.instanceColor.setXYZ(n, L.color.r * flick, L.color.g * flick, L.color.b * flick);
      n++;
    }
    M.count = n;
    M.instanceMatrix.needsUpdate = true;
    M.instanceColor.needsUpdate = true;
    M.visible = n > 0;
  }
}

const Y = new THREE.Vector3(0, 1, 0);
