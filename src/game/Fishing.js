import * as THREE from 'three';
import { Builder, M, box, cyl } from '../world/Structures.js';
import { PORT_LEN, PORT_DIR, portWorld } from '../world/Terrain.js';
import { toonMaterial } from '../render/materials.js';
import { ITEMS, itemIcon } from './Items.js';
import { damp } from '../core/noise.js';

// Fishing at the end of the harbour pier (sea) and from a small dock on the
// mirror lake. Hold to charge a cast, wait for the float to plunge, strike,
// then keep the tension bar over the fish until it is landed.

const V3 = THREE.Vector3;
const LAKE_DOCK = { x0: 59.5, x1: 72.4, z: 104, y: 1.4 };

const FISH = {
  sardine: { water: 'sea', w: 6, diff: 0.25, size: [14, 22], gems: 0 },
  snapper: { water: 'sea', w: 3, diff: 0.6, size: [28, 46], gems: 0, dusk: 2 },
  trout: { water: 'lake', w: 6, diff: 0.42, size: [24, 40], gems: 0 },
  koi: { water: 'lake', w: 0.9, diff: 0.85, size: [40, 66], gems: 15, night: 2.2, rare: true },
};

const el = (tag, cls, html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

function fishShadowTexture() {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 64;
  const g = cv.getContext('2d');
  g.filter = 'blur(4px)';
  g.fillStyle = '#000';
  g.beginPath();
  g.ellipse(58, 32, 40, 13, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(92, 32);
  g.lineTo(118, 16);
  g.lineTo(112, 32);
  g.lineTo(118, 48);
  g.closePath();
  g.fill();
  const t = new THREE.CanvasTexture(cv);
  return t;
}

export class Fishing {
  // keep trees off the lake dock (call before vegetation)
  static reserve(terrain) {
    terrain.addBlocker(63, LAKE_DOCK.z, 6);
  }

  constructor(game) {
    this.g = game;
    const prog = game.explore.progress;
    this.log = prog.fish || (prog.fish = {});
    this.buildDock();
    const S = game.structures;
    const L = PORT_LEN;
    const [px, pz] = portWorld(L + 42.4, 3);
    this.spots = [
      { pos: new V3(px, S.pier.y, pz), yaw: PORT_DIR, water: 'sea', name: '단풍 항구 부두' },
      { pos: new V3(LAKE_DOCK.x1 - 0.8, LAKE_DOCK.y, LAKE_DOCK.z), yaw: Math.PI / 2, water: 'lake', name: '거울 호수 나루' },
    ];
    this.buildRod();
    this.buildUI();
    this.active = null;
  }

  buildDock() {
    const S = this.g.structures;
    const D = LAKE_DOCK;
    const len = D.x1 - D.x0;
    const cx = (D.x0 + D.x1) / 2;
    const F = S.frame(cx, 0, D.z, Math.PI / 2);
    const at = (m) => F.clone().multiply(m);
    const b = new Builder();
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const n = Math.round(len / 0.42);
    for (let k = 0; k <= n; k++)
      b.add('wood', box(2.3, 0.11, 0.36), { m: at(M((rand() - 0.5) * 0.05, D.y - 0.11, -len / 2 + (k * len) / n, 0, (rand() - 0.5) * 0.05, 0)), color: rand() < 0.2 ? '#7a5a3c' : '#a07650', uvScale: 0.8 });
    for (let z = -len / 2 + 2; z <= len / 2; z += 2.6) for (const sx of [-1.05, 1.05]) b.add('wood', cyl(0.13, 0.15, D.y + 6, 8), { m: at(M(sx, -6, z)), color: '#5d4130' });
    for (const sx of [-1.1, 1.1]) b.add('wood', box(0.12, 0.12, len), { m: at(M(sx, D.y - 0.28, 0)), color: '#5d4130' });
    // a crate, a bucket and a lantern post at the end
    b.add('wood', box(0.6, 0.5, 0.6), { m: at(M(0.7, D.y, len / 2 - 2.2, 0, 0.3, 0)), color: '#8a5a36' });
    b.add('wood', cyl(0.2, 0.17, 0.32, 10), { m: at(M(-0.75, D.y, len / 2 - 1.4)), color: '#6b8aa0' });
    b.add('wood', cyl(0.05, 0.06, 1.9, 6), { m: at(M(-1.0, D.y, len / 2 - 0.3)), color: '#5d4130' });
    b.add('lamp', cyl(0.12, 0.1, 0.26, 8), { m: at(M(-1.0, D.y + 1.9, len / 2 - 0.3)), color: '#ffd38a', extra: 1 });
    b.build(S.mats, S.group);
    S.solids.addBox(cx, D.z, 1.2, len / 2, Math.PI / 2, D.y, true);
  }

  buildRod() {
    const scene = this.g.scene;
    this.rodGroup = new THREE.Group();
    this.rodGroup.visible = false;
    scene.add(this.rodGroup);
    const segMat = toonMaterial({ color: '#7a5236', rim: 0.25 });
    const tipMat = toonMaterial({ color: '#c9a070', rim: 0.25 });
    const geo = new THREE.CylinderGeometry(1, 1, 1, 6);
    geo.translate(0, 0.5, 0);
    this.segs = [];
    const NS = 7;
    for (let i = 0; i < NS; i++) {
      const m = new THREE.Mesh(geo, i < 2 ? segMat : tipMat);
      const r = 0.024 - i * 0.0025;
      m.userData.r = r;
      this.rodGroup.add(m);
      this.segs.push(m);
    }
    // reel near the grip
    const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.04, 12), toonMaterial({ color: '#c9a050', rim: 0.4 }));
    this.rodGroup.add(reel);
    this.reelMesh = reel;
    // line
    this.LN = 28;
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.LN * 3), 3));
    this.line = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: '#f2f2ea', transparent: true, opacity: 0.75 }));
    this.line.frustumCulled = false;
    this.rodGroup.add(this.line);
    // float: red cap, white belly
    const bob = new THREE.Group();
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), toonMaterial({ color: '#e0402e', rim: 0.4 }));
    const bot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), toonMaterial({ color: '#f4f0e6', rim: 0.4 }));
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 4), toonMaterial({ color: '#e0402e' }));
    stick.position.y = 0.1;
    bob.add(top, bot, stick);
    bob.scale.setScalar(1.7);
    this.bob = bob;
    this.rodGroup.add(bob);
    // fish shadow beneath the surface
    const sh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 0.5),
      new THREE.MeshBasicMaterial({ map: fishShadowTexture(), color: '#0a1a20', transparent: true, opacity: 0, depthWrite: false })
    );
    sh.rotation.x = -Math.PI / 2;
    sh.renderOrder = 1;
    this.shadow = sh;
    this.shadowYaw = new THREE.Group();
    this.shadowYaw.add(sh);
    scene.add(this.shadowYaw);
    this.shadowYaw.visible = false;
    this._a = new V3();
    this._b = new V3();
    this._q = new THREE.Quaternion();
    this.tip = new V3();
    this.bobPos = new V3();
  }

  buildUI() {
    const ui = (this.ui = el(
      'div',
      'fish-ui hidden',
      `<div class="fu-top"><span class="fu-spot"></span><span class="fu-hint"></span></div>
       <div class="fu-charge"><i></i></div>
       <div class="fu-reel hidden"><div class="fu-prog"><i></i></div><div class="fu-track"><div class="fu-zone"></div><div class="fu-fish"></div></div></div>
       <div class="fu-bite">!</div>
       <div class="fu-catch hidden"><img alt=""><div><span class="fu-new"></span><b></b><small></small></div></div>
       <div class="fu-keys"><span><kbd>클릭</kbd>/<kbd>Space</kbd> 길게</span><span><kbd>F</kbd>·<kbd>Esc</kbd> 그만두기</span></div>
       <button class="fu-btn">당기기</button>
       <button class="fu-quit" aria-label="그만두기">✕</button>`
    ));
    this.g.container.appendChild(ui);
    const btn = ui.querySelector('.fu-btn');
    this.touchHold = false;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.touchHold = true;
      this.touchTap = true;
    });
    window.addEventListener('pointerup', () => (this.touchHold = false));
    ui.querySelector('.fu-quit').addEventListener('click', () => this.stop());
    this.q = (s) => ui.querySelector(s);
  }

  consider(P, consider) {
    for (const s of this.spots) consider(s.pos, 2.2, `낚시하기 · ${s.water === 'sea' ? '바다' : '호수'}`, () => this.start(s));
  }

  // ---------------------------------------------------------------- state
  start(spot) {
    const g = this.g;
    if (g.state !== 'playing') return;
    const P = g.player;
    g.state = 'fishing';
    if (g.combat.action) g.combat.endAction();
    this.active = spot;
    P.vel.set(0, 0, 0);
    P.yaw = spot.yaw;
    const fw = new V3(Math.sin(spot.yaw), 0, Math.cos(spot.yaw));
    P.pos.set(spot.pos.x - fw.x * 0.4, spot.pos.y, spot.pos.z - fw.z * 0.4);
    this.fw = fw;
    this.phase = 'ready';
    this.t = 0;
    this.charge = 0;
    this.cam = null;
    this.rodGroup.visible = true;
    g.player.model.weapon.visible = false;
    g.hud.layer.classList.add('cine');
    g.hud.setPrompt('');
    g.explore.promptText = '';
    this.ui.classList.remove('hidden');
    this.ui.classList.toggle('touch', !!g.touch);
    this.q('.fu-spot').textContent = spot.name;
    this.setHint('길게 눌러 던질 거리를 정하고, 놓으면 던집니다');
    this.q('.fu-catch').classList.add('hidden');
    this.q('.fu-reel').classList.add('hidden');
    this.q('.fu-charge').classList.remove('show');
    g.sfx.open();
  }

  stop() {
    const g = this.g;
    if (g.state !== 'fishing') return;
    this.active = null;
    this.rodGroup.visible = false;
    this.shadowYaw.visible = false;
    this.ui.classList.add('hidden');
    g.hud.layer.classList.remove('cine');
    g.state = 'playing';
    g.input.enabled = true;
    g.input.requestLock();
    g.cameraCtl.yaw = g.player.yaw + Math.PI;
    g.cameraCtl.pitch = 0.2;
    g.cameraCtl.initialized = false;
    g.clock.getDelta();
    g.sfx.close();
    g.explore.save();
  }

  setHint(s) {
    if (s !== this.hint) {
      this.hint = s;
      this.q('.fu-hint').textContent = s;
    }
  }

  pick() {
    const water = this.active.water;
    const hr = this.g.env.time;
    const night = hr > 19.5 || hr < 5;
    const dusk = (hr > 16.5 && hr < 19.5) || (hr > 5 && hr < 7);
    const pool = Object.entries(FISH).filter(([, f]) => f.water === water);
    let sum = 0;
    const ws = pool.map(([id, f]) => {
      let w = f.w;
      if (f.dusk && dusk) w *= f.dusk;
      if (f.night && night) w *= f.night;
      // more fish bite in the rain
      if (this.g.weather && this.g.weather.rain > 0.3) w *= 1.2;
      sum += w;
      return [id, w];
    });
    let r = Math.random() * sum;
    for (const [id, w] of ws) if ((r -= w) <= 0) return id;
    return ws[0][0];
  }

  holding() {
    const I = this.g.input;
    return I.mouseButtons.has(0) || I.keys.has('Space') || this.touchHold;
  }
  pressed() {
    const I = this.g.input;
    const t = this.touchTap;
    this.touchTap = false;
    return I.mouseHit(0) || I.hit('Space') || t;
  }

  update(dt) {
    const g = this.g;
    const I = g.input;
    if (I.hit('KeyF')) return this.stop();
    const hold = this.holding();
    const press = this.pressed();
    this.t += dt;
    const ph = this.phase;
    if (ph === 'ready') {
      if (hold) {
        this.phase = 'charge';
        this.charge = 0;
        this.q('.fu-charge').classList.add('show');
      }
    } else if (ph === 'charge') {
      this.charge = Math.min(1, this.charge + dt * 0.75);
      // the meter swings back and forth while held
      const k = 1 - Math.abs(1 - ((this.t * 0.9) % 2));
      this.chargeK = k;
      this.q('.fu-charge i').style.width = `${(k * 100).toFixed(1)}%`;
      if (!hold) this.cast(k);
    } else if (ph === 'fly') {
      this.flyT += dt / this.flyDur;
      if (this.flyT >= 1) {
        this.flyT = 1;
        this.phase = 'wait';
        this.t = 0;
        this.waitDur = 2.5 + Math.random() * 5.5;
        this.nibbles = 1 + Math.floor(Math.random() * 3);
        this.fishId = this.pick();
        g.water.puff(this.target.x, this.target.z, 0.7);
        g.sfx.plop();
        this.setHint('찌가 물에 잠길 때를 기다리세요...');
        const a = Math.random() * Math.PI * 2;
        this.shadowFrom = new V3(this.target.x + Math.cos(a) * 6, 0, this.target.z + Math.sin(a) * 6);
        this.shadowYaw.visible = true;
        this.shadowYaw.position.copy(this.shadowFrom);
        const f = FISH[this.fishId];
        this.shadow.scale.setScalar(0.7 + ((f.size[0] + f.size[1]) / 2) / 45);
      }
    } else if (ph === 'wait') {
      // the fish's shadow circles in towards the float
      const k = Math.min(1, this.t / this.waitDur);
      const sp = this.shadowYaw.position;
      const ang = Math.atan2(this.shadowFrom.z - this.target.z, this.shadowFrom.x - this.target.x) + k * 2.2;
      const r = 6 * (1 - k) + 0.35;
      const nx = this.target.x + Math.cos(ang) * r,
        nz = this.target.z + Math.sin(ang) * r;
      this.shadowYaw.rotation.y = -Math.atan2(nz - sp.z, nx - sp.x) + Math.PI;
      sp.set(nx, -0.32, nz);
      this.shadow.material.opacity = Math.min(0.42, k * 1.2);
      // a couple of little nibbles before the real bite
      const nib = Math.floor((this.t / this.waitDur) * (this.nibbles + 1));
      if (nib !== this.lastNib && nib > 0 && nib <= this.nibbles) {
        this.dip = 0.04;
        g.water.puff(this.target.x, this.target.z, 0.25);
      }
      this.lastNib = nib;
      if (this.t > this.waitDur) {
        this.phase = 'bite';
        this.t = 0;
        this.dip = 0.16;
        g.sfx.bite();
        g.water.puff(this.target.x, this.target.z, 1);
        g.combat.vfx.burst(new V3(this.target.x, 0.1, this.target.z), '#e8f8ff', 14, { speed: 2.6, size: 0.12, life: 0.5, gravity: 7, up: 1.2 });
        this.q('.fu-bite').classList.add('show');
        this.setHint('지금! 눌러서 챔질하세요!');
      }
      if (press) this.miss('너무 일찍 당겼습니다');
    } else if (ph === 'bite') {
      if (press) {
        this.q('.fu-bite').classList.remove('show');
        this.startReel();
      } else if (this.t > 1.15) {
        this.q('.fu-bite').classList.remove('show');
        this.miss('물고기가 미끼만 먹고 달아났습니다');
      }
    } else if (ph === 'reel') {
      this.updateReel(dt, hold);
    } else if (ph === 'land') {
      if (this.t > 2.2 || (this.t > 0.6 && press)) this.reset();
    }
    this.animate(dt, hold);
  }

  cast(k) {
    const g = this.g;
    this.q('.fu-charge').classList.remove('show');
    const dist = 8.5 + k * 11;
    const s = this.active;
    const P = g.player.pos;
    this.target = new V3(P.x + this.fw.x * dist, 0, P.z + this.fw.z * dist);
    // never cast onto land
    for (let d = dist; d > 3; d -= 1) {
      this.target.set(P.x + this.fw.x * d, 0, P.z + this.fw.z * d);
      if (g.terrain.heightAt(this.target.x, this.target.z) < -0.6) break;
    }
    this.flyFrom = this.tip.clone();
    this.flyT = 0;
    this.flyDur = 0.55 + k * 0.35;
    this.phase = 'fly';
    this.swing = 0;
    g.sfx.castLine();
    this.setHint('');
    void s;
  }

  miss(text) {
    this.g.hud.flashCenter(text);
    this.reset();
  }

  reset() {
    this.phase = 'ready';
    this.t = 0;
    this.shadowYaw.visible = false;
    this.q('.fu-reel').classList.add('hidden');
    this.q('.fu-catch').classList.add('hidden');
    this.q('.fu-bite').classList.remove('show');
    this.setHint('길게 눌러 던질 거리를 정하고, 놓으면 던집니다');
  }

  startReel() {
    const f = FISH[this.fishId];
    this.phase = 'reel';
    this.t = 0;
    this.R = { zone: 0.35, zv: 0, fish: 0.5, ft: 0.5, fv: 0, retarget: 0.4, prog: 0.3, w: 0.26 - f.diff * 0.07, diff: f.diff, splash: 0 };
    this.q('.fu-reel').classList.remove('hidden');
    this.q('.fu-zone').style.width = `${(this.R.w * 100).toFixed(1)}%`;
    this.q('.fu-fish').innerHTML = `<img src="${itemIcon(this.fishId)}" alt="">`;
    this.setHint('누르고 있으면 오른쪽으로 · 물고기를 칸 안에 두세요');
    this.g.sfx.bite();
  }

  updateReel(dt, hold) {
    const R = this.R;
    const g = this.g;
    // tension zone: pushed right while held, sinks back when released
    R.zv += (hold ? 2.6 : -2.2) * dt;
    R.zv = Math.max(-1.4, Math.min(1.4, R.zv));
    R.zone += R.zv * dt;
    if (R.zone < 0) (R.zone = 0), (R.zv = Math.max(0, R.zv) * 0.3);
    if (R.zone > 1 - R.w) (R.zone = 1 - R.w), (R.zv = Math.min(0, R.zv) * 0.3);
    // the fish darts to new spots; harder fish move more often and faster
    R.retarget -= dt;
    if (R.retarget <= 0) {
      R.retarget = (0.5 + Math.random() * 1.1) * (1.25 - R.diff * 0.6);
      const jump = 0.15 + Math.random() * (0.25 + R.diff * 0.45);
      R.ft = Math.max(0.04, Math.min(0.96, R.fish + (Math.random() < 0.5 ? -jump : jump)));
    }
    const fk = 1.6 + R.diff * 3.2;
    R.fv += ((R.ft - R.fish) * fk * fk - R.fv * fk * 1.4) * dt;
    R.fish = Math.max(0.02, Math.min(0.98, R.fish + R.fv * dt));
    const inZone = R.fish > R.zone && R.fish < R.zone + R.w;
    R.prog += inZone ? 0.13 * dt : -(0.085 + R.diff * 0.1) * dt;
    if (hold) g.sfx.reel();
    this.q('.fu-zone').style.left = `${(R.zone * 100).toFixed(2)}%`;
    this.q('.fu-zone').classList.toggle('on', inZone);
    this.q('.fu-fish').style.left = `${(R.fish * 100).toFixed(2)}%`;
    this.q('.fu-prog i').style.width = `${(Math.max(0, R.prog) * 100).toFixed(1)}%`;
    R.splash -= dt;
    if (R.splash <= 0) {
      R.splash = 0.3 + Math.random() * 0.5;
      g.water.puff(this.bobPos.x, this.bobPos.z, 0.6);
      if (Math.random() < 0.5) g.combat.vfx.burst(new V3(this.bobPos.x, 0.05, this.bobPos.z), '#e8f8ff', 8, { speed: 2, size: 0.1, life: 0.4, gravity: 7, up: 1 });
    }
    if (R.prog >= 1) this.landFish();
    else if (R.prog <= 0) {
      this.g.sfx.reel();
      this.miss('낚싯줄이 풀려 물고기를 놓쳤습니다');
    }
  }

  landFish() {
    const g = this.g;
    const id = this.fishId;
    const f = FISH[id];
    const size = +(f.size[0] + Math.pow(Math.random(), 1.6) * (f.size[1] - f.size[0])).toFixed(1);
    const rec = this.log[id] || (this.log[id] = { n: 0, best: 0 });
    const first = rec.n === 0;
    const best = size > rec.best;
    rec.n++;
    rec.best = Math.max(rec.best, size);
    g.bag.add(id, 1);
    if (f.gems) g.gems += f.gems;
    if (g.achievements) g.achievements.add('fish');
    g.sfx.catchFish(!!f.rare);
    this.phase = 'land';
    this.t = 0;
    this.shadowYaw.visible = false;
    this.q('.fu-reel').classList.add('hidden');
    const card = this.q('.fu-catch');
    card.querySelector('img').src = itemIcon(id);
    card.querySelector('b').textContent = ITEMS[id].name;
    card.querySelector('small').textContent = `${size.toFixed(1)}cm${f.gems ? ` · 별빛 결정 +${f.gems}` : ''}`;
    card.querySelector('.fu-new').textContent = first ? '새로운 물고기!' : best ? '최고 기록!' : '획득';
    card.classList.toggle('rare', !!f.rare);
    card.classList.remove('hidden');
    this.setHint('');
    // the fish flips out of the water onto the planks
    this.flip = { t: 0, from: this.bobPos.clone() };
    g.water.puff(this.bobPos.x, this.bobPos.z, 1);
    g.combat.vfx.burst(this.bobPos.clone().setY(0.2), f.rare ? '#ffe680' : '#e8f8ff', 22, { speed: 3.4, size: 0.14, life: 0.6, gravity: 7, up: 1.4 });
    g.explore.save();
  }

  // ---------------------------------------------------------------- visuals
  animate(dt, hold) {
    const g = this.g;
    const P = g.player;
    const m = P.model;
    const ph = this.phase;
    // rod angle: raised while charging, flung forward on the cast, up while reeling
    let lift = ph === 'charge' ? 1.35 : ph === 'fly' ? 0.15 : ph === 'reel' ? 0.85 : ph === 'bite' ? 0.6 : 0.45;
    if (ph === 'reel' && hold) lift = 1.0;
    this.lift = damp(this.lift ?? 0.45, lift, ph === 'fly' ? 18 : 6, dt);
    m.root.position.copy(P.pos);
    m.root.rotation.y = P.yaw;
    const L = this.lift;
    m.update(dt, {
      mode: 'idle',
      speed: 0,
      override: (Pose) => {
        Pose.uArmR.set(-0.55 - L * 0.55, 0.15, -0.2);
        Pose.fArmR.set(-0.75, 0, 0);
        Pose.handR.set(0.2, 0, 0);
        Pose.uArmL.set(-0.7 - L * 0.35, -0.35, 0.25);
        Pose.fArmL.set(-0.95, 0, 0);
        Pose.spine.x = ph === 'charge' ? -0.12 : ph === 'reel' ? -0.06 : 0.05;
        Pose.chest.y = -0.15;
        return { blend: 10 };
      },
    });
    m.root.updateMatrixWorld(true);
    // rod base sits in the right hand
    const base = this._a;
    m.j.handR.getWorldPosition(base);
    const fw = this.fw;
    const right = new V3(fw.z, 0, -fw.x);
    // bend: more tension while reeling
    const tension = ph === 'reel' ? (hold ? 1 : 0.6) : ph === 'bite' ? 0.5 : ph === 'wait' ? 0.12 : 0.05;
    this.tension = damp(this.tension ?? 0, tension, 8, dt);
    const len = 2.3;
    const NS = this.segs.length;
    const p = base.clone();
    const ang0 = 0.35 + L * 0.65;
    let prev = p.clone();
    for (let i = 0; i < NS; i++) {
      const u = (i + 1) / NS;
      const a = ang0 - this.tension * u * u * 1.0 - (ph === 'fly' ? 0.25 * u : 0);
      const dir = new V3(fw.x * Math.cos(a), Math.sin(a), fw.z * Math.cos(a)).addScaledVector(right, 0.06 * u);
      const seg = this.segs[i];
      const sl = len / NS;
      const next = prev.clone().addScaledVector(dir.normalize(), sl);
      seg.position.copy(prev);
      seg.quaternion.setFromUnitVectors(new V3(0, 1, 0), dir);
      seg.scale.set(seg.userData.r, sl * 1.02, seg.userData.r);
      prev = next;
    }
    this.tip.copy(prev);
    this.reelMesh.position.copy(base).addScaledVector(fw, 0.18).add(new V3(0, -0.04, 0));
    this.reelMesh.quaternion.setFromUnitVectors(new V3(0, 1, 0), right);

    // float position
    const bp = this.bobPos;
    const t = performance.now() / 1000;
    let lineOut = true;
    if (ph === 'ready' || ph === 'charge') {
      bp.copy(this.tip).add(new V3(0, -0.45, 0));
      lineOut = false;
    } else if (ph === 'fly') {
      const k = this.flyT;
      bp.lerpVectors(this.flyFrom, this.target, k);
      bp.y = this.flyFrom.y * (1 - k) + Math.sin(k * Math.PI) * (2 + this.target.distanceTo(this.flyFrom) * 0.2);
    } else if (ph === 'land') {
      const F = this.flip;
      F.t += dt;
      const k = Math.min(1, F.t / 0.6);
      bp.lerpVectors(F.from, this.tip, k);
      bp.y += Math.sin(k * Math.PI) * 1.5 - k * 0.45;
    } else {
      this.dip = damp(this.dip || 0, 0, ph === 'bite' ? 1.2 : 5, dt);
      bp.set(this.target.x, 0.02 + Math.sin(t * 2.2) * 0.015 - this.dip * (ph === 'bite' ? 1 + Math.sin(t * 30) * 0.3 : 1), this.target.z);
      if (ph === 'reel') {
        // the fish drags the float around, nearer as it tires
        const R = this.R;
        const off = (R.fish - 0.5) * 3;
        const d = 1 - Math.max(0, R.prog) * 0.55;
        bp.set(P.pos.x + fw.x * (this.target.distanceTo(P.pos.clone().setY(0)) * d) + right.x * off, -0.03 + Math.sin(t * 9) * 0.03, P.pos.z + fw.z * (this.target.distanceTo(P.pos.clone().setY(0)) * d) + right.z * off);
        this.shadowYaw.position.set(bp.x, -0.32, bp.z);
        this.shadowYaw.rotation.y += Math.sin(t * 6) * dt * 3;
      }
    }
    this.bob.position.copy(bp);
    this.bob.rotation.z = Math.sin(t * 1.7) * 0.1;
    this.bob.visible = ph !== 'land' || this.flip.t < 0.6;
    // line: sags when slack, straight under tension
    const pos = this.line.geometry.attributes.position;
    const N = this.LN;
    const sag = lineOut ? (1 - this.tension) * Math.min(1.4, this.tip.distanceTo(bp) * 0.12) : 0;
    for (let i = 0; i < N; i++) {
      const u = i / (N - 1);
      const x = this.tip.x + (bp.x - this.tip.x) * u;
      const z = this.tip.z + (bp.z - this.tip.z) * u;
      const y = this.tip.y + (bp.y + 0.05 - this.tip.y) * u - Math.sin(u * Math.PI) * sag;
      pos.setXYZ(i, x, Math.max(y, Math.min(bp.y, 0.0)), z);
    }
    pos.needsUpdate = true;

    this.updateCamera(dt);
  }

  updateCamera(dt) {
    const g = this.g;
    const P = g.player.pos;
    const fw = this.fw;
    const right = new V3(fw.z, 0, -fw.x);
    const ph = this.phase;
    const far = ph === 'wait' || ph === 'bite' || ph === 'reel';
    // higher on the tall harbour pier so the planks never hide the float
    const up = 2.1 + Math.max(0, P.y - 1.5) * 0.45;
    const want = new V3(P.x - fw.x * 3.4 + right.x * 1.9, P.y + up, P.z - fw.z * 3.4 + right.z * 1.9);
    const look = far && this.target ? new V3().lerpVectors(P, this.bobPos, 0.62).setY(P.y * 0.4) : new V3(P.x + fw.x * 6, P.y + 0.6, P.z + fw.z * 6);
    if (!this.cam) this.cam = { pos: g.camera.position.clone(), look: look.clone() };
    const k = 1 - Math.exp(-dt * 3.5);
    this.cam.pos.lerp(want, k);
    this.cam.look.lerp(look, k);
    g.camera.position.copy(this.cam.pos);
    g.camera.lookAt(this.cam.look);
  }
}
