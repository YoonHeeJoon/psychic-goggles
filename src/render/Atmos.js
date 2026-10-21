import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { NOISE_GLSL } from './shaders.js';

// Depth-based screen pass run straight after the scene render:
//  - ambient occlusion at half resolution, blurred with depth-aware weights
//    and applied as a soft cool tint (toon shadows are coloured, not black);
//    characters mark themselves with alpha 0.98 and get only a little of it
//  - exponential height fog with drifting density, so valleys fill with mist
//    at dawn and the sun glows through it.
// The scene alpha (sun-shaft occlusion) is passed through untouched.

const VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const VIEWPOS_GLSL = /* glsl */ `
uniform mat4 uInvProj;
vec3 viewPos(vec2 uv, float d){
  vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return v.xyz / v.w;
}
`;

const AOShader = {
  defines: { NS: 10 },
  uniforms: {
    tDepth: { value: null },
    uInvProj: { value: new THREE.Matrix4() },
    uProjY: { value: 1 },
    uAspect: { value: 1 },
    uTexel: { value: new THREE.Vector2() },
    uRadius: { value: 0.9 },
    uIntensity: { value: 1.35 },
    uMaxDist: { value: 90 },
  },
  vertexShader: VERT,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDepth;
    uniform float uProjY, uAspect, uRadius, uIntensity, uMaxDist;
    uniform vec2 uTexel;
    varying vec2 vUv;
    ${VIEWPOS_GLSL}
    vec3 P_at(vec2 uv){ return viewPos(uv, texture2D(tDepth, uv).r); }
    void main(){
      float d = texture2D(tDepth, vUv).r;
      if (d >= 0.99999) { gl_FragColor = vec4(1.0, 6e4, 0.0, 1.0); return; }
      vec3 P = viewPos(vUv, d);
      float z = -P.z;
      if (z > uMaxDist) { gl_FragColor = vec4(1.0, z, 0.0, 1.0); return; }
      // normal from the flatter of the two neighbours on each axis
      vec3 pr = P_at(vUv + vec2(uTexel.x, 0.0)) - P;
      vec3 pl = P - P_at(vUv - vec2(uTexel.x, 0.0));
      vec3 pu = P_at(vUv + vec2(0.0, uTexel.y)) - P;
      vec3 pd = P - P_at(vUv - vec2(0.0, uTexel.y));
      vec3 dx = abs(pr.z) < abs(pl.z) ? pr : pl;
      vec3 dy = abs(pu.z) < abs(pd.z) ? pu : pd;
      vec3 N = normalize(cross(dx, dy));
      float rs = clamp(uRadius * uProjY * 0.5 / z, uTexel.y * 4.0, 0.09);
      float ang = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 6.2831853;
      float occ = 0.0;
      float r2 = uRadius * uRadius;
      for (int i = 0; i < NS; i++) {
        float fi = (float(i) + 0.5) / float(NS);
        float a = ang + float(i) * 2.3999632;
        vec2 off = vec2(cos(a) / uAspect, sin(a)) * rs * fi;
        vec3 v = P_at(vUv + off) - P;
        float vv = dot(v, v);
        float f = max(0.0, 1.0 - vv / r2);
        occ += max(0.0, dot(v, N) * inversesqrt(vv + 1e-4) - 0.15) * f;
      }
      occ /= float(NS);
      float ao = clamp(1.0 - occ * uIntensity, 0.0, 1.0);
      ao = mix(ao, 1.0, smoothstep(uMaxDist * 0.55, uMaxDist, z));
      gl_FragColor = vec4(ao, z, 0.0, 1.0);
    }`,
};

const BlurShader = {
  uniforms: {
    tAO: { value: null },
    uDir: { value: new THREE.Vector2() },
  },
  vertexShader: VERT,
  fragmentShader: /* glsl */ `
    uniform sampler2D tAO;
    uniform vec2 uDir;
    varying vec2 vUv;
    void main(){
      vec2 c = texture2D(tAO, vUv).rg;
      float tol = 0.04 * c.y + 0.08;
      float s = c.x, w = 1.0;
      for (int i = -3; i <= 3; i++) {
        if (i == 0) continue;
        vec2 t = texture2D(tAO, vUv + uDir * float(i)).rg;
        float k = exp(-float(i * i) * 0.18) * step(abs(t.y - c.y), tol);
        s += t.x * k;
        w += k;
      }
      gl_FragColor = vec4(s / w, c.y, 0.0, 1.0);
    }`,
};

const CompositeShader = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    tAO: { value: null },
    uAOOn: { value: 0 },
    uAOTint: { value: new THREE.Color(0.36, 0.4, 0.56) },
    uInvProj: { value: new THREE.Matrix4() },
    uCamWorld: { value: new THREE.Matrix4() },
    uCamPos: { value: new THREE.Vector3() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uTime: { value: 0 },
    uFogDensity: { value: 0 },
    uFogBase: { value: 6 },
    uFogFalloff: { value: 0.1 },
    uFogColor: { value: new THREE.Color() },
    uFogSun: { value: new THREE.Color() },
    uWind: { value: new THREE.Vector2() },
  },
  vertexShader: VERT,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse, tDepth, tAO;
    uniform float uAOOn;
    uniform vec3 uAOTint;
    uniform mat4 uCamWorld;
    uniform vec3 uCamPos, uSunDir, uFogColor, uFogSun;
    uniform float uTime, uFogDensity, uFogBase, uFogFalloff;
    uniform vec2 uWind;
    varying vec2 vUv;
    ${VIEWPOS_GLSL}
    ${NOISE_GLSL}
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float d = texture2D(tDepth, vUv).r;
      vec3 col = c.rgb;
      vec3 P = viewPos(vUv, min(d, 0.9999999));
      if (uAOOn > 0.5 && d < 0.99999) {
        vec2 a = texture2D(tAO, vUv).rg;
        float ao = a.x;
        // characters (alpha 0.98) keep their clean cel shading
        float charMask = smoothstep(0.9995, 0.985, c.a);
        ao = mix(ao, 1.0, charMask * 0.8);
        ao = smoothstep(0.0, 1.0, ao);
        col *= mix(uAOTint, vec3(1.0), ao);
      }
      if (uFogDensity > 0.0) {
        vec3 wp = (uCamWorld * vec4(P, 1.0)).xyz;
        vec3 rd = wp - uCamPos;
        float T = length(rd);
        rd /= T;
        if (d >= 0.99999) T = 800.0;
        // drifting patches: density sampled where the ray crosses the mist
        float tl = rd.y < -0.01 ? clamp((uCamPos.y - uFogBase) / -rd.y, 0.0, T) : min(T, 120.0);
        vec2 q = (uCamPos + rd * tl).xz;
        float n = snoise(q * 0.012 + uWind * uTime) * 0.5 + snoise(q * 0.031 - uWind * uTime * 1.7) * 0.25;
        float a = uFogDensity * (1.0 + n * 0.8);
        float b = uFogFalloff;
        float dy = rd.y;
        float ex = exp(-b * (uCamPos.y - uFogBase));
        float F = abs(dy) > 1e-3 ? a * ex * (1.0 - exp(-b * dy * T)) / (b * dy) : a * ex * T;
        float fog = 1.0 - exp(-max(F, 0.0));
        fog = min(fog, 0.92);
        float sd = max(dot(rd, uSunDir), 0.0);
        vec3 fc = uFogColor + uFogSun * (pow(sd, 6.0) * 0.9 + pow(sd, 32.0) * 1.4);
        col = mix(col, fc, fog);
      }
      gl_FragColor = vec4(col, c.a);
    }`,
};

const mat = (s, defines) =>
  new THREE.ShaderMaterial({
    defines: Object.assign({}, s.defines, defines),
    uniforms: THREE.UniformsUtils.clone(s.uniforms),
    vertexShader: s.vertexShader,
    fragmentShader: s.fragmentShader,
    depthTest: false,
    depthWrite: false,
  });

export class AtmosPass extends Pass {
  constructor(camera) {
    super();
    this.camera = camera;
    const o = { type: THREE.HalfFloatType, depthBuffer: false };
    this.rtA = new THREE.WebGLRenderTarget(1, 1, o);
    this.rtB = new THREE.WebGLRenderTarget(1, 1, o);
    this.aoSamples = 10;
    this.ao = mat(AOShader);
    this.blur = mat(BlurShader);
    this.comp = mat(CompositeShader);
    this.quad = new FullScreenQuad(null);
    this.aoEnabled = true;
    this.full = new THREE.Vector2(1, 1);
  }

  setAO(on, samples = 10) {
    this.aoEnabled = on;
    if (samples !== this.aoSamples) {
      this.aoSamples = samples;
      this.ao.defines.NS = samples;
      this.ao.needsUpdate = true;
    }
  }

  setSize(w, h) {
    this.full.set(w, h);
    const hw = Math.max(1, Math.round(w / 2)),
      hh = Math.max(1, Math.round(h / 2));
    this.rtA.setSize(hw, hh);
    this.rtB.setSize(hw, hh);
  }

  // fog: { density, base, falloff, color, sun } (density 0 disables it)
  setFog(f, sunDir, time, wind) {
    const u = this.comp.uniforms;
    u.uFogDensity.value = f.density;
    u.uFogBase.value = f.base;
    u.uFogFalloff.value = f.falloff;
    u.uFogColor.value.copy(f.color);
    u.uFogSun.value.copy(f.sun);
    u.uSunDir.value.copy(sunDir);
    u.uTime.value = time;
    if (wind) u.uWind.value.copy(wind).multiplyScalar(0.012);
  }

  render(renderer, writeBuffer, readBuffer) {
    const cam = this.camera;
    const depth = readBuffer.depthTexture;
    const cu = this.comp.uniforms;
    cu.uInvProj.value.copy(cam.projectionMatrixInverse);
    cu.uCamWorld.value.copy(cam.matrixWorld);
    cu.uCamPos.value.setFromMatrixPosition(cam.matrixWorld);
    const ao = this.aoEnabled && !!depth;
    if (ao) {
      const u = this.ao.uniforms;
      u.tDepth.value = depth;
      u.uInvProj.value.copy(cam.projectionMatrixInverse);
      u.uProjY.value = cam.projectionMatrix.elements[5];
      u.uAspect.value = this.full.x / this.full.y;
      u.uTexel.value.set(1 / this.full.x, 1 / this.full.y);
      this.quad.material = this.ao;
      renderer.setRenderTarget(this.rtA);
      this.quad.render(renderer);
      const bu = this.blur.uniforms;
      this.quad.material = this.blur;
      bu.tAO.value = this.rtA.texture;
      bu.uDir.value.set(1 / this.rtA.width, 0);
      renderer.setRenderTarget(this.rtB);
      this.quad.render(renderer);
      bu.tAO.value = this.rtB.texture;
      bu.uDir.value.set(0, 1 / this.rtA.height);
      renderer.setRenderTarget(this.rtA);
      this.quad.render(renderer);
    }
    cu.tDiffuse.value = readBuffer.texture;
    cu.tDepth.value = depth;
    cu.tAO.value = this.rtA.texture;
    cu.uAOOn.value = ao ? 1 : 0;
    this.quad.material = this.comp;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose() {
    this.rtA.dispose();
    this.rtB.dispose();
    this.ao.dispose();
    this.blur.dispose();
    this.comp.dispose();
    this.quad.dispose();
  }
}

// Copies the frame drawn so far (colour + depth) into a texture right before
// the water surface draws, so the water can refract the lake bed and measure
// how much water the view ray crosses. A raw framebuffer blit works for both
// multisampled and plain targets and keeps the draw order intact.
export class SceneGrab {
  constructor() {
    this.rt = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
      depthTexture: new THREE.DepthTexture(1, 1),
      magFilter: THREE.LinearFilter,
      minFilter: THREE.LinearFilter,
    });
    this.valid = { value: 0 };
    this.res = { value: new THREE.Vector2(1, 1) };
    this.enabled = true;
  }

  // call before the frame renders, with the composer's buffer size
  prepare(renderer, target) {
    this.valid.value = 0;
    if (!this.enabled || !target) return;
    if (this.rt.width !== target.width || this.rt.height !== target.height) this.rt.setSize(target.width, target.height);
    this.res.value.set(target.width, target.height);
    renderer.initRenderTarget(this.rt);
  }

  grab(renderer) {
    this.valid.value = 0;
    if (!this.enabled) return;
    const src = renderer.getRenderTarget();
    if (!src || src.width !== this.rt.width || src.height !== this.rt.height || src.isWebGLCubeRenderTarget) return;
    const gl = renderer.getContext();
    const sp = renderer.properties.get(src);
    const dp = renderer.properties.get(this.rt);
    const srcFb = sp.__webglMultisampledFramebuffer || sp.__webglFramebuffer;
    const dstFb = dp.__webglFramebuffer;
    if (!srcFb || !dstFb || Array.isArray(srcFb)) return;
    const st = renderer.state;
    const sc = renderer.getScissorTest();
    if (sc) st.setScissorTest(false);
    st.bindFramebuffer(gl.READ_FRAMEBUFFER, srcFb);
    st.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dstFb);
    const w = src.width,
      h = src.height;
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    st.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    st.bindFramebuffer(gl.DRAW_FRAMEBUFFER, srcFb);
    if (sc) st.setScissorTest(true);
    this.valid.value = 1;
  }
}
