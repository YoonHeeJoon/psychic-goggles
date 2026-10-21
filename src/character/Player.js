import * as THREE from 'three';
import { CharacterModel } from './CharacterModel.js';
import { PARTY } from './characters.js';
import { SPAWN, SEA_LEVEL } from '../world/Terrain.js';
import { clamp, damp, dampAngle, angleDiff, smoothstep } from '../core/noise.js';

const GRAVITY = 24;
const RUN = 6.2;
const WALK = 2.2;
const SPRINT = 9.4;
const CLIMB_NY = 0.6; // terrain normal.y below this counts as a wall
const SWIM_Y = SEA_LEVEL - 1.0;
const SWIM_DEPTH = 1.15;

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();

export class Player {
  constructor(game) {
    this.game = game;
    // terrain + walkable structures (same API as Terrain)
    this.terrain = game.ground || game.terrain;
    this.colliders = game.vegetation.colliders;
    this.updraft = 0;
    this.group = new THREE.Group();
    game.scene.add(this.group);

    this.party = PARTY.map((cfg, i) => {
      const model = new CharacterModel(cfg);
      model.root.visible = i === 0;
      this.group.add(model.root);
      return {
        cfg,
        model,
        maxHp: cfg.weapon === 'claymore' ? 13800 : 11200,
        hp: cfg.weapon === 'claymore' ? 13800 : 11200,
        energy: 40,
        maxEnergy: 60,
        skillCd: 0,
        burstCd: 0,
      };
    });
    this.active = 0;

    const y = this.terrain.heightAt(SPAWN.x, SPAWN.z);
    this.pos = new THREE.Vector3(SPAWN.x, y, SPAWN.z);
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI;
    this.prevYaw = this.yaw;
    this.state = 'ground';
    this.stamina = 100;
    this.maxStamina = 100;
    this.staminaDelay = 0;
    this.exhausted = false;
    this.landTimer = 0;
    this.walk = false;
    this.climbN = new THREE.Vector3(0, 0, 1);
    this.climbJump = 0;
    this.climbMoving = false;
    this.lastSafe = this.pos.clone();
    this.safeTimer = 0;
    this.fallStartY = y;
    this.lean = 0;
    this.speed = 0;
    this.events = [];
    this.switchCd = 0;
    this.animOverride = null;
    this.locked = false;
    this.forced = null;
  }

  get current() {
    return this.party[this.active];
  }
  get model() {
    return this.current.model;
  }
  get height() {
    return 1.6 * this.current.cfg.scale;
  }

  emit(type, data = {}) {
    this.events.push({ type, ...data });
  }

  switchTo(i, force = false) {
    if (i === this.active || i < 0 || i >= this.party.length) return false;
    if (!force && (this.switchCd > 0 || this.party[i].hp <= 0)) return false;
    const prev = this.model;
    this.active = i;
    prev.root.visible = false;
    const m = this.model;
    m.root.visible = true;
    this.switchCd = 0.8;
    this.emit('switch', { index: i });
    return true;
  }

  useStamina(n) {
    this.stamina = Math.max(0, this.stamina - n);
    this.staminaDelay = 1.0;
    if (this.stamina <= 0) this.exhausted = true;
  }

  groundHeight(x, z) {
    return this.terrain.heightAt(x, z);
  }

  update(dt, input, camYaw) {
    this.switchCd = Math.max(0, this.switchCd - dt);
    for (let k = 0; k < 4; k++) if (input.hit('Digit' + (k + 1))) this.switchTo(k);
    if (input.hit('ControlLeft') || input.hit('KeyZ')) this.walk = !this.walk;

    const mv = this.locked ? { x: 0, y: 0 } : input.moveVector();
    const fx = -Math.sin(camYaw),
      fz = -Math.cos(camYaw);
    const rx = Math.cos(camYaw),
      rz = -Math.sin(camYaw);
    const wish = _v.set(fx * mv.y + rx * mv.x, 0, fz * mv.y + rz * mv.x);
    const wishLen = Math.min(1, wish.length());
    const moving = wishLen > 0.05;
    if (moving) wish.normalize();
    const wishYaw = Math.atan2(wish.x, wish.z);

    this.prevYaw = this.yaw;
    const st = this.state;
    if (st === 'ground') this.updateGround(dt, input, wish, moving, wishYaw, wishLen);
    else if (st === 'air') this.updateAir(dt, input, wish, moving, wishYaw);
    else if (st === 'glide') this.updateGlide(dt, input, wish, moving, wishYaw);
    else if (st === 'climb') this.updateClimb(dt, input, mv);
    else if (st === 'swim') this.updateSwim(dt, input, wish, moving, wishYaw);

    // stamina regen
    this.staminaDelay -= dt;
    const draining = this.sprinting || this.state === 'glide' || this.state === 'climb' || this.state === 'swim';
    if (!draining && this.staminaDelay <= 0) {
      this.stamina = Math.min(this.maxStamina, this.stamina + 28 * dt);
      if (this.stamina > 25) this.exhausted = false;
    }

    // safe spot tracking (for respawn after drowning / falling into void)
    this.safeTimer -= dt;
    if (this.state === 'ground' && this.safeTimer <= 0) {
      this.lastSafe.copy(this.pos);
      this.safeTimer = 1;
    }

    // apply transform to the visible model
    const m = this.model;
    m.root.position.copy(this.pos);
    m.root.rotation.y = this.yaw;
    const yawRate = angleDiff(this.prevYaw, this.yaw) / Math.max(dt, 1e-4);
    const leanTarget = this.state === 'ground' || this.state === 'glide' ? clamp(-yawRate * 0.035 * smoothstep(1, 7, this.speed), -0.3, 0.3) : 0;
    this.lean = damp(this.lean, leanTarget, 8, dt);

    const localVel = new THREE.Vector3(this.vel.x, this.vel.y, this.vel.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.yaw);
    let mode = 'idle';
    if (this.state === 'ground') {
      if (this.landTimer > 0) mode = 'land';
      else if (this.speed > 0.4) mode = 'run';
    } else if (this.state === 'air') mode = this.vel.y > 0 ? 'jump' : 'fall';
    else mode = this.state;
    this.landTimer -= dt;
    m.update(dt, {
      mode,
      speed: this.speed,
      localVel,
      lean: this.state === 'glide' ? this.lean * 1.8 : this.lean,
      climbMoving: this.climbMoving,
      moving: this.vel.lengthSq() > 0.5,
      override: this.animOverride,
    });
  }

  // ---------------------------------------------------------------- ground
  updateGround(dt, input, wish, moving, wishYaw, wishLen) {
    const sprintKey = !this.locked && (input.down('ShiftLeft') || input.down('ShiftRight') || input.mouseButtons.has(2));
    this.sprinting = moving && sprintKey && !this.exhausted && this.stamina > 0;
    let target = 0;
    if (moving) target = this.sprinting ? SPRINT : this.walk ? WALK : RUN * Math.max(0.35, wishLen);
    if (this.sprinting) this.useStamina(15 * dt);
    if (this.sprinting && input.hit('ShiftLeft')) this.useStamina(8);

    if (moving) this.yaw = dampAngle(this.yaw, wishYaw, 12, dt);
    const fwdX = Math.sin(this.yaw),
      fwdZ = Math.cos(this.yaw);
    // move mostly along facing (smooth arcs) but blend in wish direction
    const dirX = moving ? fwdX * 0.65 + wish.x * 0.35 : 0;
    const dirZ = moving ? fwdZ * 0.65 + wish.z * 0.35 : 0;
    this.vel.x = damp(this.vel.x, dirX * target, moving ? 10 : 14, dt);
    this.vel.z = damp(this.vel.z, dirZ * target, moving ? 10 : 14, dt);
    this.vel.y = 0;
    if (this.forced && this.forced.t > 0) {
      this.vel.x = this.forced.x;
      this.vel.z = this.forced.z;
      this.forced.t -= dt;
    }

    const nx = this.pos.x + this.vel.x * dt;
    const nz = this.pos.z + this.vel.z * dt;
    const ox = this.pos.x,
      oz = this.pos.z;
    const n = this.terrain.normalAt(nx, nz, _n);
    if (n.y < CLIMB_NY && this.terrain.heightAt(nx, nz) > this.pos.y + 0.15) {
      const hl = Math.hypot(n.x, n.z) || 1;
      const into = -(n.x * wish.x + n.z * wish.z) / hl;
      if (moving && into > 0.35 && this.stamina > 2 && !this.exhausted) {
        this.startClimb(n);
        return;
      }
      // slide along the wall
      const vn = (this.vel.x * n.x + this.vel.z * n.z) / hl;
      if (vn < 0) {
        this.vel.x -= (vn * n.x) / hl;
        this.vel.z -= (vn * n.z) / hl;
      }
    }
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.colliders.resolve(this.pos, 0.32);
    this.blockSolid(ox, oz, 0.55);
    this.speed = Math.hypot(this.vel.x, this.vel.z);

    const gh = this.groundHeight(this.pos.x, this.pos.z);
    if (SEA_LEVEL - gh > SWIM_DEPTH) {
      this.enterSwim();
      return;
    }
    if (this.pos.y - gh > 0.7) {
      this.state = 'air';
      this.fallStartY = this.pos.y;
      return;
    }
    this.pos.y = gh;

    if (!this.locked && input.hit('Space')) {
      this.vel.y = 7.6;
      this.state = 'air';
      this.fallStartY = this.pos.y;
      this.emit('jump');
    }
  }

  // ---------------------------------------------------------------- air
  updateAir(dt, input, wish, moving, wishYaw) {
    this.sprinting = false;
    this.vel.y -= GRAVITY * dt;
    const ox = this.pos.x,
      oz = this.pos.z;
    if (moving) {
      this.yaw = dampAngle(this.yaw, wishYaw, 5, dt);
      this.vel.x = damp(this.vel.x, wish.x * Math.max(5.5, Math.hypot(this.vel.x, this.vel.z)), 2.5, dt);
      this.vel.z = damp(this.vel.z, wish.z * Math.max(5.5, Math.hypot(this.vel.x, this.vel.z)), 2.5, dt);
    }
    this.pos.addScaledVector(this.vel, dt);
    this.colliders.resolve(this.pos, 0.32);
    this.blockSolid(ox, oz, 0.6);
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    const gh = this.groundHeight(this.pos.x, this.pos.z);

    if (this.pos.y < SWIM_Y + 0.2 && SEA_LEVEL - gh > SWIM_DEPTH) {
      this.enterSwim();
      this.emit('splash');
      return;
    }
    if (this.pos.y <= gh) {
      const impact = -this.vel.y;
      this.pos.y = gh;
      this.vel.y = 0;
      this.state = 'ground';
      if (impact > 13) this.landTimer = 0.22;
      this.emit('land', { impact });
      const drop = this.fallStartY - gh;
      if (drop > 22) this.emit('fallDamage', { amount: Math.min(0.6, (drop - 20) * 0.02) });
      return;
    }
    // wall in front -> climb
    if (moving && !this.locked && this.tryWallAhead(wish)) return;
    // open glider (wind currents open it automatically)
    this.glideCancel = Math.max(0, (this.glideCancel || 0) - dt);
    const canGlide = this.stamina > 1 && !this.exhausted && !this.locked;
    const h = this.pos.y - gh;
    if (canGlide && ((input.hit('Space') && this.vel.y < 1 && h > 2.2) || (this.updraft > 0 && h > 0.9 && this.glideCancel <= 0))) {
      this.state = 'glide';
      this.emit('glide');
    }
  }

  // Structures have vertical walls: never step up onto one, slide down it.
  blockSolid(ox, oz, step) {
    if (!this.terrain.solidAt) return;
    if (this.terrain.solidAt(this.pos.x, this.pos.z) > this.pos.y + step) {
      this.pos.x = ox;
      this.pos.z = oz;
      this.vel.x *= 0.2;
      this.vel.z *= 0.2;
    }
  }

  tryWallAhead(wish) {
    const ax = this.pos.x + wish.x * 0.6,
      az = this.pos.z + wish.z * 0.6;
    const h = this.terrain.heightAt(ax, az);
    if (h > this.pos.y + 0.6) {
      const n = this.terrain.normalAt(ax, az, _n);
      if (n.y < CLIMB_NY + 0.08 && this.stamina > 2 && !this.exhausted) {
        this.startClimb(n);
        return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------- glide
  updateGlide(dt, input, wish, moving, wishYaw) {
    this.sprinting = false;
    if (moving) this.yaw = dampAngle(this.yaw, wishYaw, 2.6, dt);
    // wind currents slow the glide so you can ride them upward
    const sp = this.updraft > 0 ? (moving ? 5.0 : 1.0) : moving ? 8.0 : 6.0;
    this.vel.x = damp(this.vel.x, Math.sin(this.yaw) * sp, 2.2, dt);
    this.vel.z = damp(this.vel.z, Math.cos(this.yaw) * sp, 2.2, dt);
    if (this.updraft > 0) this.vel.y = damp(this.vel.y, this.updraft, 2.2, dt);
    else this.vel.y = damp(this.vel.y, -2.1, 5, dt);
    const ox = this.pos.x,
      oz = this.pos.z;
    this.pos.addScaledVector(this.vel, dt);
    this.colliders.resolve(this.pos, 0.4);
    this.blockSolid(ox, oz, 0.6);
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    this.useStamina(5.5 * dt);
    this.fallStartY = this.pos.y;
    const gh = this.groundHeight(this.pos.x, this.pos.z);
    if (input.hit('Space') || this.stamina <= 0) {
      this.state = 'air';
      this.glideCancel = 0.8;
      return;
    }
    if (this.pos.y < SWIM_Y + 0.3 && SEA_LEVEL - gh > SWIM_DEPTH) {
      this.enterSwim();
      this.emit('splash');
      return;
    }
    if (this.pos.y <= gh + 0.05) {
      this.pos.y = gh;
      this.state = 'ground';
      this.vel.y = 0;
      this.emit('land', { impact: 2 });
      return;
    }
    if (this.tryWallAhead(new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)))) return;
  }

  // ---------------------------------------------------------------- climb
  startClimb(n) {
    this.state = 'climb';
    this.sprinting = false;
    const hl = Math.hypot(n.x, n.z) || 1;
    this.climbN.set(n.x / hl, 0, n.z / hl);
    this.vel.set(0, 0, 0);
    this.yaw = Math.atan2(-this.climbN.x, -this.climbN.z);
    this.attachToWall();
    this.emit('climb');
  }

  // Find the wall surface along -climbN at the current height.
  attachToWall() {
    const n = this.climbN;
    const y = this.pos.y + 0.4;
    const f = (s) => this.terrain.heightAt(this.pos.x - n.x * s, this.pos.z - n.z * s) - y;
    let a = -1.2,
      b = 2.0;
    if (f(b) < 0) return 'top';
    if (f(a) > 0) {
      // embedded: push out
      this.pos.x += n.x * 0.5;
      this.pos.z += n.z * 0.5;
      return 'ok';
    }
    for (let i = 0; i < 14; i++) {
      const m = (a + b) / 2;
      if (f(m) > 0) b = m;
      else a = m;
    }
    const s = (a + b) / 2;
    const sx = this.pos.x - n.x * s,
      sz = this.pos.z - n.z * s;
    this.pos.x = sx + n.x * 0.32;
    this.pos.z = sz + n.z * 0.32;
    const wn = this.terrain.normalAt(sx, sz, _n);
    const hl = Math.hypot(wn.x, wn.z);
    if (wn.y > 0.8) return 'flat';
    if (hl > 0.2) {
      this.climbN.lerp(_v.set(wn.x / hl, 0, wn.z / hl), 0.25).normalize();
    }
    return 'ok';
  }

  updateClimb(dt, input, mv) {
    const n = this.climbN;
    // character-relative axes on the wall
    const facingX = -n.x,
      facingZ = -n.z;
    const rightX = -facingZ,
      rightZ = facingX;
    const up = mv.y,
      side = mv.x;
    const moving = Math.abs(up) + Math.abs(side) > 0.1;
    this.climbMoving = moving || this.climbJump > 0;
    const speed = 2.4;
    if (input.hit('Space') && this.stamina > 8) {
      this.climbJump = 0.28;
      this.useStamina(18);
      this.emit('jump');
    }
    let vy = up * speed;
    if (this.climbJump > 0) {
      this.climbJump -= dt;
      vy = 7.5;
    }
    this.pos.y += vy * dt;
    this.pos.x += rightX * side * speed * 0.8 * dt;
    this.pos.z += rightZ * side * speed * 0.8 * dt;
    if (moving) this.useStamina(9 * dt);
    else this.useStamina(1.2 * dt);
    this.speed = 0;
    this.vel.set(0, vy, 0);

    const r = this.attachToWall();
    this.yaw = dampAngle(this.yaw, Math.atan2(-n.x, -n.z), 10, dt);

    const groundBelow = this.terrain.heightAt(this.pos.x + n.x * 0.3, this.pos.z + n.z * 0.3);
    if (r === 'top' || r === 'flat') {
      // vault onto the ledge
      this.pos.x -= n.x * 0.9;
      this.pos.z -= n.z * 0.9;
      this.pos.y = this.terrain.heightAt(this.pos.x, this.pos.z);
      this.state = 'ground';
      this.vel.set(-n.x * 2, 0, -n.z * 2);
      this.landTimer = 0.15;
      this.emit('vault');
      return;
    }
    if (up < -0.1 && this.pos.y - groundBelow < 0.25) {
      this.state = 'ground';
      this.pos.y = groundBelow;
      return;
    }
    if (input.hit('KeyX') || this.stamina <= 0) {
      this.state = 'air';
      this.vel.set(n.x * 2, 0, n.z * 2);
      this.fallStartY = this.pos.y;
      return;
    }
    if (this.pos.y < SWIM_Y + 0.4 && SEA_LEVEL - groundBelow > SWIM_DEPTH) this.enterSwim();
  }

  // ---------------------------------------------------------------- swim
  enterSwim() {
    this.state = 'swim';
    if (this.pos.y < SWIM_Y - 0.4) this.pos.y = SWIM_Y - 0.4;
    this.vel.y = 0;
    this.sprinting = false;
  }

  updateSwim(dt, input, wish, moving, wishYaw) {
    const sprintKey = input.down('ShiftLeft') || input.down('ShiftRight');
    this.sprinting = moving && sprintKey && !this.exhausted && this.stamina > 0;
    const target = moving ? (this.sprinting ? 5.6 : 3.0) : 0;
    if (moving) this.yaw = dampAngle(this.yaw, wishYaw, 6, dt);
    this.vel.x = damp(this.vel.x, Math.sin(this.yaw) * target, 3, dt);
    this.vel.z = damp(this.vel.z, Math.cos(this.yaw) * target, 3, dt);
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y = damp(this.pos.y, SWIM_Y + Math.sin(performance.now() * 0.002) * 0.04, 6, dt);
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    this.useStamina((this.sprinting ? 16 : moving ? 5 : 2.5) * dt);
    this.colliders.resolve(this.pos, 0.35);
    const gh = this.groundHeight(this.pos.x, this.pos.z);
    if (SEA_LEVEL - gh < SWIM_DEPTH - 0.1) {
      this.state = 'ground';
      this.pos.y = gh;
      return;
    }
    if (this.stamina <= 0) {
      this.emit('drown');
      this.respawn();
    }
  }

  respawn(pos) {
    this.pos.copy(pos || this.lastSafe);
    this.pos.y = this.terrain.heightAt(this.pos.x, this.pos.z);
    this.vel.set(0, 0, 0);
    this.state = 'ground';
    this.stamina = this.maxStamina;
    this.exhausted = false;
  }
}
