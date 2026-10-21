import * as THREE from 'three';
import { Renderer, PRESETS, pickQuality } from '../core/Renderer.js';
import { Input } from '../core/Input.js';
import { shared } from '../render/shaders.js';
import { Terrain, SPAWN, LANDMARKS } from '../world/Terrain.js';
import { Environment } from '../world/Environment.js';
import { Water } from '../world/Water.js';
import { Grass } from '../world/Grass.js';
import { Vegetation } from '../world/Vegetation.js';
import { Player } from '../character/Player.js';
import { CameraController } from './CameraController.js';
import { HUD, Menus } from '../ui/HUD.js';
import { ELEMENTS } from '../character/characters.js';
import { damp } from '../core/noise.js';

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
    this.scene.add(this.terrain.buildMesh(q.terrainStep));

    loader.set(0.35, '하늘과 바다를 칠하는 중...');
    await nextFrame();
    this.env = new Environment(this.scene, q);
    this.water = new Water(this.scene);

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

    this.rendererW.setup(this.scene, this.camera);
    this.hud = new HUD(this.container);
    this.hud.buildMapImage(this.terrain);
    this.renderPortraits();
    this.hud.setParty(this.player.party, this.player.active);
    this.menus = new Menus(this.container, this);

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

  start() {
    if (this.state !== 'title') return;
    this.menus.hideTitle();
    this.hud.show();
    this.state = 'playing';
    this.input.enabled = true;
    this.input.requestLock();
    this.cameraCtl.initialized = false;
    this.cameraCtl.yaw = 0;
    this.cameraCtl.pitch = 0.18;
    this.clock.getDelta();
    setTimeout(() => this.hud.toast(`<b>${this.player.current.cfg.name}</b> · ${this.player.current.cfg.title}`, ELEMENTS[this.player.current.cfg.element].color), 600);
  }

  pause() {
    this.state = 'paused';
    this.menus.showPause();
  }

  resume() {
    this.menus.hidePause();
    this.state = 'playing';
    this.input.requestLock();
    this.clock.getDelta();
  }

  regionAt(x, z) {
    const d = (p) => Math.hypot(x - p.x, z - p.z);
    const h = this.terrain.heightAt(x, z);
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

  handleEvents() {
    for (const e of this.player.events) {
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
  }

  loop() {
    requestAnimationFrame(() => this.loop());
    const dt = Math.min(this.clock.getDelta(), 1 / 20);
    this.frame++;
    this.update(dt);
    this.rendererW.render();
    this.input.endFrame();
  }

  update(dt) {
    shared.uTime.value += dt;
    const P = this.player;
    if (this.state === 'title') {
      this.updateTitleCamera(dt);
    } else if (this.state === 'playing') {
      P.update(dt, this.input, this.cameraCtl.yaw);
      this.cameraCtl.update(dt, this.input, P);
      this.handleEvents();
    }
    if (this.state !== 'paused') this.env.update(dt, P.pos);
    this.env.followCamera(this.camera);
    this.water.update(this.camera);
    this.grass.update(this.state === 'playing' ? P.pos : this.camera.position);
    shared.uPlayerPos.value.copy(P.pos);

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
    if (this.frame % 2 === 0) this.hud.drawMinimap(P, this.cameraCtl.yaw, this.markers || []);
    this.fpsAcc += dt;
    this.fpsN++;
    if (this.fpsAcc > 0.5) {
      this.hud.fps.textContent = `${Math.round(this.fpsN / this.fpsAcc)} FPS · ${this.qualityKey}`;
      this.fpsAcc = 0;
      this.fpsN = 0;
    }
  }
}
