import { ELEMENTS } from '../character/characters.js';
import { elementIcon } from '../ui/icons.js';

// Character growth paid with star gems: levels (HP, ATK, damage taken) and
// two talents (elemental skill / burst damage). Saved with the progress.

export const MAX_LV = 50;
export const MAX_TAL = 8;
const BASE_LV = 20;
const BASE_ATK = 1150;

const NAMES = {
  aria: ['회오리 베기', '폭풍의 눈'],
  ren: ['화염 돌진', '불새의 낙인'],
  mizu: ['물방울 결계', '해명의 비'],
  raika: ['뇌전 낙인', '천뢰'],
};
const WEAPON = { sword: '한손검', claymore: '양손검', polearm: '장병기', catalyst: '법구' };

export const levelCost = (lv) => 40 + (lv - BASE_LV) * 12;
export const talentCost = (t) => 60 + (t - 1) * 45;

const el = (tag, cls, html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

export class Progression {
  constructor(game) {
    this.g = game;
    const prog = game.explore.progress;
    this.data = prog.chars || (prog.chars = {});
    for (const c of game.player.party) {
      const d = this.data[c.cfg.id] || (this.data[c.cfg.id] = { lv: BASE_LV, e: 1, q: 1 });
      c.baseHp = c.maxHp;
      this.apply(c, d, true);
    }
  }

  apply(c, d, fill = false) {
    const k = d.lv - BASE_LV;
    const ratio = c.maxHp > 0 ? c.hp / c.maxHp : 1;
    c.level = d.lv;
    c.talentE = d.e;
    c.talentQ = d.q;
    c.maxHp = Math.round(c.baseHp * (1 + 0.045 * k));
    c.hp = fill ? c.maxHp : Math.round(c.maxHp * ratio);
    c.atk = Math.round(BASE_ATK * (1 + 0.055 * k));
    c.skillMul = 1 + 0.12 * (d.e - 1);
    c.burstMul = 1 + 0.12 * (d.q - 1);
    c.defMul = 1 - Math.min(0.3, k * 0.01);
  }

  levelUp(c) {
    const d = this.data[c.cfg.id];
    if (d.lv >= MAX_LV) return false;
    const cost = levelCost(d.lv);
    if (this.g.gems < cost) return false;
    this.g.gems -= cost;
    d.lv++;
    const before = c.maxHp;
    this.apply(c, d);
    c.hp = Math.min(c.maxHp, c.hp + (c.maxHp - before));
    this.g.sfx.questStep();
    return true;
  }

  talentUp(c, kind) {
    const d = this.data[c.cfg.id];
    if (d[kind] >= MAX_TAL) return false;
    const cost = talentCost(d[kind]);
    if (this.g.gems < cost) return false;
    this.g.gems -= cost;
    d[kind]++;
    this.apply(c, d);
    this.g.sfx.cookDone();
    return true;
  }
}

export class CharPanel {
  constructor(game, root) {
    this.g = game;
    this.sel = 0;
    this.el = el(
      'div',
      'panel-wrap hidden',
      `<div class="panel char-panel">
        <div class="pn-head"><div class="pn-title">캐릭터</div><div class="pn-gems"></div><button class="pn-close" aria-label="닫기">✕</button></div>
        <div class="ch-body"><div class="ch-list"></div><div class="ch-detail"></div></div>
      </div>`
    );
    root.appendChild(this.el);
    this.list = this.el.querySelector('.ch-list');
    this.detail = this.el.querySelector('.ch-detail');
    this.el.querySelector('.pn-close').addEventListener('click', () => game.closePanel());
    this.el.addEventListener('pointerdown', (e) => e.target === this.el && game.closePanel());
  }

  open() {
    this.sel = this.g.player.active;
    this.render();
    this.el.classList.remove('hidden');
  }
  close() {
    this.el.classList.add('hidden');
  }

  render() {
    const g = this.g;
    const party = g.player.party;
    this.el.querySelector('.pn-gems').innerHTML = `${elementIcon('gem', '#9fe8ff', 16)} <b>${g.gems}</b>`;
    this.list.innerHTML = party
      .map((c, i) => `<button class="ch-item ${i === this.sel ? 'on' : ''}" data-i="${i}" style="--el:${ELEMENTS[c.cfg.element].color}"><img src="${c.portrait || ''}" alt=""><span class="nm">${c.cfg.name}</span><span class="lv">Lv.${c.level}</span></button>`)
      .join('');
    this.list.querySelectorAll('.ch-item').forEach((b) =>
      b.addEventListener('click', () => {
        this.sel = +b.dataset.i;
        this.render();
      })
    );
    const c = party[this.sel];
    const E = ELEMENTS[c.cfg.element];
    const names = NAMES[c.cfg.id] || ['원소 스킬', '원소 폭발'];
    const P = g.progression;
    const lvMax = c.level >= MAX_LV;
    const lc = levelCost(c.level);
    const tal = (kind, label, name, t) => {
      const max = t >= MAX_TAL;
      const cost = talentCost(t);
      return `<div class="tal"><div class="t-ic" style="--el:${E.color}">${elementIcon(E.icon, kind === 'q' ? '#fff' : E.color, 22)}</div>
        <div class="t-info"><div class="t-name">${name} <small>${label}</small></div><div class="t-lv">Lv.${t} / ${MAX_TAL} · 피해 +${Math.round((t - 1) * 12)}%</div></div>
        <button class="t-up" data-k="${kind}" ${max || g.gems < cost ? 'disabled' : ''}>${max ? '최대' : `강화 · ${cost}`}</button></div>`;
    };
    this.detail.innerHTML = `
      <div class="ch-top" style="--el:${E.color}">
        <div class="ch-name">${c.cfg.name}<small>${c.cfg.title}</small></div>
        <div class="ch-tags"><span>${elementIcon(E.icon, E.color, 14)} ${E.name}</span><span>${WEAPON[c.cfg.weapon]}</span></div>
      </div>
      <div class="ch-lv"><span class="big">Lv.${c.level}</span><span>/ ${MAX_LV}</span>
        <button class="lv-up" ${lvMax || g.gems < lc ? 'disabled' : ''}>${lvMax ? '최대 레벨' : `레벨 업 · ${elementIcon('gem', '#3a3020', 13)} ${lc}`}</button></div>
      <div class="ch-stats">
        <div><span>최대 HP</span><b>${c.maxHp.toLocaleString()}</b></div>
        <div><span>공격력</span><b>${c.atk.toLocaleString()}</b></div>
        <div><span>치명타 확률</span><b>${Math.round(g.combat.stats.critRate * 100)}%</b></div>
        <div><span>치명타 피해</span><b>${Math.round(g.combat.stats.critDmg * 100)}%</b></div>
        <div><span>받는 피해</span><b>-${Math.round((1 - c.defMul) * 100)}%</b></div>
      </div>
      <div class="ch-sub">특성</div>
      ${tal('e', '원소 스킬', names[0], c.talentE)}
      ${tal('q', '원소 폭발', names[1], c.talentQ)}
      <div class="ch-note">별빛 결정은 몬스터, 보물상자, 퍼즐, 보스, 비경에서 얻을 수 있습니다.</div>`;
    const up = this.detail.querySelector('.lv-up');
    up.addEventListener('click', () => {
      if (P.levelUp(c)) {
        g.hud.toast(`<b>${c.cfg.name}</b> 레벨 업 · Lv.${c.level}`, E.color);
        g.hud.setParty(party, g.player.active);
        this.render();
      }
    });
    this.detail.querySelectorAll('.t-up').forEach((b) =>
      b.addEventListener('click', () => {
        if (P.talentUp(c, b.dataset.k)) {
          g.hud.toast(`<b>${names[b.dataset.k === 'e' ? 0 : 1]}</b> 강화 · Lv.${b.dataset.k === 'e' ? c.talentE : c.talentQ}`, E.color);
          this.render();
        }
      })
    );
  }
}
