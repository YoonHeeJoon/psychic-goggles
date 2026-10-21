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
};

export const RECIPES = [
  { out: 'roastApple', need: { apple: 2 } },
  { out: 'skewer', need: { mushroom: 2, bellflower: 1 } },
  { out: 'pie', need: { berry: 3, apple: 1 } },
  { out: 'soup', need: { bellflower: 2, mushroom: 1, apple: 1 } },
];

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
  switch (id) {
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
