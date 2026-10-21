import * as THREE from 'three';
import { ELEMENT_COLORS } from './elements.js';

// Shields: one shield at a time covers whoever is on the field and soaks up
// damage before HP. They come from crystallize shards (earth hitting an
// element) and from the earth character's skills. A soft bubble shows it.

const BUBBLE_VERT = /* glsl */ `
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
const BUBBLE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uHit;
uniform float uTime;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
void main(){
  float f = pow(1.0 - abs(dot(normalize(vN), vV)), 2.6);
  // faint hexagonal facets drifting upward
  vec2 q = vec2(atan(vP.z, vP.x) * 3.0, vP.y * 5.0 - uTime * 0.6);
  vec2 g = abs(fract(q) - 0.5);
  float hex = smoothstep(0.42, 0.5, max(g.x * 1.2 + g.y * 0.6, g.y * 1.2));
  float a = (f * 0.8 + hex * 0.12 * (0.4 + f)) * uAlpha + uHit * (0.25 + f * 0.6);
  gl_FragColor = vec4(uColor * (1.4 + uHit * 2.0) * a, a);
}`;

const _v = new THREE.Vector3();

export class Shields {
  constructor(C) {
    this.C = C;
    this.g = C.g;
    this.cur = null;
    this.shards = [];
    this.bubbleU = { uColor: { value: new THREE.Color() }, uAlpha: { value: 0 }, uHit: { value: 0 }, uTime: { value: 0 } };
    this.bubble = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 20),
      new THREE.ShaderMaterial({ vertexShader: BUBBLE_VERT, fragmentShader: BUBBLE_FRAG, uniforms: this.bubbleU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    this.bubble.renderOrder = 6;
    this.bubble.visible = false;
    this.g.scene.add(this.bubble);
    this.shardGeo = new THREE.OctahedronGeometry(0.22, 0);
    this.shardGeo.scale(0.8, 1.3, 0.8);
  }

  // a level-scaled base value for shards
  shardValue() {
    const c = this.C.player.current;
    return Math.round(1500 * (1 + 0.04 * ((c.level || 20) - 20)));
  }

  give(hp, el, dur = 15) {
    hp = Math.round(hp);
    const cur = this.cur;
    // a stronger shield replaces the current one, a weaker one only tops it up
    if (cur && cur.hp > hp) cur.t = Math.max(cur.t, dur);
    else this.cur = { hp, max: hp, el, t: dur };
    const P = this.C.player;
    const col = ELEMENT_COLORS[el] || '#ffd86a';
    this.C.vfx.ring(_v.set(P.pos.x, P.pos.y + 0.05, P.pos.z), col, 2.2, 0.5, { inner: 0.8 });
    this.C.vfx.burst(_v.set(P.pos.x, P.pos.y + 1, P.pos.z), col, 18, { speed: 3, size: 0.18, life: 0.5, up: 0.6 });
    this.C.ui.text(_v.set(P.pos.x, P.pos.y + 2.1, P.pos.z), '보호막', col, { small: true });
    this.bubbleU.uHit.value = 0.6;
    this.g.sfx.shield && this.g.sfx.shield();
    if (this.g.achievements) this.g.achievements.add('shields');
  }

  // returns the damage that gets through
  absorb(dmg) {
    const s = this.cur;
    if (!s) return dmg;
    // earth shields are sturdier
    const eff = s.el === 'earth' ? 0.75 : 1;
    const take = Math.min(s.hp, dmg * eff);
    s.hp -= take;
    this.bubbleU.uHit.value = 1;
    const P = this.C.player;
    if (s.hp <= 0.5) {
      this.cur = null;
      const col = ELEMENT_COLORS[s.el] || '#ffd86a';
      this.C.vfx.burst(_v.set(P.pos.x, P.pos.y + 1, P.pos.z), col, 30, { speed: 6, size: 0.2, life: 0.5 });
      this.C.ui.text(_v.set(P.pos.x, P.pos.y + 2.1, P.pos.z), '보호막 파괴', '#ffffff', { small: true });
      this.g.sfx.block && this.g.sfx.block();
      return Math.max(0, dmg - take / eff);
    }
    this.C.ui.text(_v.set(P.pos.x, P.pos.y + 1.8, P.pos.z), `흡수 ${Math.round(take)}`, ELEMENT_COLORS[s.el] || '#ffd86a', { small: true });
    this.g.sfx.block && this.g.sfx.block();
    return 0;
  }

  // earth met an element: a shard of that element drops near the target
  crystallize(e, center, el) {
    if (this.shards.length >= 3) this.removeShard(this.shards[0]);
    const col = new THREE.Color(ELEMENT_COLORS[el] || '#ffd86a');
    const mat = new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(1.8) });
    const m = new THREE.Mesh(this.shardGeo, mat);
    const a = Math.random() * Math.PI * 2;
    const x = center.x + Math.cos(a) * 1.2,
      z = center.z + Math.sin(a) * 1.2;
    const y = this.g.ground.heightAt(x, z) + 0.9;
    m.position.set(center.x, center.y, center.z);
    this.g.scene.add(m);
    this.shards.push({ m, el, t: 0, home: new THREE.Vector3(x, y, z), from: center.clone(), col });
    this.C.vfx.burst(center, ELEMENT_COLORS[el], 16, { speed: 4, size: 0.2, life: 0.5 });
  }

  removeShard(s) {
    this.g.scene.remove(s.m);
    s.m.material.dispose();
    this.shards.splice(this.shards.indexOf(s), 1);
  }

  update(dt) {
    const P = this.C.player;
    this.bubbleU.uTime.value += dt;
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i];
      s.t += dt;
      const m = s.m;
      if (s.t < 0.45) {
        // pops out of the target in a little arc
        const k = s.t / 0.45;
        m.position.lerpVectors(s.from, s.home, k);
        m.position.y += Math.sin(k * Math.PI) * 1.2;
      } else {
        const d = Math.hypot(P.pos.x - m.position.x, P.pos.z - m.position.z);
        if (d < 4.5 && Math.abs(P.pos.y - m.position.y) < 3 && s.t > 0.8) {
          // drawn to the player once they come close
          _v.set(P.pos.x, P.pos.y + 1, P.pos.z).sub(m.position);
          const l = _v.length();
          m.position.addScaledVector(_v.normalize(), Math.min(l, dt * (6 + (4.5 - d) * 3)));
          if (l < 0.6) {
            this.give(this.shardValue(), s.el, 15);
            this.removeShard(s);
            continue;
          }
        } else m.position.y = s.home.y + Math.sin(s.t * 2.4) * 0.12;
      }
      m.rotation.y += dt * 2;
      if (Math.random() < dt * 8) this.C.vfx.particles.spawn(m.position, _v.set(0, 0.6, 0), this.C.vfx.color.copy(s.col), 0.12, 0.5, { drag: 2 });
      if (s.t > 15) this.removeShard(s);
    }
    // the bubble around the player
    const s = this.cur;
    if (s) {
      s.t -= dt;
      if (s.t <= 0) this.cur = null;
    }
    const want = this.cur ? 0.55 + 0.45 * Math.min(1, this.cur.t / 1.5) : 0;
    const U = this.bubbleU;
    U.uAlpha.value += (want - U.uAlpha.value) * Math.min(1, dt * 6);
    U.uHit.value = Math.max(0, U.uHit.value - dt * 3);
    this.bubble.visible = U.uAlpha.value > 0.01 && this.g.state !== 'boat';
    if (this.bubble.visible) {
      if (this.cur) U.uColor.value.set(ELEMENT_COLORS[this.cur.el] || '#ffd86a').multiplyScalar(0.5);
      const h = P.height;
      this.bubble.position.set(P.pos.x, P.pos.y + h * 0.55, P.pos.z);
      this.bubble.scale.set(h * 0.62, h * 0.72, h * 0.62);
    }
  }
}
