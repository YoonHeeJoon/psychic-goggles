import * as THREE from 'three';
import { shared, NOISE_GLSL } from '../render/shaders.js';
import { smoothstep, lerp, clamp } from '../core/noise.js';

// Palette keyframes by sun elevation (degrees). Colours are sRGB hex, light
// intensities are scalars applied after conversion to linear.
const KEYS = [
  {
    e: -20, zen: '#040a1e', hor: '#0d1a3a', sun: '#8aa6ff', sunI: 0.0, sky: '#1d2c55', skyI: 0.5, gnd: '#10141c',
    fog: '#101a33', cloudL: '#2b3a66', cloudS: '#141c38', lit: '#7f8fc4', shade: '#3b4677',
  },
  {
    e: -6, zen: '#13204a', hor: '#5a4a78', sun: '#ff9a6a', sunI: 0.0, sky: '#3a4370', skyI: 0.6, gnd: '#1a1a22',
    fog: '#3c3d66', cloudL: '#9a6f8f', cloudS: '#3a3460', lit: '#a39ac4', shade: '#4d4b7c',
  },
  {
    e: 2, zen: '#2c4a8c', hor: '#ffa06a', sun: '#ff8a4a', sunI: 0.95, sky: '#7d8cc4', skyI: 0.62, gnd: '#3a2c22',
    fog: '#e6a07c', cloudL: '#ffc29a', cloudS: '#8a6a8a', lit: '#ffd2b0', shade: '#8a7aa8',
  },
  {
    e: 10, zen: '#3c6fc4', hor: '#ffd2a0', sun: '#ffc89a', sunI: 1.3, sky: '#9ab4e6', skyI: 0.66, gnd: '#4a3e2c',
    fog: '#e8d2b8', cloudL: '#fff0dc', cloudS: '#a99ab8', lit: '#fff0e0', shade: '#a8a0c8',
  },
  {
    e: 28, zen: '#2f6fe0', hor: '#a8d4ff', sun: '#fff2dc', sunI: 1.5, sky: '#a6c4f0', skyI: 0.7, gnd: '#4e4a36',
    fog: '#b8d6f4', cloudL: '#ffffff', cloudS: '#a6b6d8', lit: '#fffaf2', shade: '#b0b4d8',
  },
  {
    e: 70, zen: '#2366dc', hor: '#9fd0ff', sun: '#fffaf0', sunI: 1.58, sky: '#a8c8f4', skyI: 0.72, gnd: '#504c38',
    fog: '#b4d6f8', cloudL: '#ffffff', cloudS: '#a9bbdc', lit: '#fffcf6', shade: '#b4b8dc',
  },
];

function lin(hex) {
  return new THREE.Color(hex);
}
const PRE = KEYS.map((k) => ({
  e: k.e,
  zen: lin(k.zen),
  hor: lin(k.hor),
  sun: lin(k.sun).multiplyScalar(k.sunI),
  sky: lin(k.sky).multiplyScalar(k.skyI),
  gnd: lin(k.gnd).multiplyScalar(0.7),
  fog: lin(k.fog),
  cloudL: lin(k.cloudL),
  cloudS: lin(k.cloudS),
  lit: lin(k.lit),
  shade: lin(k.shade),
}));

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = vec4(p.xy, p.w * 0.99999, p.w);
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uFogColor2;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uMoonDir;
uniform vec3 uCloudLight;
uniform vec3 uCloudShade;
uniform float uTime;
uniform float uNight;
uniform float uCloudCover;
uniform float uOvercast;
uniform float uRainbow;
uniform float uFlash;
varying vec3 vDir;
${NOISE_GLSL}

vec3 skyGradient(vec3 d){
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(smoothstep(0.0, 1.0, max(h, 0.0)), 0.55));
  col = mix(col, uFogColor2, smoothstep(0.06, -0.08, h));
  return col;
}

void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = skyGradient(d);
  float occ = 0.0; // alpha: how much the sky blocks sun shafts (clouds)

  // sun glow + disc
  float sd = max(dot(d, uSunDir), 0.0);
  vec3 sunTint = uSunColor / max(max(uSunColor.r, uSunColor.g), 0.001);
  float clearSky = 1.0 - uOvercast * 0.92;
  col += sunTint * pow(sd, 8.0) * 0.18 * (1.0 - uNight) * clearSky;
  col += sunTint * pow(sd, 90.0) * 0.5 * (1.0 - uNight) * clearSky;
  col += sunTint * smoothstep(0.9993, 0.9996, sd) * 6.0 * (1.0 - uNight) * clearSky;

  // moon
  float md = dot(d, uMoonDir);
  float moonDisc = smoothstep(0.99935, 0.9996, md);
  vec3 mcross = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
  float phase = smoothstep(0.0, 0.004, dot(d - uMoonDir, mcross) + 0.012);
  col += vec3(1.0, 0.97, 0.88) * moonDisc * mix(0.25, 2.2, phase) * uNight;
  col += vec3(0.4, 0.5, 0.8) * pow(max(md, 0.0), 60.0) * 0.25 * uNight;

  // stars
  if (uNight > 0.01 && h > 0.0) {
    vec3 sp = d * 220.0;
    vec3 cell = floor(sp);
    vec3 f = fract(sp) - 0.5;
    float rnd = hash12(cell.xy + cell.z * 17.13);
    float star = step(0.985, rnd) * smoothstep(0.22, 0.0, length(f));
    float tw = 0.6 + 0.4 * sin(uTime * 3.0 + rnd * 100.0);
    col += vec3(0.85, 0.9, 1.0) * star * tw * uNight * smoothstep(0.0, 0.25, h) * 1.4;
    // milky band
    float band = fbm3(d.xz * 3.0 + d.y) * 0.5 + 0.5;
    col += vec3(0.25, 0.3, 0.55) * pow(band, 3.0) * 0.12 * uNight * smoothstep(0.1, 0.6, h);
  }

  // ---- clouds: high stylised layer
  if (h > -0.02) {
    float hh = max(h, 0.0);
    vec2 uv = d.xz / (hh + 0.12);
    vec2 wind = vec2(uTime * 0.006, uTime * 0.0025);
    vec2 cuv = uv * 0.55 + wind;
    float base = fbm5(cuv * 1.1);
    float detail = fbm3(cuv * 4.3 - wind * 2.0) * 0.25;
    float cov = mix(0.12, -0.12, uCloudCover);
    float density = smoothstep(cov, cov + 0.22, base + detail);
    float horizonFade = smoothstep(0.0, 0.18, hh);
    density *= horizonFade;
    // light from sun side: sample offset towards sun
    vec2 toSun = normalize(uSunDir.xz + 1e-4) * 0.06;
    float baseS = fbm5((cuv + toSun) * 1.1) + detail;
    float lightAmt = clamp(0.62 + (base - baseS) * 4.5, 0.0, 1.0);
    float edge = smoothstep(cov + 0.22, cov, base + detail) * density; // thin edges -> bright
    vec3 cCol = mix(uCloudShade, uCloudLight, lightAmt);
    cCol += uCloudLight * edge * 0.35;
    // silver lining towards the sun
    cCol += sunTint * pow(sd, 6.0) * 0.6 * (1.0 - density * 0.6) * (1.0 - uNight);
    col = mix(col, cCol, density * 0.96);
    occ = density * 0.85;
    // rainbow opposite the sun after a shower (red outside, violet inside)
    if (uRainbow > 0.001) {
      float a = degrees(acos(clamp(dot(d, -uSunDir), -1.0, 1.0)));
      float t = (a - 40.0) / 2.8;
      float band = smoothstep(0.0, 0.18, t) * smoothstep(1.0, 0.8, t);
      vec3 rb = clamp(abs(fract((1.0 - t) * 0.78 + vec3(0.0, 0.6667, 0.3333)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
      float t2 = (a - 50.5) / 3.4;
      float band2 = smoothstep(0.0, 0.2, t2) * smoothstep(1.0, 0.8, t2);
      vec3 rb2 = clamp(abs(fract(t2 * 0.78 + vec3(0.0, 0.6667, 0.3333)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
      float fade = uRainbow * smoothstep(-0.01, 0.12, h) * (1.0 - density * 0.7) * (1.0 - uNight);
      col += (rb * band * 0.32 + rb2 * band2 * 0.1) * fade;
    }
    // lightning lights the clouds from inside
    col += vec3(0.7, 0.76, 1.0) * uFlash * (0.25 + density * 1.3);

    // ---- towering cumulus near horizon (azimuthal billboards)
    float az = atan(d.x, d.z);
    float ch = fbm5(vec2(az * 2.4, 0.0) + 3.7) * 0.5 + 0.5;
    float top = 0.03 + ch * ch * 0.22;
    float puff = fbm5(vec2(az * 9.0, h * 14.0) + vec2(uTime * 0.002, 0.0)) * 0.5 + 0.5;
    float tower = smoothstep(top + 0.02, top - 0.02, h - puff * 0.06) * smoothstep(-0.01, 0.03, h);
    tower *= smoothstep(0.35, 0.55, ch);
    float tl = clamp(0.45 + (h / max(top, 0.01)) * 0.6 + puff * 0.2, 0.0, 1.0);
    vec3 tCol = mix(uCloudShade, uCloudLight, tl);
    tCol = mix(tCol, uFogColor2, 0.35);
    col = mix(col, tCol, tower * 0.92);
    occ = max(occ, tower * 0.9);
  }
  if (h < -0.02) occ = 1.0;
  gl_FragColor = vec4(col, occ);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Environment {
  constructor(scene, quality) {
    this.scene = scene;
    this.time = 9.2; // hours
    this.timeScale = 1 / 60; // game hours per real second (24 min / day)
    this.paused = false;

    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();

    // sky dome
    this.skyUniforms = {
      uZenith: shared.uZenith,
      uHorizon: shared.uHorizon,
      uFogColor2: { value: new THREE.Color() },
      uSunDir: shared.uSunDir,
      uSunColor: shared.uSunColor,
      uMoonDir: { value: new THREE.Vector3() },
      uCloudLight: { value: new THREE.Color() },
      uCloudShade: { value: new THREE.Color() },
      uTime: shared.uTime,
      uNight: shared.uNight,
      uCloudCover: { value: 0.5 },
      uOvercast: { value: 0 },
      uRainbow: { value: 0 },
      uFlash: { value: 0 },
    };
    const skyGeo = new THREE.SphereGeometry(1, 48, 24);
    this.sky = new THREE.Mesh(
      skyGeo,
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        uniforms: this.skyUniforms,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: true,
        fog: false,
      })
    );
    this.sky.scale.setScalar(4000);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    scene.add(this.sky);

    // lights
    this.light = new THREE.DirectionalLight(0xffffff, 1);
    this.light.castShadow = true;
    const ss = quality.shadowSize;
    this.light.shadow.mapSize.set(ss, ss);
    const ext = quality.shadowExtent;
    const cam = this.light.shadow.camera;
    cam.left = -ext;
    cam.right = ext;
    cam.top = ext;
    cam.bottom = -ext;
    cam.near = 1;
    cam.far = 600;
    this.light.shadow.bias = -0.0004;
    this.light.shadow.normalBias = 0.04;
    this.light.shadow.radius = 2;
    scene.add(this.light);
    scene.add(this.light.target);
    this.shadowExtent = ext;

    // hemisphere for built-in materials (few of them)
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x4a4630, 0.6);
    scene.add(this.hemi);

    scene.fog = new THREE.FogExp2(0xb8d6f4, 0.0016);
    this.fogBase = 0.0016;

    this._tmpA = {};
    this.overcast = 0; // set by Weather (0 clear .. 1 storm)
    this.mistMul = 1; // the domain realm turns mist and cloud shadows off
    this.cloudMul = 1;
    this.update(0, new THREE.Vector3());
  }

  applyQuality(q) {
    const sh = this.light.shadow;
    sh.mapSize.set(q.shadowSize, q.shadowSize);
    if (sh.map) {
      sh.map.dispose();
      sh.map = null;
    }
    const cam = sh.camera;
    cam.left = -q.shadowExtent;
    cam.right = q.shadowExtent;
    cam.top = q.shadowExtent;
    cam.bottom = -q.shadowExtent;
    cam.updateProjectionMatrix();
    this.shadowExtent = q.shadowExtent;
  }

  get hours() {
    return this.time;
  }

  // sample palette at elevation degrees
  palette(elev) {
    let a = PRE[0],
      b = PRE[PRE.length - 1];
    if (elev <= PRE[0].e) a = b = PRE[0];
    else if (elev >= PRE[PRE.length - 1].e) a = b = PRE[PRE.length - 1];
    else {
      for (let i = 0; i < PRE.length - 1; i++) {
        if (elev >= PRE[i].e && elev <= PRE[i + 1].e) {
          a = PRE[i];
          b = PRE[i + 1];
          break;
        }
      }
    }
    const t = a === b ? 0 : (elev - a.e) / (b.e - a.e);
    const o = this._tmpA;
    for (const k of ['zen', 'hor', 'sun', 'sky', 'gnd', 'fog', 'cloudL', 'cloudS', 'lit', 'shade']) {
      if (!o[k]) o[k] = new THREE.Color();
      o[k].copy(a[k]).lerp(b[k], t);
    }
    return o;
  }

  update(dt, focus) {
    if (!this.paused) this.time = (this.time + dt * this.timeScale) % 24;
    const t = this.time;
    // sun path: rises east (+x), sets west (-x), tilted south
    const ang = ((t - 6) / 12) * Math.PI; // 0 at 6h, PI at 18h
    const elevRad = Math.sin(ang) * THREE.MathUtils.degToRad(68);
    const az = ang; // azimuth sweep
    this.sunDir.set(Math.cos(az) * Math.cos(elevRad), Math.sin(elevRad), 0.45 * Math.cos(elevRad) + 0.0).normalize();
    // keep a little elevation when below horizon so palette continues smoothly
    const elevDeg = THREE.MathUtils.radToDeg(Math.asin(this.sunDir.y));
    this.moonDir.copy(this.sunDir).multiplyScalar(-1);
    this.moonDir.y = Math.abs(this.moonDir.y) * 0.8 + 0.25;
    this.moonDir.normalize();

    const p = this.palette(elevDeg);
    const oc = this.overcast;
    if (oc > 0.001) {
      // grey, dim sky and light under rain clouds
      const grey = (c, k, dark) => {
        const l = c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
        c.r += (l - c.r) * k;
        c.g += (l - c.g) * k;
        c.b += (l - c.b) * k;
        c.multiplyScalar(1 - dark);
      };
      grey(p.zen, 0.75 * oc, 0.42 * oc);
      grey(p.hor, 0.7 * oc, 0.3 * oc);
      grey(p.fog, 0.65 * oc, 0.28 * oc);
      p.sun.multiplyScalar(1 - 0.7 * oc);
      grey(p.sky, 0.45 * oc, 0.2 * oc);
      grey(p.gnd, 0.3 * oc, 0.25 * oc);
      grey(p.cloudL, 0.55 * oc, 0.45 * oc);
      grey(p.cloudS, 0.5 * oc, 0.35 * oc);
      grey(p.lit, 0.35 * oc, 0.28 * oc);
      grey(p.shade, 0.3 * oc, 0.1 * oc);
    }
    this.skyUniforms.uCloudCover.value = 0.5 + 0.5 * oc;
    this.skyUniforms.uOvercast.value = oc;
    this.scene.fog.density = this.fogBase * (1 + 1.4 * oc);
    this.updateMist(t, p, oc, dt);
    const night = smoothstep(-2, -10, elevDeg);
    shared.uNight.value = night;
    shared.uZenith.value.copy(p.zen);
    shared.uHorizon.value.copy(p.hor);
    shared.uSkyAmb.value.copy(p.sky);
    shared.uGroundAmb.value.copy(p.gnd);
    shared.uCharLit.value.copy(p.lit);
    shared.uCharShade.value.copy(p.shade);
    this.skyUniforms.uFogColor2.value.copy(p.fog);
    this.skyUniforms.uCloudLight.value.copy(p.cloudL);
    this.skyUniforms.uCloudShade.value.copy(p.cloudS);
    this.skyUniforms.uMoonDir.value.copy(this.moonDir);

    // main light: sun by day, moon by night (cross-faded at horizon)
    const dayW = smoothstep(-4, 3, elevDeg);
    const lightDir = shared.uSunDir.value;
    if (dayW > 0.5) {
      lightDir.copy(this.sunDir);
      if (lightDir.y < 0.06) lightDir.y = 0.06;
      lightDir.normalize();
      shared.uSunColor.value.copy(p.sun).multiplyScalar(smoothstep(0.5, 1.0, dayW));
    } else {
      lightDir.copy(this.moonDir);
      const moonCol = new THREE.Color('#9fb4ff').multiplyScalar(0.55 * smoothstep(0.5, 0.0, dayW));
      shared.uSunColor.value.copy(moonCol);
    }
    // sky dome uses the true sun direction for the disc
    this.skyUniforms.uSunDir = shared.uSunDir;

    this.scene.fog.color.copy(p.fog);
    this.light.color.copy(shared.uSunColor.value);
    this.light.intensity = 1;
    this.hemi.color.copy(p.sky);
    this.hemi.groundColor.copy(p.gnd);

    // shadow camera follows focus, snapped to texels to avoid shimmer
    this.updateShadow(focus);
  }

  // valley mist (screen-space height fog) and the drifting cloud shadows
  updateMist(t, p, oc, dt) {
    const dawn = smoothstep(4.4, 6.2, t) * smoothstep(9.6, 7.2, t);
    const dusk = smoothstep(16.8, 18.4, t) * smoothstep(21, 19.2, t);
    const night = shared.uNight.value;
    const f = this.hfog || (this.hfog = { density: 0, base: 6, falloff: 0.1, color: new THREE.Color(), sun: new THREE.Color() });
    f.density = (0.0008 + dawn * 0.011 + dusk * 0.003 + night * 0.004 + oc * 0.005) * this.mistMul;
    f.base = 4 + dawn * 5;
    f.falloff = 0.08 + dawn * 0.05;
    f.color.copy(p.fog).lerp(p.sky, 0.25).multiplyScalar(1 + dawn * 0.25);
    f.sun.copy(shared.uSunColor.value).multiplyScalar(0.22 + dawn * 0.3);
    // shadows of the cloud layer, strongest under broken cloud by day
    if (!this.paused) {
      const w = shared.uWindDir.value;
      shared.uCloudOff.value.x += w.x * dt * 0.012;
      shared.uCloudOff.value.y += w.y * dt * 0.012;
    }
    const day = smoothstep(-1, 8, THREE.MathUtils.radToDeg(Math.asin(this.sunDir.y)));
    shared.uCloudCov.value = 0.42 + 0.5 * oc;
    shared.uCloudShadow.value = 0.62 * day * (1 - 0.5 * oc) * this.cloudMul;
  }

  updateShadow(focus) {
    const L = shared.uSunDir.value;
    const ext = this.shadowExtent;
    const texel = (ext * 2) / this.light.shadow.mapSize.x;
    // light space basis
    const fwd = L.clone().negate();
    const up = Math.abs(fwd.y) > 0.99 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
    const up2 = new THREE.Vector3().crossVectors(right, fwd).normalize();
    const cx = Math.round(focus.dot(right) / texel) * texel;
    const cy = Math.round(focus.dot(up2) / texel) * texel;
    const cz = focus.dot(fwd);
    const center = new THREE.Vector3().addScaledVector(right, cx).addScaledVector(up2, cy).addScaledVector(fwd, cz);
    this.light.target.position.copy(center);
    this.light.position.copy(center).addScaledVector(L, 300);
    this.light.target.updateMatrixWorld();
  }

  followCamera(camera) {
    this.sky.position.copy(camera.position);
  }
}
