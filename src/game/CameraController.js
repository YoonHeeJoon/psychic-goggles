import * as THREE from 'three';
import { clamp, damp, lerp } from '../core/noise.js';
import { SEA_LEVEL } from '../world/Terrain.js';

const smoothstepJS = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const _cp = new THREE.Vector3(),
  _cl = new THREE.Vector3(),
  _bl = new THREE.Vector3();

export class CameraController {
  constructor(camera, terrain, colliders = null) {
    this.camera = camera;
    this.terrain = terrain; // ground: terrain + walkable structures
    this.colliders = colliders; // tree trunks
    this.yaw = 0;
    this.pitch = 0.2;
    this.dist = 6.2;
    this.distTarget = 6.2;
    this.curDist = 6.2;
    this.target = new THREE.Vector3();
    this.shakeT = 0;
    this.shakeAmp = 0;
    this.fov = 52;
    this.invertY = false;
    this.sensitivity = 1;
    this._dir = new THREE.Vector3();
    this.initialized = false;
  }

  shake(amp = 0.3, time = 0.3) {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
    this.shakeT = Math.max(this.shakeT, time);
  }

  update(dt, input, player) {
    const s = 0.0024 * this.sensitivity;
    this.yaw -= input.mouseDX * s;
    this.pitch += input.mouseDY * s * (this.invertY ? -1 : 1);
    this.pitch = clamp(this.pitch, -0.75, 1.25);
    if (input.wheel) this.distTarget = clamp(this.distTarget + input.wheel * 0.9, 2.0, 14);

    const h = player.height;
    const desired = new THREE.Vector3(player.pos.x, player.pos.y + h * 0.88, player.pos.z);
    if (player.state === 'swim') desired.y = SEA_LEVEL + 0.6;
    if (!this.initialized) {
      this.target.copy(desired);
      this.initialized = true;
    }
    this.target.x = damp(this.target.x, desired.x, 16, dt);
    this.target.z = damp(this.target.z, desired.z, 16, dt);
    this.target.y = damp(this.target.y, desired.y, player.state === 'ground' ? 10 : 7, dt);

    let want = this.distTarget;
    if (player.state === 'glide') want += 1.2;
    if (player.state === 'climb') want += 0.8;
    this.dist = damp(this.dist, want, 4, dt);

    const cp = Math.cos(this.pitch);
    const dir = this._dir.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);

    // collision: march out from the target against the ground, buildings
    // (their footprints count as solid up to the roof) and tree trunks
    let d = this.dist;
    const steps = 24;
    const C = this.colliders;
    march: for (let k = 1; k <= steps; k++) {
      const t = (k / steps) * this.dist;
      const px = this.target.x + dir.x * t;
      const py = this.target.y + dir.y * t;
      const pz = this.target.z + dir.z * t;
      const gh = this.terrain.heightAt(px, pz) + 0.35;
      if (py < gh) {
        d = Math.max(0.8, t - this.dist / steps);
        break;
      }
      if (C && t > 0.9) {
        for (const c of C.query(px, pz)) {
          if (py < c.top && py > c.bottom && Math.hypot(c.x - px, c.z - pz) < c.r + 0.3) {
            d = Math.max(0.8, t - this.dist / steps);
            break march;
          }
        }
      }
    }
    this.curDist = d < this.curDist ? d : damp(this.curDist, d, 5, dt);

    const cam = this.camera;
    cam.position.copy(this.target).addScaledVector(dir, this.curDist);
    const gh = this.terrain.heightAt(cam.position.x, cam.position.z) + 0.3;
    if (cam.position.y < gh) cam.position.y = gh;
    if (cam.position.y < SEA_LEVEL + 0.25 && cam.position.y > SEA_LEVEL - 0.4) cam.position.y = SEA_LEVEL + 0.25;
    cam.lookAt(this.target.x, this.target.y + 0.05, this.target.z);

    // elemental burst cut-in: swing round to the character's face, then back
    const ci = this.cutIn;
    if (ci) {
      ci.t += dt;
      const w = smoothstepJS(0, 0.16, ci.t) * (1 - smoothstepJS(ci.dur - 0.32, ci.dur, ci.t));
      const fx = Math.sin(ci.yaw),
        fz = Math.cos(ci.yaw);
      const head = player.pos.y + player.height * 0.82;
      const push = 2.5 - Math.min(1, ci.t / ci.dur) * 0.6;
      _cp.set(player.pos.x + fx * push + fz * 0.8, head + 0.1, player.pos.z + fz * push - fx * 0.8);
      _cl.set(player.pos.x, head - 0.05, player.pos.z);
      _bl.set(this.target.x, this.target.y + 0.05, this.target.z).lerp(_cl, w);
      cam.position.lerp(_cp, w);
      cam.lookAt(_bl);
      if (ci.t >= ci.dur) this.cutIn = null;
    }

    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const a = this.shakeAmp * Math.max(0, this.shakeT) * 3;
      cam.position.x += (Math.random() - 0.5) * a;
      cam.position.y += (Math.random() - 0.5) * a;
      if (this.shakeT <= 0) this.shakeAmp = 0;
    }

    const fovT = player.sprinting ? 57 : player.state === 'glide' ? 58 : 52;
    this.fov = damp(this.fov, fovT, 3, dt);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }
}
