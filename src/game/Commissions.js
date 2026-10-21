import * as THREE from 'three';
import { ITEMS, itemIcon } from './Items.js';
import { LANDMARKS, CAMPS, PORT_LEN, portWorld } from '../world/Terrain.js';
import { Builder, M, box } from '../world/Structures.js';
import { rollArtifact } from './Gear.js';
import { elementIcon } from '../ui/icons.js';

// Daily commissions and regional reputation. Four small jobs are posted on
// the notice boards each (real) day — a hunt, a gathering run, a delivery and
// a scouting climb. Each pays star gems and reputation; finishing all four
// earns a bonus at either notice board. Reputation levels unlock rewards up
// to a 5★ weapon per region.

const REGIONS = {
  village: { name: '풍차 마을', color: '#7fd6a8' },
  port: { name: '단풍 항구', color: '#f0a050' },
};
const REP_LV = [0, 80, 200, 360, 560];
const REP_REWARDS = {
  village: { 2: { gems: 120, ore: 4 }, 3: { art: { set: 'windsong', rarity: 4 } }, 4: { gems: 160, refine: 2 }, 5: { weapon: 'galeSword' } },
  port: { 2: { gems: 120, ore: 4 }, 3: { art: { set: 'lantern', rarity: 4 } }, 4: { gems: 160, refine: 2 }, 5: { weapon: 'windstarOrb' } },
};
const PAY = 40;

const L = PORT_LEN;
function pool(S) {
  const V = LANDMARKS.village;
  const hunt = [
    { region: 'village', text: '초원 가장자리 슬라임 퇴치', x: -12, z: 18, r: 24, need: 3 },
    { region: 'village', text: '풍차 마을 서쪽 들판 정리', x: -160, z: 80, r: 24, need: 3 },
    { region: 'village', text: '거울 호숫가 물슬라임 퇴치', x: 72, z: 70, r: 24, need: 3 },
    { region: 'village', text: '오솔길의 슬라임 쫓아내기', x: -70, z: 95, r: 24, need: 3 },
    { region: 'port', text: '단풍숲의 불슬라임 진정시키기', x: 192, z: 288, r: 22, need: 3 },
    { region: 'port', text: '능선의 주술사 무리 소탕', x: 238, z: 180, r: 22, need: 3 },
    { region: 'port', text: '협곡 서쪽 고블린 쫓아내기', x: 100, z: 258, r: 22, need: 3 },
    { region: 'port', text: '동쪽 절벽의 매복 무찌르기', x: 292, z: 260, r: 22, need: 3 },
  ];
  const gather = [
    { region: 'village', item: 'apple', need: 3 },
    { region: 'village', item: 'mushroom', need: 3 },
    { region: 'village', item: 'berry', need: 4 },
    { region: 'village', item: 'bellflower', need: 3 },
  ];
  const deliver = [
    { region: 'village', npc: 'keeper', item: 'skewer', text: '풍차지기 토마에게 달빛버섯 꼬치 전해주기' },
    { region: 'village', npc: 'child', item: 'pie', text: '루루에게 별딸기 파이 전해주기' },
    { region: 'village', npc: 'elder', item: 'soup', text: '촌장 하르반에게 바람방울 수프 전해주기' },
    { region: 'port', npc: 'fisher', item: 'roastApple', text: '어부 소라에게 노을사과 구이 전해주기' },
    { region: 'port', npc: 'sailor', item: 'soup', text: '늙은 선원 도윤에게 바람방울 수프 전해주기' },
    { region: 'port', npc: 'harbor', item: 'skewer', text: '항구장 이안에게 달빛버섯 꼬치 전해주기' },
  ];
  const scout = [];
  if (S.lighthouse) scout.push({ region: 'port', text: '등대 꼭대기에서 바다 살펴보기', x: S.lighthouse.x, y: 12.8, z: S.lighthouse.z, r: 3.2 });
  if (S.bridge) {
    const m = S.bridge.deck(0.5);
    scout.push({ region: 'port', text: '바람다리 한가운데서 협곡 내려다보기', x: m.x, y: m.y, z: m.z, r: 3 });
  }
  if (CAMPS[1].tower) scout.push({ region: 'port', text: '붉은 단풍 야영지 망루 정찰하기', x: CAMPS[1].tower.x, y: CAMPS[1].tower.y, z: CAMPS[1].tower.z, r: 2.6 });
  if (S.windmills[0]) {
    const w = S.windmills[0];
    scout.push({ region: 'village', text: '풍차 꼭대기에서 마을 둘러보기', x: w.x, y: w.top, z: w.z, r: 3.5 });
  }
  if (S.statue) scout.push({ region: 'village', text: '수호상 머리 위에서 초원 바라보기', x: S.statue.center.x, y: S.statue.top, z: S.statue.center.z, r: 3.5 });
  return { hunt, gather, deliver, scout };
}

function seeded(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const el = (tag, cls, html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};
const _v = new THREE.Vector3();

export class Commissions {
  constructor(game) {
    this.g = game;
    const prog = game.explore.progress;
    this.prog = prog;
    if (!prog.rep) prog.rep = { village: { xp: 0, got: [] }, port: { xp: 0, got: [] } };
    this.rep = prog.rep;
    this.pool = pool(game.structures);
    this.boards = [];
    this.buildBoards();
    this.ensureDay();
    // HUD tracker under the quest tracker
    this.tracker = el('div', 'comm-track hidden', '<div class="ct-head">일일 의뢰</div><div class="ct-list"></div>');
    game.hud.layer.appendChild(this.tracker);
    this.tracker.addEventListener('click', () => game.openPanel(this));
    this.trackKey = '';
    // panel
    this.el = el(
      'div',
      'panel-wrap hidden',
      `<div class="panel comm-panel">
        <div class="pn-head"><div class="pn-title">의뢰 게시판</div><div class="pn-sub">매일 새 의뢰가 붙습니다</div><button class="pn-close" aria-label="닫기">✕</button></div>
        <div class="cm-body"></div>
      </div>`
    );
    game.container.appendChild(this.el);
    this.body = this.el.querySelector('.cm-body');
    this.el.querySelector('.pn-close').addEventListener('click', () => game.closePanel());
    this.el.addEventListener('pointerdown', (e) => e.target === this.el && game.closePanel());
  }

  // ---- the day's list
  ensureDay(force) {
    const day = today();
    const c = this.prog.comm;
    if (!force && c && c.day === day) return;
    const r = seeded('starwind' + day + (force || ''));
    const pick = (list) => list[Math.floor(r() * list.length)];
    const P = this.pool;
    const g = pick(P.gather);
    const list = [
      { type: 'hunt', ...pick(P.hunt), n: 0 },
      { type: 'gather', ...g, text: `${ITEMS[g.item].name} ${g.need}개 채집하기`, n: 0 },
      { type: 'deliver', ...pick(P.deliver), need: 1, n: 0 },
      { type: 'scout', ...pick(P.scout), need: 1, n: 0 },
    ];
    this.prog.comm = { day, list, bonus: false };
    this.g.explore.save();
  }
  get list() {
    return this.prog.comm.list;
  }
  get allDone() {
    return this.list.every((c) => c.done);
  }

  complete(c) {
    if (c.done) return;
    c.done = true;
    c.n = c.need;
    const g = this.g;
    g.gems += PAY;
    g.sfx.questStep();
    g.hud.toast(`<b>의뢰 완료</b> · ${c.text} · ${elementIcon('gem', '#9fe8ff', 13)} ${PAY}`, '#c9a8ff');
    this.addRep(c.region, 25);
    if (g.achievements) g.achievements.add('commissions');
    if (this.allDone) setTimeout(() => g.hud.showBanner('오늘의 의뢰 완료 · 게시판에서 보상을 받으세요'), 1200);
    g.explore.save();
  }

  // ---- progress hooks
  onKill(e) {
    for (const c of this.list) {
      if (c.done || c.type !== 'hunt') continue;
      if (Math.hypot(e.home.x - c.x, e.home.z - c.z) < c.r) {
        c.n++;
        if (c.n >= c.need) this.complete(c);
        else this.g.hud.toast(`의뢰 · ${c.text} (${c.n}/${c.need})`, '#c9a8ff');
      }
    }
  }
  onGather(type) {
    for (const c of this.list) {
      if (c.done || c.type !== 'gather' || c.item !== type) continue;
      c.n++;
      if (c.n >= c.need) this.complete(c);
    }
  }
  // wrap an NPC's conversation with a delivery offer when one is due
  wrapTalk(npc, script) {
    const c = this.list.find((x) => !x.done && x.type === 'deliver' && x.npc === npc.id);
    if (!c) return script;
    const g = this.g;
    return async (d) => {
      const has = g.bag.count(c.item) > 0;
      const i = await d.choose([
        { text: `(의뢰) ${ITEMS[c.item].name} 건네주기${has ? '' : ' — 가방에 없음'}`, icon: 'quest' },
        { text: '다른 이야기를 한다', icon: 'talk' },
      ]);
      if (i === 0) {
        if (!has) {
          await d.say(npc.name, `${ITEMS[c.item].name}… 요리 솥에서 만들 수 있다고 들었어요. 기다릴게요!`, npc.title);
          return;
        }
        g.bag.take({ [c.item]: 1 });
        await d.say(npc.name, `와, ${ITEMS[c.item].name}! 정말 고마워요. 이건 작은 답례예요.`, npc.title);
        this.complete(c);
        return;
      }
      if (script) await script(d);
    };
  }

  update(dt) {
    const g = this.g;
    if (g.state !== 'playing') return;
    this.dayT = (this.dayT || 0) - dt;
    if (this.dayT <= 0) {
      this.dayT = 30;
      const before = this.prog.comm.day;
      this.ensureDay();
      if (this.prog.comm.day !== before) g.hud.toast('새로운 일일 의뢰가 게시판에 붙었습니다', '#c9a8ff');
    }
    const P = g.player.pos;
    for (const c of this.list) {
      if (c.done || c.type !== 'scout') continue;
      if (Math.hypot(P.x - c.x, P.z - c.z) < c.r && P.y > c.y - 1.2 && P.y < c.y + 3) {
        g.flashScreen('#e8dcff', 0.2);
        this.complete(c);
      }
    }
    this.updateTracker();
  }

  updateTracker() {
    const g = this.g;
    const active = this.list.filter((c) => !c.done);
    const show = g.state === 'playing' && (active.length > 0 || (this.allDone && !this.prog.comm.bonus));
    this.tracker.classList.toggle('hidden', !show);
    if (!show) return;
    const key = this.list.map((c) => c.n + (c.done ? 'd' : '')).join('|') + this.prog.comm.bonus;
    if (key === this.trackKey) return;
    this.trackKey = key;
    const items = active.length ? active.map((c) => `<div class="ct-item">◇ ${c.text}${c.need > 1 ? ` <b>${c.n}/${c.need}</b>` : ''}</div>`) : ['<div class="ct-item done">게시판에서 일일 보상 받기</div>'];
    this.tracker.querySelector('.ct-list').innerHTML = items.join('');
  }

  minimapMarkers(out) {
    for (const c of this.list) {
      if (c.done) continue;
      const p = this.targetOf(c);
      if (p) out.push({ x: p.x, z: p.z, shape: 'comm' });
    }
  }
  targetOf(c) {
    if (c.type === 'hunt' || c.type === 'scout') return c;
    if (c.type === 'deliver') {
      const n = this.g.npcs.get(c.npc);
      return n ? n.pos : null;
    }
    return null;
  }

  // ---- reputation
  repLevel(id) {
    const xp = this.rep[id].xp;
    let lv = 1;
    for (let i = 0; i < REP_LV.length; i++) if (xp >= REP_LV[i]) lv = i + 1;
    return lv;
  }
  addRep(id, n) {
    const before = this.repLevel(id);
    this.rep[id].xp += n;
    const after = this.repLevel(id);
    if (after > before) {
      this.g.hud.toast(`<b>${REGIONS[id].name}</b> 평판 Lv.${after} · 게시판에서 보상 받기`, REGIONS[id].color);
      this.g.sfx.questDone();
    }
  }
  onChest(c) {
    const d = Math.hypot(c.pos.x - LANDMARKS.village.x, c.pos.z - LANDMARKS.village.z);
    if (this.g.terrain.autumnAt(c.pos.x, c.pos.z) > 0.3) this.addRep('port', 10);
    else if (d < 160) this.addRep('village', 10);
  }
  claimRep(id, lv) {
    const R = this.rep[id];
    if (R.got.includes(lv) || this.repLevel(id) < lv) return;
    R.got.push(lv);
    const rw = REP_REWARDS[id][lv];
    const G = this.g.gear;
    if (rw.gems) {
      this.g.gems += rw.gems;
      this.g.hud.toast(`획득 · <b>별빛 결정</b> ×${rw.gems}`, '#9fe8ff');
    }
    G.give({ ore: rw.ore, refine: rw.refine, weapon: rw.weapon, art: rw.art ? rollArtifact(Math.random, rw.art) : null });
    this.g.sfx.chest(2);
    this.g.explore.save();
  }
  claimBonus() {
    const C = this.prog.comm;
    if (!this.allDone || C.bonus) return;
    C.bonus = true;
    this.g.gems += 80;
    this.g.hud.toast('획득 · <b>별빛 결정</b> ×80', '#9fe8ff');
    this.g.gear.give({ ore: 4, art: rollArtifact(Math.random, { rarity: Math.random() < 0.25 ? 5 : 4 }) });
    this.addRep('village', 15);
    this.addRep('port', 15);
    this.g.sfx.chest(1);
    this.g.explore.save();
  }

  // ---- notice boards (village plaza + harbour plaza)
  buildBoards() {
    const S = this.g.structures;
    const T = this.g.terrain;
    const V = LANDMARKS.village;
    const spots = [
      { x: V.x - 3.6, z: V.z + 6.9, face: [V.x, V.z] },
      { at: portWorld(L - 3, -7.5), face: portWorld(L - 3, 0) },
    ];
    const b = new Builder();
    for (const s of spots) {
      const [x, z] = s.at || [s.x, s.z];
      const y = T.heightAt(x, z);
      const rot = Math.atan2(s.face[0] - x, s.face[1] - z);
      const F = S.frame(x, y, z, rot);
      const at = (m) => F.clone().multiply(m);
      for (const sx of [-1, 1]) b.add('wood', box(0.16, 2.5, 0.16), { m: at(M(sx * 1.05, -0.1, 0)), color: '#6b4630' });
      b.add('wood', box(2.3, 1.35, 0.12), { m: at(M(0, 0.95, 0)), color: '#9a7048', uvScale: 0.8 });
      b.add('roof', new THREE.BoxGeometry(2.7, 0.08, 0.7), { m: at(M(0, 2.5, 0.05, 0.35, 0, 0)), color: '#c25a3a', uv: 'local', uvScale: 0.6 });
      const notes = ['#f6efd8', '#ffe9b8', '#e8f0ff', '#f6efd8', '#ffd8c8'];
      for (let k = 0; k < 5; k++) {
        const nx = -0.75 + (k % 3) * 0.75 + (k > 2 ? 0.37 : 0),
          ny = k > 2 ? 1.25 : 1.75;
        b.add('plain', new THREE.PlaneGeometry(0.5, 0.42), { m: at(M(nx, ny, 0.07, 0, 0, (k - 2) * 0.06)), color: notes[k] });
        b.add('plain', new THREE.SphereGeometry(0.035, 6, 4), { m: at(M(nx, ny + 0.17, 0.09)), color: '#c23a2c' });
      }
      S.solids.addBox(x, z, 1.15, 0.2, rot, y + 2.3);
      T.addBlocker(x, z, 2);
      this.boards.push(new THREE.Vector3(x, y, z).add(new THREE.Vector3(Math.sin(rot), 0, Math.cos(rot)).multiplyScalar(1.2)));
    }
    b.build(S.mats, S.group);
  }

  consider(P, consider) {
    for (const p of this.boards) consider(p, 2.6, '의뢰 게시판 보기', () => this.g.openPanel(this));
  }

  // ---- panel (openPanel / closePanel interface)
  open() {
    this.render();
    this.el.classList.remove('hidden');
  }
  close() {
    this.el.classList.add('hidden');
  }

  render() {
    const g = this.g;
    const C = this.prog.comm;
    const ic = { hunt: '⚔', gather: '✿', deliver: '✉', scout: '⛰' };
    const rows = this.list
      .map((c) => {
        const R = REGIONS[c.region];
        const extra = c.type === 'deliver' ? `<img src="${itemIcon(c.item)}" alt="">` : '';
        return `<div class="cm-row ${c.done ? 'done' : ''}"><div class="cm-ic">${ic[c.type]}</div>
          <div class="cm-txt"><div class="cm-t">${c.text}</div><div class="cm-r" style="color:${R.color}">${R.name} · ${elementIcon('gem', '#9fe8ff', 12)} ${PAY} · 평판 +25</div></div>
          ${extra}<div class="cm-st">${c.done ? '완료' : c.need > 1 ? `${c.n}/${c.need}` : '진행 중'}</div></div>`;
      })
      .join('');
    const reps = Object.entries(REGIONS)
      .map(([id, R]) => {
        const lv = this.repLevel(id);
        const xp = this.rep[id].xp;
        const next = REP_LV[lv] ?? null;
        const prev = REP_LV[lv - 1];
        const pct = next ? ((xp - prev) / (next - prev)) * 100 : 100;
        const rewards = [2, 3, 4, 5]
          .map((k) => {
            const rw = REP_REWARDS[id][k];
            const got = this.rep[id].got.includes(k);
            const ok = lv >= k && !got;
            const label = rw.weapon ? '5★ 무기' : rw.art ? '4★ 성유물' : rw.refine ? `결정 ${rw.gems} · 정제 ${rw.refine}` : `결정 ${rw.gems} · 광석 ${rw.ore}`;
            return `<button class="rep-rw ${got ? 'got' : ''}" data-r="${id}" data-l="${k}" ${ok ? '' : 'disabled'}><b>Lv.${k}</b><span>${label}</span>${got ? '<i>✓</i>' : ''}</button>`;
          })
          .join('');
        return `<div class="rep" style="--rc:${R.color}"><div class="rep-h"><b>${R.name}</b> 평판 Lv.${lv}<span>${next ? `${xp - prev} / ${next - prev}` : '최대'}</span></div>
          <div class="rep-bar"><div style="width:${pct}%"></div></div><div class="rep-rws">${rewards}</div></div>`;
      })
      .join('');
    this.body.innerHTML = `
      <div class="cm-sub">오늘의 의뢰 <small>${C.day}</small></div>
      <div class="cm-list">${rows}</div>
      <button class="cm-claim" ${this.allDone && !C.bonus ? '' : 'disabled'}>${C.bonus ? '오늘의 보상을 받았습니다' : this.allDone ? '일일 보상 받기 · 결정 80 · 광석 4 · 성유물' : `일일 보상 · 의뢰 ${this.list.filter((c) => c.done).length}/4`}</button>
      <div class="cm-sub">평판</div>
      ${reps}`;
    this.body.querySelector('.cm-claim').addEventListener('click', () => {
      this.claimBonus();
      this.render();
    });
    this.body.querySelectorAll('.rep-rw').forEach((b) =>
      b.addEventListener('click', () => {
        this.claimRep(b.dataset.r, +b.dataset.l);
        this.render();
      })
    );
  }
}
