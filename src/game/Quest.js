import * as THREE from 'three';
import { ITEMS } from './Items.js';

// Opening quest "바람이 머무는 마을" (The village where the wind stays) plus
// everyday conversations with the villagers. Progress is saved with the rest
// of the exploration state.

const TITLE = '바람이 머무는 마을';

const STEPS = [
  { id: 'meet', text: '풍차 마을의 촌장 하르반과 대화하기' },
  { id: 'pray', text: '바람의 수호상에 기도하기' },
  { id: 'return', text: '촌장 하르반에게 돌아가기' },
  { id: 'flowers', text: '바람방울꽃 모으기' },
  { id: 'cook', text: '요리사 미라에게 바람방울꽃 전해주기' },
  { id: 'ruins', text: '잊힌 유적의 고리 석상 조사하기' },
  { id: 'report', text: '촌장 하르반에게 보고하기' },
  { id: 'done', text: '' },
];

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
    this.announced = false;
  }

  get step() {
    return STEPS[Math.min(this.prog.quest, STEPS.length - 1)];
  }

  advance() {
    this.prog.quest++;
    this.g.explore.save();
    const s = this.step;
    if (s.id === 'done') {
      this.tracker.classList.add('hidden');
      this.marker.classList.add('hidden');
      return;
    }
    this.g.sfx.questStep();
    this.g.hud.toast(`<b>임무 갱신</b> · ${s.text}`, '#ffd56a');
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
    if (this.step.id === 'done') return;
    this.tracker.classList.remove('hidden');
    if (!this.announced && this.prog.quest === 0) {
      this.announced = true;
      setTimeout(() => {
        this.g.hud.showBanner(`새 임무 · ${TITLE}`);
        this.g.sfx.questStep();
      }, 2600);
    }
  }

  onEvent(type, arg) {
    const id = this.step.id;
    if (type === 'pray' && id === 'pray') this.advance();
    if (type === 'gather' && arg === 'bellflower' && id === 'flowers') this.checkFlowers();
  }

  checkFlowers() {
    if (this.step.id === 'flowers' && this.g.bag.count('bellflower') >= 3) this.advance();
  }

  // ruins investigation prompt
  consider(P, consider) {
    if (this.step.id !== 'ruins') return;
    const b = this.g.structures.ringBase;
    consider(_c.copy(b).setY(P.y), 6, '고리 석상 조사하기', () => this.investigate());
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
          this.advance();
          this.reward();
        };
      return async (d) => {
        await d.say(N, '오늘도 바람이 노래하는군. 자네 덕분일세.', T);
      };
    }
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
    if (npc.id === 'merchant')
      return async (d) => {
        await d.say(N, '어서 오세요~ 먼 바다를 건너온 신선한 재료랍니다. 별빛 결정 10개씩이에요!', T);
        for (;;) {
          const i = await d.choose([
            { text: `노을사과 사기 (보유 결정 ${g.gems})`, icon: 'shop' },
            { text: '별딸기 사기', icon: 'shop' },
            { text: '달빛버섯 사기', icon: 'shop' },
            { text: '그만 볼게요.', icon: 'bye' },
          ]);
          if (i === 3) break;
          const item = ['apple', 'berry', 'mushroom'][i];
          if (g.gems < 10) {
            await d.say(N, '어머, 결정이 모자라네요. 몬스터를 물리치거나 보물상자를 열어 보세요!', T);
            break;
          }
          g.gems -= 10;
          g.bag.add(item, 1);
          g.sfx.gem();
          await d.say(N, `${ITEMS[item].name} 하나, 여기 있어요! 또 필요한 건요?`, T);
        }
        await d.say(N, '좋은 여행 되세요~', T);
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

  reward() {
    const g = this.g;
    g.gems += 120;
    g.hud.showBanner(`임무 완료 · ${TITLE}`);
    g.hud.toast('획득 · <b>별빛 결정</b> ×120', '#9fe8ff');
    g.sfx.questDone();
    g.flashScreen('#fff4d0', 0.25);
    g.explore.save();
  }

  update() {
    const g = this.g;
    const s = this.step;
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
