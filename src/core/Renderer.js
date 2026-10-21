import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export const PRESETS = {
  low: { label: '낮음', pixelRatio: 0.75, shadowSize: 1024, shadowExtent: 45, grass: 45000, grassField: 56, terrainStep: 2, bloom: false, msaa: 0, trees: 0.5 },
  medium: { label: '중간', pixelRatio: 1.0, shadowSize: 2048, shadowExtent: 55, grass: 110000, grassField: 70, terrainStep: 1, bloom: true, msaa: 2, trees: 0.8 },
  high: { label: '높음', pixelRatio: 1.5, shadowSize: 2048, shadowExtent: 65, grass: 200000, grassField: 84, terrainStep: 1, bloom: true, msaa: 4, trees: 1.0 },
  ultra: { label: '최고', pixelRatio: 2.0, shadowSize: 4096, shadowExtent: 80, grass: 320000, grassField: 100, terrainStep: 1, bloom: true, msaa: 4, trees: 1.0 },
};

export function pickQuality() {
  const url = new URLSearchParams(location.search).get('q');
  if (url && PRESETS[url]) return url;
  try {
    const s = localStorage.getItem('starwind.quality');
    if (s && PRESETS[s]) return s;
  } catch (e) {}
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  return mobile ? 'low' : 'high';
}

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSaturation: { value: 1.04 },
    uContrast: { value: 1.05 },
    uVignette: { value: 0.32 },
    uLift: { value: new THREE.Vector3(0.01, 0.012, 0.025) },
    uGain: { value: new THREE.Vector3(1.0, 1.0, 1.0) },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color(1, 1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uSaturation;
    uniform float uContrast;
    uniform float uVignette;
    uniform vec3 uLift;
    uniform vec3 uGain;
    uniform float uFlash;
    uniform vec3 uFlashColor;
    varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSaturation);
      c = (c - 0.5) * uContrast + 0.5;
      c = c * uGain + uLift * (1.0 - c);
      vec2 p = vUv - 0.5;
      float v = 1.0 - dot(p, p) * uVignette * 1.6;
      c *= v;
      c = mix(c, uFlashColor, uFlash);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

export class Renderer {
  constructor(container, quality) {
    this.q = quality;
    const r = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
    r.setSize(window.innerWidth, window.innerHeight);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(r.domElement);
    r.domElement.classList.add('game-canvas');
    this.renderer = r;
  }

  setup(scene, camera) {
    const r = this.renderer;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: this.q.msaa,
    });
    this.composer = new EffectComposer(r, rt);
    this.composer.setPixelRatio(r.getPixelRatio());
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.42, 0.55, 0.92);
    this.bloom.enabled = this.q.bloom;
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);

    window.addEventListener('resize', () => this.resize(camera));
  }

  applyQuality(q, camera) {
    this.q = q;
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    this.composer.setPixelRatio(r.getPixelRatio());
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      rt.samples = q.msaa;
      rt.dispose();
    }
    this.bloom.enabled = q.bloom;
    this.resize(camera);
  }

  resize(camera) {
    const w = window.innerWidth,
      h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  render() {
    this.composer.render();
  }
}
