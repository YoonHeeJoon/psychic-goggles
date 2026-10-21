import * as THREE from 'three';
import { SkyFX } from './SkyFX.js';
import { PORT_LEN, PORT_DIR, portWorld } from './Terrain.js';
import { Builder, M, box, cyl } from './Structures.js';
import { shared } from '../render/shaders.js';

// "바람등불 축제" — every night from 19:00 the harbour releases paper
// lanterns over the sea while fireworks burst above the harbour basin.
// Anyone can send up a wish lantern from the stand on the quay. Shooting
// stars cross every clear night, festival or not.

const L = PORT_LEN;
const WISHES = [
  '바람이 언제나 등 뒤에서 불어 주기를.',
  '다음 여행지에서도 좋은 사람들을 만나기를.',
  '모두가 따뜻한 겨울을 보내기를.',
  '별바람의 눈을 전부 찾을 수 있기를!',
  '맛있는 별딸기 파이를 실컷 먹을 수 있기를.',
  '항구의 등대가 영원히 꺼지지 않기를.',
];

export class Festival {
  constructor(game) {
    this.g = game;
    this.fx = new SkyFX(game.scene);
    this.force = new URLSearchParams(location.search).has('festival');
    this.fwT = 1.5;
    this.lanT = 0;
    this.salvo = 0;
    this.u = new THREE.Vector3(Math.sin(PORT_DIR), 0, Math.cos(PORT_DIR));
    this.buildStand();
    this.fx.onBurst = (at, kind) => {
      const d = at.distanceTo(game.camera.position);
      setTimeout(() => game.sfx.fireworkBoom(d, kind), Math.min(2500, (d / 340) * 1000));
    };
  }

  get active() {
    const t = this.g.env.time;
    return this.force || t >= 19 || t < 0.6;
  }

  // lantern stall on the quay: a table stacked with paper lanterns
  buildStand() {
    const S = this.g.structures;
    const T = this.g.terrain;
    const [x, z] = portWorld(L + 10.5, 7.5);
    const y = T.heightAt(x, z);
    const F = S.frame(x, y, z, PORT_DIR + Math.PI);
    const at = (m) => F.clone().multiply(m);
    const b = new Builder();
    b.add('wood', box(1.8, 0.85, 0.8), { m: at(M(0, 0, 0)), color: '#8a5a36' });
    for (const sx of [-0.85, 0.85]) b.add('wood', box(0.08, 2.3, 0.08), { m: at(M(sx, 0, -0.35)), color: '#6b4630' });
    b.add('cloth', new THREE.PlaneGeometry(1.9, 0.5), { m: at(M(0, 2.1, -0.35)), color: '#c23a2c', extraFn: (xx, yy) => (0.25 - yy) * 0.3 });
    for (let k = 0; k < 7; k++) {
      const lx = -0.6 + (k % 4) * 0.4,
        ly = 0.85 + Math.floor(k / 4) * 0.42,
        lz = Math.floor(k / 4) ? -0.05 : 0.1;
      b.add('lamp', cyl(0.15, 0.12, 0.34, 8), { m: at(M(lx + (k >= 4 ? 0.2 : 0), ly, lz)), color: k % 3 ? '#ffd38a' : '#ffb08a', extra: 1 });
    }
    b.build(S.mats, S.group);
    S.solids.addBox(x, z, 0.95, 0.45, PORT_DIR + Math.PI, y + 0.85);
    this.stand = new THREE.Vector3(x, y, z).addScaledVector(this.u, -1.1);
  }

  consider(P, consider) {
    if (this.active) consider(this.stand, 2.6, '소원 등불 날리기', () => this.wish());
  }

  wish() {
    const g = this.g;
    const P = g.player.pos;
    const drift = this.u.clone().multiplyScalar(0.5);
    this.fx.releaseLantern(P.x, P.y + 1.6, P.z, drift, { scale: 1.35, color: '#ffd27a', life: 160 });
    g.combat.vfx.burst(new THREE.Vector3(P.x, P.y + 1.6, P.z), '#ffd27a', 26, { speed: 3, size: 0.2, life: 1.0, gravity: -1, up: 1 });
    g.sfx.unseal();
    g.hud.toast(`<b>소원</b> · ${WISHES[Math.floor(Math.random() * WISHES.length)]}`, '#ffd27a');
    if (g.achievements) g.achievements.add('wishes');
  }

  update(dt) {
    const g = this.g;
    const t = shared.uTime.value;
    const night = shared.uNight.value;
    const clear = g.weather ? g.weather.overcast < 0.3 : true;
    this.fx.updateStars(dt, g.camera, night, clear && !(g.domain && g.domain.inside));
    if (this.active && !(g.domain && g.domain.inside)) {
      // lanterns drift up from the quay and the pier, out over the sea
      this.lanT -= dt;
      if (this.lanT <= 0) {
        this.lanT = 0.45 + Math.random() * 0.6;
        const onPier = Math.random() < 0.4;
        const s = onPier ? L + 16 + Math.random() * 26 : L - 4 + Math.random() * 16;
        const tt = onPier ? 3 + (Math.random() - 0.5) * 2.4 : (Math.random() - 0.5) * 26;
        const [x, z] = portWorld(s, tt);
        const w = shared.uWindDir.value;
        const drift = this.u.clone().multiplyScalar(0.6).add(new THREE.Vector3(w.x, 0, w.y).multiplyScalar(0.3));
        this.fx.releaseLantern(x, 4.2, z, drift);
      }
      // fireworks while someone is near enough to see them
      const [px, pz] = portWorld(L + 60, 0);
      const near = Math.hypot(g.camera.position.x - px, g.camera.position.z - pz) < 750;
      if (near) {
        this.fwT -= dt;
        if (this.fwT <= 0) {
          if (this.salvo > 0) {
            this.salvo--;
            this.fwT = 0.35 + Math.random() * 0.3;
          } else {
            this.fwT = 2.4 + Math.random() * 3.4;
            if (Math.random() < 0.25) this.salvo = 2 + Math.floor(Math.random() * 3);
          }
          const [x, z] = portWorld(L + 55 + Math.random() * 30, (Math.random() - 0.5) * 40);
          this.fx.launch(x, 0.5, z, 42 + Math.random() * 28);
          const d = Math.hypot(g.camera.position.x - x, g.camera.position.z - z);
          if (d < 400) g.sfx.fireworkLaunch(d);
        }
      }
    }
    this.fx.updateSparks(dt);
    this.fx.updateLanterns(dt, t);
  }
}
