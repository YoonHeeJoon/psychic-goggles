// Ingredients, dishes and cooking recipes (all original), plus small
// procedurally drawn icons for the bag and cooking panels.

export const ITEMS = {
  bellflower: { name: '바람방울꽃', kind: 'ingredient', desc: '바람이 지나가면 작은 종처럼 흔들리는 청록색 꽃. 향긋한 차와 수프에 쓰인다.' },
  apple: { name: '노을사과', kind: 'ingredient', desc: '노을빛으로 익는 달콤한 사과. 숲 가장자리 나무 아래에 떨어져 있곤 하다.' },
  mushroom: { name: '달빛버섯', kind: 'ingredient', desc: '그늘진 숲에서 자라는 버섯. 밤이 되면 은은한 푸른빛을 낸다.' },
  berry: { name: '별딸기', kind: 'ingredient', desc: '길가 덤불에 열리는 별 모양 딸기. 새콤달콤해서 디저트에 제격이다.' },
  roastApple: { name: '노을사과 구이', kind: 'food', desc: '불에 구워 단맛이 진해진 사과.', effect: { heal: 0.25 }, effectText: '현재 캐릭터 HP 25% 회복' },
  skewer: { name: '달빛버섯 꼬치', kind: 'food', desc: '버섯을 꼬치에 꿰어 바람방울꽃 소금을 뿌렸다.', effect: { heal: 0.45 }, effectText: '현재 캐릭터 HP 45% 회복' },
  pie: { name: '별딸기 파이', kind: 'food', desc: '바삭한 껍질 속에 별딸기가 가득.', effect: { stamina: 150 }, effectText: '150초 동안 기력 소모 30% 감소' },
  soup: { name: '바람방울 수프', kind: 'food', desc: '풍차 마을 잔치에 빠지지 않는 맑은 수프.', effect: { atk: 150 }, effectText: '150초 동안 공격력 20% 증가' },
  sardine: { name: '은빛 정어리', kind: 'ingredient', desc: '단풍 항구 앞바다에 떼 지어 다니는 작은 물고기. 비늘이 달빛처럼 반짝인다.' },
  snapper: { name: '노을 도미', kind: 'ingredient', desc: '해 질 녘 바다처럼 붉은 도미. 잔치 요리의 주인공.' },
  trout: { name: '물결 송어', kind: 'ingredient', desc: '맑은 호수에 사는 송어. 등에 물결무늬가 있다.' },
  koi: { name: '별비늘 잉어', kind: 'ingredient', desc: '호수 깊은 곳에 산다는 전설의 잉어. 비늘마다 작은 별이 박혀 있다.' },
  grilledFish: { name: '정어리 소금구이', kind: 'food', desc: '항구 사람들이 즐겨 먹는 소박한 생선구이.', effect: { heal: 0.35 }, effectText: '현재 캐릭터 HP 35% 회복' },
  snapperStew: { name: '노을 도미찜', kind: 'food', desc: '버섯과 바람방울꽃을 넣고 천천히 찐 도미.', effect: { heal: 0.7 }, effectText: '현재 캐릭터 HP 70% 회복' },
  troutRoast: { name: '송어 사과구이', kind: 'food', desc: '송어 속에 노을사과를 채워 구웠다. 기운이 솟는다.', effect: { atk: 240 }, effectText: '240초 동안 공격력 20% 증가' },
};

export const RECIPES = [
  { out: 'roastApple', need: { apple: 2 } },
  { out: 'skewer', need: { mushroom: 2, bellflower: 1 } },
  { out: 'pie', need: { berry: 3, apple: 1 } },
  { out: 'soup', need: { bellflower: 2, mushroom: 1, apple: 1 } },
  { out: 'grilledFish', need: { sardine: 2 } },
  { out: 'snapperStew', need: { snapper: 1, mushroom: 1, bellflower: 1 } },
  { out: 'troutRoast', need: { trout: 1, apple: 1 } },
];

// fish drawn sideways: body colours, fin colour, pattern
const FISH = {
  sardine: { a: '#e8f4ff', b: '#5c7fa8', fin: '#8fb0d4', len: 1 },
  snapper: { a: '#ffd0b0', b: '#d0402e', fin: '#ff8a6a', len: 1.12 },
  trout: { a: '#f2f0d8', b: '#5e8a5a', fin: '#c08a6a', len: 1.08, spots: '#3d5a3a' },
  koi: { a: '#ffffff', b: '#ff8a3a', fin: '#ffd0a0', len: 1.12, stars: true },
};

const cache = new Map();

// 96px icon as a data URL
export function itemIcon(id) {
  if (cache.has(id)) return cache.get(id);
  const cv = document.createElement('canvas');
  cv.width = cv.height = 96;
  const g = cv.getContext('2d');
  g.translate(48, 48);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  const blob = (x, y, r, c1, c2) => {
    const gr = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    gr.addColorStop(0, c1);
    gr.addColorStop(1, c2);
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  };
  const leaf = (x, y, a, s, c) => {
    g.save();
    g.translate(x, y);
    g.rotate(a);
    g.fillStyle = c;
    g.beginPath();
    g.moveTo(0, 0);
    g.quadraticCurveTo(s * 0.5, -s * 0.45, s, 0);
    g.quadraticCurveTo(s * 0.5, s * 0.45, 0, 0);
    g.fill();
    g.restore();
  };
  const plate = () => {
    g.fillStyle = 'rgba(0,0,0,.18)';
    g.beginPath();
    g.ellipse(0, 22, 36, 11, 0, 0, Math.PI * 2);
    g.fill();
    const gr = g.createLinearGradient(0, 8, 0, 30);
    gr.addColorStop(0, '#ffffff');
    gr.addColorStop(1, '#cfd6e4');
    g.fillStyle = gr;
    g.beginPath();
    g.ellipse(0, 18, 36, 12, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#9fb2cc';
    g.lineWidth = 2;
    g.stroke();
  };
  const fish = (f, x = 0, y = 0, s = 1, rot = -0.25) => {
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.scale(s * f.len, s);
    // tail
    g.fillStyle = f.fin;
    g.beginPath();
    g.moveTo(22, 0);
    g.quadraticCurveTo(34, -6, 40, -18);
    g.quadraticCurveTo(34, 0, 40, 18);
    g.quadraticCurveTo(34, 6, 22, 0);
    g.fill();
    // fins
    g.beginPath();
    g.moveTo(-6, -14);
    g.quadraticCurveTo(4, -26, 14, -12);
    g.fill();
    g.beginPath();
    g.moveTo(-2, 12);
    g.quadraticCurveTo(6, 22, 12, 10);
    g.fill();
    // body
    const gr = g.createLinearGradient(0, -18, 0, 18);
    gr.addColorStop(0, f.b);
    gr.addColorStop(0.55, f.a);
    gr.addColorStop(1, f.a);
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(-34, 2);
    g.quadraticCurveTo(-24, -20, 4, -16);
    g.quadraticCurveTo(20, -12, 26, 0);
    g.quadraticCurveTo(20, 12, 4, 15);
    g.quadraticCurveTo(-24, 18, -34, 2);
    g.fill();
    if (f.spots) {
      g.fillStyle = f.spots;
      for (const [sx, sy] of [[-12, -8], [-2, -10], [8, -7], [-6, -3], [14, -4]]) {
        g.beginPath();
        g.arc(sx, sy, 1.8, 0, Math.PI * 2);
        g.fill();
      }
    }
    if (f.stars) {
      g.fillStyle = '#ff6a2a';
      g.beginPath();
      g.ellipse(-4, -8, 9, 6, 0.3, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ffe680';
      for (const [sx, sy] of [[-14, -2], [6, -10], [12, 2]]) {
        g.beginPath();
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          const r = k % 2 ? 1.2 : 3.4;
          g.lineTo(sx + Math.cos(a) * r, sy + Math.sin(a) * r);
        }
        g.fill();
      }
    }
    // gill + eye
    g.strokeStyle = 'rgba(0,0,0,.25)';
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(-20, -9);
    g.quadraticCurveTo(-16, 0, -20, 9);
    g.stroke();
    g.fillStyle = '#1a1a24';
    g.beginPath();
    g.arc(-26, -2, 2.6, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,.55)';
    g.beginPath();
    g.ellipse(-6, -10, 12, 3, -0.15, 0, Math.PI * 2);
    g.fill();
    g.restore();
  };
  if (FISH[id]) fish(FISH[id]);
  switch (id) {
    case 'grilledFish':
      plate();
      fish({ ...FISH.sardine, a: '#f0d8a8', b: '#8a5a36' }, -2, -2, 0.62, -0.1);
      fish({ ...FISH.sardine, a: '#f0d8a8', b: '#8a5a36' }, 4, 10, 0.62, 0.05);
      g.fillStyle = '#ffffff';
      for (const [x, y] of [[-10, -8], [8, 6], [14, -4], [-4, 12]]) g.fillRect(x, y, 2, 2);
      break;
    case 'snapperStew':
      plate();
      fish({ ...FISH.snapper, a: '#ffc0a0', b: '#b8382a' }, 0, 4, 0.75, 0);
      leaf(-14, -8, -0.4, 14, '#3fc7b0');
      blob(14, 12, 6, '#9fe3ff', '#3a62c8');
      g.strokeStyle = 'rgba(255,255,255,.6)';
      g.lineWidth = 3;
      for (const x of [-8, 8]) {
        g.beginPath();
        g.moveTo(x, -18);
        g.quadraticCurveTo(x + 5, -26, x, -34);
        g.stroke();
      }
      break;
    case 'troutRoast':
      plate();
      fish({ ...FISH.trout, a: '#e8c890', b: '#7a5a30', spots: '#5a3a20' }, 0, 2, 0.75, 0);
      blob(-4, 4, 6, '#ffb36a', '#d8402e');
      leaf(18, -8, -0.8, 12, '#5fb04a');
      break;
    case 'bellflower': {
      g.strokeStyle = '#3f8a3a';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(0, 38);
      g.quadraticCurveTo(-4, 6, 6, -14);
      g.stroke();
      leaf(-2, 22, -2.6, 22, '#5fb04a');
      leaf(2, 14, -0.4, 20, '#4f9a3e');
      for (const [x, y, s] of [
        [8, -20, 1],
        [-14, -6, 0.8],
        [16, 2, 0.75],
      ]) {
        g.save();
        g.translate(x, y);
        g.scale(s, s);
        const gr = g.createLinearGradient(0, -14, 0, 14);
        gr.addColorStop(0, '#d8fff4');
        gr.addColorStop(1, '#3fc7b0');
        g.fillStyle = gr;
        g.beginPath();
        g.moveTo(-12, -6);
        g.quadraticCurveTo(0, -20, 12, -6);
        g.lineTo(14, 10);
        g.quadraticCurveTo(7, 6, 4, 12);
        g.quadraticCurveTo(0, 7, -4, 12);
        g.quadraticCurveTo(-7, 6, -14, 10);
        g.closePath();
        g.fill();
        g.restore();
      }
      break;
    }
    case 'apple':
      blob(0, 6, 28, '#ffb36a', '#d8402e');
      g.strokeStyle = '#6b4630';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(0, -18);
      g.lineTo(3, -32);
      g.stroke();
      leaf(4, -26, -0.5, 22, '#5fb04a');
      g.fillStyle = 'rgba(255,255,255,.55)';
      g.beginPath();
      g.ellipse(-10, -4, 6, 10, 0.5, 0, Math.PI * 2);
      g.fill();
      break;
    case 'mushroom': {
      g.fillStyle = '#f2ead8';
      g.beginPath();
      g.moveTo(-9, 6);
      g.quadraticCurveTo(-12, 32, -6, 36);
      g.lineTo(8, 36);
      g.quadraticCurveTo(13, 32, 9, 6);
      g.fill();
      const gr = g.createLinearGradient(0, -30, 0, 10);
      gr.addColorStop(0, '#9fe3ff');
      gr.addColorStop(1, '#3a62c8');
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(-34, 8);
      g.quadraticCurveTo(-30, -34, 0, -34);
      g.quadraticCurveTo(30, -34, 34, 8);
      g.quadraticCurveTo(0, 0, -34, 8);
      g.fill();
      g.fillStyle = 'rgba(230,250,255,.85)';
      for (const [x, y, r] of [
        [-14, -14, 5],
        [8, -22, 4],
        [18, -6, 3.5],
      ]) {
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    case 'berry': {
      leaf(-6, 6, 2.6, 26, '#4f9a3e');
      leaf(6, 6, 0.4, 26, '#5fb04a');
      for (const [x, y] of [
        [-12, 4],
        [10, 8],
        [-1, -10],
      ]) {
        g.save();
        g.translate(x, y);
        const gr = g.createRadialGradient(-4, -4, 1, 0, 0, 16);
        gr.addColorStop(0, '#ff9ab8');
        gr.addColorStop(1, '#c41e4a');
        g.fillStyle = gr;
        g.beginPath();
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
          const r = k % 2 ? 7 : 15;
          g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        g.closePath();
        g.fill();
        g.restore();
      }
      break;
    }
    case 'roastApple':
      plate();
      blob(-10, 4, 15, '#ffc07a', '#a83a22');
      blob(12, 6, 13, '#ffc07a', '#a83a22');
      g.strokeStyle = 'rgba(255,240,200,.7)';
      g.lineWidth = 3;
      for (const x of [-12, 0, 12]) {
        g.beginPath();
        g.moveTo(x, -16);
        g.quadraticCurveTo(x + 5, -24, x, -32);
        g.stroke();
      }
      break;
    case 'skewer':
      plate();
      g.strokeStyle = '#b08452';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(-32, 22);
      g.lineTo(30, -28);
      g.stroke();
      for (const t of [0.25, 0.5, 0.75]) blob(-32 + 62 * t, 22 - 50 * t, 10, '#9fe3ff', '#3a62c8');
      break;
    case 'pie': {
      plate();
      const gr = g.createLinearGradient(0, -14, 0, 18);
      gr.addColorStop(0, '#ffd98a');
      gr.addColorStop(1, '#c47a2a');
      g.fillStyle = gr;
      g.beginPath();
      g.ellipse(0, 6, 30, 14, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#d8304e';
      for (const [x, y] of [
        [-12, 2],
        [4, -2],
        [14, 6],
        [-2, 10],
      ]) {
        g.beginPath();
        g.arc(x, y, 4.5, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    case 'soup': {
      g.fillStyle = 'rgba(0,0,0,.18)';
      g.beginPath();
      g.ellipse(0, 28, 30, 8, 0, 0, Math.PI * 2);
      g.fill();
      const gr = g.createLinearGradient(0, -4, 0, 30);
      gr.addColorStop(0, '#f4e6c8');
      gr.addColorStop(1, '#a8743c');
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(-32, -2);
      g.quadraticCurveTo(-30, 30, 0, 30);
      g.quadraticCurveTo(30, 30, 32, -2);
      g.fill();
      g.fillStyle = '#8fe0c8';
      g.beginPath();
      g.ellipse(0, -2, 32, 9, 0, 0, Math.PI * 2);
      g.fill();
      leaf(-8, -4, 0.2, 14, '#3f8a3a');
      leaf(6, -2, 2.8, 12, '#4f9a3e');
      g.strokeStyle = 'rgba(255,255,255,.6)';
      g.lineWidth = 3;
      for (const x of [-10, 4]) {
        g.beginPath();
        g.moveTo(x, -14);
        g.quadraticCurveTo(x + 5, -22, x, -32);
        g.stroke();
      }
      break;
    }
  }
  const url = cv.toDataURL();
  cache.set(id, url);
  return url;
}
