import { elementIcon } from '../ui/icons.js';
import { WEAPONS } from './Gear.js';

// Achievements ("모험 기록"): progress is derived from saved progress plus a
// few counters, checked once a second. Each unlock pops a banner and gives
// star gems.

const LIST = [
  { id: 'kill1', name: '첫 승리', desc: '몬스터를 처음으로 처치하기', goal: 1, stat: 'kills' },
  { id: 'kill50', name: '섬의 수호자', desc: '몬스터 50마리 처치하기', goal: 50, stat: 'kills' },
  { id: 'chest1', name: '첫 보물', desc: '보물상자를 처음으로 열기', goal: 1, stat: 'chests' },
  { id: 'chest10', name: '보물 사냥꾼', desc: '보물상자 10개 열기', goal: 10, stat: 'chests' },
  { id: 'eye10', name: '바람을 모으는 자', desc: '별바람의 눈 10개 모으기', goal: 10, stat: 'eyes' },
  { id: 'eyeAll', name: '바람의 친구', desc: '별바람의 눈을 모두 모으기', goal: 31, stat: 'eyes' },
  { id: 'wpAll', name: '섬의 지도', desc: '순간이동 포인트를 모두 활성화하기', goal: 12, stat: 'wp' },
  { id: 'react', name: '원소 연구자', desc: '서로 다른 원소 반응 6종 일으키기', goal: 6, stat: 'reactions' },
  { id: 'gather30', name: '채집가', desc: '재료를 30번 채집하기', goal: 30, stat: 'gathered' },
  { id: 'cook5', name: '요리 입문', desc: '요리 솥에서 요리 5번 하기', goal: 5, stat: 'cooked' },
  { id: 'quest', name: '바람이 머무는 마을', desc: '첫 임무 완료하기', goal: 1, stat: 'quest' },
  { id: 'puzzle', name: '수수께끼 풀이', desc: '섬의 퍼즐 3개를 모두 풀기', goal: 3, stat: 'puzzles' },
  { id: 'boss', name: '폭풍 진압', desc: '뇌광의 결정체 처치하기', goal: 1, stat: 'boss' },
  { id: 'domain', name: '회랑의 정복자', desc: '비경 「바람 그림자 회랑」 클리어하기', goal: 1, stat: 'domain' },
  { id: 'glide', name: '바람을 타는 자', desc: '활공 누적 120초', goal: 120, stat: 'glide' },
  { id: 'summit', name: '별빛 설산 정상', desc: '섬에서 가장 높은 곳에 서기', goal: 1, stat: 'summit' },
  { id: 'lv30', name: '성장의 기쁨', desc: '캐릭터 하나를 Lv.30까지 올리기', goal: 30, stat: 'maxLv' },
  { id: 'photo', name: '추억 한 장', desc: '사진 모드에서 사진 찍기', goal: 1, stat: 'photos' },
  { id: 'highland', name: '협곡을 건너는 바람', desc: '바람다리를 건너 단풍 고원에 닿기', goal: 1, stat: 'highland' },
  { id: 'guard', name: '방패 깨기', desc: '방패 고블린의 방어를 무너뜨리기', goal: 1, stat: 'guardBreaks' },
  { id: 'elite', name: '우두머리 사냥', desc: '정예 몬스터 처치하기', goal: 1, stat: 'elites' },
  { id: 'quest2', name: '단풍 항구의 등불', desc: '두 번째 임무 완료하기', goal: 1, stat: 'quest2' },
  { id: 'comm10', name: '믿음직한 일꾼', desc: '일일 의뢰 10개 완료하기', goal: 10, stat: 'commissions' },
  { id: 'weapon5', name: '전설의 무기', desc: '5성 무기 손에 넣기', goal: 1, stat: 'weapon5' },
  { id: 'fish5', name: '느긋한 낚시꾼', desc: '물고기 5마리 낚기', goal: 5, stat: 'fish' },
  { id: 'fishAll', name: '물고기 도감', desc: '모든 종류의 물고기 낚기', goal: 4, stat: 'fishKinds' },
  { id: 'wish', name: '바람에 띄운 소원', desc: '바람등불 축제에서 소원 등불 날리기', goal: 1, stat: 'wishes' },
  { id: 'sail', name: '바다로 나간 여행자', desc: '돛단배로 누적 1000m 항해하기', goal: 1000, stat: 'sail' },
];
const REWARD = 20;

const el = (tag, cls, html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

export class Achievements {
  constructor(game) {
    this.g = game;
    const prog = game.explore.progress;
    this.done = prog.ach || (prog.ach = {});
    this.st = prog.stats || (prog.stats = { kills: 0, gathered: 0, cooked: 0, glide: 0, photos: 0, reactionTypes: {}, summit: 0 });
    this.checkT = 1;
    this.queue = [];
    // the island's highest point (summit achievement)
    let top = 0;
    const T = game.terrain;
    for (let i = -40; i <= 40; i++) for (let j = -40; j <= 40; j++) top = Math.max(top, T.heightAt(30 + i * 4, -300 + j * 4));
    this.summitY = top - 7;
    // popup + log panel
    this.pop = el('div', 'ach-pop hidden', `<div class="ap-ic">${elementIcon('gem', '#ffe6a0', 26)}</div><div class="ap-t"><span>업적 달성</span><b></b></div>`);
    game.container.appendChild(this.pop);
    this.panel = el(
      'div',
      'panel-wrap hidden',
      `<div class="panel ach-panel"><div class="pn-head"><div class="pn-title">모험 기록</div><div class="pn-sub ach-count"></div><button class="pn-close" aria-label="닫기">✕</button></div><div class="ach-list"></div></div>`
    );
    game.container.appendChild(this.panel);
    this.panel.querySelector('.pn-close').addEventListener('click', () => game.closePanel());
    this.panel.addEventListener('pointerdown', (e) => e.target === this.panel && game.closePanel());
  }

  add(stat, n = 1) {
    this.st[stat] = (this.st[stat] || 0) + n;
  }
  reaction(type) {
    this.st.reactionTypes[type] = 1;
  }

  value(stat) {
    const g = this.g;
    const prog = g.explore.progress;
    switch (stat) {
      case 'chests':
        return prog.chests.length;
      case 'eyes':
        return prog.orbs.length;
      case 'wp':
        return g.structures.waypoints.filter((w) => w.active).length;
      case 'reactions':
        return Object.keys(this.st.reactionTypes).length;
      case 'quest':
        return g.quest.chapterDone(1) ? 1 : 0;
      case 'quest2':
        return g.quest.chapterDone(2) ? 1 : 0;
      case 'weapon5':
        return g.gear && g.gear.d.weapons.some((w) => WEAPONS[w.id].rarity === 5) ? 1 : 0;
      case 'puzzles':
        return Object.keys(prog.puzzles || {}).length;
      case 'boss':
        return prog.bossKills || 0;
      case 'domain':
        return prog.domainClears || 0;
      case 'fishKinds':
        return Object.keys(prog.fish || {}).length;
      case 'maxLv':
        return Math.max(...g.player.party.map((c) => c.level || 20));
      default:
        return this.st[stat] || 0;
    }
  }

  update(dt) {
    const g = this.g;
    const P = g.player;
    if (g.state === 'playing' && P.state === 'glide') this.st.glide += dt;
    if (P.pos.y > this.summitY && P.state === 'ground') this.st.summit = 1;
    if (!this.st.highland && P.state === 'ground' && g.frame % 30 === 0 && g.terrain.autumnAt(P.pos.x, P.pos.z) > 0.75) this.st.highland = 1;
    this.checkT -= dt;
    if (this.checkT > 0) return;
    this.checkT = 1;
    for (const a of LIST) {
      if (this.done[a.id]) continue;
      if (this.value(a.stat) >= a.goal) {
        this.done[a.id] = Date.now();
        g.gems += REWARD;
        this.queue.push(a);
      }
    }
    if (this.queue.length && !this.showing) this.showNext();
  }

  showNext() {
    const a = this.queue.shift();
    if (!a) {
      this.showing = false;
      return;
    }
    this.showing = true;
    this.pop.querySelector('b').textContent = a.name;
    this.pop.classList.remove('hidden', 'show');
    void this.pop.offsetWidth;
    this.pop.classList.add('show');
    this.g.sfx.questStep();
    this.g.hud.toast(`업적 보상 · <b>별빛 결정</b> ×${REWARD}`, '#9fe8ff');
    this.g.explore.save();
    setTimeout(() => {
      this.pop.classList.add('hidden');
      this.showNext();
    }, 3400);
  }

  // log panel (opened through Game.openPanel)
  open() {
    const got = LIST.filter((a) => this.done[a.id]).length;
    this.panel.querySelector('.ach-count').textContent = `달성 ${got} / ${LIST.length}`;
    this.panel.querySelector('.ach-list').innerHTML = LIST.map((a) => {
      const v = Math.min(a.goal, Math.floor(this.value(a.stat)));
      const ok = !!this.done[a.id];
      const date = ok ? new Date(this.done[a.id]).toLocaleDateString('ko-KR') : '';
      return `<div class="ach ${ok ? 'ok' : ''}"><div class="ac-ic">${ok ? '★' : '☆'}</div>
        <div class="ac-t"><b>${a.name}</b><span>${a.desc}</span><div class="ac-bar"><div style="width:${(v / a.goal) * 100}%"></div></div></div>
        <div class="ac-r">${ok ? `<small>${date}</small>달성` : `${v} / ${a.goal}`}</div></div>`;
    }).join('');
    this.panel.classList.remove('hidden');
  }
  close() {
    this.panel.classList.add('hidden');
  }
}
