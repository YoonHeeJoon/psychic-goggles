import * as THREE from 'three';
import { HALF, WORLD_SIZE, RES, CELL, LANDMARKS, SPAWN, HIGHLAND, BRIDGE, CAMPS, PORT_LEN, portWorld } from '../world/Terrain.js';

const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

const LABELS = [
  { text: '바람의 초원', x: SPAWN.x, z: SPAWN.z + 18, size: 1 },
  { text: '거울 호수', x: LANDMARKS.lake.x, z: LANDMARKS.lake.z, size: 1 },
  { text: '별빛 설산', x: LANDMARKS.mountain.x, z: LANDMARKS.mountain.z + 30, size: 1.35 },
  { text: '천년나무 언덕', x: LANDMARKS.giantTree.x - 8, z: LANDMARKS.giantTree.z - 24, size: 0.9 },
  { text: '수호상의 언덕', x: LANDMARKS.statue.x + 10, z: LANDMARKS.statue.z - 18, size: 0.85 },
  { text: '풍차 마을', x: LANDMARKS.village.x, z: LANDMARKS.village.z + 52, size: 1 },
  { text: '잊힌 유적', x: LANDMARKS.ruins.x, z: LANDMARKS.ruins.z + 32, size: 0.9 },
  { text: '속삭이는 숲', x: -260, z: -20, size: 0.85 },
  { text: '은빛 해안', x: 30, z: 360, size: 0.85 },
  { text: '별바람 평원', x: 210, z: -10, size: 0.9 },
  { text: '뇌광의 결전장', x: LANDMARKS.arena.x - 6, z: LANDMARKS.arena.z + 40, size: 0.85 },
  { text: '바람 그림자 회랑', x: LANDMARKS.domain.x, z: LANDMARKS.domain.z - 18, size: 0.75 },
  { text: '단풍 고원', x: HIGHLAND.x + 10, z: HIGHLAND.z - 8, size: 1.2 },
  { text: '단풍 항구', x: portWorld(PORT_LEN + 4, 26)[0], z: portWorld(PORT_LEN + 4, 26)[1], size: 0.9 },
  { text: '바람다리', x: (BRIDGE.ax + BRIDGE.bx) / 2, z: BRIDGE.az - 14, size: 0.75 },
  { text: CAMPS[0].name, x: CAMPS[0].x, z: CAMPS[0].z - 18, size: 0.7 },
  { text: CAMPS[1].name, x: CAMPS[1].x, z: CAMPS[1].z - 18, size: 0.7 },
];

export class WorldMap {
  constructor(root, game) {
    this.g = game;
    this.el = el(
      'div',
      'worldmap hidden',
      `<canvas class="wm-canvas"></canvas>
       <div class="wm-top">
         <div class="wm-title"><span class="wm-sub">STARWIND</span><span>별바람 군도</span></div>
         <div class="wm-stats"></div>
       </div>
       <div class="wm-panel hidden">
         <div class="wm-p-kind">순간이동 포인트</div>
         <div class="wm-p-name"></div>
         <div class="wm-p-desc"></div>
         <button class="wm-tp">순간이동</button>
       </div>
       <button class="wm-close" aria-label="지도 닫기">✕</button>
       <div class="wm-hint">드래그 이동 · 휠 확대 · 순간이동 포인트 클릭 · <b>M</b> 닫기</div>`
    );
    root.appendChild(this.el);
    this.canvas = this.el.querySelector('.wm-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.panel = this.el.querySelector('.wm-panel');
    this.view = { cx: 0, cz: 0, scale: 1 };
    this.selected = null;
    this.isOpen = false;
    this.bind();
  }

  bind() {
    const c = this.canvas;
    let drag = null;
    c.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, cx: this.view.cx, cz: this.view.cz, moved: 0 };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (drag) {
        const dx = e.clientX - drag.x,
          dy = e.clientY - drag.y;
        drag.moved = Math.max(drag.moved, Math.abs(dx) + Math.abs(dy));
        this.view.cx = drag.cx - dx / this.view.scale;
        this.view.cz = drag.cz - dy / this.view.scale;
        this.clampView();
        this.draw();
      } else {
        const hov = this.pick(e.clientX, e.clientY);
        if (hov !== this.hover) {
          this.hover = hov;
          c.style.cursor = hov ? 'pointer' : 'grab';
          this.draw();
        }
      }
    });
    c.addEventListener('pointerup', (e) => {
      if (drag && drag.moved < 6) {
        const wp = this.pick(e.clientX, e.clientY);
        this.select(wp);
      }
      drag = null;
    });
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const k = Math.exp(-Math.sign(e.deltaY) * 0.18);
        const before = this.toWorld(e.clientX, e.clientY);
        this.view.scale = THREE.MathUtils.clamp(this.view.scale * k, this.minScale(), 7);
        const after = this.toWorld(e.clientX, e.clientY);
        this.view.cx += before.x - after.x;
        this.view.cz += before.z - after.z;
        this.clampView();
        this.draw();
      },
      { passive: false }
    );
    this.el.querySelector('.wm-close').addEventListener('click', () => this.g.closeMap());
    this.el.querySelector('.wm-tp').addEventListener('click', () => {
      if (this.selected && this.selected.active) this.g.teleport(this.selected);
    });
    window.addEventListener('resize', () => this.isOpen && this.resize());
  }

  minScale() {
    return Math.min(window.innerWidth, window.innerHeight) / (WORLD_SIZE * 0.95);
  }
  clampView() {
    const m = HALF * 0.9;
    this.view.cx = THREE.MathUtils.clamp(this.view.cx, -m, m);
    this.view.cz = THREE.MathUtils.clamp(this.view.cz, -m, m);
  }
  toScreen(x, z) {
    return { x: window.innerWidth / 2 + (x - this.view.cx) * this.view.scale, y: window.innerHeight / 2 + (z - this.view.cz) * this.view.scale };
  }
  toWorld(sx, sy) {
    return { x: this.view.cx + (sx - window.innerWidth / 2) / this.view.scale, z: this.view.cz + (sy - window.innerHeight / 2) / this.view.scale };
  }
  pick(sx, sy) {
    let best = null,
      bd = 18;
    for (const wp of this.g.structures.waypoints) {
      const p = this.toScreen(wp.x, wp.z);
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d < bd) {
        bd = d;
        best = wp;
      }
    }
    return best;
  }

  select(wp) {
    this.selected = wp;
    if (!wp) {
      this.panel.classList.add('hidden');
    } else {
      this.panel.classList.remove('hidden');
      this.panel.querySelector('.wm-p-name').textContent = wp.name;
      this.panel.querySelector('.wm-p-desc').textContent = wp.active ? '바람의 길이 이어진 곳. 언제든 이곳으로 이동할 수 있습니다.' : '아직 활성화되지 않았습니다. 직접 찾아가 활성화하세요.';
      const b = this.panel.querySelector('.wm-tp');
      b.disabled = !wp.active;
      b.textContent = wp.active ? '순간이동' : '미활성화';
    }
    this.draw();
  }

  open(focus) {
    if (!this.art) this.buildArt();
    this.isOpen = true;
    this.el.classList.remove('hidden');
    this.resize();
    const P = this.g.player;
    if (!this.opened) this.view.scale = this.minScale() * 2.2;
    this.opened = true;
    this.view.cx = (focus || P.pos).x;
    this.view.cz = (focus || P.pos).z;
    this.clampView();
    this.select(focus && focus.id ? focus : null);
    const s = this.g.explore.stats();
    this.el.querySelector('.wm-stats').innerHTML = `
      <div><i class="ic wp"></i>순간이동 포인트 <b>${s.wp}</b>/${s.wpTotal}</div>
      <div><i class="ic eye"></i>별바람의 눈 <b>${s.orbs}</b>/${s.orbTotal}</div>
      <div><i class="ic chest"></i>보물상자 <b>${s.chests}</b>/${s.chestTotal}</div>
      <div><i class="ic bless"></i>바람의 가호 <b>Lv.${s.blessing}</b>${s.held ? ` · 바칠 수 있는 눈 ${s.held}` : ''}</div>`;
    this.draw();
  }

  close() {
    this.isOpen = false;
    this.el.classList.add('hidden');
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.canvas.width = Math.round(window.innerWidth * dpr);
    this.canvas.height = Math.round(window.innerHeight * dpr);
    this.view.scale = Math.max(this.view.scale, this.minScale());
    this.draw();
  }

  // Painted map image: hillshaded terrain colours, contour lines, shoreline
  // foam and depth-tinted sea, roads and village rooftops.
  buildArt() {
    const T = this.g.terrain;
    const N = 1024;
    const cv = document.createElement('canvas');
    cv.width = cv.height = N;
    const g = cv.getContext('2d');
    const img = g.createImageData(N, N);
    const H = T.heights,
      C = T.colors;
    const S = WORLD_SIZE / N;
    const c = new THREE.Color();
    const paper = new THREE.Color('#efe6cf');
    const sample = (arr, gx, gz, stride, o) => {
      const i = Math.min(RES - 2, Math.floor(gx)),
        j = Math.min(RES - 2, Math.floor(gz));
      const fx = gx - i,
        fz = gz - j;
      const a = arr[(j * RES + i) * stride + o],
        b = arr[(j * RES + i + 1) * stride + o];
      const cc = arr[((j + 1) * RES + i) * stride + o],
        d = arr[((j + 1) * RES + i + 1) * stride + o];
      return (a + (b - a) * fx) * (1 - fz) + (cc + (d - cc) * fx) * fz;
    };
    for (let py = 0; py < N; py++) {
      const gz = ((py + 0.5) * S) / CELL;
      for (let px = 0; px < N; px++) {
        const gx = ((px + 0.5) * S) / CELL;
        const h = sample(H, gx, gz, 1, 0);
        const hx = sample(H, Math.min(gx + 1, RES - 1.01), gz, 1, 0) - sample(H, Math.max(gx - 1, 0), gz, 1, 0);
        const hz = sample(H, gx, Math.min(gz + 1, RES - 1.01), 1, 0) - sample(H, gx, Math.max(gz - 1, 0), 1, 0);
        const o = (py * N + px) * 4;
        if (h < 0) {
          const d = Math.min(1, -h / 16);
          c.setRGB(0.36, 0.7, 0.78).lerp(new THREE.Color(0.07, 0.25, 0.42), Math.pow(d, 0.7));
          if (h > -0.9) c.lerp(new THREE.Color(0.92, 0.97, 0.98), 0.75 * (1 - -h / 0.9));
          const wave = Math.sin((px + py * 0.35) * 0.22 + Math.sin(py * 0.05) * 3) > 0.96 ? 0.04 : 0;
          c.offsetHSL(0, 0, wave);
        } else {
          c.setRGB(sample(C, gx, gz, 3, 0), sample(C, gx, gz, 3, 1), sample(C, gx, gz, 3, 2));
          c.lerp(paper, 0.18 + Math.min(0.25, h / 400));
          const slope = Math.hypot(hx, hz) / (2 * CELL);
          if (slope > 1.1) c.lerp(new THREE.Color(0.47, 0.43, 0.38), Math.min(0.6, (slope - 1.1) * 0.6));
          if (h > 130) c.lerp(new THREE.Color(0.93, 0.95, 0.98), Math.min(0.85, (h - 130) / 30));
          // hillshade from the north-west
          const shade = 1 + (-hx * 0.7 - hz * 0.7) * 0.06;
          c.multiplyScalar(Math.max(0.55, Math.min(1.35, shade)));
          // contour lines every 20 m
          const band = h / 20;
          const fr = band - Math.floor(band);
          if (h > 4 && (fr < 0.035 || fr > 0.965) && slope < 2.2) c.multiplyScalar(0.88);
          if (h < 0.6) c.lerp(new THREE.Color(0.95, 0.9, 0.75), 0.5);
        }
        c.convertLinearToSRGB();
        img.data[o] = Math.min(255, c.r * 255);
        img.data[o + 1] = Math.min(255, c.g * 255);
        img.data[o + 2] = Math.min(255, c.b * 255);
        img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    const toPx = (x, z) => [((x + HALF) / WORLD_SIZE) * N, ((z + HALF) / WORLD_SIZE) * N];
    // roads
    g.lineCap = g.lineJoin = 'round';
    for (const [w, col] of [
      [5, 'rgba(110,84,52,0.35)'],
      [2.6, 'rgba(250,236,200,0.9)'],
    ]) {
      g.strokeStyle = col;
      g.lineWidth = w;
      for (const poly of T.paths) {
        g.beginPath();
        poly.forEach(([x, z], i) => {
          const [px, py] = toPx(x, z);
          if (i === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        });
        g.stroke();
      }
    }
    // rooftops
    const S2 = this.g.structures;
    for (const h of S2.houses) {
      const [px, py] = toPx(h.x, h.z);
      g.save();
      g.translate(px, py);
      g.rotate(-h.rot);
      g.fillStyle = 'rgba(70,40,30,0.45)';
      g.fillRect(-h.w / 2 - 0.5, -h.d / 2 + 0.5, h.w + 1, h.d + 1);
      g.fillStyle = '#c86a4e';
      g.fillRect(-h.w / 2 - 0.5, -h.d / 2 - 0.5, h.w + 1, h.d + 1);
      g.fillStyle = 'rgba(255,255,255,0.3)';
      g.fillRect(-h.w / 2 - 0.5, -0.4, h.w + 1, 0.8);
      g.restore();
    }
    for (const w of S2.windmills) {
      const [px, py] = toPx(w.x, w.z);
      g.fillStyle = '#f3ecdc';
      g.strokeStyle = '#6a4a34';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(px, py, 3.2, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    {
      const R = LANDMARKS.ruins;
      const [px, py] = toPx(R.x, R.z);
      g.save();
      g.translate(px, py);
      g.rotate(-S2.ruins.rot);
      g.fillStyle = 'rgba(214,206,186,0.9)';
      g.fillRect(-7, -7, 14, 14);
      g.strokeStyle = 'rgba(90,80,60,0.6)';
      g.strokeRect(-7, -7, 14, 14);
      g.restore();
      g.strokeStyle = 'rgba(200,190,170,0.9)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(px, py, 10.5, 0, Math.PI * 2);
      g.stroke();
    }
    this.art = cv;
  }

  draw() {
    if (!this.isOpen) return;
    const g = this.ctx;
    const dpr = this.dpr || 1;
    const W = window.innerWidth,
      H = window.innerHeight;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // sea background
    const bg = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.8);
    bg.addColorStop(0, '#1f5a78');
    bg.addColorStop(1, '#0c2a42');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    const s = this.view.scale;
    const o = this.toScreen(-HALF, -HALF);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(this.art, o.x, o.y, WORLD_SIZE * s, WORLD_SIZE * s);

    // labels
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const ls = THREE.MathUtils.clamp(s / this.minScale(), 1, 3.2);
    for (const L of LABELS) {
      const p = this.toScreen(L.x, L.z);
      const fs = Math.round(13 * L.size * Math.sqrt(ls));
      g.font = `700 ${fs}px "Noto Serif KR", serif`;
      g.lineWidth = 4;
      g.strokeStyle = 'rgba(40,32,24,0.55)';
      g.strokeText(L.text, p.x, p.y);
      g.fillStyle = '#fbf3df';
      g.fillText(L.text, p.x, p.y);
    }

    // statue
    const st = this.g.structures.statue.center;
    this.drawStatue(g, this.toScreen(st.x, st.z));
    // waypoints
    for (const wp of this.g.structures.waypoints) this.drawWaypoint(g, this.toScreen(wp.x, wp.z), wp);

    // player
    const P = this.g.player;
    const pp = this.toScreen(P.pos.x, P.pos.z);
    g.save();
    g.translate(pp.x, pp.y);
    g.rotate(-this.g.cameraCtl.yaw + Math.PI);
    const cone = g.createRadialGradient(0, 0, 0, 0, 0, 60);
    cone.addColorStop(0, 'rgba(255,255,255,0.4)');
    cone.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = cone;
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, 60, Math.PI / 2 - 0.5, Math.PI / 2 + 0.5);
    g.closePath();
    g.fill();
    g.restore();
    g.save();
    g.translate(pp.x, pp.y);
    g.rotate(-P.yaw);
    g.fillStyle = '#ffe9a8';
    g.strokeStyle = '#5a3d10';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, 12);
    g.lineTo(8.5, -8);
    g.lineTo(0, -3.5);
    g.lineTo(-8.5, -8);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();

    // vignette
    const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(5,12,24,0.55)');
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);
  }

  drawWaypoint(g, p, wp) {
    const sel = this.selected === wp || this.hover === wp;
    const r = sel ? 13 : 10;
    g.save();
    g.translate(p.x, p.y);
    if (wp.active) {
      const glow = g.createRadialGradient(0, 0, 0, 0, 0, r * 2.2);
      glow.addColorStop(0, 'rgba(120,245,220,0.55)');
      glow.addColorStop(1, 'rgba(120,245,220,0)');
      g.fillStyle = glow;
      g.beginPath();
      g.arc(0, 0, r * 2.2, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = 'rgba(20,30,40,0.75)';
    g.strokeStyle = wp.active ? '#f3d58a' : '#9aa3ad';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = wp.active ? '#8ff7e0' : '#7d8894';
    g.beginPath();
    g.moveTo(0, -r * 0.7);
    g.lineTo(r * 0.42, 0);
    g.lineTo(0, r * 0.7);
    g.lineTo(-r * 0.42, 0);
    g.closePath();
    g.fill();
    if (sel) {
      g.strokeStyle = '#fff6d8';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(0, 0, r + 4, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
  }

  drawStatue(g, p) {
    g.save();
    g.translate(p.x, p.y);
    g.fillStyle = 'rgba(20,30,40,0.75)';
    g.strokeStyle = '#f3d58a';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(0, 0, 12, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = '#9ff0e0';
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(s * 1.5, 2);
      g.quadraticCurveTo(s * 9, -2, s * 8, -8);
      g.quadraticCurveTo(s * 5, -3, s * 1.5, -2);
      g.closePath();
      g.fill();
    }
    g.beginPath();
    g.arc(0, 3.5, 2.6, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
}
