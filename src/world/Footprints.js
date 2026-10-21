import * as THREE from 'three';
import { shared } from '../render/shaders.js';

// Footprints pressed into sand and snow. Each print is an instanced quad laid
// on the ground slope; its shader draws a sole + heel and multiplies the
// ground below (so it darkens lit and shadowed sand alike), fading out over
// half a minute. Prints are kept in a ring buffer.

const N = 120;
const LIFE = 30;

const VERT = /* glsl */ `
attribute vec3 aInfo; // birth time, kind (0 sand, 1 snow), side (+1 left / -1 right)
varying vec2 vUv;
varying vec3 vInfo;
void main(){
  vUv = uv;
  vInfo = aInfo;
  vec3 p = position;
  p.x *= aInfo.z;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(p, 1.0);
}`;

const FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying vec3 vInfo;
float blob(vec2 p, vec2 c, vec2 r){ vec2 d = (p - c) / r; return 1.0 - smoothstep(0.75, 1.0, length(d)); }
void main(){
  vec2 p = vUv - 0.5;
  // sole (front, slightly turned in) + heel
  float s = max(blob(p, vec2(0.03, 0.14), vec2(0.36, 0.3)), blob(p, vec2(-0.01, -0.22), vec2(0.27, 0.2)));
  s = max(s, 0.6 * blob(p, vec2(0.01, -0.03), vec2(0.24, 0.22)));
  float age = (uTime - vInfo.x) / ${LIFE.toFixed(1)};
  float fade = (1.0 - smoothstep(0.55, 1.0, age)) * smoothstep(0.0, 0.02, age + 0.02);
  float k = s * fade;
  if (k < 0.004) discard;
  // snow: cool blue hollow; sand: damp darker sand
  vec3 tint = vInfo.y > 0.5 ? vec3(0.56, 0.64, 0.86) : vec3(0.6, 0.5, 0.4);
  gl_FragColor = vec4(mix(vec3(1.0), tint, k), 1.0);
}`;

export class Footprints {
  constructor(scene, ground) {
    this.ground = ground;
    const geo = new THREE.PlaneGeometry(0.21, 0.38);
    geo.rotateX(-Math.PI / 2);
    // uv.y runs heel -> toe along -z (the walking direction in local space)
    this.info = new Float32Array(N * 3).fill(-999);
    this.infoAttr = new THREE.InstancedBufferAttribute(this.info, 3);
    this.infoAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aInfo', this.infoAttr);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uTime: shared.uTime },
      transparent: true,
      depthWrite: false,
      // multiply the ground colour, leave the alpha (sun-shaft mask) alone
      blending: THREE.CustomBlending,
      blendSrc: THREE.ZeroFactor,
      blendDst: THREE.SrcColorFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.material, N);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.count = 0;
    this.i = 0;
    this._m = new THREE.Matrix4();
    this._x = new THREE.Vector3();
    this._y = new THREE.Vector3();
    this._z = new THREE.Vector3();
    scene.add(this.mesh);
  }

  add(x, z, yaw, kind, side) {
    const G = this.ground;
    const y = G.heightAt(x, z);
    // ground normal from neighbouring heights
    const e = 0.3;
    const n = this._y.set(G.heightAt(x - e, z) - G.heightAt(x + e, z), 2 * e, G.heightAt(x, z - e) - G.heightAt(x, z + e)).normalize();
    const fwd = this._z.set(Math.sin(yaw), 0, Math.cos(yaw)); // models face +z
    fwd.addScaledVector(n, -fwd.dot(n)).normalize();
    const right = this._x.crossVectors(n, fwd).negate().normalize();
    // local -z is the walking direction
    const back = fwd.clone().negate();
    this._m.makeBasis(right, n, back).setPosition(x, y + 0.015, z);
    const i = this.i;
    this.mesh.setMatrixAt(i, this._m);
    this.info[i * 3] = shared.uTime.value;
    this.info[i * 3 + 1] = kind === 'snow' ? 1 : 0;
    this.info[i * 3 + 2] = side;
    this.i = (i + 1) % N;
    this.mesh.count = Math.max(this.mesh.count, this.i === 0 ? N : this.i);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.infoAttr.needsUpdate = true;
  }

  // call when the player's model plants a foot
  step(player, surface) {
    if (surface !== 'sand' && surface !== 'snow') return;
    const m = player.model;
    const left = (m.steps & 1) === 0;
    const foot = m.j[left ? 'footL' : 'footR'];
    if (!foot) return;
    const p = foot.getWorldPosition(this._x);
    this.add(p.x, p.z, player.model.root.rotation.y, surface, left ? 1 : -1);
  }

  get active() {
    return this.mesh.count;
  }
}
