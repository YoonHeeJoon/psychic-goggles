import * as THREE from 'three';
import { elementIcon } from './icons.js';
import { ELEMENTS } from '../character/characters.js';
import { PRESETS } from '../core/Renderer.js';
import { WEATHER_MODES } from '../world/Weather.js';
import { ACTIONS, keyLabel } from '../core/Input.js';
import { HALF, WORLD_SIZE, RES, SEA_LEVEL } from '../world/Terrain.js';
import { saveFile } from '../core/Files.js';
import { exportSave, importSave } from '../game/Save.js';

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
       <div class="pill keyhint" data-act="map"><b>M</b> 지도</div>
       <div class="pill keyhint" data-act="bag"><b>B</b> 가방</div>
       <div class="pill keyhint" data-act="char"><b>C</b> 캐릭터</div>
       <div class="pill keyhint" data-act="comm"><b>J</b> 의뢰</div>
       <div class="pill keyhint" data-act="menu"><b>Esc</b> 메뉴</div>`
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
      `<div><b>좌클릭</b> 공격 · <b>E</b> 원소 스킬 · <b>Q</b> 원소 폭발 · <b>공중 좌클릭</b> 낙하 공격</div>
       <div><b>WASD</b> 이동 · <b>Shift</b> 질주(회피) · <b>Space</b> 점프/활공 · <b>1-4</b> 교체 · <b>H</b> 도움말</div>
       <div><b>F</b> 대화·채집·상호작용 · <b>B</b> 가방 · <b>C</b> 캐릭터 · <b>M</b> 지도 · 상승 기류에 들어가면 하늘로 떠오릅니다</div>`
    );
    L.appendChild(this.help);

    this.fps = el('div', 'fps hidden', '');
    L.appendChild(this.fps);

    this.center = el('div', 'center-msg', '');
    L.appendChild(this.center);
    this.timer = el('div', 'challenge-timer hidden', '');
    L.appendChild(this.timer);
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

  // challenge timer at the top of the screen (null hides it)
  setTimer(text) {
    this.timer.classList.toggle('hidden', !text);
    if (text && this.timer.textContent !== text) this.timer.textContent = text;
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
    const now = performance.now() / 1000;
    for (const m of markers) {
      let x = W / 2 + (m.x - player.pos.x) * zoom;
      let y = W / 2 + (m.z - player.pos.z) * zoom;
      if (m.shape === 'quest' || m.shape === 'comm') {
        // quest target sticks to the rim when it is out of range
        const dx = x - W / 2,
          dy = y - W / 2;
        const l = Math.hypot(dx, dy);
        const R = W / 2 - 14;
        if (l > R) {
          x = W / 2 + (dx / l) * R;
          y = W / 2 + (dy / l) * R;
        }
        const s = 7 + Math.sin(now * 4) * 1.2;
        g.fillStyle = 'rgba(30,24,10,0.75)';
        g.beginPath();
        g.arc(x, y, s + 3, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = m.shape === 'comm' ? '#c9a8ff' : '#ffd56a';
        g.beginPath();
        g.moveTo(x, y - s);
        g.lineTo(x + s * 0.7, y);
        g.lineTo(x, y + s);
        g.lineTo(x - s * 0.7, y);
        g.closePath();
        g.fill();
        continue;
      }
      if (x < -12 || x > W + 12 || y < -12 || y > W + 12) continue;
      if (m.shape === 'wp') {
        g.fillStyle = 'rgba(20,30,40,0.8)';
        g.strokeStyle = m.active ? '#f3d58a' : '#9aa3ad';
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(x, y, 7, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.fillStyle = m.active ? '#8ff7e0' : '#7d8894';
        g.beginPath();
        g.moveTo(x, y - 5);
        g.lineTo(x + 3, y);
        g.lineTo(x, y + 5);
        g.lineTo(x - 3, y);
        g.closePath();
        g.fill();
      } else if (m.shape === 'statue') {
        g.fillStyle = 'rgba(20,30,40,0.8)';
        g.strokeStyle = '#f3d58a';
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(x, y, 8, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.fillStyle = '#9ff0e0';
        for (const s of [-1, 1]) {
          g.beginPath();
          g.moveTo(x + s, y + 1.5);
          g.quadraticCurveTo(x + s * 6, y - 1.5, x + s * 5.5, y - 5.5);
          g.quadraticCurveTo(x + s * 3.5, y - 2, x + s, y - 1.5);
          g.closePath();
          g.fill();
        }
        g.beginPath();
        g.arc(x, y + 2.5, 1.8, 0, Math.PI * 2);
        g.fill();
      } else {
        const r = (m.r || 4) * (m.pulse ? 1 + 0.35 * Math.sin(now * 5) : 1);
        if (m.pulse) {
          g.fillStyle = 'rgba(127,245,220,0.25)';
          g.beginPath();
          g.arc(x, y, r * 2.2, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = m.color || '#ffd56a';
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      }
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
          <div><b>WASD</b> 이동</div><div><b>Shift</b> 질주 · 회피</div><div><b>Space</b> 점프 · 공중에서 활공</div><div><b>절벽으로 이동</b> 등반</div>
          <div><b>좌클릭</b> 일반 공격</div><div><b>E</b> 원소 스킬</div><div><b>Q</b> 원소 폭발</div><div><b>1-4</b> 캐릭터 교체</div>
          <div><b>F</b> 대화 · 채집</div><div><b>M</b> 지도 · 순간이동</div><div><b>B</b> 가방 · <b>C</b> 캐릭터</div><div><b>L</b> 업적 · <b>P</b> 사진</div>
        </div>
        <div class="touch-controls"><b>왼쪽</b> 끌어서 이동 · <b>오른쪽</b> 끌어서 시점 · 버튼으로 공격 · 스킬 · 점프 · 질주<br>초상화를 눌러 캐릭터 교체 · 활공 중 공격 버튼으로 낙하 공격</div>
      </div>
      <div class="title-foot">Three.js로 만든 오리지널 오픈월드 · 모든 캐릭터와 지역은 창작물입니다</div>`
    );
    root.appendChild(this.title);
    this.pause = el(
      'div',
      'pause hidden',
      `<div class="pause-panel">
        <h2>설정</h2>
        <label>그래픽 품질 <select class="sel-q" id="sel-q">${Object.entries(PRESETS)
          .map(([k, v]) => `<option value="${k}">${v.label}</option>`)
          .join('')}</select><small>풀 밀도·그림자·해상도가 바로 바뀝니다</small></label>
        <label>마우스 감도 <input type="range" class="sens" id="opt-sens" min="0.3" max="2.5" step="0.05" value="1"></label>
        <label>소리 크기 <input type="range" class="vol" id="opt-vol" min="0" max="1" step="0.05" value="0.8"></label>
        <label>음악 크기 <input type="range" class="mvol" id="opt-mvol" min="0" max="1" step="0.05" value="0.55"></label>
        <label class="row"><input type="checkbox" class="mute" id="opt-mute"> 소리 끄기</label>
        <label>시간 <input type="range" class="tod" id="opt-tod" min="0" max="24" step="0.05" value="9"></label>
        <label>시간 흐름 <select class="tspeed" id="opt-tspeed"><option value="0">멈춤</option><option value="1" selected>보통 (하루 24분)</option><option value="6">빠름</option><option value="30">매우 빠름</option></select></label>
        <label>날씨 <select class="weather" id="opt-weather">${Object.entries(WEATHER_MODES)
          .map(([k, v]) => `<option value="${k}">${v}</option>`)
          .join('')}</select></label>
        <label class="row"><input type="checkbox" class="inv" id="opt-inv"> 상하 반전</label>
        <label class="row"><input type="checkbox" class="autores" id="opt-autores"> 자동 해상도 (프레임 유지)</label>
        <label class="row"><input type="checkbox" class="showfps" id="opt-showfps"> FPS 표시</label>
        <div class="pm-row"><button class="pm-btn pm-log">모험 기록</button><button class="pm-btn pm-photo">사진 모드</button></div>
        <div class="pm-row"><button class="pm-btn pm-export">저장 내보내기</button><button class="pm-btn pm-import">저장 불러오기</button><input type="file" class="pm-file" accept=".json,application/json" hidden></div>
        <details class="keys"><summary>조작 키 설정</summary><div class="key-list"></div><button class="pm-btn key-reset">기본값으로</button></details>
        <button class="resume">계속하기</button>
      </div>`
    );
    root.appendChild(this.pause);
    this.bind();
  }

  bind() {
    const g = this.game;
    const cur = g.qualityKey;
    const qBtns = this.title.querySelectorAll('.q-btn');
    const mark = () => qBtns.forEach((b) => b.classList.toggle('on', b.dataset.q === g.qualityKey));
    mark();
    qBtns.forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        g.setQuality(b.dataset.q);
        mark();
        this.pause.querySelector('.sel-q').value = g.qualityKey;
      });
    });
    this.title.querySelector('.start-btn').addEventListener('click', () => g.start());
    const P = this.pause;
    P.querySelector('.sel-q').value = cur;
    P.querySelector('.sel-q').addEventListener('change', (e) => {
      g.setQuality(e.target.value);
      mark();
    });
    P.querySelector('.sens').addEventListener('input', (e) => (g.cameraCtl.sensitivity = +e.target.value));
    const vol = P.querySelector('.vol'),
      mute = P.querySelector('.mute');
    vol.value = g.sfx.volume;
    mute.checked = g.sfx.muted;
    vol.addEventListener('input', (e) => g.sfx.setVolume(+e.target.value));
    mute.addEventListener('change', (e) => g.sfx.setMuted(e.target.checked));
    const mv = P.querySelector('.mvol');
    mv.value = g.music.volume;
    mv.addEventListener('input', (e) => g.music.setVolume(+e.target.value));
    P.querySelector('.tod').addEventListener('input', (e) => (g.env.time = +e.target.value));
    P.querySelector('.tspeed').addEventListener('change', (e) => (g.env.timeScale = +e.target.value / 60));
    P.querySelector('.weather').addEventListener('change', (e) => g.weather.setMode(e.target.value));
    P.querySelector('.inv').addEventListener('change', (e) => (g.cameraCtl.invertY = e.target.checked));
    const ar = P.querySelector('.autores');
    ar.checked = g.autoRes;
    ar.addEventListener('change', (e) => g.setAutoRes(e.target.checked));
    P.querySelector('.showfps').addEventListener('change', (e) => g.hud.fps.classList.toggle('hidden', !e.target.checked));
    P.querySelector('.resume').addEventListener('click', () => g.resume());
    P.querySelector('.pm-log').addEventListener('click', () => {
      g.resume();
      g.openPanel(g.achievements);
    });
    P.querySelector('.pm-photo').addEventListener('click', () => {
      g.resume();
      g.photo.open();
    });
    // portable saves: export as JSON, import (validated) and restart
    P.querySelector('.pm-export').addEventListener('click', async () => {
      g.explore.save();
      const d = new Date();
      const name = `starwind-save-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
      const r = await saveFile(name, exportSave(g.explore.progress));
      if (r === 'saved') g.hud.toast('저장 파일을 내보냈습니다', '#9fe8ff');
      else if (r === 'unavailable') g.hud.toast('이 화면에서는 파일을 저장할 수 없습니다', '#ffd36a');
    });
    const file = P.querySelector('.pm-file');
    P.querySelector('.pm-import').addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      file.value = '';
      if (!f) return;
      const err = importSave(await f.text());
      if (err) {
        g.hud.toast(err, '#ff8a7a');
        return;
      }
      g.loadedFromFile = true;
      g.hud.toast('저장을 불러왔습니다 · 다시 시작합니다', '#9fe8ff');
      setTimeout(() => {
        const u = new URL(location.href);
        u.searchParams.delete('fresh');
        location.replace(u.toString());
      }, 900);
    });
    P.querySelector('.key-reset').addEventListener('click', () => {
      g.input.resetBinds();
      this.renderKeys();
    });
    this.renderKeys();
  }

  renderKeys() {
    const input = this.game.input;
    const list = this.pause.querySelector('.key-list');
    list.innerHTML = ACTIONS.map(([id, label]) => `<div class="key-row"><span>${label}</span><button data-a="${id}">${keyLabel(input.binds[id])}</button></div>`).join('');
    list.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => {
        b.textContent = '키를 누르세요…';
        b.classList.add('wait');
        input.capture = true;
        const onKey = (e) => {
          e.preventDefault();
          e.stopPropagation();
          window.removeEventListener('keydown', onKey, true);
          input.capture = false;
          if (e.code !== 'Escape') input.bind(b.dataset.a, e.code);
          this.renderKeys();
        };
        window.addEventListener('keydown', onKey, true);
      })
    );
  }

  showPause() {
    this.pause.querySelector('.tod').value = this.game.env.time;
    this.pause.querySelector('.weather').value = this.game.weather.mode;
    this.pause.classList.remove('hidden');
  }
  hidePause() {
    this.pause.classList.add('hidden');
  }
  hideTitle() {
    this.title.classList.add('gone');
  }
}
