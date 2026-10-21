import * as THREE from 'three';
import { elementIcon } from './icons.js';

const _p = new THREE.Vector3();

// Screen-space overlays that follow world positions: damage numbers,
// reaction labels and enemy HP bars.
export class WorldUI {
  constructor(root, camera) {
    this.camera = camera;
    this.layer = document.createElement('div');
    this.layer.className = 'world-ui';
    root.appendChild(this.layer);
    this.texts = [];
    this.bars = new Map();
  }

  project(pos) {
    _p.copy(pos).project(this.camera);
    if (_p.z > 1 || _p.z < -1) return null;
    return { x: (_p.x * 0.5 + 0.5) * window.innerWidth, y: (-_p.y * 0.5 + 0.5) * window.innerHeight };
  }

  text(pos, str, color = '#fff', opts = {}) {
    const el = document.createElement('div');
    el.className = 'dmg' + (opts.crit ? ' crit' : '') + (opts.reaction ? ' reaction' : '') + (opts.small ? ' small' : '');
    el.textContent = str;
    el.style.setProperty('--c', color);
    this.layer.appendChild(el);
    const jitter = opts.reaction ? 0 : (Math.random() - 0.5) * 0.6;
    this.texts.push({
      el,
      pos: pos.clone().add(new THREE.Vector3(jitter, opts.reaction ? 0.45 : Math.random() * 0.3, jitter)),
      t: 0,
      life: opts.reaction ? 1.2 : 0.95,
      rise: opts.reaction ? 0.5 : 1.1,
    });
  }

  bar(enemy) {
    let b = this.bars.get(enemy);
    if (!b) {
      const el = document.createElement('div');
      el.className = 'ebar';
      el.innerHTML = `<div class="aura"></div><div class="lv">Lv.${enemy.level}</div><div class="track"><div class="fill"></div><div class="ghost"></div></div>`;
      this.layer.appendChild(el);
      b = { el, fill: el.querySelector('.fill'), ghost: el.querySelector('.ghost'), aura: el.querySelector('.aura'), ghostP: 1, auraKey: '' };
      this.bars.set(enemy, b);
    }
    return b;
  }

  update(dt, enemies, player) {
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.t += dt;
      const k = t.t / t.life;
      if (k >= 1) {
        t.el.remove();
        this.texts.splice(i, 1);
        continue;
      }
      _p.copy(t.pos);
      _p.y += t.rise * (1 - Math.pow(1 - k, 2));
      const s = this.project(_p);
      if (!s) {
        t.el.style.opacity = 0;
        continue;
      }
      const pop = k < 0.12 ? 1.35 - k * 2.9 : 1;
      t.el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -50%) scale(${pop})`;
      t.el.style.opacity = k > 0.7 ? (1 - k) / 0.3 : 1;
    }

    for (const e of enemies) {
      if (e.isBoss) continue; // the boss has its own bar at the top of the screen
      const b = this.bars.get(e);
      const dist = Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z);
      const show = e.alive && (e.aggro || e.hp < e.maxHp) && dist < 40;
      if (!show) {
        if (b) b.el.style.display = 'none';
        continue;
      }
      const bb = b || this.bar(e);
      const s = this.project(e.headPos);
      if (!s) {
        bb.el.style.display = 'none';
        continue;
      }
      bb.el.style.display = '';
      const p = Math.max(0, e.hp / e.maxHp);
      bb.ghostP = Math.max(p, bb.ghostP - dt * 0.6);
      bb.fill.style.width = `${p * 100}%`;
      bb.ghost.style.width = `${bb.ghostP * 100}%`;
      const auraKey = (e.frozenT > 0 ? 'ice' : e.aura || '') + (e.chargedT > 0 ? '+thunder' : '');
      if (auraKey !== bb.auraKey) {
        bb.auraKey = auraKey;
        const icons = [];
        if (e.frozenT > 0) icons.push(elementIcon('ice', '#bff4ff', 16));
        else if (e.aura) icons.push(elementIcon(e.aura, ELEMENT_ICON_COLORS[e.aura], 16));
        if (e.chargedT > 0 && e.aura !== 'thunder') icons.push(elementIcon('thunder', ELEMENT_ICON_COLORS.thunder, 16));
        bb.aura.innerHTML = icons.join('');
      }
      const scale = Math.max(0.65, 1.15 - dist / 45);
      bb.el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%) scale(${scale})`;
    }
  }
}

const ELEMENT_ICON_COLORS = {
  wind: '#5fe3c0',
  fire: '#ff8a4a',
  water: '#4fc0ff',
  thunder: '#c690ff',
  ice: '#a8eeff',
};
