import * as THREE from 'three';

// Photo mode: the world freezes, the HUD hides, the camera orbits freely
// around the character (drag / wheel), with colour filters, time of day,
// a few poses and a shutter that saves a PNG.

const FILTERS = [
  { id: 'none', name: '기본', sat: 1.04, con: 1.05, lift: [0.01, 0.012, 0.025], gain: [1, 1, 1] },
  { id: 'warm', name: '노을', sat: 1.1, con: 1.06, lift: [0.04, 0.02, 0.0], gain: [1.08, 1.0, 0.9] },
  { id: 'cool', name: '새벽', sat: 0.95, con: 1.04, lift: [0.0, 0.02, 0.05], gain: [0.92, 1.0, 1.1] },
  { id: 'vivid', name: '선명', sat: 1.35, con: 1.12, lift: [0.0, 0.0, 0.0], gain: [1.02, 1.02, 1.02] },
  { id: 'mono', name: '흑백', sat: 0.0, con: 1.15, lift: [0.02, 0.02, 0.02], gain: [1, 1, 1] },
  { id: 'film', name: '필름', sat: 0.8, con: 0.95, lift: [0.06, 0.05, 0.03], gain: [1.0, 0.97, 0.9] },
];
const POSES = [null, 'look', 'stretch', 'shift', 'scuff'];

const el = (tag, cls, html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

export class Photo {
  constructor(game) {
    this.g = game;
    this.el = el(
      'div',
      'photo hidden',
      `<div class="ph-drag"></div>
       <div class="ph-flash"></div>
       <div class="ph-bar">
         <div class="ph-group"><span>필터</span><div class="ph-filters">${FILTERS.map((f, i) => `<button data-f="${i}">${f.name}</button>`).join('')}</div></div>
         <div class="ph-group"><span>시간</span><input type="range" class="ph-time" min="0" max="24" step="0.1"></div>
         <div class="ph-group"><span>포즈</span><button class="ph-pose">기본</button></div>
         <div class="ph-group"><span>캐릭터</span><button class="ph-hide">보이기</button></div>
         <button class="ph-shot" aria-label="촬영"></button>
         <button class="ph-exit">나가기</button>
       </div>
       <div class="ph-hint">드래그 · 회전 &nbsp; 휠 · 거리 &nbsp; Shift+드래그 · 높이</div>
       <a class="ph-last hidden" download="starwind-photo.png" target="_blank"><img alt="마지막 사진"><span>저장</span></a>`
    );
    game.container.appendChild(this.el);
    this.active = false;
    this.filter = 0;
    this.pose = 0;
    const q = (s) => this.el.querySelector(s);
    this.el.querySelectorAll('.ph-filters button').forEach((b) => b.addEventListener('click', () => this.setFilter(+b.dataset.f)));
    q('.ph-time').addEventListener('input', (e) => (game.env.time = +e.target.value));
    q('.ph-pose').addEventListener('click', () => this.nextPose());
    q('.ph-hide').addEventListener('click', () => {
      const m = game.player.model.root;
      m.visible = !m.visible;
      q('.ph-hide').textContent = m.visible ? '보이기' : '숨김';
    });
    q('.ph-shot').addEventListener('click', () => this.shoot());
    q('.ph-exit').addEventListener('click', () => this.close());
    // orbit by dragging
    const drag = q('.ph-drag');
    let down = null;
    drag.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, shift: e.shiftKey };
      drag.setPointerCapture(e.pointerId);
    });
    drag.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - down.x,
        dy = e.clientY - down.y;
      down.x = e.clientX;
      down.y = e.clientY;
      if (down.shift || e.shiftKey) this.height = Math.max(-1.2, Math.min(3, this.height - dy * 0.01));
      else {
        this.yaw -= dx * 0.006;
        this.pitch = Math.max(-0.5, Math.min(1.3, this.pitch + dy * 0.005));
      }
    });
    drag.addEventListener('pointerup', () => (down = null));
    drag.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.dist = Math.max(1.2, Math.min(14, this.dist * (e.deltaY > 0 ? 1.1 : 0.9)));
      },
      { passive: false }
    );
    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      if (e.code === 'Escape' || e.code === 'KeyP') {
        e.stopImmediatePropagation();
        this.close();
      }
      if (e.code === 'Space' || e.code === 'Enter') this.shoot();
    });
  }

  open() {
    const g = this.g;
    if (g.state !== 'playing') return;
    g.state = 'photo';
    this.active = true;
    g.input.enabled = false;
    g.input.keys.clear();
    g.input.exitLock();
    g.hud.layer.classList.add('cine');
    g.hud.setPrompt('');
    g.explore.promptText = '';
    this.savedPaused = g.env.paused;
    g.env.paused = true;
    const C = g.cameraCtl;
    this.yaw = C.yaw;
    this.pitch = Math.max(0.05, C.pitch);
    this.dist = Math.min(6, C.curDist || 5);
    this.height = 0;
    this.el.querySelector('.ph-time').value = g.env.time;
    this.setFilter(this.filter);
    this.el.classList.remove('hidden');
    g.sfx.open();
  }

  close() {
    const g = this.g;
    if (!this.active) return;
    this.active = false;
    this.el.classList.add('hidden');
    g.hud.layer.classList.remove('cine');
    g.player.model.root.visible = true;
    this.el.querySelector('.ph-hide').textContent = '보이기';
    g.player.model.idleVar = null;
    g.env.paused = this.savedPaused;
    this.applyGrade(FILTERS[0]);
    g.state = 'playing';
    g.input.enabled = true;
    g.input.requestLock();
    g.cameraCtl.yaw = this.yaw;
    g.clock.getDelta();
    g.sfx.close();
  }

  setFilter(i) {
    this.filter = i;
    this.el.querySelectorAll('.ph-filters button').forEach((b) => b.classList.toggle('on', +b.dataset.f === i));
    this.applyGrade(FILTERS[i]);
  }

  applyGrade(f) {
    const u = this.g.rendererW.grade.uniforms;
    u.uSaturation.value = f.sat;
    u.uContrast.value = f.con;
    u.uLift.value.set(...f.lift);
    u.uGain.value.set(...f.gain);
  }

  nextPose() {
    this.pose = (this.pose + 1) % POSES.length;
    const m = this.g.player.model;
    const k = POSES[this.pose];
    this.el.querySelector('.ph-pose').textContent = ['기본', '두리번', '기지개', '짝다리', '발장난'][this.pose];
    m.idleVar = k ? { k, t: 0, dur: 4 } : null;
  }

  shoot() {
    const g = this.g;
    // render a clean frame and grab it straight away
    g.rendererW.render();
    let url = '';
    try {
      url = g.renderer.domElement.toDataURL('image/png');
    } catch (e) {}
    const fl = this.el.querySelector('.ph-flash');
    fl.classList.remove('go');
    void fl.offsetWidth;
    fl.classList.add('go');
    g.sfx.shutter();
    if (!url) return;
    const a = this.el.querySelector('.ph-last');
    a.href = url;
    a.querySelector('img').src = url;
    a.classList.remove('hidden');
    g.achievements.add('photos');
    try {
      const dl = document.createElement('a');
      dl.href = url;
      dl.download = `starwind-${Date.now()}.png`;
      document.body.appendChild(dl);
      dl.click();
      dl.remove();
    } catch (e) {}
  }

  update(dt) {
    const g = this.g;
    const P = g.player;
    const m = P.model;
    m.root.position.copy(P.pos);
    // hold the chosen pose at its peak
    if (POSES[this.pose]) {
      if (!m.idleVar) m.idleVar = { k: POSES[this.pose], t: 0, dur: 4 };
      m.idleVar.t = Math.min(m.idleVar.t, 1.8);
    }
    m.update(dt, { mode: 'idle', speed: 0 });
    const cp = Math.cos(this.pitch);
    const tx = P.pos.x,
      ty = P.pos.y + 1.3 + this.height,
      tz = P.pos.z;
    const cam = g.camera;
    cam.position.set(tx + Math.sin(this.yaw) * cp * this.dist, ty + Math.sin(this.pitch) * this.dist, tz + Math.cos(this.yaw) * cp * this.dist);
    const gh = g.ground.heightAt(cam.position.x, cam.position.z) + 0.25;
    if (cam.position.y < gh) cam.position.y = gh;
    cam.lookAt(tx, ty, tz);
  }
}
