import * as THREE from 'three';
import { Renderer, PRESETS, pickQuality } from '../core/Renderer.js';
import { Input } from '../core/Input.js';
import { shared } from '../render/shaders.js';
import { Terrain, SPAWN, LANDMARKS } from '../world/Terrain.js';
import { Environment } from '../world/Environment.js';
import { Water } from '../world/Water.js';
import { Horizon } from '../world/Horizon.js';
import { Weather } from '../world/Weather.js';
import { Wildlife } from '../world/Wildlife.js';
import { Gathering } from '../world/Gathering.js';
import { NPCs } from '../world/NPCs.js';
import { Bag, CookPanel, BuffBar } from '../ui/Panels.js';
import { Dialogue } from '../ui/Dialogue.js';
import { Quest } from './Quest.js';
import { ITEMS } from './Items.js';
import { Boss } from '../combat/Boss.js';
import { BossUI } from '../ui/BossUI.js';
import { Progression, CharPanel } from './Progression.js';
import { Puzzles } from '../world/Puzzles.js';
import { Domain } from './Domain.js';
import { Grass } from '../world/Grass.js';
import { Vegetation, setLeafCoverage } from '../world/Vegetation.js';
import { Player } from '../character/Player.js';
import { CameraController } from './CameraController.js';
import { HUD, Menus } from '../ui/HUD.js';
import { ELEMENTS } from '../character/characters.js';
import { Combat } from '../combat/Combat.js';
import { Structures } from '../world/Structures.js';
import { Exploration } from './Exploration.js';
import { WorldMap } from '../ui/WorldMap.js';
import { TouchControls } from '../ui/Touch.js';
import { damp, smoothstep } from '../core/noise.js';
import { Sound } from '../audio/Sound.js';

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

export class Game {
  constructor(container) {
    this.container = container;
    this.state = 'loading';
    this.clock = new THREE.Clock();
    this.frame = 0;
    this.gems = 0;
    this.fpsAcc = 0;
    this.fpsN = 0;
    // debug: fixed timestep (?dt=0.033) for deterministic captures
    const fdt = parseFloat(new URLSearchParams(location.search).get('dt'));
    this.fixedDt = fdt > 0 && fdt < 0.2 ? fdt : 0;
    this.sfx = new Sound();
    // dynamic resolution keeps the frame rate up on slower GPUs
    this.autoRes = !this.fixedDt;
    try {
      if (localStorage.getItem('starwind.autores') === '0') this.autoRes = false;
    } catch (e) {}
    this.resT = 0;
    this.resN = 0;
    this.resCool = 3;
    this.lastSteps = 0;
    this.lastGrabs = 0;
    this.ambT = 0;
    this.amb = { alt: 0, speed: 0, air: false, night: 0, day: 1, water: 0, forest: 0, snow: 0, active: false };
  }

  async init() {
    const loader = HUD.loading(this.container);
    this.qualityKey = pickQuality();
    const q = (this.quality = PRESETS[this.qualityKey]);

    this.rendererW = new Renderer(this.container, q);
    this.renderer = this.rendererW.renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.2, 6000);
    this.input = new Input(this.renderer.domElement);

    loader.set(0.05, '지형을 빚는 중...');
    await nextFrame();
    this.terrain = new Terrain(1337);
    this.terrain.generate();
    loader.set(0.2, '마을과 유적을 세우는 중...');
    await nextFrame();
    this.structures = new Structures(this.scene, this.terrain);
    this.structures.build();
    this.ground = this.structures.ground;
    this.explore = new Exploration(this);
    this.gathering = new Gathering(this);
    Puzzles.reserve(this.terrain);
    this.scene.add(this.terrain.buildMesh(q.terrainStep));

    loader.set(0.35, '하늘과 바다를 칠하는 중...');
    await nextFrame();
    this.env = new Environment(this.scene, q);
    this.water = new Water(this.scene);
    this.horizon = new Horizon(this.scene);

    loader.set(0.5, '풀과 나무를 심는 중...');
    await nextFrame();
    this.grass = new Grass(this.scene, q.grass, q.grassField);
    this.vegetation = new Vegetation(this.scene, this.terrain, q);
    this.vegetation.build();

    loader.set(0.75, '여행자를 깨우는 중...');
    await nextFrame();
    this.player = new Player(this);
    this.cameraCtl = new CameraController(this.camera, this.terrain);
    this.cameraCtl.yaw = 0;
    this.combat = new Combat(this);
    this.explore.build();
    this.progression = new Progression(this);
    this.weather = new Weather(this);
    this.wildlife = new Wildlife(this);
    this.gathering.build();
    this.npcs = new NPCs(this);
    this.boss = new Boss(this);
    this.puzzles = new Puzzles(this);
    this.domain = new Domain(this);
    this.buffs = { atk: 0, stamina: 0 };

    this.rendererW.setup(this.scene, this.camera);
    this.hud = new HUD(this.container);
    this.hud.buildMapImage(this.terrain);
    this.renderPortraits();
    this.hud.setParty(this.player.party, this.player.active);
    this.menus = new Menus(this.container, this);
    this.worldMap = new WorldMap(this.container, this);
    this.bag = new Bag(this, this.container);
    this.cookPanel = new CookPanel(this, this.container);
    this.buffBar = new BuffBar(this.hud.layer);
    this.dialogue = new Dialogue(this, this.container);
    this.quest = new Quest(this);
    this.bossUI = new BossUI(this.container);
    this.charPanel = new CharPanel(this, this.container);
    if (TouchControls.wanted()) this.touch = new TouchControls(this);
    this.tpFade = document.createElement('div');
    this.tpFade.className = 'tp-fade';
    this.container.appendChild(this.tpFade);

    loader.set(0.9, '셰이더 준비 중...');
    await nextFrame();
    // initial camera for the title screen
    this.titleT = 0;
    this.updateTitleCamera(0);
    this.env.update(0, this.player.pos);
    this.renderer.compile(this.scene, this.camera);

    loader.set(1, '준비 완료');
    await nextFrame();
    loader.done();
    this.state = 'title';
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.state === 'playing' && !this.input.dragMode) this.pause();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.input.dragMode) {
        if (this.state === 'playing') this.pause();
        else if (this.state === 'paused') this.resume();
      }
      if (e.code === 'KeyH' && this.state === 'playing') this.hud.help.classList.toggle('hidden');
      if (e.code === 'KeyM') {
        if (this.state === 'playing') this.openMap();
        else if (this.state === 'map') this.closeMap();
      }
      if (e.code === 'KeyB') {
        if (this.state === 'playing') this.openPanel(this.bag);
        else if (this.state === 'panel' && this.panel === this.bag) this.closePanel();
      }
      if (e.code === 'KeyC') {
        if (this.state === 'playing') this.openPanel(this.charPanel);
        else if (this.state === 'panel' && this.panel === this.charPanel) this.closePanel();
      }
      if (e.code === 'Escape' && this.state === 'map') this.closeMap();
      if (e.code === 'Escape' && this.state === 'panel') this.closePanel();
    });
    window.addEventListener('beforeunload', () => this.explore.save());
    // audio unlocks on the first gesture; every button gets a soft click
    const unlock = () => this.sfx.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    this.container.addEventListener('click', (e) => {
      if (e.target.closest && e.target.closest('button')) this.sfx.click();
    });
    this.loop();
    window.__game = this;
  }

  renderPortraits() {
    const rt = new THREE.WebGLRenderTarget(160, 160, { samples: 4 });
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    const light = new THREE.DirectionalLight(0xffffff, 1);
    scene.add(light);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 10);
    const buf = new Uint8Array(160 * 160 * 4);
    const cv = document.createElement('canvas');
    cv.width = cv.height = 160;
    const g = cv.getContext('2d');
    const prevSun = shared.uSunDir.value.clone();
    shared.uSunDir.value.set(0.4, 0.6, 0.7).normalize();
    const prevClear = this.renderer.getClearAlpha();
    this.renderer.setClearColor(0x000000, 0);
    for (const p of this.player.party) {
      const m = p.model;
      const parent = m.root.parent;
      const vis = m.root.visible;
      m.root.visible = true;
      const pos = m.root.position.clone();
      m.root.position.set(0, 0, 0);
      m.root.rotation.y = 0;
      scene.add(m.root);
      m.update(0.016, { mode: 'idle', speed: 0 });
      m.root.updateMatrixWorld(true);
      const head = new THREE.Vector3();
      m.headGroup.getWorldPosition(head);
      cam.position.set(head.x + 0.12, head.y + 0.02, head.z + 0.62);
      cam.lookAt(head.x, head.y - 0.03, head.z);
      this.renderer.setRenderTarget(rt);
      this.renderer.clear();
      this.renderer.render(scene, cam);
      this.renderer.readRenderTargetPixels(rt, 0, 0, 160, 160, buf);
      const img = g.createImageData(160, 160);
      for (let y = 0; y < 160; y++) img.data.set(buf.subarray((159 - y) * 640, (160 - y) * 640), y * 640);
      g.clearRect(0, 0, 160, 160);
      g.putImageData(img, 0, 0);
      p.portrait = cv.toDataURL();
      parent.add(m.root);
      m.root.position.copy(pos);
      m.root.visible = vis;
    }
    this.renderer.setRenderTarget(null);
    this.renderer.setClearColor(0x000000, prevClear);
    shared.uSunDir.value.copy(prevSun);
    rt.dispose();
  }

  setQuality(key) {
    if (!PRESETS[key] || key === this.qualityKey) return;
    const q = PRESETS[key];
    this.qualityKey = key;
    this.quality = q;
    try {
      localStorage.setItem('starwind.quality', key);
    } catch (e) {}
    this.rendererW.applyQuality(q, this.camera);
    this.env.applyQuality(q);
    this.grass.setQuality(q.grass, q.grassField);
    setLeafCoverage(q.msaa > 0);
  }

  start() {
    if (this.state !== 'title') return;
    this.menus.hideTitle();
    this.hud.show();
    this.state = 'playing';
    this.sfx.unlock();
    this.input.enabled = true;
    this.input.requestLock();
    this.cameraCtl.initialized = false;
    this.cameraCtl.yaw = 0;
    this.cameraCtl.pitch = 0.18;
    this.clock.getDelta();
    setTimeout(() => this.hud.toast(`<b>${this.player.current.cfg.name}</b> · ${this.player.current.cfg.title}`, ELEMENTS[this.player.current.cfg.element].color), 600);
    this.quest.start();
  }

  // ---- bag / cooking panels
  openPanel(p, arg) {
    if (this.state !== 'playing') return;
    this.state = 'panel';
    this.panel = p;
    this.input.enabled = false;
    this.input.keys.clear();
    this.input.exitLock();
    this.hud.setPrompt('');
    this.explore.promptText = '';
    p.open(arg);
    this.sfx.open();
  }

  closePanel() {
    if (this.state !== 'panel') return;
    this.panel.close();
    this.panel = null;
    this.state = 'playing';
    this.input.enabled = true;
    this.input.requestLock();
    this.clock.getDelta();
    this.sfx.close();
    this.explore.save();
  }

  openCook(pot) {
    this.openPanel(this.cookPanel, pot);
  }

  applyFood(id) {
    const it = ITEMS[id];
    const fx = it.effect || {};
    if (fx.heal) this.combat.heal(fx.heal);
    if (fx.atk) this.buffs.atk = fx.atk;
    if (fx.stamina) this.buffs.stamina = fx.stamina;
    this.sfx.cookDone();
    this.hud.toast(`<b>${it.name}</b> · ${it.effectText}`, '#ffd36a');
    this.hud.setParty(this.player.party, this.player.active);
  }

  updateBuffs(dt) {
    const B = this.buffs;
    B.atk = Math.max(0, B.atk - dt);
    B.stamina = Math.max(0, B.stamina - dt);
    this.combat.atkBuff = B.atk > 0 ? 1.2 : 1;
    this.player.staminaMul = B.stamina > 0 ? 0.7 : 1;
    this.buffBar.update(B);
  }

  // ---- boss
  // short scripted camera shot: cam(t) fills `pos` / `look`, onEnd runs after
  startCine(dur, cam, onEnd) {
    if (this.state !== 'playing') return false;
    this.state = 'cine';
    this.cine = { t: 0, dur, cam, onEnd, pos: new THREE.Vector3(), look: new THREE.Vector3() };
    this.input.enabled = false;
    this.input.keys.clear();
    this.hud.layer.classList.add('cine');
    this.hud.setPrompt('');
    this.explore.promptText = '';
    if (this.combat.action) this.combat.endAction();
    return true;
  }

  updateCine(dt) {
    const c = this.cine;
    c.t += dt;
    const P = this.player;
    P.model.root.position.copy(P.pos);
    P.model.update(dt, { mode: 'idle', speed: 0 });
    c.cam(c.t, c.pos, c.look);
    this.camera.position.copy(c.pos);
    this.camera.lookAt(c.look);
    if (c.t > c.dur) {
      this.state = 'playing';
      this.input.enabled = true;
      this.hud.layer.classList.remove('cine');
      this.cameraCtl.pitch = 0.22;
      this.cameraCtl.initialized = false;
      this.clock.getDelta();
      if (c.onEnd) c.onEnd();
    }
  }

  bossIntro(boss) {
    const a0 = Math.atan2(this.player.pos.x - boss.home.x, this.player.pos.z - boss.home.z);
    const ok = this.startCine(
      4.2,
      (t, pos, look) => {
        const a = a0 + t * 0.32;
        const r = 15 - t * 0.8;
        pos.set(boss.home.x + Math.sin(a) * r, boss.home.y + 2.5 + t * 0.6, boss.home.z + Math.cos(a) * r);
        look.copy(boss.corePos);
      },
      () => (this.cameraCtl.yaw = Math.atan2(this.player.pos.x - boss.home.x, this.player.pos.z - boss.home.z))
    );
    if (!ok) return;
    this.bossUI.showCard(boss.name, boss.title);
    this.sfx.bossRoar();
  }

  onBossDefeated(boss) {
    this.combat.hitStop = 0.3;
    this.flashScreen('#f2deff', 0.55);
    this.cameraCtl.shake(0.5, 0.7);
    this.sfx.bossDeath();
    const prog = this.explore.progress;
    prog.bossKills = (prog.bossKills || 0) + 1;
    setTimeout(() => {
      this.hud.showBanner('도전 완료 · 뇌광의 결정체');
      this.explore.spawnChest('boss:' + Date.now(), { x: boss.home.x, y: boss.home.y, z: boss.home.z + 3 }, 2, true);
      this.gems += 100;
      this.hud.toast('획득 · <b>별빛 결정</b> ×100', '#9fe8ff');
      this.explore.save();
    }, 2600);
  }

  onBossReset() {}

  // ---- dialogue
  talkTo(npc) {
    return this.runScript(npc, this.quest.script(npc));
  }

  runScript(npc, fn) {
    if (this.state !== 'playing') return Promise.resolve();
    this.state = 'dialog';
    this.talkNpc = npc;
    if (npc) npc.talking = true;
    this.input.enabled = false;
    this.input.keys.clear();
    this.input.exitLock();
    this.hud.setPrompt('');
    this.explore.promptText = '';
    this.hud.layer.classList.add('cine');
    this.dlgCam = null;
    const P = this.player;
    if (npc) P.yaw = Math.atan2(npc.pos.x - P.pos.x, npc.pos.z - P.pos.z);
    return this.dialogue.run(fn).finally(() => {
      if (npc) npc.talking = false;
      this.talkNpc = null;
      this.hud.layer.classList.remove('cine');
      if (this.state === 'dialog') {
        this.state = 'playing';
        this.input.enabled = true;
        this.input.requestLock();
        this.clock.getDelta();
      }
      this.explore.save();
    });
  }

  // over-the-shoulder framing of the speaker during a conversation
  updateDialogCamera(dt) {
    const P = this.player;
    const n = this.talkNpc;
    const m = P.model;
    m.root.position.copy(P.pos);
    m.root.rotation.y = P.yaw = n ? Math.atan2(n.pos.x - P.pos.x, n.pos.z - P.pos.z) : P.yaw;
    m.update(dt, { mode: 'idle', speed: 0 });
    if (!n) return;
    const dx = n.pos.x - P.pos.x,
      dz = n.pos.z - P.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    const fx = dx / l,
      fz = dz / l;
    const sx = -fz,
      sz = fx;
    const h = n.pos.y + 1.45 * (n.def.cfg.scale || 1);
    const want = new THREE.Vector3(P.pos.x - fx * 1.6 + sx * 1.1, Math.max(P.pos.y, n.pos.y) + 1.55, P.pos.z - fz * 1.6 + sz * 1.1);
    const look = new THREE.Vector3(n.pos.x - sx * 0.35, h, n.pos.z - sz * 0.35);
    if (!this.dlgCam) this.dlgCam = { pos: this.camera.position.clone(), look: look.clone() };
    const k = 1 - Math.exp(-dt * 5);
    this.dlgCam.pos.lerp(want, k);
    this.dlgCam.look.lerp(look, k);
    this.camera.position.copy(this.dlgCam.pos);
    this.camera.lookAt(this.dlgCam.look);
  }

  pause() {
    this.state = 'paused';
    this.menus.showPause();
    this.sfx.open();
  }

  resume() {
    this.menus.hidePause();
    this.state = 'playing';
    this.input.requestLock();
    this.clock.getDelta();
  }

  openMap(focus) {
    if (this.state !== 'playing') return;
    this.state = 'map';
    this.input.enabled = false;
    this.input.keys.clear();
    this.input.exitLock();
    this.hud.setPrompt('');
    this.explore.promptText = '';
    this.worldMap.open(focus);
    this.sfx.open();
  }

  closeMap() {
    if (this.state !== 'map') return;
    this.worldMap.close();
    this.sfx.close();
    this.state = 'playing';
    this.input.enabled = true;
    this.input.requestLock();
    this.clock.getDelta();
  }

  // Fade out, move to a waypoint, fade back in.
  teleport(wp) {
    if (this.tpBusy) return;
    this.tpBusy = true;
    if (this.state === 'map') this.closeMap();
    const P = this.player;
    P.locked = true;
    this.tpFade.classList.add('on');
    this.sfx.teleport();
    setTimeout(() => {
      const a = Math.atan2(wp.x - LANDMARKS.statue.x, wp.z - LANDMARKS.statue.z) + 0.6;
      const x = wp.x + Math.sin(a) * 2.8,
        z = wp.z + Math.cos(a) * 2.8;
      P.pos.set(x, this.ground.heightAt(x, z), z);
      P.vel.set(0, 0, 0);
      P.state = 'ground';
      P.yaw = a;
      P.lastSafe.copy(P.pos);
      P.fallStartY = P.pos.y;
      this.cameraCtl.yaw = a + Math.PI;
      this.cameraCtl.pitch = 0.2;
      this.cameraCtl.initialized = false;
      this.hud.region = '';
      setTimeout(() => {
        this.tpFade.classList.remove('on');
        P.locked = false;
        this.tpBusy = false;
      }, 350);
    }, 520);
  }

  // fade out, move the player, fade back in
  warp(x, y, z, yaw, then) {
    if (this.tpBusy) return;
    this.tpBusy = true;
    const P = this.player;
    P.locked = true;
    this.tpFade.classList.add('on');
    this.sfx.teleport();
    setTimeout(() => {
      P.pos.set(x, y, z);
      P.vel.set(0, 0, 0);
      P.state = 'ground';
      P.yaw = yaw;
      P.lastSafe.copy(P.pos);
      P.fallStartY = P.pos.y;
      this.cameraCtl.yaw = yaw + Math.PI;
      this.cameraCtl.pitch = 0.2;
      this.cameraCtl.initialized = false;
      this.hud.region = '';
      setTimeout(() => {
        this.tpFade.classList.remove('on');
        P.locked = false;
        this.tpBusy = false;
        if (then) then();
      }, 350);
    }, 520);
  }

  regionAt(x, z) {
    if (this.domain && this.domain.inside) return '비경 · 바람 그림자 회랑';
    const d = (p) => Math.hypot(x - p.x, z - p.z);
    const h = this.terrain.heightAt(x, z);
    if (d(LANDMARKS.village) < 70) return '풍차 마을';
    if (d(LANDMARKS.arena) < 45) return '뇌광의 결전장';
    if (d(LANDMARKS.ruins) < 45) return '잊힌 유적';
    if (d(LANDMARKS.giantTree) < 75) return '천년나무 언덕';
    if (d(LANDMARKS.lake) < 95) return '거울 호수';
    if (d(LANDMARKS.mountain) < 210 || h > 75) return '별빛 설산';
    if (d(LANDMARKS.statue) < 45) return '수호상의 언덕';
    if (d(SPAWN) < 130) return '바람의 초원';
    if (this.terrain.forestAt(x, z) > 0.45) return '속삭이는 숲';
    if (h < 4) return '은빛 해안';
    return '별바람 평원';
  }

  updateTitleCamera(dt) {
    this.titleT += dt;
    const t = this.titleT * 0.035;
    const c = new THREE.Vector3(SPAWN.x, 0, SPAWN.z);
    const r = 16;
    const x = c.x + Math.sin(t + 2.6) * r;
    const z = c.z + Math.cos(t + 2.6) * r;
    const y = this.terrain.heightAt(x, z) + 3.2;
    this.camera.position.set(x, y, z);
    const look = new THREE.Vector3(c.x, this.terrain.heightAt(c.x, c.z) + 2.2, c.z);
    this.camera.lookAt(look);
    this.player.model.update(dt, { mode: 'idle', speed: 0 });
    const m = this.player.model;
    m.root.position.copy(this.player.pos);
    m.root.rotation.y = Math.atan2(x - this.player.pos.x, z - this.player.pos.z) * 0.6 + this.player.yaw * 0.4;
  }

  flashScreen(color, amount = 0.3) {
    const u = this.rendererW.grade.uniforms;
    u.uFlashColor.value.set(color);
    u.uFlash.value = Math.max(u.uFlash.value, amount);
  }

  // what the player is standing on (for footstep sounds)
  surfaceAt() {
    const P = this.player;
    if (P.state === 'swim') return 'water';
    const x = P.pos.x,
      z = P.pos.z;
    const th = this.terrain.heightAt(x, z);
    if (th < 0.3) return 'water';
    if (P.pos.y > th + 0.35) return Math.hypot(x - LANDMARKS.village.x, z - LANDMARKS.village.z) < 70 ? 'wood' : 'stone';
    if (th > 126) return 'snow';
    if (Math.hypot(x - LANDMARKS.village.x, z - LANDMARKS.village.z) < 15) return 'stone';
    if (this.terrain.pathDistance(x, z) < 2.4) return 'path';
    if (this.terrain.grassAt(x, z) < 0.22) return 'stone';
    return 'grass';
  }

  // ambient mix inputs, refreshed a few times per second
  updateAudio(dt) {
    const s = this.sfx;
    if (!s.ctx) return;
    const P = this.player;
    const m = P.model;
    if (this.state === 'playing') {
      if (m.steps !== this.lastSteps) {
        const sprint = P.speed > 7 ? 1.25 : P.speed < 3 ? 0.7 : 1;
        s.footstep(this.surfaceAt(), sprint);
      }
      if (m.grabs !== this.lastGrabs) s.climbGrab();
    }
    this.lastSteps = m.steps;
    this.lastGrabs = m.grabs;
    this.ambT -= dt;
    const A = this.amb;
    if (this.ambT <= 0) {
      this.ambT = 0.25;
      const pos = this.state === 'playing' || this.state === 'paused' || this.state === 'map' ? P.pos : this.camera.position;
      let wet = 0;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        for (const r of [10, 28]) if (this.terrain.heightAt(pos.x + Math.cos(a) * r, pos.z + Math.sin(a) * r) < 0.2) wet += r === 10 ? 1 / 8 : 0.5 / 8;
      }
      A.water = Math.min(1, wet);
      A.forest = Math.min(1, this.terrain.forestAt(pos.x, pos.z) * 1.3 + 0.15);
      A.snow = smoothstep(95, 135, pos.y);
      A.alt = Math.max(0, pos.y - this.terrain.heightAt(pos.x, pos.z) * 0.6);
      A.night = shared.uNight.value;
      A.day = smoothstep(-0.02, 0.1, this.env.sunDir.y);
    }
    A.speed = this.state === 'playing' ? P.vel.length() : 0;
    A.air = P.state === 'glide' || (P.state === 'air' && P.vel.y < -6);
    A.active = this.state === 'playing' || this.state === 'title';
    s.update(dt, A);
  }

  handleEvents() {
    for (const e of this.player.events) {
      this.combat.onPlayerEvent(e);
      const s = this.sfx;
      if (e.type === 'jump' || e.type === 'vault') s.jump();
      else if (e.type === 'land') s.land(e.impact || 4, this.surfaceAt());
      else if (e.type === 'glide') s.glider();
      else if (e.type === 'splash') s.splash();
      else if (e.type === 'climb') s.climbGrab();
      else if (e.type === 'switch') s.swap(this.player.current.cfg.element);
      if (e.type === 'switch') {
        const p = this.player.current;
        this.hud.setActive(this.player.party, this.player.active);
        this.hud.toast(`<b>${p.cfg.name}</b> 교체`, ELEMENTS[p.cfg.element].color);
      } else if (e.type === 'drown') {
        this.hud.flashCenter('기력이 다했습니다...');
        const p = this.player.current;
        p.hp = Math.max(1, p.hp - p.maxHp * 0.2);
      } else if (e.type === 'fallDamage') {
        const p = this.player.current;
        p.hp = Math.max(1, p.hp - p.maxHp * e.amount);
        this.cameraCtl.shake(0.25, 0.25);
      } else if (e.type === 'land' && e.impact > 13) {
        this.cameraCtl.shake(0.12, 0.2);
      }
    }
    this.player.events.length = 0;
  }

  // debug helper: advance the simulation n frames without rendering
  step(n = 1, dt = 1 / 30, keys = []) {
    for (const k of keys) this.input.pressed.add(k);
    for (let i = 0; i < n; i++) {
      this.update(dt);
      this.input.endFrame();
    }
  }

  loop() {
    requestAnimationFrame(() => this.loop());
    const raw = this.clock.getDelta();
    const real = Math.min(raw, 1 / 20);
    const dt = this.fixedDt || real;
    this.frame++;
    this.adaptResolution(raw);
    this.update(dt);
    this.updateRays();
    this.rendererW.render();
    this.input.endFrame();
  }

  // Lower the render scale when the frame rate sags, raise it again when
  // there is headroom. Decisions use ~2 s windows and a cooldown.
  adaptResolution(raw) {
    if (!this.autoRes || this.state !== 'playing' || raw > 1.5) return;
    this.resT += raw;
    this.resN++;
    this.resCool -= raw;
    if (this.resT < 2) return;
    const fps = this.resN / this.resT;
    this.resT = 0;
    this.resN = 0;
    if (this.resCool > 0) return;
    const R = this.rendererW;
    let s = R.scale;
    if (fps < 42 && s > 0.55) s = Math.max(0.55, s - (fps < 30 ? 0.15 : 0.1));
    else if (fps > 57 && s < 1) s = Math.min(1, s + 0.05);
    if (s !== R.scale) {
      R.setScale(s, this.camera);
      this.resCool = 2.5;
    }
  }

  setAutoRes(on) {
    this.autoRes = on;
    try {
      localStorage.setItem('starwind.autores', on ? '1' : '0');
    } catch (e) {}
    if (!on) this.rendererW.setScale(1, this.camera);
  }

  // sun shafts by day (stronger when the sun is low), faint moon shafts at night
  updateRays() {
    const env = this.env;
    this.camera.updateMatrixWorld();
    const col = this._rayCol || (this._rayCol = new THREE.Color());
    const s = env.sunDir;
    const day = smoothstep(-0.03, 0.06, s.y);
    if (day > 0.02) {
      const low = 1 - smoothstep(0.08, 0.6, s.y);
      col.copy(shared.uSunColor.value).multiplyScalar(0.17 * (1 + 1.0 * low));
      this.rendererW.updateRays(this.camera, s, col, day * (1 - this.weather.overcast * 0.85));
    } else {
      col.setRGB(0.5, 0.62, 1.0).multiplyScalar(0.1);
      this.rendererW.updateRays(this.camera, env.moonDir, col, shared.uNight.value * (1 - this.weather.overcast));
    }
  }

  update(dt) {
    shared.uTime.value += dt;
    const P = this.player;
    if (this.state === 'title') {
      this.updateTitleCamera(dt);
      this.combat.lateUpdate(dt, dt);
    } else if (this.state === 'playing') {
      const C = this.combat;
      const stop = C.hitStop > 0;
      C.hitStop = Math.max(0, C.hitStop - dt);
      const gdt = stop ? dt * 0.06 : dt;
      C.update(gdt, this.input);
      this.explore.preUpdate(gdt);
      P.update(gdt, this.input, this.cameraCtl.yaw);
      this.cameraCtl.update(dt, this.input, P);
      this.handleEvents();
      this.explore.update(gdt, this.input);
      C.lateUpdate(gdt, dt);
    } else if (this.state === 'map' || this.state === 'panel') {
      this.combat.lateUpdate(0, dt);
    } else if (this.state === 'dialog') {
      this.combat.lateUpdate(0, dt);
      this.updateDialogCamera(dt);
    } else if (this.state === 'cine') {
      this.combat.lateUpdate(dt, dt);
      this.updateCine(dt);
    }
    if (this.bossUI) {
      const b = this.boss;
      const show = b.aggro && b.alive && b.state !== 'dormant' && b.state !== 'intro' && this.state === 'playing';
      this.bossUI.update(dt, b, show);
    }
    if (this.state === 'playing') this.updateBuffs(dt);
    if (this.state !== 'paused' && this.state !== 'loading') {
      this.gathering.update(dt);
      this.npcs.update(dt);
      this.puzzles.update(dt);
      this.domain.update(dt);
    }
    if (this.quest) this.quest.update();
    this.structures.update(dt, shared.uWindStrength.value);
    if (this.touch) this.touch.setVisible(this.state === 'playing');
    const gu = this.rendererW.grade.uniforms;
    gu.uFlash.value = Math.max(0, gu.uFlash.value - dt * 2.2);
    gu.uSaturation.value = 1.04 - 0.22 * this.weather.overcast;
    if (this.state !== 'paused') {
      this.weather.update(dt);
      this.env.update(dt, P.pos);
    }
    this.env.followCamera(this.camera);
    this.water.update(this.camera);
    this.vegetation.update(this.camera);
    if (this.state !== 'paused') this.wildlife.update(dt);
    this.grass.update(this.state === 'playing' ? P.pos : this.camera.position);
    shared.uPlayerPos.value.copy(P.pos);
    this.updateAudio(dt);

    if (this.state === 'playing' || this.state === 'paused') this.updateHUD(dt);
  }

  updateHUD(dt) {
    const P = this.player;
    const v = new THREE.Vector3(P.pos.x, P.pos.y + P.height * 0.75, P.pos.z).project(this.camera);
    const sx = (v.x * 0.5 + 0.5) * window.innerWidth + 70;
    const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
    this.hud.update({
      party: P.party,
      active: P.active,
      switchCd: P.switchCd,
      stamina: P.stamina,
      maxStamina: P.maxStamina,
      exhausted: P.exhausted,
      draining: P.sprinting || P.state === 'glide' || P.state === 'climb' || P.state === 'swim',
      staminaPos: { x: sx, y: sy },
      time: this.env.time,
      region: this.frame % 15 === 0 ? this.regionAt(P.pos.x, P.pos.z) : null,
      gems: this.gems,
    });
    if (this.frame % 2 === 0) {
      const markers = [];
      for (const e of this.combat.enemies.list) {
        if (e.alive && Math.abs(e.pos.x - P.pos.x) < 60 && Math.abs(e.pos.z - P.pos.z) < 60) markers.push({ x: e.pos.x, z: e.pos.z, color: '#ff5a4a', r: 3 });
      }
      this.explore.minimapMarkers(P, markers);
      this.gathering.minimapMarkers(P, markers);
      this.puzzles.minimapMarkers(P, markers);
      const B = this.boss;
      if (B.alive && Math.abs(B.home.x - P.pos.x) < 110 && Math.abs(B.home.z - P.pos.z) < 110) markers.push({ x: B.home.x, z: B.home.z, color: '#c48bff', r: 6, pulse: B.aggro });
      this.npcs.minimapMarkers(P, markers);
      this.quest.minimapMarker(markers);
      this.hud.drawMinimap(P, this.cameraCtl.yaw, markers);
    }
    this.fpsAcc += dt;
    this.fpsN++;
    if (this.fpsAcc > 0.5) {
      const sc = this.rendererW.scale;
      this.hud.fps.textContent = `${Math.round(this.fpsN / this.fpsAcc)} FPS · ${this.qualityKey}${sc < 0.999 ? ` · ${Math.round(sc * 100)}%` : ''}`;
      this.fpsAcc = 0;
      this.fpsN = 0;
    }
  }
}
