// Boss health bar (top centre, with the electro shield layered over it) and
// the name card that slides in during the boss intro.

const el = (tag, cls, html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

export class BossUI {
  constructor(root) {
    this.bar = el(
      'div',
      'boss-bar hidden',
      `<div class="bb-name"><span class="lv"></span><span class="nm"></span></div>
       <div class="bb-track"><div class="bb-ghost"></div><div class="bb-fill"></div><div class="bb-shield"></div><div class="bb-mark"></div></div>`
    );
    this.card = el('div', 'boss-card hidden', `<div class="bc-sub"></div><div class="bc-name"></div><div class="bc-line"></div>`);
    root.append(this.bar, this.card);
    this.fill = this.bar.querySelector('.bb-fill');
    this.ghost = this.bar.querySelector('.bb-ghost');
    this.shield = this.bar.querySelector('.bb-shield');
    this.ghostP = 1;
  }

  showCard(name, sub) {
    this.card.querySelector('.bc-name').textContent = name;
    this.card.querySelector('.bc-sub').textContent = sub;
    this.card.classList.remove('hidden', 'show');
    void this.card.offsetWidth;
    this.card.classList.add('show');
    clearTimeout(this._t);
    this._t = setTimeout(() => this.card.classList.add('hidden'), 4300);
  }

  update(dt, boss, visible) {
    this.bar.classList.toggle('hidden', !visible);
    if (!visible) {
      this.ghostP = boss ? boss.hp / boss.maxHp : 1;
      return;
    }
    this.bar.querySelector('.nm').textContent = boss.name;
    this.bar.querySelector('.lv').textContent = `Lv.${boss.level}`;
    const p = Math.max(0, boss.hp / boss.maxHp);
    this.ghostP = Math.max(p, this.ghostP - dt * 0.35);
    this.fill.style.width = `${p * 100}%`;
    this.ghost.style.width = `${this.ghostP * 100}%`;
    const s = boss.shield > 0 ? boss.shield / boss.shieldMax : 0;
    this.shield.style.width = `${s * 100}%`;
    this.bar.classList.toggle('shielded', s > 0);
    this.bar.classList.toggle('stunned', boss.state === 'stunned');
  }
}
