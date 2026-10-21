// Weapons and artifacts. Everything a character carries is computed into a
// flat stat block (ATK, HP, crit, energy recharge, damage bonuses) that the
// combat code reads. Gear is earned by playing — chests, elites, the domain,
// the boss, commissions, reputation and the harbour smithy — never by chance
// purchases.

export const WEAPON_TYPES = { sword: '한손검', claymore: '양손검', polearm: '장병기', catalyst: '법구', bow: '활' };

// passive effects scale with refinement (R1..R5: +25% per rank)
export const WEAPONS = {
  travelSword: { name: '여행자의 검', type: 'sword', rarity: 3, atk: 250, sub: ['atkPct', 0.1], fx: { normalDmg: 0.12 }, desc: '일반 공격 피해 +{normalDmg}' },
  mapleBlade: { name: '단풍 칼날', type: 'sword', rarity: 4, atk: 380, sub: ['er', 0.18], fx: { skillDmg: 0.16 }, desc: '원소 스킬 피해 +{skillDmg}' },
  galeSword: { name: '바람결 장검', type: 'sword', rarity: 5, atk: 520, sub: ['critRate', 0.12], fx: { atkPct: 0.12, burstAtk: 0.2 }, desc: '공격력 +{atkPct}, 원소 폭발 후 10초 동안 공격력 +{burstAtk}' },
  smithClaymore: { name: '대장장이 대검', type: 'claymore', rarity: 3, atk: 260, sub: ['atkPct', 0.1], fx: { normalDmg: 0.12 }, desc: '일반 공격 피해 +{normalDmg}' },
  lanternAxe: { name: '등대지기의 도끼검', type: 'claymore', rarity: 4, atk: 400, sub: ['critRate', 0.08], fx: { reactDmg: 0.2 }, desc: '원소 반응 피해 +{reactDmg}' },
  stoneThunder: { name: '천둥 바위 대검', type: 'claymore', rarity: 5, atk: 540, sub: ['critDmg', 0.24], fx: { atkPct: 0.12, normalDmg: 0.2 }, desc: '공격력 +{atkPct}, 일반 공격 피해 +{normalDmg}' },
  traineeSpear: { name: '견습 창', type: 'polearm', rarity: 3, atk: 245, sub: ['critRate', 0.06], fx: { normalDmg: 0.12 }, desc: '일반 공격 피해 +{normalDmg}' },
  tideSpear: { name: '파도 가르는 창', type: 'polearm', rarity: 4, atk: 390, sub: ['er', 0.16], fx: { burstDmg: 0.18 }, desc: '원소 폭발 피해 +{burstDmg}' },
  starfallSpear: { name: '별똥별 창', type: 'polearm', rarity: 5, atk: 530, sub: ['critRate', 0.14], fx: { critDmg: 0.2, burstDmg: 0.16 }, desc: '치명타 피해 +{critDmg}, 원소 폭발 피해 +{burstDmg}' },
  oldTome: { name: '낡은 마도서', type: 'catalyst', rarity: 3, atk: 240, sub: ['elemDmg', 0.1], fx: { elemDmg: 0.12 }, desc: '원소 피해 +{elemDmg}' },
  harborChart: { name: '항구의 해도', type: 'catalyst', rarity: 4, atk: 375, sub: ['atkPct', 0.18], fx: { skillDmg: 0.16 }, desc: '원소 스킬 피해 +{skillDmg}' },
  hunterBow: { name: '사냥꾼의 활', type: 'bow', rarity: 3, atk: 245, sub: ['critRate', 0.06], fx: { normalDmg: 0.12 }, desc: '일반 공격 피해 +{normalDmg}' },
  frostString: { name: '서리 현의 활', type: 'bow', rarity: 4, atk: 385, sub: ['atkPct', 0.18], fx: { skillDmg: 0.16 }, desc: '원소 스킬 피해 +{skillDmg}' },
  auroraBow: { name: '오로라 장궁', type: 'bow', rarity: 5, atk: 525, sub: ['critDmg', 0.28], fx: { elemDmg: 0.16, burstDmg: 0.18 }, desc: '원소 피해 +{elemDmg}, 원소 폭발 피해 +{burstDmg}' },
  windstarOrb: { name: '바람별 구슬', type: 'catalyst', rarity: 5, atk: 520, sub: ['critDmg', 0.28], fx: { elemDmg: 0.2, reactDmg: 0.2 }, desc: '원소 피해 +{elemDmg}, 원소 반응 피해 +{reactDmg}' },
};
export const STARTER = { sword: 'travelSword', claymore: 'smithClaymore', polearm: 'traineeSpear', catalyst: 'oldTome', bow: 'hunterBow' };
export const WEAPON_MAX_ASC = 5;
export const REFINE_MAX = 5;
export const ascCost = (a, rarity) => ({ ore: 2 + a * 2 + (rarity - 3) * 2, gems: 40 + a * 40 });
export const refineCost = (r) => ({ refine: r });

export const SLOTS = [
  { id: 'flower', name: '생명의 꽃', main: ['hp'] },
  { id: 'plume', name: '죽음의 깃털', main: ['atk'] },
  { id: 'sands', name: '시간의 모래', main: ['atkPct', 'hpPct', 'er'] },
  { id: 'goblet', name: '공간의 성배', main: ['elemDmg', 'atkPct', 'hpPct'] },
  { id: 'circlet', name: '이성의 왕관', main: ['critRate', 'critDmg', 'atkPct'] },
];
export const SETS = {
  windsong: { name: '바람의 노래', color: '#5fe3c0', two: { elemDmg: 0.15 }, four: { reactDmg: 0.4 }, twoText: '원소 피해 +15%', fourText: '원소 반응 피해 +40%' },
  maple: { name: '단풍 사냥꾼', color: '#e0743a', two: { atkPct: 0.18 }, four: { normalDmg: 0.35 }, twoText: '공격력 +18%', fourText: '일반 공격 피해 +35%' },
  lantern: { name: '항구의 등불', color: '#ffc861', two: { er: 0.2 }, four: { burstDmg: 0.25 }, twoText: '원소 충전 효율 +20%', fourText: '원소 폭발 피해 +25%' },
};
export const ART_MAX = 12;
export const artLevelCost = (lv, rarity) => 12 + lv * 6 + (rarity - 3) * 8;

// main stat value at level, per rarity (a 5★ at +12 is the strongest)
const MAIN = {
  hp: [480, 90],
  atk: [32, 6.5],
  atkPct: [0.05, 0.011],
  hpPct: [0.05, 0.011],
  er: [0.055, 0.012],
  elemDmg: [0.05, 0.011],
  critRate: [0.033, 0.0075],
  critDmg: [0.066, 0.015],
};
const SUBS = { hp: 210, atk: 15, atkPct: 0.045, hpPct: 0.045, er: 0.05, critRate: 0.03, critDmg: 0.06 };
const SUB_KEYS = Object.keys(SUBS);

export const STAT_NAMES = {
  hp: 'HP',
  atk: '공격력',
  atkPct: '공격력',
  hpPct: 'HP',
  er: '원소 충전 효율',
  elemDmg: '원소 피해 보너스',
  critRate: '치명타 확률',
  critDmg: '치명타 피해',
  normalDmg: '일반 공격 피해',
  skillDmg: '원소 스킬 피해',
  burstDmg: '원소 폭발 피해',
  reactDmg: '원소 반응 피해',
  burstAtk: '폭발 후 공격력',
};
const FLAT = new Set(['hp', 'atk']);
export const fmtStat = (k, v) => (FLAT.has(k) ? `${Math.round(v).toLocaleString()}` : `${(v * 100).toFixed(1).replace(/\.0$/, '')}%`);
export const mainValue = (a) => {
  const [b, s] = MAIN[a.main];
  return (b + s * a.lv) * (0.72 + (a.rarity - 3) * 0.14);
};

export function rollArtifact(rand, opts = {}) {
  const rarity = opts.rarity ?? (rand() < 0.15 ? 5 : rand() < 0.6 ? 4 : 3);
  const slot = opts.slot ?? SLOTS[Math.floor(rand() * SLOTS.length)].id;
  const set = opts.set ?? Object.keys(SETS)[Math.floor(rand() * 3)];
  const mains = SLOTS.find((s) => s.id === slot).main;
  const main = mains[Math.floor(rand() * mains.length)];
  const nSub = rarity - 2 + (rand() < 0.3 ? 1 : 0);
  const subs = [];
  const pool = SUB_KEYS.filter((k) => k !== main);
  while (subs.length < Math.min(4, nSub)) {
    const k = pool.splice(Math.floor(rand() * pool.length), 1)[0];
    subs.push({ k, v: SUBS[k] * (0.7 + rand() * 0.3) * (0.8 + (rarity - 3) * 0.1) });
  }
  return { set, slot, rarity, lv: 0, main, subs };
}

// ---------------------------------------------------------------------------
// Inventory + stat computation, kept in the saved progress (gear block)
// ---------------------------------------------------------------------------
export class Gear {
  constructor(game) {
    this.g = game;
    const prog = game.explore.progress;
    this.d = prog.gear;
    this.rand = Math.random;
  }

  // save v2: starters equipped, empty bags
  static migrate(prog, party) {
    if (!prog.gear) prog.gear = { weapons: [], arts: [], ore: 0, refine: 0, uid: 1 };
    const G = prog.gear;
    for (const c of party) {
      if (!G.weapons.some((w) => w.owner === c.id)) G.weapons.push({ uid: G.uid++, id: STARTER[c.weapon], asc: 0, r: 1, owner: c.id });
    }
  }

  weaponOf(c) {
    return this.d.weapons.find((w) => w.owner === c.cfg.id);
  }
  artsOf(c) {
    const out = {};
    for (const a of this.d.arts) if (a.owner === c.cfg.id) out[a.slot] = a;
    return out;
  }
  weaponAtk(w) {
    return WEAPONS[w.id].atk * (1 + 0.16 * w.asc);
  }
  weaponSub(w) {
    const W = WEAPONS[w.id];
    return [W.sub[0], W.sub[1] * (1 + 0.12 * w.asc)];
  }
  weaponFx(w) {
    const W = WEAPONS[w.id];
    const k = 1 + 0.25 * (w.r - 1);
    const out = {};
    for (const [key, v] of Object.entries(W.fx)) out[key] = v * k;
    return out;
  }
  weaponDesc(w) {
    const fx = this.weaponFx(w);
    return WEAPONS[w.id].desc.replace(/\{(\w+)\}/g, (_, k) => `${Math.round(fx[k] * 1000) / 10}%`);
  }
  setCounts(c) {
    const n = {};
    for (const a of Object.values(this.artsOf(c))) n[a.set] = (n[a.set] || 0) + 1;
    return n;
  }

  // full stat block for a character (base values come from Progression)
  stats(c) {
    const s = { atkPct: 0, hpPct: 0, atk: 0, hp: 0, critRate: 0.25, critDmg: 0.8, er: 1, elemDmg: 0, normalDmg: 0, skillDmg: 0, burstDmg: 0, reactDmg: 0, burstAtk: 0 };
    const add = (k, v) => (s[k] = (s[k] || 0) + v);
    const w = this.weaponOf(c);
    let wAtk = 0;
    if (w) {
      wAtk = this.weaponAtk(w);
      const [k, v] = this.weaponSub(w);
      add(k, v);
      for (const [key, v2] of Object.entries(this.weaponFx(w))) add(key, v2);
    }
    for (const a of Object.values(this.artsOf(c))) {
      add(a.main, mainValue(a));
      for (const sb of a.subs) add(sb.k, sb.v);
    }
    for (const [set, n] of Object.entries(this.setCounts(c))) {
      const S = SETS[set];
      if (n >= 2) for (const [k, v] of Object.entries(S.two)) add(k, v);
      if (n >= 4) for (const [k, v] of Object.entries(S.four)) add(k, v);
    }
    s.wAtk = wAtk;
    return s;
  }

  // called by Progression.apply after the level-based base values are set
  apply(c) {
    const s = this.stats(c);
    c.gear = s;
    c.atk = Math.round((c.baseAtkLv + s.wAtk) * (1 + s.atkPct) + s.atk);
    c.maxHp = Math.round(c.baseHpLv * (1 + s.hpPct) + s.hp);
    c.critRate = Math.min(1, s.critRate);
    c.critDmg = s.critDmg;
    c.er = s.er;
  }

  refresh(c) {
    this.g.progression.apply(c, this.g.progression.data[c.cfg.id]);
    this.g.explore.save();
  }

  // ---- inventory changes
  addWeapon(id) {
    const w = { uid: this.d.uid++, id, asc: 0, r: 1, owner: null };
    // a duplicate of an owned weapon refines it instead of cluttering the bag
    const same = this.d.weapons.filter((x) => x.id === id && x.r < REFINE_MAX).sort((a, b) => b.r - a.r)[0];
    if (same) {
      same.r++;
      this.g.explore.save();
      return { refined: same };
    }
    this.d.weapons.push(w);
    this.g.explore.save();
    return { weapon: w };
  }
  addArtifact(a) {
    const art = { uid: this.d.uid++, ...a, owner: null };
    this.d.arts.push(art);
    this.g.explore.save();
    return art;
  }
  addMats(ore = 0, refine = 0) {
    this.d.ore += ore;
    this.d.refine += refine;
  }

  equipWeapon(c, w) {
    if (WEAPONS[w.id].type !== c.cfg.weapon) return false;
    const cur = this.weaponOf(c);
    if (w.owner && w.owner !== c.cfg.id) {
      // swap with the other wearer
      const other = this.g.player.byId(w.owner);
      if (cur) cur.owner = w.owner;
      w.owner = c.cfg.id;
      if (other) this.refresh(other);
    } else {
      if (cur) cur.owner = null;
      w.owner = c.cfg.id;
    }
    this.refresh(c);
    return true;
  }
  equipArt(c, a) {
    const cur = this.artsOf(c)[a.slot];
    if (a.owner && a.owner !== c.cfg.id) {
      const other = this.g.player.byId(a.owner);
      if (cur) cur.owner = a.owner;
      a.owner = c.cfg.id;
      if (other) this.refresh(other);
    } else {
      if (cur) cur.owner = null;
      a.owner = c.cfg.id;
    }
    this.refresh(c);
  }
  unequipArt(c, a) {
    a.owner = null;
    this.refresh(c);
  }

  ascend(c, w) {
    if (w.asc >= WEAPON_MAX_ASC) return 'max';
    const cost = ascCost(w.asc, WEAPONS[w.id].rarity);
    if (this.d.ore < cost.ore) return 'ore';
    if (this.g.gems < cost.gems) return 'gems';
    this.d.ore -= cost.ore;
    this.g.gems -= cost.gems;
    w.asc++;
    if (c) this.refresh(c);
    return 'ok';
  }
  refine(c, w) {
    if (w.r >= REFINE_MAX) return 'max';
    const cost = refineCost(w.r);
    if (this.d.refine < cost.refine) return 'refine';
    this.d.refine -= cost.refine;
    w.r++;
    if (c) this.refresh(c);
    return 'ok';
  }
  levelArt(c, a) {
    if (a.lv >= ART_MAX) return 'max';
    const cost = artLevelCost(a.lv, a.rarity);
    if (this.g.gems < cost) return 'gems';
    this.g.gems -= cost;
    a.lv++;
    // every 4 levels: a new substat, or an existing one grows
    if (a.lv % 4 === 0) {
      if (a.subs.length < 4) {
        const pool = SUB_KEYS.filter((k) => k !== a.main && !a.subs.some((s) => s.k === k));
        const k = pool[Math.floor(this.rand() * pool.length)];
        a.subs.push({ k, v: SUBS[k] * (0.7 + this.rand() * 0.3) });
      } else {
        const s = a.subs[Math.floor(this.rand() * a.subs.length)];
        s.v += SUBS[s.k] * (0.7 + this.rand() * 0.3);
      }
    }
    if (c && a.owner) this.refresh(c);
    else this.g.explore.save();
    return 'ok';
  }

  // loot from chests, elites, domain and boss
  drop(source, tier = 0) {
    const R = this.rand;
    const out = [];
    if (source === 'chest') {
      if (tier >= 1) out.push({ ore: 1 + tier });
      if ((tier === 1 && R() < 0.4) || tier >= 2) out.push({ art: rollArtifact(R, { rarity: tier >= 2 ? (R() < 0.35 ? 5 : 4) : R() < 0.7 ? 3 : 4 }) });
      if (tier >= 2 && R() < 0.5) out.push({ refine: 1 });
    } else if (source === 'elite') {
      out.push({ ore: 2 }, { art: rollArtifact(R, { rarity: R() < 0.3 ? 5 : 4 }) });
    } else if (source === 'domain') {
      out.push({ ore: 4 }, { art: rollArtifact(R, { rarity: 5 }) }, { refine: 1 });
    } else if (source === 'boss') {
      out.push({ ore: 6 }, { art: rollArtifact(R, { rarity: 5 }) }, { art: rollArtifact(R, { rarity: 4 }) }, { refine: 2 });
    }
    for (const it of out) this.give(it);
    return out;
  }

  // apply one reward and announce it
  give(it) {
    const hud = this.g.hud;
    if (it.ore) {
      this.d.ore += it.ore;
      hud.toast(`획득 · <b>강화 광석</b> ×${it.ore}`, '#d8c39a');
    }
    if (it.refine) {
      this.d.refine += it.refine;
      hud.toast(`획득 · <b>정제 결정</b> ×${it.refine}`, '#c9a8ff');
    }
    if (it.art) {
      const a = this.addArtifact(it.art);
      hud.toast(`획득 · <b>${SETS[a.set].name}</b> ${SLOTS.find((s) => s.id === a.slot).name} ${'★'.repeat(a.rarity)}`, SETS[a.set].color);
    }
    if (it.weapon) {
      const r = this.addWeapon(it.weapon);
      const W = WEAPONS[it.weapon];
      hud.toast(r.refined ? `<b>${W.name}</b> 정제 · R${r.refined.r}` : `획득 · <b>${W.name}</b> ${'★'.repeat(W.rarity)}`, '#ffd36a');
    }
    this.g.explore.save();
  }
}

// ---------------------------------------------------------------------------
// Canvas icons (cached): weapons by type, artifacts by slot, tinted by set
// ---------------------------------------------------------------------------
const ICONS = new Map();
const RAR_BG = { 3: ['#4a6a9a', '#2a3a5a'], 4: ['#8a62b8', '#4a3270'], 5: ['#c98a3a', '#7a4a1a'] };
export function gearIcon(kind, sub, rarity, tint = '#e8e0cc') {
  const key = kind + sub + rarity + tint;
  if (ICONS.has(key)) return ICONS.get(key);
  const S = 96;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const [a, b] = RAR_BG[rarity] || RAR_BG[3];
  const bg = g.createLinearGradient(0, 0, 0, S);
  bg.addColorStop(0, a);
  bg.addColorStop(1, b);
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect(2, 2, S - 4, S - 4, 14);
  g.fill();
  g.save();
  g.translate(S / 2, S / 2);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const metal = g.createLinearGradient(-30, -30, 30, 30);
  metal.addColorStop(0, '#ffffff');
  metal.addColorStop(1, '#b8c0d0');
  g.shadowColor = 'rgba(0,0,0,.35)';
  g.shadowBlur = 6;
  if (kind === 'weapon') {
    g.rotate(-Math.PI / 4);
    if (sub === 'sword') {
      g.fillStyle = metal;
      g.beginPath();
      g.moveTo(0, -36);
      g.lineTo(6, -26);
      g.lineTo(5, 14);
      g.lineTo(-5, 14);
      g.lineTo(-6, -26);
      g.closePath();
      g.fill();
      g.fillStyle = '#e3b25a';
      g.fillRect(-14, 14, 28, 5);
      g.fillStyle = '#6b4a33';
      g.fillRect(-3, 19, 6, 14);
    } else if (sub === 'claymore') {
      g.fillStyle = metal;
      g.beginPath();
      g.moveTo(0, -38);
      g.lineTo(11, -24);
      g.lineTo(10, 12);
      g.lineTo(-10, 12);
      g.lineTo(-11, -24);
      g.closePath();
      g.fill();
      g.fillStyle = '#e3b25a';
      g.fillRect(-18, 12, 36, 6);
      g.fillStyle = '#5a3a26';
      g.fillRect(-4, 18, 8, 18);
    } else if (sub === 'polearm') {
      g.strokeStyle = '#7a5236';
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(0, -18);
      g.lineTo(0, 40);
      g.stroke();
      g.fillStyle = metal;
      g.beginPath();
      g.moveTo(0, -42);
      g.lineTo(8, -20);
      g.lineTo(0, -14);
      g.lineTo(-8, -20);
      g.closePath();
      g.fill();
      g.fillStyle = '#e3b25a';
      g.fillRect(-7, -16, 14, 4);
    } else if (sub === 'bow') {
      g.rotate(Math.PI / 4);
      g.strokeStyle = '#7a5236';
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(-8, -38);
      g.quadraticCurveTo(26, 0, -8, 38);
      g.stroke();
      g.strokeStyle = tint;
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(-8, -38);
      g.quadraticCurveTo(8, 0, -8, 38);
      g.stroke();
      g.strokeStyle = 'rgba(255,255,255,.85)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(-8, -38);
      g.lineTo(-8, 38);
      g.stroke();
      g.fillStyle = '#e3b25a';
      g.fillRect(6, -6, 7, 12);
    } else {
      g.rotate(Math.PI / 4);
      g.fillStyle = '#7a4a8a';
      g.fillRect(-22, -26, 44, 52);
      g.fillStyle = '#f2ead8';
      g.fillRect(-18, -22, 36, 44);
      g.strokeStyle = tint;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(0, 0, 11, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = '#e3b25a';
      g.fillRect(-22, -26, 6, 52);
    }
  } else {
    g.fillStyle = tint;
    g.strokeStyle = 'rgba(255,255,255,.85)';
    g.lineWidth = 2;
    if (sub === 'flower') {
      for (let k = 0; k < 5; k++) {
        g.save();
        g.rotate((k / 5) * Math.PI * 2);
        g.beginPath();
        g.ellipse(0, -16, 9, 16, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
      g.fillStyle = '#fff2c0';
      g.beginPath();
      g.arc(0, 0, 8, 0, Math.PI * 2);
      g.fill();
    } else if (sub === 'plume') {
      g.rotate(0.5);
      g.beginPath();
      g.ellipse(0, -6, 12, 30, 0, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.moveTo(0, -34);
      g.lineTo(0, 34);
      g.stroke();
    } else if (sub === 'sands') {
      g.beginPath();
      g.moveTo(-18, -30);
      g.lineTo(18, -30);
      g.lineTo(2, 0);
      g.lineTo(18, 30);
      g.lineTo(-18, 30);
      g.lineTo(-2, 0);
      g.closePath();
      g.fill();
      g.stroke();
    } else if (sub === 'goblet') {
      g.beginPath();
      g.moveTo(-20, -26);
      g.quadraticCurveTo(-20, 6, 0, 8);
      g.quadraticCurveTo(20, 6, 20, -26);
      g.closePath();
      g.fill();
      g.fillRect(-3, 8, 6, 16);
      g.fillRect(-14, 24, 28, 5);
    } else {
      g.beginPath();
      g.moveTo(-26, 16);
      g.lineTo(-26, -14);
      g.lineTo(-13, 0);
      g.lineTo(0, -24);
      g.lineTo(13, 0);
      g.lineTo(26, -14);
      g.lineTo(26, 16);
      g.closePath();
      g.fill();
      g.stroke();
    }
  }
  g.restore();
  const url = cv.toDataURL();
  ICONS.set(key, url);
  return url;
}
