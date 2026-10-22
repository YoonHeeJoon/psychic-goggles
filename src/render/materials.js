import * as THREE from 'three';
import { shared, VERT_HEAD, FRAG_HEAD, FRAG_TAIL, litUniforms, CLOUD_GLSL } from './shaders.js';
import { FACE_TEX_GLSL } from '../character/Face.js';

// ---------------------------------------------------------------------------
// Face lighting: instead of N.L (which gives blotchy shadows on a small head)
// the shadow edge sweeps across the face as the light circles the head, the
// way hand-authored anime face shadow maps behave. hp is the head-space
// position (unit radius), F/Rt the head forward/right axes in world space.
// ---------------------------------------------------------------------------
export const FACE_GLSL = /* glsl */ `
float faceLit(vec3 hp, vec3 F, vec3 Rt, vec3 L){
  vec2 lh = vec2(dot(L, Rt), dot(L, F));
  float len = length(lh);
  vec2 d = lh / max(len, 1e-4);
  float ang = acos(clamp(d.y, -1.0, 1.0)) / 3.14159265;
  float xs = hp.x * (d.x >= 0.0 ? 1.0 : -1.0);
  float th = 0.5 + 0.5 * clamp(xs * 1.2, -1.0, 1.0);
  // small wedge of shadow beside the nose on the far side
  float nose = smoothstep(0.16, 0.02, abs(xs + 0.07)) * smoothstep(0.2, 0.05, abs(hp.y + 0.3));
  th -= 0.14 * nose;
  float lit = smoothstep(ang - 0.035, ang + 0.035, th);
  return mix(1.0, lit, smoothstep(0.08, 0.35, len));
}
`;

// ---------------------------------------------------------------------------
// Anime toon material: two-tone ramp with tinted shadows, rim light, crisp
// specular, optional root->tip colour gradient (hair) and texture.
// ---------------------------------------------------------------------------
// Hair tails, capes, skirts and scarves bend as a chain: every vertex turns
// about the pivot by an angle growing with its distance down the chain
// (t^2), plus a travelling flutter wave. Driven by spring physics on the CPU.
export const CHAIN_GLSL = /* glsl */ `
#ifdef CHAIN
uniform vec4 uBend; // tip pitch, tip roll, flutter amplitude, flutter phase
uniform float uChainLen;
vec3 chainBend(vec3 p, inout vec3 n){
  float t = clamp(-p.y / uChainLen, 0.0, 1.0);
  float w = t * t;
  float ax = uBend.x * w + sin(t * 6.5 - uBend.w + p.x * 8.0) * uBend.z * t;
  float az = uBend.y * w + sin(t * 5.0 - uBend.w * 0.8 + p.z * 7.0) * uBend.z * 0.4 * t;
  float cx = cos(ax), sx = sin(ax), cz = cos(az), sz = sin(az);
  mat3 r = mat3(cz, sz, 0.0, -sz, cz, 0.0, 0.0, 0.0, 1.0) * mat3(1.0, 0.0, 0.0, 0.0, cx, sx, 0.0, -sx, cx);
  n = r * n;
  return r * p;
}
#endif
`;

const TOON_VERT = /* glsl */ `
${VERT_HEAD}
${CHAIN_GLSL}
attribute float aGrad;
varying vec3 vNormalW;
varying vec3 vWorldPos;
varying float vGrad;
varying vec2 vUv;
#if defined(FACE) || defined(HAIR)
  varying vec3 vHead;
  varying vec3 vHF;
  varying vec3 vHR;
  varying vec3 vHU;
#endif
#ifdef HAIR
  attribute vec3 aHead;
#endif
#ifdef FACE
  uniform float uHeadR;
  uniform vec3 uSunDir;
#endif
void main(){
  vec3 pos = position;
  vec3 nrm = normal;
  #ifdef CHAIN
    pos = chainBend(pos, nrm);
  #endif
  vec4 worldPosition = modelMatrix * vec4(pos, 1.0);
  vec3 transformedNormal = normalMatrix * nrm;
  vNormalW = inverseTransformDirection(transformedNormal, viewMatrix);
  vWorldPos = worldPosition.xyz;
  vGrad = aGrad;
  vUv = uv;
  #if defined(FACE) || defined(HAIR)
    vHF = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
    vHR = normalize(mat3(modelMatrix) * vec3(1.0, 0.0, 0.0));
    vHU = normalize(mat3(modelMatrix) * vec3(0.0, 1.0, 0.0));
  #endif
  #ifdef HAIR
    vHead = aHead;
  #endif
  #ifdef FACE
    vHead = position / uHeadR;
    // one shadow lookup for the whole face, taken just outside the head
    // towards the light, so the face never gets blocky self-shadowing
    vec4 realWorld = worldPosition;
    worldPosition = vec4((modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz + uSunDir * 0.32, 1.0);
  #endif
  #include <shadowmap_vertex>
  #ifdef FACE
    worldPosition = realWorld;
  #endif
  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const TOON_FRAG = /* glsl */ `
${FRAG_HEAD}
uniform vec3 uColor;
uniform vec3 uColor2;
uniform float uGradAmt;
uniform vec3 uShadowTint;
uniform vec3 uCharLit;
uniform vec3 uCharShade;
uniform vec3 uSunDir;
uniform float uRim;
uniform float uSpec;
uniform float uEmissive;
uniform float uOpacity;
uniform float uFlash;
uniform float uRampOffset;
uniform sampler2D uMap;
uniform float uUseMap;
uniform float uRing;
varying vec3 vNormalW;
varying vec3 vWorldPos;
varying float vGrad;
varying vec2 vUv;
#if defined(FACE) || defined(HAIR)
  varying vec3 vHead;
  varying vec3 vHF;
  varying vec3 vHR;
  varying vec3 vHU;
#endif
${FACE_GLSL}
${CLOUD_GLSL}
#ifdef FACETEX
${FACE_TEX_GLSL}
#endif
void main(){
  vec3 N = normalize(vNormalW);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 albedo = mix(uColor, uColor2, smoothstep(0.3, 1.0, vGrad) * uGradAmt);
  if (uUseMap > 0.5) albedo *= texture2D(uMap, vUv).rgb;
  #ifdef FACETEX
    float featK, hairSh;
    albedo = faceComposite(albedo, featK, hairSh);
  #endif
  float ndl = dot(N, uSunDir);
  float shadow = getShadowMask() * cloudShadow(vWorldPos, uSunDir);
  float lit = smoothstep(uRampOffset - 0.04, uRampOffset + 0.06, ndl);
  #ifdef FACE
    float fw = smoothstep(0.05, 0.45, vHead.z / max(length(vHead), 1e-3));
    lit = mix(lit, faceLit(vHead, normalize(vHF), normalize(vHR), uSunDir), fw);
  #endif
  #ifdef FACETEX
    lit *= 1.0 - hairSh;
  #endif
  lit *= mix(1.0, shadow, 0.9);
  #ifdef FACETEX
    lit = mix(lit, 1.0, featK * 0.45);
  #endif
  vec3 litCol = albedo * uCharLit;
  vec3 shdCol = albedo * uShadowTint * uCharShade;
  #ifdef FACETEX
    // faces keep a light, warm shadow
    shdCol = mix(shdCol, litCol * vec3(0.96, 0.86, 0.86), 0.45);
  #endif
  vec3 col = mix(shdCol, litCol, lit);
  float fr = 1.0 - max(dot(N, V), 0.0);
  float rim = smoothstep(0.62, 0.78, fr) * (0.25 + 0.75 * lit);
  col += albedo * uCharLit * rim * uRim;
  vec3 H = normalize(uSunDir + V);
  float sp = smoothstep(0.90, 0.94, dot(N, H)) * lit;
  col += uCharLit * sp * uSpec;
  #ifdef HAIR
    // "angel ring": a jagged highlight band around the crown whose height
    // follows the view (half-way between the eye and the head's up axis)
    vec3 Fh = normalize(vHF), Rh = normalize(vHR), Uh = normalize(vHU);
    vec3 Vh = vec3(dot(V, Rh), dot(V, Uh), dot(V, Fh));
    vec3 Hh = normalize(Vh + vec3(0.0, 0.8, 0.0));
    vec3 hp = vHead / max(length(vHead), 1e-3);
    float az = atan(hp.x, hp.z);
    float zig = abs(fract(az * 2.6 + vUv.x * 0.15) - 0.5) * 2.0;
    // soft upper edge, jagged lower edge (strand tips)
    float d = hp.y - Hh.y;
    float zj = (zig - 0.5) * 0.09;
    float ring = smoothstep(0.075, 0.015, d) * smoothstep(-0.085 + zj, -0.04 + zj, d);
    ring *= smoothstep(0.15, 0.5, dot(N, V)) * step(0.0, dot(hp.xz, Vh.xz) + 0.35);
    ring *= 0.35 + 0.65 * lit;
    vec3 ringCol = mix(albedo * 1.8, vec3(1.0), 0.4) * uCharLit;
    col = mix(col, ringCol, clamp(ring * uRing, 0.0, 1.0));
    // painted strand lines along each lock, darker towards the roots
    float strandL = smoothstep(0.6, 0.98, abs(sin(vUv.x * 12.566 + vGrad * 1.7)));
    col *= 1.0 - strandL * 0.1 * step(0.001, vUv.x + vUv.y);
    col *= mix(0.9, 1.0, smoothstep(0.0, 0.35, vGrad + step(vUv.x + vUv.y, 0.0)));
  #endif
  col += albedo * uEmissive;
  col = mix(col, vec3(1.0, 0.95, 0.9), uFlash);
  // alpha 0.98 marks cel-shaded characters for the AO pass
  gl_FragColor = vec4(col, uOpacity * 0.98);
  ${FRAG_TAIL}
}
`;

const toonCache = new Map();

export function toonMaterial(opts = {}) {
  const chain = opts.chain;
  const unique = opts.unique || !!chain || !!opts.faceTex;
  const key = unique ? '' : JSON.stringify(opts, (k, v) => (v && v.isTexture ? v.uuid : v));
  if (!unique && toonCache.has(key)) return toonCache.get(key);
  const c = new THREE.Color(opts.color ?? '#ffffff');
  const c2 = new THREE.Color(opts.color2 ?? opts.color ?? '#ffffff');
  const tint = new THREE.Color(opts.shadowTint ?? '#c9b8d8');
  const uniforms = Object.assign(litUniforms(), {
    uColor: { value: c },
    uColor2: { value: c2 },
    uGradAmt: { value: opts.color2 ? 1 : 0 },
    uShadowTint: { value: tint },
    uCharLit: shared.uCharLit,
    uCharShade: shared.uCharShade,
    uSunDir: shared.uSunDir,
    uRim: { value: opts.rim ?? 0.35 },
    uSpec: { value: opts.spec ?? 0.0 },
    uEmissive: { value: opts.emissive ?? 0.0 },
    uOpacity: { value: opts.opacity ?? 1.0 },
    uFlash: { value: 0 },
    uRampOffset: { value: opts.ramp ?? 0.0 },
    uMap: { value: opts.map ?? null },
    uUseMap: { value: opts.map ? 1 : 0 },
    uRing: { value: opts.ring ?? 0 },
    uHeadR: { value: opts.headR ?? 1 },
    uCloudTex: shared.uCloudTex,
    uCloudOff: shared.uCloudOff,
    uCloudShadow: shared.uCloudShadow,
    uCloudCov: shared.uCloudCov,
  });
  const defines = {};
  if (opts.face) defines.FACE = '';
  if (opts.faceTex) {
    defines.FACETEX = '';
    Object.assign(uniforms, opts.faceTex);
  }
  if (opts.ring) defines.HAIR = '';
  if (chain) {
    defines.CHAIN = '';
    uniforms.uBend = chain.uBend;
    uniforms.uChainLen = chain.uChainLen;
  }
  const mat = new THREE.ShaderMaterial({
    vertexShader: TOON_VERT,
    fragmentShader: TOON_FRAG,
    uniforms,
    defines,
    lights: true,
    fog: true,
    side: opts.side ?? THREE.FrontSide,
    transparent: (opts.opacity ?? 1) < 1,
  });
  if (!unique) toonCache.set(key, mat);
  return mat;
}

// ---------------------------------------------------------------------------
// Inverted-hull outline with roughly constant screen-space width.
// ---------------------------------------------------------------------------
const OUTLINE_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
uniform float uWidth;
${CHAIN_GLSL}
void main(){
  vec3 pos = position;
  vec3 nrm = normal;
  #ifdef CHAIN
    pos = chainBend(pos, nrm);
  #endif
  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  vec3 n = normalize(normalMatrix * nrm);
  float dist = max(-mvPosition.z, 0.3);
  mvPosition.xyz += n * uWidth * clamp(dist, 0.8, 30.0) * 0.0016;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;
const OUTLINE_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uOutlineColor;
uniform vec3 uCharLit;
uniform float uOpacity;
void main(){
  gl_FragColor = vec4(uOutlineColor * uCharLit, uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;
const outlineCache = new Map();
export function outlineMaterial(color = '#2a2230', width = 1, chain = null) {
  const key = color + '|' + width;
  if (!chain && outlineCache.has(key)) return outlineCache.get(key);
  const mat = new THREE.ShaderMaterial({
    defines: chain ? { CHAIN: '' } : {},
    vertexShader: OUTLINE_VERT,
    fragmentShader: OUTLINE_FRAG,
    uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), {
      uWidth: { value: width },
      uOutlineColor: { value: new THREE.Color(color) },
      uCharLit: shared.uCharLit,
      uOpacity: { value: 1 },
    }),
    side: THREE.BackSide,
    fog: true,
  });
  if (chain) {
    mat.uniforms.uBend = chain.uBend;
    mat.uniforms.uChainLen = chain.uChainLen;
  } else outlineCache.set(key, mat);
  return mat;
}

// Shadow-map material that bends like its chain, so capes and tails cast
// matching shadows.
export function chainDepthMaterial(chain) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uBend = chain.uBend;
    sh.uniforms.uChainLen = chain.uChainLen;
    sh.vertexShader = '#define CHAIN\n' + CHAIN_GLSL + sh.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = vec3(position);\nvec3 chainN = vec3(0.0, 1.0, 0.0);\ntransformed = chainBend(transformed, chainN);');
  };
  m.customProgramCacheKey = () => 'chain-depth';
  return m;
}

// Darken + saturate a colour to use as its outline colour.
export function outlineColorFor(hex) {
  const c = new THREE.Color(hex);
  const hsl = {};
  c.getHSL(hsl);
  c.setHSL(hsl.h, Math.min(1, hsl.s * 1.1 + 0.1), hsl.l * 0.28);
  return '#' + c.getHexString();
}

// ---------------------------------------------------------------------------
// Face overlay: brows and lash lines drawn faintly over the fringe (anime
// hair is see-through over the eyebrows). The mesh is pulled a few cm towards
// the camera so it clears the bangs but stays behind anything further in
// front, and fades out unless the face is turned towards the camera.
// ---------------------------------------------------------------------------
export function faceOverlayMaterial(faceU, headR = 1) {
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      uniform float uHeadR;
      uniform float uPush;
      varying vec3 vHead;
      varying vec3 vHF;
      varying vec3 vHR;
      varying vec3 vV;
      void main(){
        vHead = position / uHeadR;
        vHF = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
        vHR = normalize(mat3(modelMatrix) * vec3(1.0, 0.0, 0.0));
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vV = normalize(cameraPosition - wp.xyz);
        vec4 mvPosition = viewMatrix * wp;
        mvPosition.xyz += normalize(-mvPosition.xyz) * uPush;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform sampler2D uFaceMask;
      uniform sampler2D uFaceClosed;
      uniform vec4 uFaceWin;
      uniform float uBlink;
      uniform vec3 uInkCol;
      uniform vec3 uBrowCol;
      uniform vec3 uCharLit;
      uniform vec3 uCharShade;
      uniform vec3 uSunDir;
      uniform vec4 uEye;
      varying vec3 vHead;
      varying vec3 vHF;
      varying vec3 vHR;
      varying vec3 vV;
      ${FACE_GLSL}
      void main(){
        float front = smoothstep(0.12, 0.4, vHead.z) * smoothstep(0.2, 0.5, dot(normalize(vV), normalize(vHF)));
        vec2 fuv = (vHead.xy - uFaceWin.xy) * uFaceWin.zw;
        vec4 m = texture2D(uFaceMask, fuv);
        m.r = mix(m.r, texture2D(uFaceClosed, fuv).r, uBlink);
        // only the brows and the upper lash line
        float lashZone = smoothstep(-0.12, -0.02, vHead.y - uEye.y);
        float ink = m.r * lashZone;
        float a = max(m.g * 0.55, ink * 0.5) * front;
        if (a < 0.02) discard;
        vec3 col = mix(uInkCol, uBrowCol, m.g / max(m.g + ink, 1e-3));
        float lit = faceLit(vHead, normalize(vHF), normalize(vHR), uSunDir);
        col *= mix(uCharShade, uCharLit, mix(0.55, 1.0, lit));
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), {
      uFaceMask: faceU.uFaceMask,
      uFaceClosed: faceU.uFaceClosed,
      uFaceWin: faceU.uFaceWin,
      uBlink: faceU.uBlink,
      uInkCol: faceU.uInkCol,
      uBrowCol: faceU.uBrowCol,
      uEye: faceU.uEye,
      uCharLit: shared.uCharLit,
      uCharShade: shared.uCharShade,
      uSunDir: shared.uSunDir,
      uHeadR: { value: headR },
      uPush: { value: 0.032 },
    }),
    transparent: true,
    depthWrite: false,
    fog: true,
    // keep the alpha marker underneath (characters are tagged for the AO pass)
    blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  });
}

// ---------------------------------------------------------------------------
// Additive glow material for VFX / gems.
// ---------------------------------------------------------------------------
export function glowMaterial(color, opacity = 1, opts = {}) {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(color).multiplyScalar(opts.intensity ?? 2.0),
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: opts.side ?? THREE.FrontSide,
    map: opts.map ?? null,
    toneMapped: true,
    fog: false,
  });
}
