import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// Screen-space sun shafts. The sky dome writes alpha = 0 where the sky is
// clear (clouds raise it), every opaque surface writes 1, so (1 - alpha) is a
// free occlusion mask. The mask is weighted towards the sun, radially blurred
// twice at quarter resolution and added back on top of the HDR frame.

const VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const MaskShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSunDir: { value: new THREE.Vector3() },
    uRight: { value: new THREE.Vector3() },
    uUp: { value: new THREE.Vector3() },
    uFwd: { value: new THREE.Vector3() },
    uTan: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: VERT,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec3 uSunDir, uRight, uUp, uFwd;
    uniform vec2 uTan;
    varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 p = vUv * 2.0 - 1.0;
      vec3 d = normalize(uFwd + uRight * p.x * uTan.x + uUp * p.y * uTan.y);
      float sd = max(dot(d, uSunDir), 0.0);
      float open = 1.0 - clamp(c.a, 0.0, 1.0);
      float lum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      float w = pow(sd, 60.0) * 2.2 + pow(sd, 14.0) * 0.3;
      float m = open * w * (0.55 + 0.45 * smoothstep(0.3, 1.6, lum));
      m *= smoothstep(-0.03, 0.04, d.y);
      gl_FragColor = vec4(m, m, m, 1.0);
    }`,
};

const BlurShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSun: { value: new THREE.Vector2(0.5, 0.5) },
    uStep: { value: 1 },
    uDecay: { value: 0.96 },
  },
  vertexShader: VERT,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uSun;
    uniform float uStep;
    uniform float uDecay;
    varying vec2 vUv;
    const int N = 24;
    void main(){
      vec2 delta = (vUv - uSun) * uStep;
      vec2 uv = vUv;
      float acc = 0.0, wsum = 0.0, w = 1.0;
      for (int i = 0; i < N; i++) {
        acc += texture2D(tDiffuse, uv).r * w;
        wsum += w;
        w *= uDecay;
        uv -= delta;
      }
      float r = acc / wsum;
      gl_FragColor = vec4(r, r, r, 1.0);
    }`,
};

const CompositeShader = {
  uniforms: {
    tDiffuse: { value: null },
    tRays: { value: null },
    uColor: { value: new THREE.Color() },
  },
  vertexShader: VERT,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tRays;
    uniform vec3 uColor;
    varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float r = texture2D(tRays, vUv).r;
      // soft-light style add: strong in dark areas, gentle on bright sky
      // shafts are strongest against the sky, a lighter veil over geometry
      float open = 1.0 - clamp(c.a, 0.0, 1.0);
      vec3 add = uColor * r * mix(0.55, 1.0, open);
      c.rgb += add / (1.0 + c.rgb * 0.35);
      gl_FragColor = vec4(c.rgb, 1.0);
    }`,
};

const mat = (s) =>
  new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(s.uniforms),
    vertexShader: s.vertexShader,
    fragmentShader: s.fragmentShader,
    depthTest: false,
    depthWrite: false,
  });

export class GodRaysPass extends Pass {
  constructor() {
    super();
    const o = { type: THREE.HalfFloatType, depthBuffer: false };
    this.rtA = new THREE.WebGLRenderTarget(1, 1, o);
    this.rtB = new THREE.WebGLRenderTarget(1, 1, o);
    this.mask = mat(MaskShader);
    this.blur = mat(BlurShader);
    this.comp = mat(CompositeShader);
    this.quad = new FullScreenQuad(null);
    this.strength = 0;
    this._v = new THREE.Vector3();
  }

  setSize(w, h) {
    const s = 0.25;
    this.rtA.setSize(Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)));
    this.rtB.setSize(Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)));
  }

  // camera: the scene camera, sunDir: true sun direction (world),
  // color: linear colour of the shafts, strength: 0..1 overall fade
  update(camera, sunDir, color, strength) {
    const e = camera.matrixWorld.elements;
    const R = this.mask.uniforms.uRight.value.set(e[0], e[1], e[2]).normalize();
    const U = this.mask.uniforms.uUp.value.set(e[4], e[5], e[6]).normalize();
    const F = this.mask.uniforms.uFwd.value.set(-e[8], -e[9], -e[10]).normalize();
    const ty = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    this.mask.uniforms.uTan.value.set(ty * camera.aspect, ty);
    this.mask.uniforms.uSunDir.value.copy(sunDir);
    // sun position on screen (may be off-screen; the blur still points at it)
    const f = Math.max(sunDir.dot(F), 1e-3);
    const sx = sunDir.dot(R) / f / (ty * camera.aspect);
    const sy = sunDir.dot(U) / f / ty;
    const clampL = 2.2;
    this.blur.uniforms.uSun.value.set(THREE.MathUtils.clamp(sx, -clampL, clampL) * 0.5 + 0.5, THREE.MathUtils.clamp(sy, -clampL, clampL) * 0.5 + 0.5);
    // fade when the sun is behind the camera
    const facing = THREE.MathUtils.smoothstep(sunDir.dot(F), -0.15, 0.35);
    this.strength = strength * facing;
    this.comp.uniforms.uColor.value.copy(color).multiplyScalar(this.strength);
  }

  render(renderer, writeBuffer, readBuffer) {
    const q = this.quad;
    const active = this.strength > 0.002;
    // nothing to add: leave the frame untouched and skip the swap
    this.needsSwap = active || this.renderToScreen;
    if (!this.needsSwap) return;
    if (active) {
      this.mask.uniforms.tDiffuse.value = readBuffer.texture;
      q.material = this.mask;
      renderer.setRenderTarget(this.rtA);
      q.render(renderer);
      // long coarse pass, then a short fine pass to fill the gaps
      this.blur.uniforms.tDiffuse.value = this.rtA.texture;
      this.blur.uniforms.uStep.value = 0.9 / 24;
      this.blur.uniforms.uDecay.value = 0.965;
      q.material = this.blur;
      renderer.setRenderTarget(this.rtB);
      q.render(renderer);
      this.blur.uniforms.tDiffuse.value = this.rtB.texture;
      this.blur.uniforms.uStep.value = 0.9 / 24 / 24;
      this.blur.uniforms.uDecay.value = 1.0;
      renderer.setRenderTarget(this.rtA);
      q.render(renderer);
    }
    this.comp.uniforms.tDiffuse.value = readBuffer.texture;
    this.comp.uniforms.tRays.value = this.rtA.texture;
    if (!active) this.comp.uniforms.uColor.value.setScalar(0);
    q.material = this.comp;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (this.clear) renderer.clear();
    q.render(renderer);
  }

  dispose() {
    this.rtA.dispose();
    this.rtB.dispose();
    this.mask.dispose();
    this.blur.dispose();
    this.comp.dispose();
    this.quad.dispose();
  }
}
