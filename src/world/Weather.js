import * as THREE from 'three';
import { shared, terrainUniforms, TERRAIN_SAMPLE_GLSL } from '../render/shaders.js';
import { smoothstep, damp } from '../core/noise.js';

// Weather: passing showers with grey skies, falling rain, splashes and rings
// on water, soaked ground that slowly dries, a rainbow when the sun comes
// back, and thunderstorms with lightning after dark.

const RAIN_VERT = /* glsl */ `
attribute vec3 aOffset;
attribute float aRand;
uniform float uTime;
uniform float uRain;
uniform vec2 uWind;
uniform float uBox;
uniform float uHeight;
uniform vec3 uSide;
varying float vA;
varying float vX;
void main(){
  // instances above the current density collapse to nothing
  if (aRand > uRain) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vA = 0.0; return; }
  float speed = 21.0 + aRand * 6.0;
  float y = fract(aOffset.y - uTime * speed / uHeight);
  vec3 c = cameraPosition;
  vec3 p;
  p.x = c.x + (fract(aOffset.x - c.x / uBox) - 0.5) * uBox;
  p.z = c.z + (fract(aOffset.z - c.z / uBox) - 0.5) * uBox;
  p.y = c.y - uHeight * 0.45 + y * uHeight;
  vec3 fall = normalize(vec3(uWind.x * 0.13, -1.0, uWind.y * 0.13));
  float len = 0.6 + aRand * 0.4;
  vec3 wp = p + uSide * position.x * 0.03 - fall * position.y * len;
  float d = length(p - c);
  vA = smoothstep(0.8, 2.5, d) * smoothstep(uBox * 0.5, uBox * 0.3, d);
  vX = position.x;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const RAIN_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uRain;
varying float vA;
varying float vX;
void main(){
  float a = vA * (1.0 - abs(vX) * 1.6) * 0.5;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
}`;

const SPLASH_VERT = /* glsl */ `
${TERRAIN_SAMPLE_GLSL}
attribute vec3 aOffset;
attribute float aRand;
uniform float uTime;
uniform float uRain;
uniform float uBox;
varying vec2 vUv;
varying float vT;
varying float vWater;
void main(){
  if (aRand > uRain) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vT = 1.0; return; }
  float cyc = uTime * (1.6 + aRand) + aOffset.y * 10.0;
  float t = fract(cyc);
  float k = floor(cyc);
  // a new random spot every cycle
  vec2 jitter = fract(vec2(sin(k * 12.9898 + aRand * 78.2), sin(k * 39.346 + aRand * 11.1)) * 43758.5453) - 0.5;
  vec3 c = cameraPosition;
  vec2 xz;
  xz.x = c.x + (fract(aOffset.x + jitter.x * 0.2 - c.x / uBox) - 0.5) * uBox;
  xz.y = c.z + (fract(aOffset.z + jitter.y * 0.2 - c.z / uBox) - 0.5) * uBox;
  float th = terrainHeight(xz);
  vWater = step(th, 0.0);
  float y = max(th, 0.0) + 0.04;
  float s = mix(0.06, mix(0.22, 0.42, vWater), t);
  vec3 wp = vec3(xz.x + position.x * s, y, xz.y + position.z * s);
  vUv = position.xz;
  vT = t;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const SPLASH_FRAG = /* glsl */ `
uniform vec3 uColor;
varying vec2 vUv;
varying float vT;
varying float vWater;
void main(){
  float r = length(vUv) * 2.0;
  float ring = smoothstep(0.62, 0.85, r) * smoothstep(1.0, 0.88, r);
  float dot0 = smoothstep(0.5, 0.0, r) * (1.0 - vWater) * smoothstep(0.4, 0.0, vT);
  float a = (ring * mix(0.55, 0.7, vWater) + dot0 * 0.5) * (1.0 - vT);
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
}`;

function instancedQuads(n, build) {
  const base = build();
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute('position', base.attributes.position);
  const off = new Float32Array(n * 3);
  const rnd = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    off[i * 3] = Math.random();
    off[i * 3 + 1] = Math.random();
    off[i * 3 + 2] = Math.random();
    rnd[i] = Math.random();
  }
  g.setAttribute('aOffset', new THREE.InstancedBufferAttribute(off, 3));
  g.setAttribute('aRand', new THREE.InstancedBufferAttribute(rnd, 1));
  g.instanceCount = n;
  return g;
}

export const WEATHER_MODES = { auto: '자동', clear: '맑음', rain: '비', storm: '뇌우' };

export class Weather {
  constructor(game) {
    this.g = game;
    const q = game.quality;
    const many = q.grass > 150000;
    this.rain = 0; // current intensity
    this.target = 0;
    this.overcast = 0;
    this.wet = 0;
    this.rainbow = 0;
    this.flash = 0;
    this.storm = false;
    this.timer = 140 + Math.random() * 120; // seconds until the next weather roll
    this.boltT = 5;
    const forced = new URLSearchParams(location.search).get('weather');
    this.mode = WEATHER_MODES[forced] ? forced : 'auto';

    const box = 34;
    this.rainMat = new THREE.ShaderMaterial({
      vertexShader: RAIN_VERT,
      fragmentShader: RAIN_FRAG,
      uniforms: {
        uTime: shared.uTime,
        uRain: { value: 0 },
        uWind: { value: new THREE.Vector2(0.6, 0.3) },
        uBox: { value: box },
        uHeight: { value: 22 },
        uColor: { value: new THREE.Color() },
        uSide: { value: new THREE.Vector3(1, 0, 0) },
      },
      transparent: true,
      depthWrite: false,
    });
    const quad = () => {
      const p = new THREE.PlaneGeometry(1, 1);
      p.translate(0, 0.5, 0);
      return p;
    };
    this.rainMesh = new THREE.Mesh(instancedQuads(many ? 7000 : 2600, quad), this.rainMat);
    this.rainMesh.frustumCulled = false;
    this.rainMesh.renderOrder = 5;
    this.rainMesh.visible = false;
    game.scene.add(this.rainMesh);

    this.splashMat = new THREE.ShaderMaterial({
      vertexShader: SPLASH_VERT,
      fragmentShader: SPLASH_FRAG,
      uniforms: {
        uTime: shared.uTime,
        uRain: { value: 0 },
        uBox: { value: 26 },
        uColor: { value: new THREE.Color() },
        ...terrainUniforms,
      },
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const flat = () => {
      const p = new THREE.PlaneGeometry(1, 1);
      p.rotateX(-Math.PI / 2);
      return p;
    };
    this.splashMesh = new THREE.Mesh(instancedQuads(many ? 900 : 350, flat), this.splashMat);
    this.splashMesh.frustumCulled = false;
    this.splashMesh.renderOrder = 4;
    this.splashMesh.visible = false;
    game.scene.add(this.splashMesh);
  }

  setMode(m) {
    if (!WEATHER_MODES[m]) return;
    this.mode = m;
    this.timer = 30;
  }

  // auto mode: clear spells broken by showers; storms when it is night
  roll(dt) {
    const night = shared.uNight.value > 0.5;
    if (this.mode === 'clear') {
      this.target = 0;
      return;
    }
    if (this.mode === 'rain' || this.mode === 'storm') {
      this.target = this.mode === 'storm' ? 1 : 0.75;
      this.storm = this.mode === 'storm';
      return;
    }
    this.timer -= dt;
    if (this.timer > 0) return;
    if (this.target > 0) {
      this.target = 0; // shower ends
      this.timer = 180 + Math.random() * 240;
    } else if (Math.random() < 0.45) {
      this.storm = night && Math.random() < 0.6;
      this.target = this.storm ? 1 : 0.55 + Math.random() * 0.35;
      this.timer = 70 + Math.random() * 90;
    } else this.timer = 60 + Math.random() * 120;
  }

  update(dt) {
    const g = this.g;
    this.roll(dt);
    const before = this.rain;
    // clouds gather before the rain and linger a little after it
    this.overcast = damp(this.overcast, Math.min(1, this.target * 1.25), this.target > this.overcast ? 0.18 : 0.08, dt);
    const ready = smoothstep(0.45, 0.85, this.overcast);
    this.rain = damp(this.rain, this.target * ready, this.target > this.rain ? 0.35 : 0.25, dt);
    this.wet = this.rain > this.wet ? damp(this.wet, Math.min(1, this.rain * 1.4), 0.15, dt) : Math.max(0, this.wet - dt / 110);
    if (before > 0.35 && this.rain <= 0.35 && this.target === 0 && g.env.sunDir.y > 0.05) this.rainbow = 1;
    this.rainbow = Math.max(0, this.rainbow - dt / 75);
    if (this.rain > 0.2) this.rainbow = Math.min(this.rainbow, 1 - this.rain);

    const env = g.env;
    env.overcast = this.overcast;
    shared.uWet.value = this.wet;
    shared.uWindStrength.value = 1 + 0.9 * this.overcast;
    env.skyUniforms.uRainbow.value = smoothstep(0, 0.25, this.rainbow) * smoothstep(1, 0.75, this.rainbow) * 0.9 + 0.1 * this.rainbow;
    // rain colour follows the sky light so it reads at night as well
    const c = this.rainMat.uniforms.uColor.value.copy(shared.uSkyAmb.value).multiplyScalar(1.15).addScalar(0.12);
    this.splashMat.uniforms.uColor.value.copy(c).multiplyScalar(1.2);
    this.rainMat.uniforms.uRain.value = this.rain;
    this.splashMat.uniforms.uRain.value = this.rain;
    const wd = shared.uWindDir.value;
    this.rainMat.uniforms.uWind.value.set(wd.x, wd.y).multiplyScalar(1 + this.overcast);
    // streaks face the camera: widen them along the camera's right axis
    const e = g.camera.matrixWorld.elements;
    this.rainMat.uniforms.uSide.value.set(e[0], 0, e[2]).normalize();
    const vis = this.rain > 0.01;
    this.rainMesh.visible = vis;
    this.splashMesh.visible = vis;

    // lightning
    this.flash = Math.max(0, this.flash - dt * 3.5);
    if (this.storm && this.rain > 0.6) {
      this.boltT -= dt;
      if (this.boltT <= 0) {
        this.bolt();
        this.boltT = 5 + Math.random() * 9;
      }
    }
    env.skyUniforms.uFlash.value = this.flash;
    if (g.sfx) g.sfx.setRain(this.rain);
  }

  bolt() {
    const g = this.g;
    const cam = g.camera.position;
    const a = Math.random() * Math.PI * 2;
    const r = 160 + Math.random() * 260;
    const to = new THREE.Vector3(cam.x + Math.sin(a) * r, 0, cam.z + Math.cos(a) * r);
    to.y = Math.max(0, g.terrain.heightAt(to.x, to.z));
    const from = to.clone().add(new THREE.Vector3((Math.random() - 0.5) * 60, 220 + Math.random() * 60, (Math.random() - 0.5) * 60));
    g.combat.vfx.lightning(from, to, '#dfe6ff', 2.2, 0.35);
    this.flash = 1;
    g.flashScreen('#c8d4ff', 0.28);
    const delay = Math.min(3.5, r / 340);
    setTimeout(() => g.sfx.thunder(1 - r / 600), delay * 1000);
  }

  // multiplier for sun shafts / birds etc.
  get clearness() {
    return 1 - this.overcast;
  }
}
