import * as THREE from 'three';
import { elementIcon } from './icons.js';
import { ELEMENTS } from '../character/characters.js';
import { PRESETS } from '../core/Renderer.js';
import { HALF, WORLD_SIZE, RES, SEA_LEVEL } from '../world/Terrain.js';

const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

export class HUD {
  constructor(root) {
    this.root = root;
    this.layer = el('div', 'hud hidden');
    root.appendChild(this.layer);
    this.build();
    this.region = '';
    this.toasts = [];
  }

  // ---------------------------------------------------------------- loading
  static loading(root) {
    const wrap = el(
      'div',
      'loading',
      `<div class="load-inner">
        <div class="logo small"><span class="logo-main">STARWIND</span><span class="logo-sub">별바람 군도</span></div>
        <div class="load-bar"><div class="load-fill"></div></div>
        <div class="load-text">세계를 만드는 중...</div>
      </div>`
    );
    root.appendChild(wrap);
    return {
      set(p, text) {
        wrap.querySelector('.load-fill').style.width = `${Math.round(p * 100)}%`;
        if (text) wrap.querySelector('.load-text').textContent = text;
      },
      done() {
        wrap.classList.add('fade');
        setTimeout(() => wrap.remove(), 900);
      },
    };
  }

  build() {
    const L = this.layer;
    // minimap
    this.mini = el('div', 'minimap');
    this.miniCanvas = el('canvas');
    this.miniCanvas.width = this.miniCanvas.height = 200;
    this.mini.appendChild(this.miniCanvas);
    this.mini.appendChild(el('div', 'mini-n', 'N'));
    L.appendChild(this.mini);
    this.regionLabel = el('div', 'region-label', '');
    L.appendChild(this.regionLabel);

    // top right
    this.topRight = el(
      'div',
      'top-right',
      `<div class="pill time">${elementIcon('clock', '#fff', 16)}<span class="t">09:00</span></div>
       <div class="pill gems">${elementIcon('gem', '#9fe8ff', 16)}<span class="g">0</span></div>
       <div class="pill keyhint"><b>Esc</b> 메뉴</div>`
    );
    L.appendChild(this.topRight);

    // party
    this.partyEl = el('div', 'party');
    L.appendChild(this.partyEl);

    // hp
    this.hpWrap = el(
      'div',
      'hp-wrap',
      `<div class="hp-name"><span class="lv">Lv. 20</span><span class="nm"></span></div>
       <div class="hp-bar"><div class="hp-fill"></div><div class="hp-text"></div></div>`
    );
    L.appendChild(this.hpWrap);

    // skills
    this.skills = el(
      'div',
      'skills',
      `<div class="skill e"><div class="ic"></div><div class="cd"></div><div class="key">E</div></div>
       <div class="skill q"><svg class="ring" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" class="bg"/><circle cx="50" cy="50" r="46" class="fg"/></svg><div class="ic"></div><div class="cd"></div><div class="key">Q</div></div>
       <div class="skill atk"><div class="ic">${elementIcon('sword', '#fff', 26)}</div><div class="key">LMB</div></div>`
    );
    L.appendChild(this.skills);

    // stamina wheel
    this.stam = el(
      'div',
      'stamina',
      `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" class="bg"/><circle cx="50" cy="50" r="40" class="fg"/></svg>`
    );
    L.appendChild(this.stam);

    // interaction prompt
    this.prompt = el('div', 'prompt hidden', `<span class="k">F</span><span class="txt"></span>`);
    L.appendChild(this.prompt);

    // banners & toasts
    this.banner = el('div', 'banner', `<div class="b-line"></div><div class="b-text"></div><div class="b-line"></div>`);
    L.appendChild(this.banner);
    this.toastWrap = el('div', 'toasts');
    L.appendChild(this.toastWrap);

    // help
    this.help = el(
      'div',
      'help',
      `<div><b>WASD</b> 이동 · <b>Shift</b> 질주 · <b>Space</b> 점프/활공 · <b>마우스</b> 시점</div>
       <div><b>1-4</b> 캐릭터 교체 · <b>Ctrl</b> 걷기 · <b>X</b> 등반 중 손 놓기 · <b>휠</b> 줌 · <b>H</b> 도움말</div>`
    );
    L.appendChild(this.help);

    this.fps = el('div', 'fps hidden', '');
    L.appendChild(this.fps);

    this.center = el('div', 'center-msg', '');
    L.appendChild(this.center);
  }

  setParty(party, active) {
    this.partyEl.innerHTML = '';
    this.partyRows = party.map((p, i) => {
      const e = ELEMENTS[p.cfg.element];
      const row = el(
        'div',
        'member',
        `<div class="m-name">${p.cfg.name}</div>
         <div class="m-hp"><div class="m-hp-fill"></div></div>
         <div class="m-portrait" style="--el:${e.color}">
            <img alt="" />
            <div class="m-el">${elementIcon(e.icon, e.color, 14)}</div>
         </div>
         <div class="m-key">${i + 1}</div>`
      );
      if (p.portrait) row.querySelector('img').src = p.portrait;
      this.partyEl.appendChild(row);
      return row;
    });
    this.setActive(party, active);
  }

  setActive(party, active) {
    this.partyRows.forEach((r, i) => r.classList.toggle('active', i === active));
    const p = party[active];
    const e = ELEMENTS[p.cfg.element];
    this.hpWrap.querySelector('.nm').textContent = p.cfg.name;
    this.skills.querySelector('.e .ic').innerHTML = elementIcon(e.icon, e.color, 30);
    this.skills.querySelector('.q .ic').innerHTML = elementIcon(e.icon, '#fff', 38);
    this.skills.style.setProperty('--el', e.color);
  }

  update(s) {
    // hp
    const p = s.party[s.active];
    const hpP = Math.max(0, p.hp / p.maxHp);
    this.hpWrap.querySelector('.hp-fill').style.width = `${hpP * 100}%`;
    this.hpWrap.querySelector('.hp-text').textContent = `${Math.ceil(p.hp)} / ${p.maxHp}`;
    this.partyRows.forEach((r, i) => {
      const q = s.party[i];
      r.querySelector('.m-hp-fill').style.width = `${(q.hp / q.maxHp) * 100}%`;
      r.classList.toggle('cooling', s.switchCd > 0 && i !== s.active);
    });
    // skills
    const ecd = this.skills.querySelector('.e .cd');
    ecd.textContent = p.skillCd > 0 ? p.skillCd.toFixed(1) : '';
    this.skills.querySelector('.e').classList.toggle('cooling', p.skillCd > 0);
    const qEl = this.skills.querySelector('.q');
    const ratio = Math.min(1, p.energy / p.maxEnergy);
    qEl.querySelector('.fg').style.strokeDashoffset = `${289 * (1 - ratio)}`;
    qEl.classList.toggle('ready', ratio >= 1 && p.burstCd <= 0);
    qEl.querySelector('.cd').textContent = p.burstCd > 0 ? p.burstCd.toFixed(1) : '';

    // stamina wheel
    const sp = s.stamina / s.maxStamina;
    const show = sp < 0.999 || s.draining;
    this.stam.classList.toggle('show', show);
    this.stam.classList.toggle('low', sp < 0.25 || s.exhausted);
    this.stam.querySelector('.fg').style.strokeDashoffset = `${251 * (1 - sp)}`;
    if (s.staminaPos) {
      this.stam.style.transform = `translate(${s.staminaPos.x}px, ${s.staminaPos.y}px)`;
    }

    // clock
    const h = Math.floor(s.time),
      m = Math.floor((s.time - h) * 60);
    this.topRight.querySelector('.t').textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    this.topRight.querySelector('.g').textContent = s.gems ?? 0;

    if (s.region && s.region !== this.region) {
      this.region = s.region;
      this.regionLabel.textContent = s.region;
      this.showBanner(s.region);
    }
  }

  showBanner(text) {
    const b = this.banner;
    b.querySelector('.b-text').textContent = text;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
  }

  toast(html, color) {
    const t = el('div', 'toast', html);
    if (color) t.style.setProperty('--c', color);
    this.toastWrap.appendChild(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3200);
  }

  setPrompt(text) {
    if (!text) this.prompt.classList.add('hidden');
    else {
      this.prompt.classList.remove('hidden');
      this.prompt.querySelector('.txt').textContent = text;
    }
  }

  flashCenter(text, ms = 1500) {
    this.center.textContent = text;
    this.center.classList.add('show');
    clearTimeout(this._ct);
    this._ct = setTimeout(() => this.center.classList.remove('show'), ms);
  }

  show() {
    this.layer.classList.remove('hidden');
  }
  hide() {
    this.layer.classList.add('hidden');
  }

  // ---------------------------------------------------------------- minimap
  buildMapImage(terrain) {
    const S = RES - 1;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const g = cv.getContext('2d');
    const img = g.createImageData(S, S);
    const c = new THREE.Color();
    for (let j = 0; j < S; j++)
      for (let i = 0; i < S; i++) {
        const k = j * RES + i;
        const h = terrain.heights[k];
        const ny = terrain.normals[k * 3 + 1];
        const nx = terrain.normals[k * 3];
        c.setRGB(terrain.colors[k * 3], terrain.colors[k * 3 + 1], terrain.colors[k * 3 + 2]);
        if (ny < 0.7) c.lerp(new THREE.Color(0.25, 0.23, 0.21), 0.7);
        if (h > 132) c.lerp(new THREE.Color(0.85, 0.88, 0.94), 0.8);
        const shade = 0.75 + (nx * 0.6 + ny * 0.4) * 0.35;
        c.multiplyScalar(shade);
        if (h < SEA_LEVEL) {
          const d = Math.min(1, -h / 12);
          c.setRGB(0.25, 0.62, 0.72).lerp(new THREE.Color(0.05, 0.22, 0.42), d);
        }
        c.convertLinearToSRGB();
        const o = (j * S + i) * 4;
        img.data[o] = c.r * 255;
        img.data[o + 1] = c.g * 255;
        img.data[o + 2] = c.b * 255;
        img.data[o + 3] = 255;
      }
    g.putImageData(img, 0, 0);
    this.mapImage = cv;
    this.mapScale = S / WORLD_SIZE;
  }

  drawMinimap(player, camYaw, markers = []) {
    const g = this.miniCanvas.getContext('2d');
    const W = 200;
    g.clearRect(0, 0, W, W);
    g.save();
    g.beginPath();
    g.arc(W / 2, W / 2, W / 2 - 4, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#123a5a';
    g.fillRect(0, 0, W, W);
    const zoom = 1.9; // canvas px per world metre
    const mx = (player.pos.x + HALF) * this.mapScale;
    const mz = (player.pos.z + HALF) * this.mapScale;
    const k = zoom / this.mapScale;
    g.imageSmoothingEnabled = true;
    g.setTransform(k, 0, 0, k, W / 2 - mx * k, W / 2 - mz * k);
    g.drawImage(this.mapImage, 0, 0);
    g.setTransform(1, 0, 0, 1, 0, 0);
    // markers
    for (const m of markers) {
      const x = W / 2 + (m.x - player.pos.x) * zoom;
      const y = W / 2 + (m.z - player.pos.z) * zoom;
      g.fillStyle = m.color || '#ffd56a';
      g.beginPath();
      g.arc(x, y, m.r || 4, 0, Math.PI * 2);
      g.fill();
    }
    // view cone
    g.translate(W / 2, W / 2);
    g.rotate(-camYaw + Math.PI);
    const cone = g.createRadialGradient(0, 0, 0, 0, 0, 70);
    cone.addColorStop(0, 'rgba(255,255,255,0.35)');
    cone.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = cone;
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, 70, Math.PI / 2 - 0.5, Math.PI / 2 + 0.5);
    g.closePath();
    g.fill();
    g.restore();
    // player arrow
    g.save();
    g.translate(W / 2, W / 2);
    g.rotate(-player.yaw);
    g.fillStyle = '#ffe9a8';
    g.strokeStyle = '#5a3d10';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(0, 9);
    g.lineTo(6.5, -6);
    g.lineTo(0, -2.5);
    g.lineTo(-6.5, -6);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }
}

// ---------------------------------------------------------------------------
// Title + pause menus
// ---------------------------------------------------------------------------
export class Menus {
  constructor(root, game) {
    this.game = game;
    this.title = el(
      'div',
      'title-screen',
      `<div class="title-inner">
        <div class="logo"><span class="logo-main">STARWIND</span><span class="logo-sub">별 바 람 군 도</span></div>
        <div class="tagline">바람이 노래하는 섬, 그 끝없는 모험의 시작</div>
        <button class="start-btn">클릭하여 모험 시작</button>
        <div class="q-row"><span>그래픽 품질</span>${Object.entries(PRESETS)
          .map(([k, v]) => `<button data-q="${k}" class="q-btn">${v.label}</button>`)
          .join('')}</div>
        <div class="controls">
          <div><b>WASD</b> 이동</div><div><b>Shift</b> 질주</div><div><b>Space</b> 점프 · 공중에서 활공</div>
          <div><b>마우스</b> 시점 회전</div><div><b>휠</b> 줌</div><div><b>1-4</b> 캐릭터 교체</div>
          <div><b>절벽으로 이동</b> 등반</div><div><b>Esc</b> 메뉴</div>
        </div>
      </div>
      <div class="title-foot">Three.js로 만든 오리지널 오픈월드 · 모든 캐릭터와 지역은 창작물입니다</div>`
    );
    root.appendChild(this.title);
    this.pause = el(
      'div',
      'pause hidden',
      `<div class="pause-panel">
        <h2>설정</h2>
        <label>그래픽 품질 <select class="sel-q">${Object.entries(PRESETS)
          .map(([k, v]) => `<option value="${k}">${v.label}</option>`)
          .join('')}</select><small>변경 시 다시 불러옵니다</small></label>
        <label>마우스 감도 <input type="range" class="sens" min="0.3" max="2.5" step="0.05" value="1"></label>
        <label>시간 <input type="range" class="tod" min="0" max="24" step="0.05" value="9"></label>
        <label>시간 흐름 <select class="tspeed"><option value="0">멈춤</option><option value="1" selected>보통 (하루 24분)</option><option value="6">빠름</option><option value="30">매우 빠름</option></select></label>
        <label class="row"><input type="checkbox" class="inv"> 상하 반전</label>
        <label class="row"><input type="checkbox" class="showfps"> FPS 표시</label>
        <button class="resume">계속하기</button>
      </div>`
    );
    root.appendChild(this.pause);
    this.bind();
  }

  bind() {
    const g = this.game;
    const cur = g.qualityKey;
    this.title.querySelectorAll('.q-btn').forEach((b) => {
      b.classList.toggle('on', b.dataset.q === cur);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (b.dataset.q === cur) return;
        try {
          localStorage.setItem('starwind.quality', b.dataset.q);
        } catch (err) {}
        const u = new URL(location.href);
        u.searchParams.set('q', b.dataset.q);
        location.href = u.toString();
      });
    });
    this.title.querySelector('.start-btn').addEventListener('click', () => g.start());
    const P = this.pause;
    P.querySelector('.sel-q').value = cur;
    P.querySelector('.sel-q').addEventListener('change', (e) => {
      try {
        localStorage.setItem('starwind.quality', e.target.value);
      } catch (err) {}
      const u = new URL(location.href);
      u.searchParams.set('q', e.target.value);
      location.href = u.toString();
    });
    P.querySelector('.sens').addEventListener('input', (e) => (g.cameraCtl.sensitivity = +e.target.value));
    P.querySelector('.tod').addEventListener('input', (e) => (g.env.time = +e.target.value));
    P.querySelector('.tspeed').addEventListener('change', (e) => (g.env.timeScale = +e.target.value / 60));
    P.querySelector('.inv').addEventListener('change', (e) => (g.cameraCtl.invertY = e.target.checked));
    P.querySelector('.showfps').addEventListener('change', (e) => g.hud.fps.classList.toggle('hidden', !e.target.checked));
    P.querySelector('.resume').addEventListener('click', () => g.resume());
  }

  showPause() {
    this.pause.querySelector('.tod').value = this.game.env.time;
    this.pause.classList.remove('hidden');
  }
  hidePause() {
    this.pause.classList.add('hidden');
  }
  hideTitle() {
    this.title.classList.add('gone');
  }
}
