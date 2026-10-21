import * as THREE from 'three';
import { ITEMS } from './Items.js';
import { CAMPS } from '../world/Terrain.js';
import { setBeacon } from '../world/Highlands.js';

// Opening quest "바람이 머무는 마을" (The village where the wind stays) plus
// everyday conversations with the villagers. Progress is saved with the rest
// of the exploration state.

// chapter 2 "단풍 항구의 등불" (Lanterns of the maple harbour) continues
// in the autumn highlands across the rope bridge.
const TITLES = { 1: '바람이 머무는 마을', 2: '단풍 항구의 등불' };
const TITLE = TITLES[1];

const STEPS = [
  { id: 'meet', ch: 1, text: '풍차 마을의 촌장 하르반과 대화하기' },
  { id: 'pray', ch: 1, text: '바람의 수호상에 기도하기' },
  { id: 'return', ch: 1, text: '촌장 하르반에게 돌아가기' },
  { id: 'flowers', ch: 1, text: '바람방울꽃 모으기' },
  { id: 'cook', ch: 1, text: '요리사 미라에게 바람방울꽃 전해주기' },
  { id: 'ruins', ch: 1, text: '잊힌 유적의 고리 석상 조사하기' },
  { id: 'report', ch: 1, text: '촌장 하르반에게 보고하기' },
  { id: 'harbor', ch: 2, text: '바람다리를 건너 단풍 항구의 항구장 이안 만나기' },
  { id: 'camp', ch: 2, text: '감시탑 야영지의 고블린 무찌르기' },
  { id: 'lens', ch: 2, text: '야영지에서 바람등불 되찾기' },
  { id: 'light', ch: 2, text: '등대에 바람등불 밝히기' },
  { id: 'report2', ch: 2, text: '항구장 이안에게 보고하기' },
  { id: 'done', ch: 2, text: '' },
];
const stepIndex = (id) => STEPS.findIndex((s) => s.id === id);

const el = (tag, cls, html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

export class Quest {
  constructor(game) {
    this.g = game;
    const prog = game.explore.progress;
    if (typeof prog.quest !== 'number') prog.quest = 0;
    this.prog = prog;
    this.tracker = el('div', 'quest-track hidden', `<div class="qt-title"><span class="qt-ic">◆</span><span class="qt-name">${TITLE}</span></div><div class="qt-obj"></div><div class="qt-dist"></div>`);
    game.hud.layer.appendChild(this.tracker);
    this.marker = el('div', 'q-marker hidden', '<div class="qm-ic">◆</div><div class="qm-d"></div>');
    game.hud.layer.appendChild(this.marker);
    this.objEl = this.tracker.querySelector('.qt-obj');
    this.distEl = this.tracker.querySelector('.qt-dist');
    this.tracker.addEventListener('click', () => game.openMap());
    this.nameEl = this.tracker.querySelector('.qt-name');
    this.announced = false;
    this.syncTitle();
  }

  chapterDone(ch) {
    const last = STEPS.reduce((k, s, i) => (s.ch === ch && s.id !== 'done' ? i : k), -1);
    return this.prog.quest > last;
  }

  syncTitle() {
    this.nameEl.textContent = TITLES[this.step.ch] || TITLE;
  }

  // world state that follows quest progress (beacon lit, ship in port)
  applyWorld() {
    const S = this.g.structures;
    const past = (id) => this.prog.quest > stepIndex(id);
    setBeacon(S, past('light'), true);
    if (S.ship && past('light')) {
      S.ship.group.position.copy(S.ship.berth.pos);
      S.ship.group.rotation.y = S.ship.berth.yaw;
    }
  }

  get step() {
    return STEPS[Math.min(this.prog.quest, STEPS.length - 1)];
  }

  advance() {
    const prevCh = this.step.ch;
    this.prog.quest++;
    this.g.explore.save();
    const s = this.step;
    if (s.id === 'done') {
      this.tracker.classList.add('hidden');
      this.marker.classList.add('hidden');
      return;
    }
    if (s.ch !== prevCh) {
      // a new chapter begins after the completion banner
      this.syncTitle();
      setTimeout(() => {
        this.g.hud.showBanner(`새 임무 · ${TITLES[s.ch]}`);
        this.g.sfx.questStep();
      }, 3400);
    }
    this.g.sfx.questStep();
    this.g.hud.toast(`<b>임무 갱신</b> · ${s.text}`, '#ffd56a');
    if (s.id === 'camp') this.checkCamp();
    if (s.id === 'lens') this.showLantern(true);
    this.tracker.classList.remove('flash');
    void this.tracker.offsetWidth;
    this.tracker.classList.add('flash');
    if (s.id === 'flowers') this.checkFlowers();
  }

  // objective text with live counters
  objective() {
    const s = this.step;
    if (s.id === 'flowers') return `${s.text} (${Math.min(3, this.g.bag.count('bellflower'))}/3)`;
    return s.text;
  }

  target() {
    const g = this.g;
    const id = this.step.id;
    const npc = (k) => {
      const n = g.npcs.get(k);
      return n ? _t.set(n.pos.x, n.pos.y + 2.4, n.pos.z) : null;
    };
    if (id === 'meet' || id === 'return' || id === 'report') return npc('elder');
    if (id === 'cook') return npc('cook');
    if (id === 'harbor' || id === 'report2') return npc('harbor');
    if (id === 'camp') return _t.set(CAMPS[0].x, (CAMPS[0].y ?? 30) + 4, CAMPS[0].z);
    if (id === 'lens' && CAMPS[0].fire) return _t.copy(CAMPS[0].fire).setY(CAMPS[0].fire.y + 1.2);
    if (id === 'light') return _t.copy(g.structures.lighthouseBase).setY(g.structures.lighthouseBase.y + 3);
    if (id === 'pray') return _t.copy(g.structures.statue.center).setY(g.structures.statue.center.y + 3);
    if (id === 'ruins') return _t.copy(g.structures.ringCenter).setY(g.structures.ringCenter.y + 4.5);
    if (id === 'flowers') {
      // nearest unpicked bellflower
      const P = g.player.pos;
      let best = null,
        bd = 1e9;
      for (const s of g.gathering.spots) {
        if (s.picked || s.type !== 'bellflower') continue;
        const d = (s.pos.x - P.x) ** 2 + (s.pos.z - P.z) ** 2;
        if (d < bd) {
          bd = d;
          best = s;
        }
      }
      return best ? _t.copy(best.pos).setY(best.pos.y + 1.2) : null;
    }
    return null;
  }

  start() {
    this.applyWorld();
    if (this.step.id === 'lens') this.showLantern(true);
    if (this.step.id === 'done') return;
    this.tracker.classList.remove('hidden');
    if (!this.announced && (this.prog.quest === 0 || this.step.id === 'harbor')) {
      this.announced = true;
      setTimeout(() => {
        this.g.hud.showBanner(`새 임무 · ${TITLES[this.step.ch] || TITLE}`);
        this.g.sfx.questStep();
      }, 2600);
    }
  }

  onEvent(type, arg) {
    const id = this.step.id;
    if (type === 'pray' && id === 'pray') this.advance();
    if (type === 'gather' && arg === 'bellflower' && id === 'flowers') this.checkFlowers();
  }

  checkCamp() {
    if (this.step.id === 'camp' && this.g.combat.enemies.groupCleared('campA')) {
      this.g.hud.toast('감시탑 야영지를 소탕했다!', '#ffd36a');
      this.advance();
    }
  }

  // the stolen lantern glowing by the camp fire
  showLantern(on) {
    const g = this.g;
    if (!this.lantern) {
      const grp = new THREE.Group();
      const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.42, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color('#bff7ff').multiplyScalar(2.2) }));
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.2, 10), new THREE.MeshBasicMaterial({ color: '#c9a050' }));
      cap.position.y = 0.3;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.06, 10), new THREE.MeshBasicMaterial({ color: '#c9a050' }));
      base.position.y = -0.24;
      grp.add(glass, cap, base);
      const f = CAMPS[0].fire;
      grp.position.set(f.x + 1.4, f.y - 0.3, f.z + 0.6);
      g.scene.add(grp);
      this.lantern = grp;
    }
    this.lantern.visible = on;
  }

  checkFlowers() {
    if (this.step.id === 'flowers' && this.g.bag.count('bellflower') >= 3) this.advance();
  }

  // quest prompts: the ruins ring, the stolen lantern, the dark lighthouse
  consider(P, consider) {
    const id = this.step.id;
    if (id === 'ruins') {
      const b = this.g.structures.ringBase;
      consider(_c.copy(b).setY(P.y), 6, '고리 석상 조사하기', () => this.investigate());
    }
    if (id === 'lens' && this.lantern) consider(_c.copy(this.lantern.position).setY(P.y), 3.5, '바람등불 되찾기', () => this.takeLantern());
    if (id === 'light') consider(_c.copy(this.g.structures.lighthouseBase).setY(P.y), 6.5, '등대에 바람등불 밝히기', () => this.lightBeacon());
  }

  takeLantern() {
    const g = this.g;
    this.showLantern(false);
    g.combat.vfx.burst(this.lantern.position.clone(), '#bff7ff', 30, { speed: 4, size: 0.2, life: 0.8, gravity: 0, up: 0.6 });
    g.sfx.chest(1);
    g.hud.toast('획득 · <b>바람등불</b>', '#bff7ff');
    this.advance();
  }

  // light the beacon; the winter ship finds the harbour (short cutscene)
  lightBeacon() {
    const g = this.g;
    const S = g.structures;
    const L = S.lighthouse.clone();
    const ship = S.ship;
    const from = ship.sea.pos.clone(),
      to = ship.berth.pos.clone();
    const yaw0 = ship.sea.yaw,
      yaw1 = ship.berth.yaw;
    const ease = (t) => t * t * (3 - 2 * t);
    g.sfx.waypoint();
    const ok = g.startCine(
      10,
      (t, pos, look) => {
        if (t < 3.0) {
          // looking up the tower as the light catches
          const a = 0.6 + t * 0.12;
          pos.set(L.x + Math.cos(a) * 12, L.y - 6 + t * 1.5, L.z + Math.sin(a) * 12);
          look.copy(L);
          if (t > 0.8 && S.beacon.target === 0) {
            setBeacon(S, true);
            g.flashScreen('#fff2c8', 0.35);
            g.sfx.unseal();
          }
        } else {
          // the ship glides in from the open sea
          const k = ease(Math.min(1, (t - 3.0) / 6.2));
          ship.group.position.lerpVectors(from, to, k);
          let dy = yaw1 - yaw0;
          dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          ship.group.rotation.y = yaw0 + dy * Math.min(1, k * 1.4);
          // framed from beside its course, the lit harbour behind it
          const sp = ship.group.position;
          const dx = to.x - from.x,
            dz = to.z - from.z,
            dl = Math.hypot(dx, dz);
          const ux = dx / dl,
            uz = dz / dl;
          pos.set(sp.x - ux * 16 - uz * 15, 8 - k * 2.5, sp.z - uz * 16 + ux * 15);
          look.set(sp.x + ux * 14, 4 + k * 2, sp.z + uz * 14);
        }
      },
      () => {
        ship.group.position.copy(to);
        ship.group.rotation.y = yaw1;
        this.advance();
      }
    );
    if (ok) {
      // start from the sea even if the ship had drifted
      ship.group.position.copy(from);
      ship.group.rotation.y = yaw0;
    }
  }

  investigate() {
    const g = this.g;
    const S = g.structures;
    g.explore.beam(S.ringBase.clone(), '#9ff0e0', 26, 1.6, 2.6);
    g.combat.vfx.ring(S.ringCenter.clone(), '#9ff0e0', 5, 0.9);
    g.combat.vfx.burst(S.ringCenter.clone(), '#7ff5dc', 60, { speed: 6, size: 0.25, life: 1.1, gravity: 0, up: 0.3 });
    g.flashScreen('#cffff4', 0.3);
    g.sfx.waypoint();
    g.runScript(null, async (d) => {
      await d.say('', '고리 석상의 룬이 하나씩 빛을 되찾는다. 아주 오래된 바람의 목소리가 들려오는 것 같다…');
      await d.say('???', '…별바람이 잠든 섬의 아이야. 바람은 사라지지 않는다. 잠시 길을 잃었을 뿐.');
      await d.say('???', '흩어진 별바람의 눈을 모아 수호상에 돌려다오. 그러면 바람은 다시 노래하리라.');
      await d.say('', '빛이 잦아들었다. 마을로 돌아가 촌장에게 알려야겠다.');
    }).then(() => this.advance());
  }

  // conversation for a villager, depends on quest progress
  script(npc) {
    const g = this.g;
    const id = this.step.id;
    const N = npc.name,
      T = npc.title;
    if (npc.id === 'elder') {
      if (id === 'meet')
        return async (d) => {
          await d.say(N, '오, 낯선 바람이 불어온다 했더니… 여행자로군. 풍차 마을에 온 걸 환영하네.', T);
          await d.say(N, '요즘 섬의 바람이 이상하게 약해졌어. 풍차도 예전처럼 힘차게 돌지 않고 말이야.', T);
          let i;
          do {
            i = await d.choose([
              { text: '제가 도와드릴게요.', icon: 'quest' },
              { text: '수호상은 어디 있나요?', icon: 'talk' },
            ]);
            if (i === 1) await d.say(N, '초원 동쪽 언덕 위, 날개를 펼친 석상이 서 있다네. 지도(M)를 열면 금방 찾을 걸세.', T);
          } while (i !== 0);
          await d.say(N, '고맙네! 바람의 수호상 앞에서 기도를 올려 주게. 지친 바람이 응답할지도 모르지.', T);
          this.advance();
        };
      if (id === 'pray' || id === 'flowers' || id === 'cook' || id === 'ruins')
        return async (d) => {
          const hint = {
            pray: '수호상은 초원 동쪽 언덕 위에 있다네. 날개를 펼친 석상이라 멀리서도 보일 걸세.',
            flowers: '바람방울꽃은 초원 곳곳에 피어 있다네. 청록색 종처럼 생겼지.',
            cook: '미라에게 바람방울꽃을 가져다주게. 잔치 준비로 바쁠 걸세.',
            ruins: '유적의 고리 석상이라… 예로부터 바람의 기억이 깃든 곳이라 했지.',
          };
          await d.say(N, hint[id], T);
        };
      if (id === 'return')
        return async (d) => {
          await d.say(N, '느껴지나? 바람이 조금 돌아왔어! 풍차 날개 소리가 한결 가벼워졌다네.', T);
          await d.say(N, '이 기세라면 오늘 밤 바람맞이 잔치를 열 수 있겠어. 요리사 미라가 바람방울 수프를 끓이려면 꽃이 필요하다더군.', T);
          await d.say(N, '들판에서 청록색 종처럼 생긴 바람방울꽃 3송이를 모아 미라에게 가져다주겠나?', T);
          this.advance();
        };
      if (id === 'report')
        return async (d) => {
          await d.say(N, '고리 석상이 빛났다고? …그렇군. 옛 이야기가 사실이었어.', T);
          await d.say(N, '별바람의 눈이 모이면 바람이 되살아난다지. 자네라면 해낼 수 있을 걸세.', T);
          await d.say(N, '이건 마을이 드리는 작은 감사의 표시라네. 바람의 가호가 함께하길!', T);
          this.reward(1);
          await d.say(N, '…그리고 하나 더. 남동쪽 단풍 항구에서 급한 전갈이 왔다네. 등대의 불이 꺼져 배가 들어오지 못한다더군.', T);
          await d.say(N, '거울 호수 남쪽 길을 따라가면 협곡을 건너는 바람다리가 있네. 항구장 이안을 찾아가 보게.', T);
          this.advance();
        };
      return async (d) => {
        await d.say(N, '오늘도 바람이 노래하는군. 자네 덕분일세.', T);
        if (this.step.ch === 2 && id !== 'done') await d.say(N, '단풍 항구 일은 잘 되어 가나? 바람다리는 거울 호수 남쪽에 있다네.', T);
      };
    }
    if (npc.id === 'harbor') return this.harborScript(npc, id);
    if (npc.id === 'fisher')
      return async (d) => {
        if (this.prog.quest > stepIndex('light')) {
          await d.say(N, '등대 불이 다시 켜졌어요! 오늘 밤엔 항구 전체가 잔치예요!', T);
          return;
        }
        await d.say(N, '어서 와요! 단풍 항구는 처음이에요? 바다 내음이랑 단풍 냄새가 섞여서 참 좋죠.', T);
        const i = await d.choose([
          { text: '고원에 고블린이 있다던데?', icon: 'talk' },
          { text: '그물 손질 힘내세요.', icon: 'bye' },
        ]);
        if (i === 0) {
          await d.say(N, '네… 활 쏘는 녀석들은 높은 망루 위에서 노려요. 붉게 빛나는 조준선이 보이면 얼른 피하세요!', T);
          await d.say(N, '두건 쓴 주술사는 가까이 가면 휙 사라져 버려요. 원소 구슬은 질주로 피하는 게 최고예요.', T);
        } else await d.say(N, '헤헤, 고마워요. 갈매기들만 안 훔쳐 가면 오늘도 대풍이에요!', T);
      };
    if (npc.id === 'sailor')
      return async (d) => {
        await d.say(N, '저 등대 말이네. 내가 젊었을 땐 저 불빛 하나만 믿고 폭풍 속을 건넜지.', T);
        await d.say(N, this.prog.quest > stepIndex('light') ? '다시 빛나는 걸 보니 눈물이 다 나는구먼. 고맙네, 여행자.' : '불이 꺼진 등대는 슬픈 법이지. 누가 다시 밝혀 주면 좋으련만…', T);
      };
    if (npc.id === 'cook') {
      if (id === 'cook')
        return async (d) => {
          await d.say(N, '앗, 그 꽃! 바람방울꽃이잖아요? 마침 딱 필요했는데!', T);
          g.bag.take({ bellflower: 3 });
          await d.say(N, '잠깐만요… (보글보글) 짠! 바람방울 수프 완성! 하나는 여행자님 몫이에요.', T);
          g.bag.add('soup', 2);
          g.hud.toast(`획득 · <b>${ITEMS.soup.name}</b> ×2`, '#ffd36a');
          g.sfx.cookDone();
          await d.say(N, '먹으면 한동안 힘이 솟을 거예요. 가방(B)에서 꺼내 먹을 수 있어요. 재료만 있으면 요리 솥에서 직접 만들어도 되고요!', T);
          await d.say(N, '참, 그런데요… 숲속 잊힌 유적의 고리 석상에서 요즘 밤마다 이상한 빛이 보인대요. 한번 가 보실래요?', T);
          this.advance();
        };
      if (id === 'flowers')
        return async (d) => {
          await d.say(N, `바람방울꽃은 초원 여기저기에 피어 있어요. 반짝이는 걸 찾아보세요! (${Math.min(3, g.bag.count('bellflower'))}/3)`, T);
        };
      return async (d) => {
        await d.say(N, '배고프지 않아요? 요리 솥은 언제든 써도 돼요!', T);
        const i = await d.choose([
          { text: '요리법을 알려 주세요.', icon: 'talk' },
          { text: '다음에 올게요.', icon: 'bye' },
        ]);
        if (i === 0) {
          await d.say(N, '노을사과 두 개면 사과 구이, 달빛버섯 둘에 바람방울꽃 하나면 버섯 꼬치! 별딸기 셋에 사과 하나면 파이가 돼요.', T);
          await d.say(N, '사과는 숲 가장자리, 버섯은 그늘진 숲속, 별딸기는 길가 덤불에 있어요.', T);
        }
      };
    }
    if (npc.id === 'smith')
      return async (d) => {
        await d.say(N, '어서 와! 단풍 항구 대장간에 온 걸 환영해. 고원 광석으로 벼린 무기들이지.', T);
        const i = await d.choose([
          { text: '물건 보여 주세요.', icon: 'shop' },
          { text: '강화 광석은 어디서 나요?', icon: 'talk' },
          { text: '다음에 올게요.', icon: 'bye' },
        ]);
        if (i === 0) this.openShopAfter = 'smith';
        else if (i === 1) await d.say(N, '보물상자, 정예 몬스터, 비경… 그리고 게시판 의뢰를 끝내면 나눠 주기도 하지. 모자라면 여기서 사도 돼!', T);
        else await d.say(N, '그래, 무기가 무뎌지면 언제든 들러!', T);
      };
    if (npc.id === 'merchant')
      return async (d) => {
        await d.say(N, '어서 오세요~ 먼 바다를 건너온 신선한 재료랍니다!', T);
        const i = await d.choose([
          { text: '물건 보여 주세요.', icon: 'shop' },
          { text: '그냥 둘러볼게요.', icon: 'bye' },
        ]);
        if (i === 0) this.openShopAfter = 'market';
        else await d.say(N, '좋은 여행 되세요~', T);
      };
    if (npc.id === 'keeper')
      return async (d) => {
        await d.say(N, '풍차 날개가 도는 소리, 들리나? 바람이 좋은 날엔 저 소리가 노래처럼 들리지.', T);
        const i = await d.choose([
          { text: '상승 기류가 뭔가요?', icon: 'talk' },
          { text: '수고하세요.', icon: 'bye' },
        ]);
        if (i === 0) await d.say(N, '빛나는 바람 기둥 말이야. 들어가면 글라이더가 저절로 펴지고 하늘 높이 솟구치지. 마을 남쪽에도 하나 있다네!', T);
      };
    if (npc.id === 'child')
      return async (d) => {
        await d.say(N, '우와, 여행자다! 바람을 타고 하늘을 날 수 있다는 게 진짜야?', T);
        const i = await d.choose([
          { text: '응, 글라이더로 날 수 있어.', icon: 'talk' },
          { text: '비밀이야.', icon: 'talk' },
        ]);
        await d.say(N, i === 0 ? '나도 크면 풍차 꼭대기에서 날아 볼 거야! 꼭이야!' : '치사해~! 그래도 언젠가 알아낼 거야!', T);
      };
    return async (d) => {
      await d.say(N, '…', T);
    };
  }

  harborScript(npc, id) {
    const g = this.g;
    const N = npc.name,
      T = npc.title;
    if (id === 'harbor')
      return async (d) => {
        await d.say(N, '여행자? 마침 잘 왔소. 이 항구의 항구장, 이안이라 하오.', T);
        await d.say(N, '사흘 전, 고원의 고블린들이 등대에서 바람등불을 훔쳐 갔소. 등불이 꺼지니 바다 안개 속에서 배들이 항구를 찾지 못하고 있지.', T);
        let i;
        do {
          i = await d.choose([
            { text: '제가 되찾아 올게요.', icon: 'quest' },
            { text: '바람등불이 뭔가요?', icon: 'talk' },
          ]);
          if (i === 1) await d.say(N, '바람의 힘을 머금은 등불이오. 그 빛은 짙은 안개도 꿰뚫고 수평선 너머까지 닿지.', T);
        } while (i !== 0);
        await d.say(N, '고맙소! 놈들은 고원 북쪽 감시탑 야영지에 진을 쳤소. 방패를 든 덩치 큰 놈이 우두머리요.', T);
        await d.say(N, '그놈의 방패는 정면 공격을 대부분 막아 내오. 등 뒤를 노리거나, 원소 반응과 묵직한 일격으로 방어를 깨뜨리시오.', T);
        this.advance();
      };
    if (id === 'camp' || id === 'lens' || id === 'light')
      return async (d) => {
        const hint = {
          camp: '감시탑 야영지는 바람다리에서 고원 북쪽으로 올라가면 보이오. 망루 위 궁수를 조심하시오.',
          lens: '야영지를 정리했다니! 모닥불 근처 어딘가에 바람등불이 있을 거요.',
          light: '오, 바람등불! 등대 아래에서 불을 붙여 주시오. 바다가 기다리고 있소.',
        };
        await d.say(N, hint[id], T);
      };
    if (id === 'report2')
      return async (d) => {
        await d.say(N, '보았소? 등대가 다시 빛나고, 겨울 배가 무사히 들어왔소!', T);
        await d.say(N, '항구 사람들 모두 당신에게 빚을 졌구려. 이건 우리 항구의 작은 성의요.', T);
        g.bag.add('pie', 2);
        g.hud.toast(`획득 · <b>${ITEMS.pie.name}</b> ×2`, '#ffd36a');
        this.reward(2);
        await d.say(N, '바람이 당신을 또 어디로 데려갈지 모르겠지만, 단풍 항구의 문은 언제나 열려 있소.', T);
        this.advance();
      };
    return async (d) => {
      await d.say(N, '등대 불빛 아래로 배들이 오가니 항구가 다시 살아났소. 언제든 들러 주시오.', T);
    };
  }

  reward(ch = 1) {
    const g = this.g;
    if (g.commissions) g.commissions.addRep(ch === 2 ? 'port' : 'village', 60);
    const gems = ch === 2 ? 160 : 120;
    g.gems += gems;
    g.hud.showBanner(`임무 완료 · ${TITLES[ch]}`);
    g.hud.toast(`획득 · <b>별빛 결정</b> ×${gems}`, '#9fe8ff');
    g.sfx.questDone();
    g.flashScreen('#fff4d0', 0.25);
    g.explore.save();
  }

  update() {
    const g = this.g;
    const s = this.step;
    if (s.id === 'camp' && g.frame % 20 === 0) this.checkCamp();
    const show = s.id !== 'done' && g.state === 'playing';
    if (s.id === 'done') return;
    const obj = this.objective();
    if (obj !== this.objText) {
      this.objText = obj;
      this.objEl.textContent = obj;
    }
    const t = show ? this.target() : null;
    if (!t) {
      this.marker.classList.add('hidden');
      this.distEl.textContent = '';
      return;
    }
    const P = g.player.pos;
    const d = Math.hypot(t.x - P.x, t.z - P.z);
    const txt = d < 1000 ? `${Math.round(d)}m` : `${(d / 1000).toFixed(1)}km`;
    this.distEl.textContent = txt;
    // on-screen marker, clamped to the screen edge when off-screen
    const W = window.innerWidth,
      H = window.innerHeight;
    _p.copy(t).project(g.camera);
    let x = (_p.x * 0.5 + 0.5) * W,
      y = (-_p.y * 0.5 + 0.5) * H;
    const behind = _p.z > 1;
    if (behind) {
      x = W - x;
      y = H - 40;
    }
    const m = 46;
    const off = behind || x < m || x > W - m || y < m || y > H - m;
    x = Math.min(W - m, Math.max(m, x));
    y = Math.min(H - m, Math.max(m, y));
    this.marker.classList.toggle('hidden', d < 5);
    this.marker.classList.toggle('edge', off);
    this.marker.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    this.marker.querySelector('.qm-d').textContent = txt;
  }

  minimapMarker(out) {
    if (this.step.id === 'done') return;
    const t = this.target();
    if (t) out.push({ x: t.x, z: t.z, shape: 'quest' });
  }
}

const _t = new THREE.Vector3();
const _c = new THREE.Vector3();
const _p = new THREE.Vector3();
