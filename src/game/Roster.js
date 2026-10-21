import * as THREE from 'three';
import { PARTY, ELEMENTS, STARTER_PARTY } from '../character/characters.js';
import { elementIcon } from '../ui/icons.js';
import { WEAPON_TYPES, Gear } from './Gear.js';

// Who travels with you. Four start the journey; new companions are met out
// in the world and join after a short talk. The party setup screen (K) picks
// any four, with the chosen character shown in the world beside the panel.

const BLURB = {
  aria: '바람을 타고 검을 휘두르는 여행자. 적을 끌어모으고 원소를 퍼뜨린다.',
  ren: '불꽃처럼 뜨거운 방랑 검사. 묵직한 대검으로 길을 연다.',
  mizu: '물결의 노래로 동료를 치유하는 소녀.',
  rai: '번개를 부르는 창술가. 여러 적을 동시에 꿰뚫는다.',
  seolha: '설산 기슭에서 홀로 수행하는 궁수. 화살 끝에 서리꽃을 피우고, 물 위에 얼음길을 낸다.',
  karun: '고원의 바위산을 지키는 과묵한 전사. 바위 기둥을 세우고 동료에게 결정 방패를 씌운다.',
};

const el = (tag, cls, html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

export class Roster {
  constructor(game) {
    this.g = game;
    const prog = game.explore.progress;
    const R = (this.d = prog.roster || (prog.roster = { have: [...STARTER_PARTY], party: [...STARTER_PARTY] }));
    R.have = R.have.filter((id) => PARTY.some((c) => c.id === id));
    R.party = R.party.filter((id) => R.have.includes(id));
    if (!R.party.length) R.party = [...STARTER_PARTY];
    game.player.setParty(R.party);
    this.slot = 0;
    this.view = null;
    this.buildPanel();
  }

  has(id) {
    return this.d.have.includes(id);
  }

  // ---------------------------------------------------------------- recruits
  // NPC stand-ins for characters not met yet
  static recruitDefs() {
    return PARTY.filter((c) => c.recruit).map((c) => ({
      id: 'recruit-' + c.id,
      name: c.name,
      title: c.title,
      recruit: c.id,
      cfg: c,
      route: [[c.recruit.x, c.recruit.z]],
      face: c.id === 'seolha' ? Math.PI * 0.8 : -Math.PI * 0.3,
      speed: 0,
      wait: [99, 99],
      lines:
        c.id === 'seolha'
          ? ['…바람이 차갑네. 눈이 오려나.', '활시위는 마음처럼 곧아야 해.', '서리꽃은 추울수록 예쁘게 피어.']
          : ['바위는 서두르지 않는다.', '고원의 바람이 수상하군.', '…방패가 필요한가?'],
    }));
  }

  script(npc) {
    const id = npc.def.recruit;
    const N = npc.name,
      T = npc.title;
    if (id === 'seolha')
      return async (d) => {
        await d.say(N, '…발소리가 가볍네. 여행자구나. 이런 설산 기슭까지는 무슨 일로?', T);
        await d.say(N, '나는 설하. 이 산에서 활을 익히고 있어. 요즘 산바람이 거칠어져서 혼자 지내기 심심하던 참이었지.', T);
        const i = await d.choose([
          { text: '같이 여행하지 않을래요?', icon: 'quest' },
          { text: '활 솜씨를 보여 줄 수 있나요?', icon: 'talk' },
        ]);
        if (i === 1) await d.say(N, '좋아. 서리꽃을 피운 화살은 적을 얼리고, 내 발밑의 물은 얼음길이 돼. …직접 보는 게 빠르겠지?', T);
        await d.say(N, '함께 가 줄게. 대신 맛있는 걸 먹을 때는 나도 불러 줘.', T);
        this.recruit(id);
      };
    return async (d) => {
      await d.say(N, '……고원에 낯선 발걸음이 들리더니, 너였나.', T);
      await d.say(N, '나는 카룬. 바위산을 지키는 일족의 마지막 전사다. 요즘 고블린들이 고원을 어지럽히고 있지.', T);
      const i = await d.choose([
        { text: '함께 싸워 주세요.', icon: 'quest' },
        { text: '바위산의 힘이란 뭔가요?', icon: 'talk' },
      ]);
      if (i === 1) await d.say(N, '바위는 원소를 붙잡아 결정으로 만든다. 그 결정은 동료를 지키는 방패가 되지. 내가 세운 기둥 위에 올라서도 좋다.', T);
      await d.say(N, '…좋다. 네 바람이 어디로 가는지, 이 방패로 지켜보겠다.', T);
      this.recruit(id);
    };
  }

  recruit(id) {
    const g = this.g;
    if (this.has(id)) return;
    this.d.have.push(id);
    const c = g.player.byId(id);
    // their own starter weapon comes with them
    Gear.migrate(g.explore.progress, [c.cfg]);
    g.progression.apply(c, g.progression.data[c.cfg.id], true);
    if (this.d.party.length < 4) {
      this.d.party.push(id);
      g.player.setParty(this.d.party);
      g.hud.setParty(g.player.party, g.player.active);
    }
    const E = ELEMENTS[c.cfg.element];
    setTimeout(() => {
      g.hud.showBanner(`새로운 동료 · ${c.cfg.name}`);
      g.hud.toast(`<b>${c.cfg.name}</b> 합류 · <b>K</b> 파티 편성에서 파티에 넣을 수 있습니다`, E.color);
      g.sfx.unseal();
    }, 400);
    g.explore.save();
  }

  // ---------------------------------------------------------------- panel
  buildPanel() {
    const g = this.g;
    this.el = el(
      'div',
      'panel-wrap party-wrap hidden',
      `<div class="panel party-panel">
        <div class="pn-head"><div class="pn-title">파티 편성</div><div class="pn-sub">칸을 고른 뒤 아래에서 캐릭터를 누르세요</div><button class="pn-close" aria-label="닫기">✕</button></div>
        <div class="pt-slots"></div>
        <div class="pt-info"></div>
        <div class="pt-list"></div>
      </div>`
    );
    g.container.appendChild(this.el);
    this.el.querySelector('.pn-close').addEventListener('click', () => g.closePanel());
  }

  canEdit() {
    const g = this.g;
    if (g.battleHold > 0) return '전투 중에는 파티를 바꿀 수 없습니다';
    if (g.domain && g.domain.inside) return '비경 안에서는 파티를 바꿀 수 없습니다';
    return null;
  }

  open() {
    this.slot = Math.min(this.g.player.active, this.d.party.length - 1);
    this.view = this.d.party[this.slot];
    this.camT = 0;
    this.camPos = null;
    this.render();
    this.el.classList.remove('hidden');
  }

  close() {
    this.el.classList.add('hidden');
    const P = this.g.player;
    for (const c of P.roster) c.model.root.visible = false;
    P.model.root.visible = true;
    P.model.root.position.copy(P.pos);
    this.g.cameraCtl.initialized = false;
  }

  render() {
    const g = this.g;
    const P = g.player;
    const R = this.d;
    const card = (id, i) => {
      if (!id) return `<button class="pt-slot empty ${i === this.slot ? 'on' : ''}" data-i="${i}"><span>+</span></button>`;
      const c = P.byId(id);
      const E = ELEMENTS[c.cfg.element];
      return `<button class="pt-slot ${i === this.slot ? 'on' : ''}" data-i="${i}" style="--el:${E.color}"><img src="${c.portrait || ''}" alt=""><span class="pt-el">${elementIcon(E.icon, E.color, 18)}</span><b>${c.cfg.name}</b><small>Lv.${c.level}</small><i class="pt-n">${i + 1}</i></button>`;
    };
    this.el.querySelector('.pt-slots').innerHTML = [0, 1, 2, 3].map((i) => card(R.party[i], i)).join('');
    this.el.querySelectorAll('.pt-slot').forEach((b) =>
      b.addEventListener('click', () => {
        this.slot = +b.dataset.i;
        if (R.party[this.slot]) this.view = R.party[this.slot];
        g.sfx.click && g.sfx.click();
        this.render();
      })
    );
    // the character being looked at
    const v = P.byId(this.view);
    if (v) {
      const E = ELEMENTS[v.cfg.element];
      const inParty = R.party.indexOf(v.cfg.id);
      const btn = inParty === this.slot ? (R.party.length > 1 ? '파티에서 빼기' : '') : inParty >= 0 ? `${this.slot + 1}번 칸과 자리 바꾸기` : `${this.slot + 1}번 칸에 넣기`;
      this.el.querySelector('.pt-info').innerHTML = `<div class="pt-name" style="--el:${E.color}">${elementIcon(E.icon, E.color, 26)}<div><b>${v.cfg.name}</b><span>${v.cfg.title} · ${E.name} · ${WEAPON_TYPES[v.cfg.weapon]}</span></div></div>
        <p>${BLURB[v.cfg.id] || ''}</p>
        <div class="pt-stats"><span>Lv.<b>${v.level}</b></span><span>HP <b>${Math.round(v.maxHp).toLocaleString()}</b></span><span>공격력 <b>${Math.round(v.atk || 0).toLocaleString()}</b></span></div>
        ${btn ? `<button class="pt-act">${btn}</button>` : ''}`;
      const act = this.el.querySelector('.pt-act');
      if (act) act.addEventListener('click', () => this.assign(v.cfg.id));
    }
    // everyone met so far, plus silhouettes of those still out there
    this.el.querySelector('.pt-list').innerHTML = PARTY.map((cfg) => {
      const E = ELEMENTS[cfg.element];
      if (!this.has(cfg.id)) return `<div class="pt-card locked" title="${cfg.recruit ? cfg.recruit.where : ''}"><div class="pt-q">?</div><small>${cfg.recruit ? cfg.recruit.where + '에서 만날 수 있음' : ''}</small></div>`;
      const c = P.byId(cfg.id);
      const k = R.party.indexOf(cfg.id);
      return `<button class="pt-card ${cfg.id === this.view ? 'on' : ''} ${k >= 0 ? 'inp' : ''}" data-id="${cfg.id}" style="--el:${E.color}"><img src="${c.portrait || ''}" alt=""><span class="pt-el">${elementIcon(E.icon, E.color, 16)}</span>${k >= 0 ? `<i class="pt-n">${k + 1}</i>` : ''}<b>${cfg.name}</b></button>`;
    }).join('');
    this.el.querySelectorAll('.pt-card[data-id]').forEach((b) =>
      b.addEventListener('click', () => {
        this.view = b.dataset.id;
        g.sfx.click && g.sfx.click();
        this.render();
      })
    );
  }

  // put `id` into the selected slot (swapping if it is already in the party)
  assign(id) {
    const g = this.g;
    const why = this.canEdit();
    if (why) {
      g.hud.flashCenter(why);
      return;
    }
    const R = this.d;
    const party = [...R.party];
    const at = party.indexOf(id);
    if (at === this.slot) {
      if (party.length <= 1) return;
      party.splice(at, 1);
      this.slot = Math.min(this.slot, party.length - 1);
    } else if (at >= 0) {
      [party[at], party[this.slot]] = [party[this.slot], party[at]];
    } else if (this.slot >= party.length) party.push(id);
    else party[this.slot] = id;
    R.party = party;
    g.player.setParty(party);
    g.hud.setParty(g.player.party, g.player.active);
    g.sfx.swap(g.player.byId(id).cfg.element);
    g.explore.save();
    this.render();
  }

  // the character on show stands where the player is, framed beside the panel
  updateShowcase(dt) {
    const g = this.g;
    const P = g.player;
    const v = P.byId(this.view) || P.current;
    for (const c of P.roster) c.model.root.visible = c === v;
    const m = v.model;
    m.root.position.copy(P.pos);
    this.camT += dt;
    const yaw = P.yaw;
    m.root.rotation.y = yaw;
    m.update(dt, { mode: 'idle', speed: 0 });
    const h = 1.6 * v.cfg.scale;
    const fx = Math.sin(yaw),
      fz = Math.cos(yaw);
    // the camera's right as it faces the character; looking a little to that
    // side puts the character on the left, clear of the panel
    const sx = fz,
      sz = -fx;
    const sway = Math.sin(this.camT * 0.4) * 0.15;
    const cam = g.camera;
    const want = new THREE.Vector3(P.pos.x + fx * 3.3 + sx * (1.25 + sway), P.pos.y + h * 0.72, P.pos.z + fz * 3.3 + sz * (1.25 + sway));
    // stay above the ground in front of the character
    want.y = Math.max(want.y, g.ground.heightAt(want.x, want.z) + 0.6);
    if (!this.camPos) this.camPos = want.clone();
    this.camPos.lerp(want, 1 - Math.exp(-dt * 5));
    cam.position.copy(this.camPos);
    cam.lookAt(P.pos.x + sx * 1.05, P.pos.y + h * 0.6, P.pos.z + sz * 1.05);
  }
}
