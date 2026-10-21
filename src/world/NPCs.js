import * as THREE from 'three';
import { CharacterModel } from '../character/CharacterModel.js';
import { LANDMARKS, PORT_LEN, PORT_DIR, portWorld } from './Terrain.js';
import { dampAngle, damp } from '../core/noise.js';
import { Roster } from '../game/Roster.js';
import { ELEMENTS } from '../character/characters.js';

// Villagers of the windmill village. Each walks a small routine, turns to
// look at you when you come close, says something now and then, and can be
// talked to (the quest system decides what they say).

const V = LANDMARKS.village;
const rad = (d) => (d * Math.PI) / 180;
const at = (deg, r) => [V.x + Math.cos(rad(deg)) * r, V.z + Math.sin(rad(deg)) * r];

const PL = PORT_LEN;

const col = (o) => ({ skin: '#ffe2d0', eye2: '#ffffff', dark: '#2a2630', gold: '#e3b25a', boots: '#4a3a30', legs: '#3a3440', ...o });

export const NPC_DEFS = [
  {
    id: 'elder',
    name: '하르반',
    title: '풍차 마을 촌장',
    cfg: {
      female: false,
      scale: 1.04,
      colors: col({ skin: '#f6d6c2', hair: '#d8d4cc', hairTip: '#a8a29a', eye: '#7a6a4a', eye2: '#e8dcc0', outfit: '#5b4636', outfit2: '#c9a35a', legs: '#3a3028' }),
      hair: { style: 'short', length: 1.3, bangs: 7, ahoge: false, spiky: false, tail: null },
      outfit: { skirt: 'coat', cape: true, sleeves: 'long', coat: true },
    },
    route: [at(-20, 3.2), at(30, 3.4), at(-60, 3.0)],
    speed: 0.85,
    wait: [6, 10],
    lines: ['바람이 조금 약해진 것 같군…', '풍차가 돌아야 마을이 웃지.', '젊은이, 서두르지 말게.', '오늘 밤 별이 참 밝겠어.'],
  },
  {
    id: 'cook',
    name: '미라',
    title: '마을 요리사',
    cfg: {
      female: true,
      scale: 0.98,
      colors: col({ hair: '#f0a050', hairTip: '#ffd08a', eye: '#d0702a', eye2: '#ffe0a0', outfit: '#fbf5ea', outfit2: '#e0704a', legs: '#5a3a30' }),
      hair: { style: 'medium', length: 2.0, bangs: 9, ahoge: true, tail: 'pony' },
      outfit: { skirt: 'long', cape: false, sleeves: 'puff', coat: false },
    },
    route: [at(100, 4.6), at(80, 4.8), at(118, 4.4)],
    speed: 1.0,
    wait: [4, 7],
    lines: ['음~ 수프 냄새 좋다!', '바람방울꽃이 더 있으면 좋을 텐데.', '배고프면 솥을 써도 돼요!', '노을사과는 구워 먹어야 제맛이죠.'],
  },
  {
    id: 'merchant',
    name: '벨라',
    title: '떠돌이 상인',
    cfg: {
      female: true,
      scale: 1.0,
      colors: col({ skin: '#f8dccb', hair: '#3a2f4a', hairTip: '#8a6ab8', eye: '#9a5ad6', eye2: '#f0d0ff', outfit: '#6a3f7a', outfit2: '#e9c46a', legs: '#2a2238' }),
      hair: { style: 'long', length: 3.4, bangs: 9, ahoge: false, tail: null },
      outfit: { skirt: 'flare', cape: false, sleeves: 'wide', coat: false },
    },
    // behind the first market stall (local -z of a stall rotated 0.9 rad)
    route: [[V.x - 6.5 - Math.sin(0.9) * 0.45, V.z - 4.5 - Math.cos(0.9) * 0.45]],
    face: 0.9,
    speed: 0,
    wait: [99, 99],
    lines: ['구경은 공짜예요~', '별빛 결정만 있으면 뭐든지!', '이 사과, 오늘 아침에 딴 거예요.'],
  },
  {
    id: 'keeper',
    name: '토마',
    title: '풍차지기',
    cfg: {
      female: false,
      scale: 1.06,
      colors: col({ skin: '#f0caa8', hair: '#7a5232', hairTip: '#b08452', eye: '#4a7a3a', eye2: '#d0f0b0', outfit: '#3f6aa6', outfit2: '#e8d8b0', legs: '#3a3a48' }),
      hair: { style: 'short', length: 1.2, bangs: 8, ahoge: false, spiky: true, tail: null },
      outfit: { skirt: 'coat', cape: false, sleeves: 'long', coat: false },
    },
    route: [at(150, 34), at(150, 22), at(160, 13), at(140, 16)],
    speed: 1.2,
    wait: [3, 6],
    lines: ['날개 각도가 딱 좋군.', '상승 기류를 타 봤나? 끝내주지!', '바람이 세면 풍차도 신이 나지.'],
  },
  {
    id: 'child',
    name: '루루',
    title: '마을 아이',
    cfg: {
      female: true,
      scale: 0.74,
      colors: col({ hair: '#ffd36a', hairTip: '#ffefb0', eye: '#3aa0e0', eye2: '#c0f0ff', outfit: '#9fd86a', outfit2: '#ffffff', legs: '#f0e0d0', boots: '#d8604a' }),
      hair: { style: 'medium', length: 1.6, bangs: 9, ahoge: true, tail: 'twin' },
      outfit: { skirt: 'pleated', cape: false, sleeves: 'puff', coat: false },
    },
    circle: { r: 7.6, w: 0.34 },
    speed: 2.6,
    dayOnly: true,
    lines: ['잡아 봐라~!', '나도 글라이더 타고 싶어!', '언니 오빠는 어디서 왔어?', '헤헤, 바람이 간지러워!'],
  },
  // ---- 단풍 항구 (autumn harbour)
  {
    id: 'harbor',
    name: '이안',
    title: '단풍 항구 항구장',
    cfg: {
      female: false,
      scale: 1.06,
      colors: col({ skin: '#eec7a6', hair: '#2e3442', hairTip: '#5a6a84', eye: '#2e6f8e', eye2: '#c8eaff', outfit: '#2e4a6a', outfit2: '#e3b25a', legs: '#2a2a34' }),
      hair: { style: 'short', length: 1.3, bangs: 8, ahoge: false, spiky: false, tail: null },
      outfit: { skirt: 'coat', cape: true, sleeves: 'long', coat: true },
    },
    route: [portWorld(PL + 10, 4.5), portWorld(PL + 10, -3), portWorld(PL + 6, 1)],
    speed: 0.7,
    wait: [5, 9],
    face: PORT_DIR,
    lines: ['등대가 꺼진 지 벌써 사흘째군…', '배가 들어와야 장이 서는데.', '바다 바람이 차갑구려.', '오늘도 수평선엔 돛 하나 없군.'],
  },
  {
    id: 'fisher',
    name: '소라',
    title: '항구 어부',
    cfg: {
      female: true,
      scale: 0.96,
      colors: col({ skin: '#f6d2b8', hair: '#3a7f8a', hairTip: '#8fe0d8', eye: '#2a9a8a', eye2: '#d0fff4', outfit: '#f2ead8', outfit2: '#c25a3a', legs: '#3a4a58' }),
      hair: { style: 'medium', length: 1.9, bangs: 9, ahoge: true, tail: 'pony' },
      outfit: { skirt: 'flare', cape: false, sleeves: 'puff', coat: false },
    },
    route: [portWorld(PL + 3, 11.5), portWorld(PL - 3, 8.5), portWorld(PL + 9, 9.5)],
    speed: 1.0,
    wait: [4, 7],
    lines: ['그물 손질은 끝이 없다니까!', '오늘은 단풍잎이 바다에 동동 떠다녀요.', '고블린들이 고원에 진을 쳤대요… 무서워.', '갈매기야, 생선은 안 줄 거야!'],
  },
  {
    id: 'sailor',
    name: '도윤',
    title: '늙은 선원',
    cfg: {
      female: false,
      scale: 1.0,
      colors: col({ skin: '#e6b896', hair: '#e0ddd6', hairTip: '#b0aca4', eye: '#5a4a3a', eye2: '#f0e0c8', outfit: '#7a3a32', outfit2: '#efe6d2', legs: '#3a3028' }),
      hair: { style: 'short', length: 1.1, bangs: 6, ahoge: false, spiky: true, tail: null },
      outfit: { skirt: 'coat', cape: false, sleeves: 'long', coat: false },
    },
    route: [portWorld(PL + 11, -12.5)],
    face: PORT_DIR - 0.9,
    speed: 0,
    wait: [99, 99],
    lines: ['젊었을 땐 저 등대 불빛만 보고 바다를 건넜지.', '흠, 바람에서 소금 냄새가 나는군.', '단풍이 지면 겨울 배가 온다네.'],
  },
  {
    id: 'smith',
    name: '해랑',
    title: '항구 대장장이',
    cfg: {
      female: false,
      scale: 1.1,
      colors: col({ skin: '#d9a07a', hair: '#3a2a22', hairTip: '#7a4a32', eye: '#c25a3a', eye2: '#ffd8b0', outfit: '#5a3a2a', outfit2: '#c25a3a', legs: '#2a2420' }),
      hair: { style: 'short', length: 1.0, bangs: 6, ahoge: false, spiky: true, tail: null },
      outfit: { skirt: 'coat', cape: false, sleeves: 'long', coat: false },
    },
    route: [portWorld(PL + 1.6, -10.1)],
    face: PORT_DIR + Math.PI / 2,
    speed: 0,
    wait: [99, 99],
    lines: ['쇠는 뜨거울 때 두드려야지!', '고원 광석은 단단해서 좋아.', '무기 손질은 여행의 기본이야.'],
  },
];

export class NPCs {
  constructor(game) {
    this.g = game;
    this.list = [];
    this.layer = document.createElement('div');
    this.layer.className = 'npc-ui';
    game.container.appendChild(this.layer);
    const G = game.ground;
    // companions not met yet wait out in the world
    [...NPC_DEFS, ...Roster.recruitDefs()].forEach((d, k) => {
      const cfg = { id: 'npc-' + d.id, name: d.name, element: 'wind', weapon: 'catalyst', ...d.cfg };
      const model = new CharacterModel(cfg);
      model.weapon.visible = false;
      model.root.traverse((o) => {
        if (o.isMesh) o.castShadow = o.castShadow && !(o.material && o.material.uniforms && o.material.uniforms.uOutlineColor);
      });
      game.scene.add(model.root);
      const start = d.route ? d.route[0] : [V.x + d.circle.r, V.z];
      const pos = new THREE.Vector3(start[0], G.heightAt(start[0], start[1]), start[1]);
      const tag = document.createElement('div');
      tag.className = 'npc-tag';
      tag.innerHTML = `<span class="nm">${d.name}</span><span class="tt">${d.title}</span>`;
      const bubble = document.createElement('div');
      bubble.className = 'npc-bubble';
      this.layer.append(tag, bubble);
      this.list.push({
        def: d,
        id: d.id,
        name: d.name,
        title: d.title,
        model,
        pos,
        yaw: d.face ?? 0,
        leg: 0,
        waitT: 1 + k,
        angle: 0,
        moving: false,
        tag,
        bubble,
        bubbleT: 3 + k * 1.7,
        lineI: k,
        lod: -1,
        talking: false,
        marker: null,
      });
    });
  }

  get(id) {
    return this.list.find((n) => n.id === id);
  }

  setLod(n, d) {
    const k = (d > 18 ? 1 : 0) + (d > 28 ? 2 : 0);
    if (n.lod === k) return;
    n.lod = k;
    if (!n.outlines) {
      n.outlines = [];
      n.casters = [];
      n.model.root.traverse((o) => {
        if (!o.isMesh) return;
        if (o.material && o.material.uniforms && o.material.uniforms.uOutlineColor) n.outlines.push(o);
        else if (o.castShadow) n.casters.push(o);
      });
    }
    for (const o of n.outlines) o.visible = !(k & 1);
    for (const o of n.casters) o.castShadow = !(k & 2);
  }

  update(dt) {
    const g = this.g;
    const P = g.player.pos;
    const G = g.ground;
    const night = g.env ? 1 - Math.min(1, Math.max(0, (g.env.sunDir.y + 0.05) * 8)) : 0;
    const cam = g.camera;
    const W = window.innerWidth,
      H = window.innerHeight;
    const showUI = g.state === 'playing';
    for (const n of this.list) {
      const d = n.def;
      const dist = Math.hypot(P.x - n.pos.x, P.z - n.pos.z);
      const away = (d.dayOnly && night > 0.5) || (d.recruit && g.roster && g.roster.has(d.recruit));
      const vis = dist < 110 && !away;
      n.model.root.visible = vis;
      if (!vis) {
        n.tag.style.display = n.bubble.style.display = 'none';
        continue;
      }
      this.setLod(n, dist);
      // routine
      let speed = 0;
      const near = dist < 4.2 || n.talking;
      if (!near) {
        if (d.circle) {
          n.angle += (d.circle.w * dt * (1 + 0.3 * Math.sin(g.wildlife ? g.wildlife.t * 0.3 : 0)));
          const tx = V.x + Math.cos(n.angle) * d.circle.r,
            tz = V.z + Math.sin(n.angle) * d.circle.r;
          speed = d.speed;
          const want = Math.atan2(tx - n.pos.x, tz - n.pos.z);
          n.yaw = dampAngle(n.yaw, want, 8, dt);
          n.pos.x = tx;
          n.pos.z = tz;
        } else if (d.speed > 0) {
          if (n.waitT > 0) n.waitT -= dt;
          else {
            const [tx, tz] = d.route[(n.leg + 1) % d.route.length];
            const dx = tx - n.pos.x,
              dz = tz - n.pos.z;
            const l = Math.hypot(dx, dz);
            if (l < 0.15) {
              n.leg = (n.leg + 1) % d.route.length;
              n.waitT = d.wait[0] + Math.random() * (d.wait[1] - d.wait[0]);
            } else {
              speed = d.speed;
              n.yaw = dampAngle(n.yaw, Math.atan2(dx, dz), 7, dt);
              const step = Math.min(l, speed * dt);
              n.pos.x += (dx / l) * step;
              n.pos.z += (dz / l) * step;
            }
          }
        }
      }
      // turn towards the player when close
      if (near) n.yaw = dampAngle(n.yaw, Math.atan2(P.x - n.pos.x, P.z - n.pos.z), 5, dt);
      else if (d.face !== undefined && speed === 0) n.yaw = dampAngle(n.yaw, d.face, 3, dt);
      n.pos.y = damp(n.pos.y, G.heightAt(n.pos.x, n.pos.z), 14, dt);
      const m = n.model;
      m.root.position.copy(n.pos);
      m.root.rotation.y = n.yaw;
      m.update(dt, { mode: speed > 0.1 ? 'run' : 'idle', speed, localVel: _lv.set(0, 0, speed) });

      // name tag + chatter bubble
      if (!showUI || dist > 16) {
        n.tag.style.display = n.bubble.style.display = 'none';
        continue;
      }
      _h.set(n.pos.x, n.pos.y + 1.95 * (d.cfg.scale || 1) + 0.15, n.pos.z).project(cam);
      if (_h.z > 1) {
        n.tag.style.display = n.bubble.style.display = 'none';
        continue;
      }
      const x = (_h.x * 0.5 + 0.5) * W,
        y = (-_h.y * 0.5 + 0.5) * H;
      n.tag.style.display = 'block';
      n.tag.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      n.tag.style.opacity = String(Math.max(0, Math.min(1, (16 - dist) / 4)));
      n.bubbleT -= dt;
      if (n.bubbleT < 0) {
        n.bubbleT = 7 + Math.random() * 5;
        n.lineI = (n.lineI + 1) % d.lines.length;
        n.bubble.textContent = d.lines[n.lineI];
        n.bubbleShow = 3.6;
      }
      n.bubbleShow = (n.bubbleShow || 0) - dt;
      const bv = n.bubbleShow > 0 && dist < 13 && !n.talking;
      n.bubble.style.display = bv ? 'block' : 'none';
      if (bv) n.bubble.style.transform = `translate(${x}px, ${y - 28}px) translate(-50%, -100%)`;
    }
  }

  consider(P, consider) {
    for (const n of this.list) {
      if (!n.model.root.visible) continue;
      consider(n.pos, 2.7, `대화 · ${n.name}`, () => this.g.talkTo(n));
    }
  }

  minimapMarkers(P, out) {
    // a star on the rim of the minimap points to anyone waiting to join
    for (const n of this.list) {
      const d = n.def;
      if (!d.recruit || (this.g.roster && this.g.roster.has(d.recruit))) continue;
      if (Math.abs(n.pos.x - P.x) < 260 && Math.abs(n.pos.z - P.z) < 260) out.push({ x: n.pos.x, z: n.pos.z, shape: 'friend', color: ELEMENTS[d.cfg.element].color });
    }
    for (const n of this.list) {
      if (!n.model.root.visible) continue;
      if (Math.abs(n.pos.x - P.x) < 70 && Math.abs(n.pos.z - P.z) < 70) out.push({ x: n.pos.x, z: n.pos.z, color: '#ffe9a8', r: 3 });
    }
  }
}

const _h = new THREE.Vector3();
const _lv = new THREE.Vector3();
