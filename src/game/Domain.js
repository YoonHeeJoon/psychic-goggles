import * as THREE from 'three';

// 비경 · 바람 그림자 회랑: a challenge domain on a floating platform far over
// the northern sea. Step through the gate, watch the realm come into view,
// then clear three waves of monsters before the time runs out.

const TAU = Math.PI * 2;
const NAME = '바람 그림자 회랑';
const WAVES = [
  [
    ['slime', 'fire'],
    ['slime', 'water'],
    ['slime', 'thunder'],
    ['slime', 'wind'],
  ],
  [
    ['goblin', null],
    ['goblin', null],
    ['slime', 'ice'],
    ['slime', 'water'],
  ],
  [
    ['goblin', null],
    ['goblin', null],
    ['goblin', null],
    ['slime', 'fire'],
    ['slime', 'thunder'],
  ],
];
const TIME = 150;
const LEVEL = 30;

export class Domain {
  constructor(game) {
    this.g = game;
    this.gate = game.structures.domainGate;
    this.realm = game.structures.realm;
    this.state = 'idle';
    this.inside = false;
    this.enemies = [];
  }

  consider(P, consider) {
    if (this.state === 'idle') consider(this.gate.pos, 5.5, `비경 진입 · ${NAME}`, () => this.enter());
    if (this.inside && (this.state === 'done' || this.state === 'failed')) consider(this.realm.exitPos, 3.2, '비경 나가기', () => this.leave());
  }

  enter() {
    const g = this.g;
    const R = this.realm;
    this.state = 'entering';
    g.sfx.waypoint();
    g.warp(R.center.x - 9, R.center.y, R.center.z, Math.PI / 2, () => {
      this.inside = true;
      this.state = 'intro';
      const c = R.center;
      g.startCine(
        4.4,
        (t, pos, look) => {
          const a = Math.PI + t * 0.45;
          const r = 34 - t * 3;
          pos.set(c.x + Math.cos(a) * r, c.y + 14 - t * 1.6, c.z + Math.sin(a) * r);
          look.set(c.x, c.y + 1.5, c.z);
        },
        () => this.countdown()
      );
      g.bossUI.showCard(NAME, '비경 · 시련');
    });
  }

  countdown() {
    const g = this.g;
    this.state = 'countdown';
    this.t = 3.2;
    g.cameraCtl.yaw = -Math.PI / 2;
    g.hud.flashCenter('3', 900);
    g.sfx.click();
  }

  spawnWave(i) {
    const g = this.g;
    const c = this.realm.center;
    const list = WAVES[i];
    list.forEach(([kind, el], k) => {
      const a = (k / list.length) * TAU + i * 0.7;
      const r = 8 + (k % 2) * 3;
      const e = g.combat.enemies.spawn(kind, el, c.x + Math.cos(a) * r, c.z + Math.sin(a) * r, LEVEL + i);
      this.enemies.push(e);
      g.combat.vfx.burst(e.center(new THREE.Vector3()), '#9ff0e0', 22, { speed: 5, size: 0.24, life: 0.7, up: 0.8 });
      g.combat.vfx.ring(new THREE.Vector3(e.pos.x, e.pos.y + 0.1, e.pos.z), '#9ff0e0', 2.2, 0.5);
    });
    g.hud.flashCenter(`제 ${i + 1} 파`, 1400);
    g.sfx.bossCharge();
  }

  clearEnemies() {
    for (const e of this.enemies) this.g.combat.enemies.remove(e);
    this.enemies.length = 0;
  }

  succeed() {
    const g = this.g;
    this.state = 'done';
    const used = TIME - this.timeLeft;
    g.hud.setTimer(null);
    g.hud.showBanner(`비경 도전 완료 · ${Math.floor(used / 60)}:${String(Math.floor(used % 60)).padStart(2, '0')}`);
    g.sfx.questDone();
    const prog = g.explore.progress;
    const first = !prog.domainClears;
    prog.domainClears = (prog.domainClears || 0) + 1;
    const c = this.realm.center;
    setTimeout(() => {
      g.explore.spawnChest('domain:' + Date.now(), { x: c.x, y: c.y, z: c.z }, 2, true);
      if (first) {
        g.gems += 150;
        g.hud.toast('첫 클리어 보상 · <b>별빛 결정</b> ×150', '#9fe8ff');
      }
      g.explore.save();
    }, 900);
    this.openExit();
  }

  fail(msg) {
    const g = this.g;
    this.state = 'failed';
    this.clearEnemies();
    g.hud.setTimer(null);
    g.hud.flashCenter(msg || '도전 실패', 2200);
    this.openExit();
  }

  openExit() {
    this.exitOpen = 0.001;
  }

  leave() {
    const g = this.g;
    const G = this.gate;
    const x = G.pos.x + G.front.x * 7,
      z = G.pos.z + G.front.z * 7;
    this.state = 'leaving';
    g.warp(x, g.ground.heightAt(x, z), z, Math.atan2(G.front.x, G.front.z), () => this.reset());
  }

  reset() {
    this.clearEnemies();
    this.inside = false;
    this.state = 'idle';
    this.exitOpen = 0;
    this.realm.exit.material.uniforms.uOpen.value = 0;
    this.g.hud.setTimer(null);
  }

  update(dt) {
    const g = this.g;
    const R = this.realm;
    const P = g.player;
    // the exit portal fades in once the trial is over
    if (this.exitOpen > 0) {
      this.exitOpen = Math.min(1, this.exitOpen + dt * 0.8);
      R.exit.material.uniforms.uOpen.value = this.exitOpen;
    }
    if (!this.inside) return;
    const c = R.center;
    // left by other means (map teleport): tidy up
    if (Math.hypot(P.pos.x - c.x, P.pos.z - c.z) > 120) {
      this.reset();
      return;
    }
    // keep everyone on the platform
    const keep = (pos, r) => {
      const dx = pos.x - c.x,
        dz = pos.z - c.z;
      const d = Math.hypot(dx, dz);
      if (d > r) {
        pos.x = c.x + (dx / d) * r;
        pos.z = c.z + (dz / d) * r;
      }
    };
    keep(P.pos, R.r - 0.8);
    if (P.pos.y < c.y - 12) {
      P.pos.set(c.x - 6, c.y + 0.5, c.z);
      P.vel.set(0, 0, 0);
    }
    for (const e of this.enemies) if (e.alive) keep(e.pos, R.r - 1.2);

    if (this.state === 'countdown') {
      const before = Math.ceil(this.t - 0.2);
      this.t -= dt;
      const now = Math.ceil(this.t - 0.2);
      if (now !== before && now > 0) {
        g.hud.flashCenter(String(now), 900);
        g.sfx.click();
      }
      if (this.t <= 0.2) {
        g.hud.flashCenter('도전 시작!', 1000);
        this.state = 'fight';
        this.wave = 0;
        this.timeLeft = TIME;
        this.waveDelay = 0;
        this.spawnWave(0);
      }
    } else if (this.state === 'fight') {
      this.timeLeft -= dt;
      const alive = this.enemies.filter((e) => e.alive).length;
      if (alive === 0) {
        if (this.wave >= WAVES.length - 1) this.succeed();
        else {
          this.waveDelay += dt;
          if (this.waveDelay > 1.6) {
            this.waveDelay = 0;
            this.wave++;
            this.spawnWave(this.wave);
          }
        }
      }
      if (this.state === 'fight') {
        const m = Math.max(0, this.timeLeft);
        g.hud.setTimer(`${NAME} · ${Math.floor(m / 60)}:${String(Math.floor(m % 60)).padStart(2, '0')} · ${this.wave + 1}/${WAVES.length} 파`);
        if (this.timeLeft <= 0) this.fail('시간 초과 · 도전 실패');
        else if (g.combat.downTimer > 0) this.fail('파티가 쓰러졌습니다 · 도전 실패');
      }
    }
  }
}
