import { ITEMS, RECIPES, itemIcon } from '../game/Items.js';

// Bag (inventory) and cooking panels, plus the active food-buff pills.

const el = (tag, cls, html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

export class Bag {
  constructor(game, root) {
    this.g = game;
    const prog = game.explore.progress;
    this.counts = prog.inv || (prog.inv = {});
    this.tab = 'ingredient';
    this.sel = null;
    this.el = el(
      'div',
      'panel-wrap hidden',
      `<div class="panel bag-panel">
        <div class="pn-head"><div class="pn-title">가방</div>
          <div class="pn-tabs"><button data-tab="ingredient">재료</button><button data-tab="food">요리</button></div>
          <button class="pn-close" aria-label="닫기">✕</button></div>
        <div class="pn-body"><div class="pn-grid"></div><div class="pn-detail"></div></div>
      </div>`
    );
    root.appendChild(this.el);
    this.grid = this.el.querySelector('.pn-grid');
    this.detail = this.el.querySelector('.pn-detail');
    this.el.querySelector('.pn-close').addEventListener('click', () => game.closePanel());
    this.el.addEventListener('pointerdown', (e) => e.target === this.el && game.closePanel());
    this.el.querySelectorAll('.pn-tabs button').forEach((b) =>
      b.addEventListener('click', () => {
        this.tab = b.dataset.tab;
        this.sel = null;
        this.render();
      })
    );
  }

  count(id) {
    return this.counts[id] || 0;
  }
  add(id, n = 1) {
    this.counts[id] = this.count(id) + n;
  }
  has(need) {
    return Object.entries(need).every(([k, n]) => this.count(k) >= n);
  }
  take(need) {
    for (const [k, n] of Object.entries(need)) {
      this.counts[k] = this.count(k) - n;
      if (this.counts[k] <= 0) delete this.counts[k];
    }
  }

  open(tab) {
    if (tab) this.tab = tab;
    this.sel = null;
    this.render();
    this.el.classList.remove('hidden');
  }
  close() {
    this.el.classList.add('hidden');
  }

  render() {
    this.el.querySelectorAll('.pn-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === this.tab));
    const ids = Object.keys(ITEMS).filter((k) => ITEMS[k].kind === this.tab && this.count(k) > 0);
    if (!this.sel || !ids.includes(this.sel)) this.sel = ids[0] || null;
    this.grid.innerHTML = ids.length
      ? ids.map((k) => `<button class="slot ${k === this.sel ? 'on' : ''} ${ITEMS[k].kind}" data-id="${k}"><img src="${itemIcon(k)}" alt=""><span class="cnt">${this.count(k)}</span></button>`).join('')
      : `<div class="pn-empty">${this.tab === 'food' ? '아직 만든 요리가 없습니다.<br>요리 솥에서 재료로 요리해 보세요.' : '아직 모은 재료가 없습니다.<br>들판의 반짝이는 식물을 채집해 보세요.'}</div>`;
    this.grid.querySelectorAll('.slot').forEach((b) =>
      b.addEventListener('click', () => {
        this.sel = b.dataset.id;
        this.render();
      })
    );
    const it = this.sel && ITEMS[this.sel];
    if (!it) {
      this.detail.innerHTML = '';
      return;
    }
    this.detail.innerHTML = `<img class="big" src="${itemIcon(this.sel)}" alt="">
      <div class="nm">${it.name}</div>
      <div class="kd">${it.kind === 'food' ? '요리' : '요리 재료'} · 보유 ${this.count(this.sel)}</div>
      ${it.effectText ? `<div class="fx">${it.effectText}</div>` : ''}
      <div class="ds">${it.desc}</div>
      ${it.kind === 'food' ? '<button class="use">먹기</button>' : ''}`;
    const use = this.detail.querySelector('.use');
    if (use)
      use.addEventListener('click', () => {
        if (this.count(this.sel) <= 0) return;
        this.take({ [this.sel]: 1 });
        this.g.applyFood(this.sel);
        this.render();
      });
  }
}

export class CookPanel {
  constructor(game, root) {
    this.g = game;
    this.el = el(
      'div',
      'panel-wrap hidden',
      `<div class="panel cook-panel">
        <div class="pn-head"><div class="pn-title">요리</div><div class="pn-sub"></div><button class="pn-close" aria-label="닫기">✕</button></div>
        <div class="recipes"></div>
        <div class="cook-bar"><div class="cook-fill"></div></div>
      </div>`
    );
    root.appendChild(this.el);
    this.list = this.el.querySelector('.recipes');
    this.bar = this.el.querySelector('.cook-bar');
    this.el.querySelector('.pn-close').addEventListener('click', () => game.closePanel());
    this.el.addEventListener('pointerdown', (e) => e.target === this.el && game.closePanel());
  }

  open(pot) {
    this.el.querySelector('.pn-sub').textContent = pot ? pot.name : '';
    this.busy = false;
    this.render();
    this.el.classList.remove('hidden');
  }
  close() {
    this.el.classList.add('hidden');
  }

  render() {
    const bag = this.g.bag;
    this.list.innerHTML = RECIPES.map((r, i) => {
      const out = ITEMS[r.out];
      const ok = bag.has(r.need);
      const needs = Object.entries(r.need)
        .map(([k, n]) => `<span class="need ${bag.count(k) >= n ? '' : 'short'}"><img src="${itemIcon(k)}" alt="">${ITEMS[k].name} <b>${bag.count(k)}/${n}</b></span>`)
        .join('');
      return `<div class="recipe ${ok ? '' : 'locked'}">
        <img class="out" src="${itemIcon(r.out)}" alt="">
        <div class="r-info"><div class="r-name">${out.name} <small>보유 ${bag.count(r.out)}</small></div><div class="r-fx">${out.effectText}</div><div class="r-needs">${needs}</div></div>
        <button class="r-cook" data-i="${i}" ${ok ? '' : 'disabled'}>요리</button>
      </div>`;
    }).join('');
    this.list.querySelectorAll('.r-cook').forEach((b) => b.addEventListener('click', () => this.cook(RECIPES[+b.dataset.i])));
  }

  cook(r) {
    const bag = this.g.bag;
    if (this.busy || !bag.has(r.need)) return;
    this.busy = true;
    bag.take(r.need);
    this.g.sfx.cookStart();
    this.bar.classList.add('run');
    setTimeout(() => {
      this.bar.classList.remove('run');
      bag.add(r.out, 1);
      this.busy = false;
      this.g.sfx.cookDone();
      this.g.hud.toast(`요리 완성 · <b>${ITEMS[r.out].name}</b> ×1`, '#ffd36a');
      this.render();
      if (this.g.quest) this.g.quest.onEvent('cook', r.out);
      if (this.g.achievements) this.g.achievements.add('cooked');
    }, 900);
  }
}

// small pills above the HP bar for active food effects
export class BuffBar {
  constructor(root) {
    this.el = el('div', 'buffs');
    root.appendChild(this.el);
    this.key = '';
  }
  update(buffs) {
    const parts = [];
    if (buffs.atk > 0) parts.push(['soup', '공격력 +20%', buffs.atk]);
    if (buffs.stamina > 0) parts.push(['pie', '기력 소모 -30%', buffs.stamina]);
    const key = parts.map((p) => p[0] + Math.ceil(p[2])).join('|');
    if (key === this.key) return;
    this.key = key;
    this.el.innerHTML = parts.map(([id, t, s]) => `<div class="buff"><img src="${itemIcon(id)}" alt="">${t} <b>${Math.ceil(s)}초</b></div>`).join('');
  }
}
