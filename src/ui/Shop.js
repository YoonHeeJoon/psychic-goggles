import { ITEMS, itemIcon } from '../game/Items.js';
import { WEAPONS, WEAPON_TYPES, STAT_NAMES, fmtStat, gearIcon } from '../game/Gear.js';
import { elementIcon } from './icons.js';

// Shop panel shared by the village market stall and the harbour smithy.
// Prices are in star gems; weapons also cost ore (and refine crystals for
// the 5★ ones). Buying a weapon you already own refines it.

export const SHOPS = {
  market: {
    name: '벨라의 노점',
    sub: '먼 바다를 건너온 신선한 재료',
    items: [
      { kind: 'item', id: 'apple', price: 10 },
      { kind: 'item', id: 'berry', price: 10 },
      { kind: 'item', id: 'mushroom', price: 10 },
      { kind: 'item', id: 'bellflower', price: 12 },
      { kind: 'mat', id: 'ore', price: 30 },
    ],
  },
  smith: {
    name: '해랑의 대장간',
    sub: '단풍 항구 최고의 망치질',
    items: [
      { kind: 'weapon', id: 'mapleBlade', price: 480, ore: 4 },
      { kind: 'weapon', id: 'lanternAxe', price: 480, ore: 4 },
      { kind: 'weapon', id: 'tideSpear', price: 480, ore: 4 },
      { kind: 'weapon', id: 'harborChart', price: 480, ore: 4 },
      { kind: 'weapon', id: 'frostString', price: 480, ore: 4 },
      { kind: 'weapon', id: 'stoneThunder', price: 1500, ore: 12, refine: 2 },
      { kind: 'weapon', id: 'starfallSpear', price: 1500, ore: 12, refine: 2 },
      { kind: 'weapon', id: 'auroraBow', price: 1500, ore: 12, refine: 2 },
      { kind: 'mat', id: 'ore', price: 30 },
      { kind: 'mat', id: 'refine', price: 240 },
    ],
  },
};
const MATS = {
  ore: { name: '강화 광석', desc: '무기를 강화하는 데 쓰는 단단한 광석. 고원 대장간의 필수품.', color: '#d8c39a' },
  refine: { name: '정제 결정', desc: '무기의 숨은 힘을 깨우는 보랏빛 결정. 무기를 정제할 때 쓴다.', color: '#c9a8ff' },
};

const el = (tag, cls, html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

function matIcon(id) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 96;
  const g = cv.getContext('2d');
  g.translate(48, 48);
  const c = MATS[id].color;
  const grd = g.createLinearGradient(-30, -30, 30, 30);
  grd.addColorStop(0, '#ffffff');
  grd.addColorStop(1, c);
  g.fillStyle = grd;
  g.strokeStyle = 'rgba(40,30,20,.6)';
  g.lineWidth = 3;
  g.beginPath();
  if (id === 'ore') {
    g.moveTo(-26, 10);
    g.lineTo(-14, -22);
    g.lineTo(12, -28);
    g.lineTo(28, -4);
    g.lineTo(18, 24);
    g.lineTo(-12, 26);
  } else {
    g.moveTo(0, -34);
    g.lineTo(20, -6);
    g.lineTo(0, 34);
    g.lineTo(-20, -6);
  }
  g.closePath();
  g.fill();
  g.stroke();
  return cv.toDataURL();
}
const MAT_ICONS = {};

export class ShopPanel {
  constructor(game, root) {
    this.g = game;
    this.el = el(
      'div',
      'panel-wrap hidden',
      `<div class="panel shop-panel">
        <div class="pn-head"><div class="pn-title"></div><div class="pn-sub"></div><div class="pn-gems"></div><button class="pn-close" aria-label="닫기">✕</button></div>
        <div class="pn-body"><div class="pn-grid"></div><div class="pn-detail"></div></div>
      </div>`
    );
    root.appendChild(this.el);
    this.grid = this.el.querySelector('.pn-grid');
    this.detail = this.el.querySelector('.pn-detail');
    this.el.querySelector('.pn-close').addEventListener('click', () => game.closePanel());
    this.el.addEventListener('pointerdown', (e) => e.target === this.el && game.closePanel());
  }

  open(id) {
    this.shop = SHOPS[id || 'market'];
    this.sel = 0;
    this.qty = 1;
    this.el.querySelector('.pn-title').textContent = this.shop.name;
    this.el.querySelector('.pn-sub').textContent = this.shop.sub;
    this.render();
    this.el.classList.remove('hidden');
  }
  close() {
    this.el.classList.add('hidden');
  }

  info(it) {
    if (it.kind === 'item') return { name: ITEMS[it.id].name, icon: itemIcon(it.id), desc: ITEMS[it.id].desc, rarity: 0 };
    if (it.kind === 'mat') return { name: MATS[it.id].name, icon: MAT_ICONS[it.id] || (MAT_ICONS[it.id] = matIcon(it.id)), desc: MATS[it.id].desc, rarity: 0 };
    const W = WEAPONS[it.id];
    return { name: W.name, icon: gearIcon('weapon', W.type, W.rarity), desc: '', rarity: W.rarity, W };
  }
  owned(it) {
    const G = this.g.gear;
    if (it.kind === 'item') return this.g.bag.count(it.id);
    if (it.kind === 'mat') return G.d[it.id];
    const ws = G.d.weapons.filter((w) => w.id === it.id);
    return ws.length ? `R${Math.max(...ws.map((w) => w.r))}` : 0;
  }

  render() {
    const g = this.g;
    const G = g.gear;
    this.el.querySelector('.pn-gems').innerHTML = `${elementIcon('gem', '#9fe8ff', 16)} <b>${g.gems}</b><span class="mat ore">광석 <b>${G.d.ore}</b></span><span class="mat ref">정제 <b>${G.d.refine}</b></span>`;
    const items = this.shop.items;
    this.grid.innerHTML = items
      .map((it, i) => {
        const I = this.info(it);
        return `<button class="slot shop-slot ${i === this.sel ? 'on' : ''} ${I.rarity ? 'r' + I.rarity : ''}" data-i="${i}"><img src="${I.icon}" alt=""><span class="price">${elementIcon('gem', '#9fe8ff', 11)}${it.price}</span></button>`;
      })
      .join('');
    this.grid.querySelectorAll('.slot').forEach((b) =>
      b.addEventListener('click', () => {
        this.sel = +b.dataset.i;
        this.qty = 1;
        this.render();
      })
    );
    const it = items[this.sel];
    const I = this.info(it);
    const stack = it.kind !== 'weapon';
    const qty = stack ? this.qty : 1;
    const cost = it.price * qty,
      ore = (it.ore || 0) * qty,
      ref = (it.refine || 0) * qty;
    const ok = g.gems >= cost && G.d.ore >= ore && G.d.refine >= ref;
    let body = `<div class="ds">${I.desc}</div>`;
    if (I.W) {
      const W = I.W;
      body = `<div class="kd">${WEAPON_TYPES[W.type]} · ${'★'.repeat(W.rarity)}</div>
        <div class="wp-stat"><span>기초 공격력</span><b>${W.atk}</b></div>
        <div class="wp-stat"><span>${STAT_NAMES[W.sub[0]]}</span><b>${fmtStat(W.sub[0], W.sub[1])}</b></div>
        <div class="fx">${W.desc.replace(/\{(\w+)\}/g, (_, k) => `${Math.round(W.fx[k] * 1000) / 10}%`)}</div>
        <div class="ds">이미 가진 무기를 사면 정제(R+1)됩니다.</div>`;
    }
    this.detail.innerHTML = `<img class="big" src="${I.icon}" alt="">
      <div class="nm">${I.name}</div>
      <div class="kd">보유 ${this.owned(it)}</div>
      ${body}
      ${stack ? `<div class="sh-qty"><button class="q-dn">−</button><b>${qty}</b><button class="q-up">+</button></div>` : ''}
      <div class="sh-cost">${elementIcon('gem', '#9fe8ff', 14)} ${cost}${ore ? ` · 광석 ${ore}` : ''}${ref ? ` · 정제 결정 ${ref}` : ''}</div>
      <button class="use sh-buy" ${ok ? '' : 'disabled'}>구입</button>`;
    const q = (s) => this.detail.querySelector(s);
    if (stack) {
      q('.q-dn').addEventListener('click', () => {
        this.qty = Math.max(1, this.qty - 1);
        this.render();
      });
      q('.q-up').addEventListener('click', () => {
        this.qty = Math.min(20, this.qty + 1);
        this.render();
      });
    }
    q('.sh-buy').addEventListener('click', () => this.buy(it, qty));
  }

  buy(it, qty) {
    const g = this.g;
    const G = g.gear;
    const cost = it.price * qty,
      ore = (it.ore || 0) * qty,
      ref = (it.refine || 0) * qty;
    if (g.gems < cost || G.d.ore < ore || G.d.refine < ref) return;
    g.gems -= cost;
    G.d.ore -= ore;
    G.d.refine -= ref;
    if (it.kind === 'item') {
      g.bag.add(it.id, qty);
      g.hud.toast(`구입 · <b>${ITEMS[it.id].name}</b> ×${qty}`, '#ffd36a');
    } else if (it.kind === 'mat') G.give({ [it.id]: qty });
    else G.give({ weapon: it.id });
    g.sfx.gem();
    g.explore.save();
    this.render();
  }
}
