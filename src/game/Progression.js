import { ELEMENTS } from '../character/characters.js';
import { elementIcon } from '../ui/icons.js';
import { WEAPONS, WEAPON_TYPES, WEAPON_MAX_ASC, REFINE_MAX, ascCost, refineCost, SLOTS, SETS, ART_MAX, artLevelCost, STAT_NAMES, fmtStat, mainValue, gearIcon } from './Gear.js';

// Character growth paid with star gems: levels (HP, ATK, damage taken) and
// two talents (elemental skill / burst damage). Saved with the progress.

export const MAX_LV = 50;
export const MAX_TAL = 8;
const BASE_LV = 20;
const BASE_ATK = 1150;
const BASE_ATK_CHAR = 900; // the starter weapon brings it back to ~1150

const NAMES = {
  aria: ['회오리 베기', '폭풍의 눈'],
  ren: ['화염 돌진', '불새의 낙인'],
  mizu: ['물방울 결계', '해명의 비'],
  rai: ['뇌전 낙인', '천뢰'],
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
    c.baseHpLv = Math.round(c.baseHp * (1 + 0.045 * k));
    c.baseAtkLv = Math.round(BASE_ATK_CHAR * (1 + 0.055 * k));
    if (this.g.gear) this.g.gear.apply(c);
    else {
      c.maxHp = c.baseHpLv;
      c.atk = Math.round(BASE_ATK * (1 + 0.055 * k));
    }
    c.hp = fill ? c.maxHp : Math.min(c.maxHp, Math.round(c.maxHp * ratio));
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
    this.tab = 'info';
    this.slot = 'flower';
    this.pick = null;
    this.el = el(
      'div',
      'panel-wrap hidden',
      `<div class="panel char-panel">
        <div class="pn-head"><div class="pn-title">캐릭터</div>
          <div class="pn-tabs"><button data-tab="info">개요</button><button data-tab="weapon">무기</button><button data-tab="arts">성유물</button></div>
          <div class="pn-gems"></div><button class="pn-close" aria-label="닫기">✕</button></div>
        <div class="ch-body"><div class="ch-list"></div><div class="ch-detail"></div></div>
      </div>`
    );
    root.appendChild(this.el);
    this.list = this.el.querySelector('.ch-list');
    this.detail = this.el.querySelector('.ch-detail');
    this.el.querySelector('.pn-close').addEventListener('click', () => game.closePanel());
    this.el.addEventListener('pointerdown', (e) => e.target === this.el && game.closePanel());
    this.el.querySelectorAll('.pn-tabs button').forEach((b) =>
      b.addEventListener('click', () => {
        this.tab = b.dataset.tab;
        this.pick = null;
        this.g.sfx.click && this.g.sfx.click();
        this.render();
      })
    );
  }

  open(tab) {
    this.sel = this.g.player.active;
    if (tab) this.tab = tab;
    this.pick = null;
    this.render();
    this.el.classList.remove('hidden');
  }
  close() {
    this.el.classList.add('hidden');
  }

  render() {
    const g = this.g;
    const party = g.player.party;
    const G = g.gear;
    this.el.querySelectorAll('.pn-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === this.tab));
    this.el.querySelector('.pn-gems').innerHTML = `${elementIcon('gem', '#9fe8ff', 16)} <b>${g.gems}</b><span class="mat ore">광석 <b>${G.d.ore}</b></span><span class="mat ref">정제 <b>${G.d.refine}</b></span>`;
    this.list.innerHTML = party
      .map((c, i) => `<button class="ch-item ${i === this.sel ? 'on' : ''}" data-i="${i}" style="--el:${ELEMENTS[c.cfg.element].color}"><img src="${c.portrait || ''}" alt=""><span class="nm">${c.cfg.name}</span><span class="lv">Lv.${c.level}</span></button>`)
      .join('');
    this.list.querySelectorAll('.ch-item').forEach((b) =>
      b.addEventListener('click', () => {
        this.sel = +b.dataset.i;
        this.pick = null;
        this.render();
      })
    );
    const c = party[this.sel];
    if (this.tab === 'weapon') this.renderWeapon(c);
    else if (this.tab === 'arts') this.renderArts(c);
    else this.renderInfo(c);
  }

  renderInfo(c) {
    const g = this.g;
    const party = g.player.party;
    const E = ELEMENTS[c.cfg.element];
    const names = NAMES[c.cfg.id] || ['원소 스킬', '원소 폭발'];
    const P = g.progression;
    const lvMax = c.level >= MAX_LV;
    const lc = levelCost(c.level);
    const S = c.gear || {};
    const pct = (v) => `${Math.round((v || 0) * 1000) / 10}%`;
    const tal = (kind, label, name, t) => {
      const max = t >= MAX_TAL;
      const cost = talentCost(t);
      return `<div class="tal"><div class="t-ic" style="--el:${E.color}">${elementIcon(E.icon, kind === 'q' ? '#fff' : E.color, 22)}</div>
        <div class="t-info"><div class="t-name">${name} <small>${label}</small></div><div class="t-lv">Lv.${t} / ${MAX_TAL} · 피해 +${Math.round((t - 1) * 12)}%</div></div>
        <button class="t-up" data-k="${kind}" ${max || g.gems < cost ? 'disabled' : ''}>${max ? '최대' : `강화 · ${cost}`}</button></div>`;
    };
    const sets = Object.entries(g.gear.setCounts(c))
      .filter(([, n]) => n >= 2)
      .map(([k, n]) => `<div class="set-on" style="--sc:${SETS[k].color}"><b>${SETS[k].name}</b> ${n >= 4 ? '4세트' : '2세트'} · ${SETS[k].twoText}${n >= 4 ? ' · ' + SETS[k].fourText : ''}</div>`)
      .join('');
    const w = g.gear.weaponOf(c);
    this.detail.innerHTML = `
      <div class="ch-top" style="--el:${E.color}">
        <div class="ch-name">${c.cfg.name}<small>${c.cfg.title}</small></div>
        <div class="ch-tags"><span>${elementIcon(E.icon, E.color, 14)} ${E.name}</span><span>${WEAPON[c.cfg.weapon]}</span>${w ? `<span>${WEAPONS[w.id].name} R${w.r}</span>` : ''}</div>
      </div>
      <div class="ch-lv"><span class="big">Lv.${c.level}</span><span>/ ${MAX_LV}</span>
        <button class="lv-up" ${lvMax || g.gems < lc ? 'disabled' : ''}>${lvMax ? '최대 레벨' : `레벨 업 · ${elementIcon('gem', '#3a3020', 13)} ${lc}`}</button></div>
      <div class="ch-stats">
        <div><span>최대 HP</span><b>${c.maxHp.toLocaleString()}</b></div>
        <div><span>공격력</span><b>${c.atk.toLocaleString()}</b></div>
        <div><span>치명타 확률</span><b>${pct(c.critRate)}</b></div>
        <div><span>치명타 피해</span><b>${pct(c.critDmg)}</b></div>
        <div><span>원소 충전 효율</span><b>${pct(c.er)}</b></div>
        <div><span>원소 피해 보너스</span><b>${pct(S.elemDmg)}</b></div>
        <div><span>받는 피해</span><b>-${Math.round((1 - c.defMul) * 100)}%</b></div>
      </div>
      ${sets ? `<div class="ch-sets">${sets}</div>` : ''}
      <div class="ch-sub">특성</div>
      ${tal('e', '원소 스킬', names[0], c.talentE)}
      ${tal('q', '원소 폭발', names[1], c.talentQ)}
      <div class="ch-note">별빛 결정은 몬스터, 보물상자, 퍼즐, 보스, 비경, 일일 의뢰에서 얻을 수 있습니다.</div>`;
    this.detail.querySelector('.lv-up').addEventListener('click', () => {
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

  weaponCard(w, extra = '') {
    const G = this.g.gear;
    const W = WEAPONS[w.id];
    const [sk, sv] = G.weaponSub(w);
    return `<div class="wp-card r${W.rarity}">
      <img class="wp-ic" src="${gearIcon('weapon', W.type, W.rarity)}" alt="">
      <div class="wp-info">
        <div class="wp-name">${W.name} <span class="stars">${'★'.repeat(W.rarity)}</span></div>
        <div class="wp-meta">${WEAPON_TYPES[W.type]} · 강화 ${w.asc}/${WEAPON_MAX_ASC} · 정제 R${w.r}</div>
        <div class="wp-stat"><span>기초 공격력</span><b>${Math.round(G.weaponAtk(w))}</b></div>
        <div class="wp-stat"><span>${STAT_NAMES[sk]}</span><b>${fmtStat(sk, sv)}</b></div>
        <div class="wp-fx">${G.weaponDesc(w)}</div>
      </div>${extra}</div>`;
  }

  renderWeapon(c) {
    const g = this.g;
    const G = g.gear;
    const w = G.weaponOf(c);
    const owned = G.d.weapons.filter((x) => WEAPONS[x.id].type === c.cfg.weapon).sort((a, b) => WEAPONS[b.id].rarity - WEAPONS[a.id].rarity || b.r - a.r);
    const sel = (this.pick && owned.find((x) => x.uid === this.pick)) || w;
    const isCur = sel === w;
    const W = WEAPONS[sel.id];
    const ac = ascCost(sel.asc, W.rarity);
    const rc = refineCost(sel.r);
    const ascOk = sel.asc < WEAPON_MAX_ASC && G.d.ore >= ac.ore && g.gems >= ac.gems;
    const refOk = sel.r < REFINE_MAX && G.d.refine >= rc.refine;
    const wearer = sel.owner && sel.owner !== c.cfg.id ? g.player.party.find((p) => p.cfg.id === sel.owner) : null;
    this.detail.innerHTML = `
      ${this.weaponCard(sel)}
      <div class="wp-actions">
        ${isCur ? '<span class="eq-tag">장착 중</span>' : `<button class="wp-eq">${wearer ? `${wearer.cfg.name}에게서 가져와 장착` : '장착'}</button>`}
        <button class="wp-asc" ${ascOk ? '' : 'disabled'}>${sel.asc >= WEAPON_MAX_ASC ? '강화 완료' : `강화 · 광석 ${ac.ore} · ${elementIcon('gem', '#3a3020', 12)} ${ac.gems}`}</button>
        <button class="wp-ref" ${refOk ? '' : 'disabled'}>${sel.r >= REFINE_MAX ? '정제 완료' : `정제 · 정제 결정 ${rc.refine}`}</button>
      </div>
      <div class="ch-sub">보유한 ${WEAPON_TYPES[c.cfg.weapon]}</div>
      <div class="wp-list">${owned
        .map((x) => {
          const X = WEAPONS[x.id];
          const by = x.owner ? g.player.party.find((p) => p.cfg.id === x.owner) : null;
          return `<button class="wp-slot r${X.rarity} ${x === sel ? 'on' : ''}" data-u="${x.uid}"><img src="${gearIcon('weapon', X.type, X.rarity)}" alt=""><span class="nm">${X.name}</span><span class="rk">R${x.r} · +${x.asc}</span>${by ? `<img class="by" src="${by.portrait || ''}" alt="">` : ''}</button>`;
        })
        .join('')}</div>
      <div class="ch-note">강화 광석은 보물상자·정예 몬스터·비경·일일 의뢰에서, 정제 결정은 진귀한 보물상자와 보스에서 얻습니다. 같은 무기를 또 얻으면 자동으로 정제됩니다. 단풍 항구 대장간에서 새 무기를 살 수 있습니다.</div>`;
    const E = ELEMENTS[c.cfg.element];
    const q = (s) => this.detail.querySelector(s);
    if (q('.wp-eq'))
      q('.wp-eq').addEventListener('click', () => {
        if (G.equipWeapon(c, sel)) {
          g.hud.toast(`<b>${c.cfg.name}</b> · ${W.name} 장착`, E.color);
          g.sfx.swap && g.sfx.swap();
          this.pick = null;
          this.render();
        }
      });
    q('.wp-asc').addEventListener('click', () => {
      if (G.ascend(sel.owner ? g.player.party.find((p) => p.cfg.id === sel.owner) : null, sel) === 'ok') {
        g.hud.toast(`<b>${W.name}</b> 강화 · ${sel.asc}/${WEAPON_MAX_ASC}`, '#ffd36a');
        g.sfx.questStep();
        g.explore.save();
        this.render();
      }
    });
    q('.wp-ref').addEventListener('click', () => {
      if (G.refine(sel.owner ? g.player.party.find((p) => p.cfg.id === sel.owner) : null, sel) === 'ok') {
        g.hud.toast(`<b>${W.name}</b> 정제 · R${sel.r}`, '#c9a8ff');
        g.sfx.cookDone();
        g.explore.save();
        this.render();
      }
    });
    this.detail.querySelectorAll('.wp-slot').forEach((b) =>
      b.addEventListener('click', () => {
        this.pick = +b.dataset.u;
        this.render();
      })
    );
  }

  artCard(a) {
    const S = SETS[a.set];
    const slot = SLOTS.find((x) => x.id === a.slot);
    return `<div class="art-card r${a.rarity}">
      <img class="art-ic" src="${gearIcon('art', a.slot, a.rarity, S.color)}" alt="">
      <div class="art-info">
        <div class="art-name">${S.name} · ${slot.name} <span class="stars">${'★'.repeat(a.rarity)}</span></div>
        <div class="art-main"><span>${STAT_NAMES[a.main]}</span><b>${fmtStat(a.main, mainValue(a))}</b><em>+${a.lv}</em></div>
        ${a.subs.map((s) => `<div class="art-sub">· ${STAT_NAMES[s.k]} +${fmtStat(s.k, s.v)}</div>`).join('')}
        <div class="art-set" style="--sc:${S.color}">2세트: ${S.twoText}<br>4세트: ${S.fourText}</div>
      </div></div>`;
  }

  renderArts(c) {
    const g = this.g;
    const G = g.gear;
    const worn = G.artsOf(c);
    const slots = SLOTS.map((s) => {
      const a = worn[s.id];
      return `<button class="art-slot ${s.id === this.slot ? 'on' : ''}" data-s="${s.id}" title="${s.name}">${a ? `<img src="${gearIcon('art', s.id, a.rarity, SETS[a.set].color)}" alt=""><span class="lv">+${a.lv}</span>` : `<span class="empty">${s.name.split(' ')[1]}</span>`}</button>`;
    }).join('');
    const list = G.d.arts.filter((a) => a.slot === this.slot).sort((a, b) => b.rarity - a.rarity || b.lv - a.lv);
    const cur = worn[this.slot];
    const sel = (this.pick && list.find((a) => a.uid === this.pick)) || cur || list.find((a) => !a.owner) || list[0] || null;
    const sets = Object.entries(G.setCounts(c))
      .map(([k, n]) => `<span class="set-chip ${n >= 2 ? 'on' : ''}" style="--sc:${SETS[k].color}">${SETS[k].name} ${n}</span>`)
      .join('');
    let actions = '';
    if (sel) {
      const cost = artLevelCost(sel.lv, sel.rarity);
      const wearer = sel.owner && sel.owner !== c.cfg.id ? g.player.party.find((p) => p.cfg.id === sel.owner) : null;
      actions = `<div class="wp-actions">
        ${sel === cur ? '<button class="art-off">해제</button>' : `<button class="art-eq">${wearer ? `${wearer.cfg.name}에게서 가져와 장착` : '장착'}</button>`}
        <button class="art-up" ${sel.lv >= ART_MAX || g.gems < cost ? 'disabled' : ''}>${sel.lv >= ART_MAX ? '최대 강화' : `강화 +1 · ${elementIcon('gem', '#3a3020', 12)} ${cost}`}</button>
      </div>`;
    }
    this.detail.innerHTML = `
      <div class="art-slots">${slots}</div>
      <div class="art-setline">${sets || '<span class="set-chip">세트 효과 없음</span>'}</div>
      ${sel ? this.artCard(sel) + actions : `<div class="pn-empty">이 자리에 장착할 성유물이 없습니다.<br>보물상자·정예 몬스터·비경·보스에서 얻을 수 있어요.</div>`}
      <div class="ch-sub">보유한 ${SLOTS.find((s) => s.id === this.slot).name} (${list.length})</div>
      <div class="art-list">${list
        .map((a) => {
          const by = a.owner ? g.player.party.find((p) => p.cfg.id === a.owner) : null;
          return `<button class="art-item r${a.rarity} ${a === sel ? 'on' : ''}" data-u="${a.uid}"><img src="${gearIcon('art', a.slot, a.rarity, SETS[a.set].color)}" alt=""><span class="lv">+${a.lv}</span>${by ? `<img class="by" src="${by.portrait || ''}" alt="">` : ''}</button>`;
        })
        .join('')}</div>`;
    const E = ELEMENTS[c.cfg.element];
    this.detail.querySelectorAll('.art-slot').forEach((b) =>
      b.addEventListener('click', () => {
        this.slot = b.dataset.s;
        this.pick = null;
        this.render();
      })
    );
    this.detail.querySelectorAll('.art-item').forEach((b) =>
      b.addEventListener('click', () => {
        this.pick = +b.dataset.u;
        this.render();
      })
    );
    const q = (s) => this.detail.querySelector(s);
    if (q('.art-eq'))
      q('.art-eq').addEventListener('click', () => {
        G.equipArt(c, sel);
        g.hud.toast(`<b>${c.cfg.name}</b> · ${SETS[sel.set].name} 장착`, E.color);
        this.pick = null;
        this.render();
      });
    if (q('.art-off'))
      q('.art-off').addEventListener('click', () => {
        G.unequipArt(c, sel);
        this.render();
      });
    if (q('.art-up'))
      q('.art-up').addEventListener('click', () => {
        const owner = sel.owner ? g.player.party.find((p) => p.cfg.id === sel.owner) : null;
        if (G.levelArt(owner, sel) === 'ok') {
          g.sfx.blip && g.sfx.blip();
          if (sel.lv % 4 === 0) g.hud.toast(`<b>+${sel.lv}</b> · 부옵션 강화!`, '#ffd36a');
          this.render();
        }
      });
  }
}
