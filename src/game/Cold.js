import { LANDMARKS } from '../world/Terrain.js';
import { elementIcon } from '../ui/icons.js';

// Biting cold high on the mountain. Above the treeline the cold meter fills
// (faster while climbing or in the giant's blizzard); standing by a lit
// brazier warms you back up. A full meter starts to sap the active
// character's HP. Frost creeps in from the screen edges as it rises.

const COLD_Y = 108;

const el = (tag, cls, html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

// a frosted vignette: fractal noise crystals masked to the edges
const FROST_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><filter id="f"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="4" seed="7"/><feColorMatrix values="0 0 0 0 0.86  0 0 0 0 0.95  0 0 0 0 1  0 0 0 2.4 -1.1"/></filter><rect width="100%" height="100%" filter="url(#f)"/></svg>`;

export class Cold {
  constructor(game) {
    this.g = game;
    this.v = 0;
    this.drainT = 0;
    this.storm = 0;
    this.overlay = el('div', 'frost-overlay');
    this.overlay.style.backgroundImage = `url("data:image/svg+xml;utf8,${encodeURIComponent(FROST_SVG)}")`;
    game.container.appendChild(this.overlay);
    this.gauge = el('div', 'cold-gauge hidden', `<svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="18" class="bg"/><circle cx="22" cy="22" r="18" class="fg"/></svg><div class="cg-ic">${elementIcon('ice', '#dff6ff', 18)}</div>`);
    game.hud.layer.appendChild(this.gauge);
    this.fg = this.gauge.querySelector('.fg');
  }

  // high on the northern massif counts as cold
  inColdZone(p) {
    const M = LANDMARKS.mountain;
    return p.y > COLD_Y && Math.hypot((p.x - M.x) * 0.85, p.z - M.z) < 300;
  }

  update(dt) {
    const g = this.g;
    const P = g.player;
    if (g.state !== 'playing' || (g.domain && g.domain.inside)) {
      this.render();
      return;
    }
    const cold = this.inColdZone(P.pos);
    const warm = g.summit && g.summit.warmAt(P.pos);
    this.warm = warm;
    this.cold = cold;
    if (warm) this.v = Math.max(0, this.v - 16 * dt);
    else if (cold) {
      let rate = 1.1;
      if (P.state === 'climb') rate *= 1.5;
      if (P.state === 'swim') rate *= 3;
      rate *= 1 + this.storm * 1.2;
      if (g.weather && g.weather.rain > 0.3) rate *= 1.3;
      // a fire character's own warmth helps a little
      if (P.current.cfg.element === 'fire') rate *= 0.8;
      this.v = Math.min(100, this.v + rate * dt);
    } else this.v = Math.max(0, this.v - 9 * dt);
    if (this.v >= 100 && !warm) {
      this.drainT -= dt;
      if (this.drainT <= 0) {
        this.drainT = 1;
        const c = P.current;
        const dmg = Math.round(c.maxHp * 0.045);
        c.hp = Math.max(0, c.hp - dmg);
        g.combat.ui.text(P.pos.clone().setY(P.pos.y + 1.9), String(dmg), '#bfe8ff', { small: true });
        if (!this.warned) {
          this.warned = true;
          g.hud.flashCenter('추위가 몸을 파고듭니다 · 불을 피운 화로 곁에서 몸을 녹이세요', 2600);
        }
        if (c.hp <= 0) g.combat.onCharDown();
      }
    } else {
      this.drainT = 0.5;
      if (this.v < 60) this.warned = false;
    }
    if (g.achievements && warm && cold && this.v > 50) g.achievements.add('warmedUp', dt);
    this.render();
  }

  render() {
    const v = this.v;
    const show = this.g.state === 'playing' && (v > 0.5 || this.cold);
    this.gauge.classList.toggle('hidden', !show);
    this.gauge.classList.toggle('warm', !!this.warm);
    this.gauge.classList.toggle('danger', v >= 80);
    this.fg.style.strokeDashoffset = `${113.1 * (1 - v / 100)}`;
    const k = Math.max(0, Math.min(1, (v - 25) / 75));
    this.overlay.style.opacity = String(k * k * 0.9 * (this.g.state === 'title' ? 0 : 1));
  }
}
