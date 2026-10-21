// Keyboard + mouse input. Uses pointer lock when available and falls back to
// click-and-drag camera control (e.g. inside sandboxed iframes). Keys can be
// rebound (game code keeps reading the default codes) and a standard gamepad
// drives the same virtual keys.

// action -> default key (the code the game logic reads)
export const ACTIONS = [
  ['forward', '앞으로', 'KeyW'],
  ['back', '뒤로', 'KeyS'],
  ['left', '왼쪽', 'KeyA'],
  ['right', '오른쪽', 'KeyD'],
  ['jump', '점프 · 활공', 'Space'],
  ['sprint', '질주 · 회피', 'ShiftLeft'],
  ['skill', '원소 스킬', 'KeyE'],
  ['burst', '원소 폭발', 'KeyQ'],
  ['interact', '상호작용', 'KeyF'],
  ['letgo', '등반 중 손 놓기', 'KeyX'],
  ['walk', '걷기 전환', 'ControlLeft'],
  ['map', '지도', 'KeyM'],
  ['bag', '가방', 'KeyB'],
  ['char', '캐릭터', 'KeyC'],
  ['log', '업적', 'KeyL'],
  ['comm', '의뢰 게시판', 'KeyJ'],
  ['photo', '사진 모드', 'KeyP'],
];

export function keyLabel(code) {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map = { Space: 'Space', ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl', AltLeft: 'L-Alt', Tab: 'Tab', CapsLock: 'Caps', Backquote: '`', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
  return map[code] || code;
}

// gamepad (standard mapping) -> virtual key
const PAD = { 0: 'Space', 1: 'ShiftLeft', 3: 'KeyF', 5: 'KeyE', 7: 'KeyQ', 12: 'Digit1', 13: 'Digit3', 14: 'Digit4', 15: 'Digit2', 10: 'ControlLeft' };

export class Input {
  constructor(dom) {
    this.dom = dom;
    this.keys = new Set();
    this.pressed = new Set(); // keys pressed this frame
    this.mouseButtons = new Set();
    this.mousePressed = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.locked = false;
    this.dragMode = false;
    this.dragging = false;
    this.enabled = false;
    this.sensitivity = 1;
    this.touchMove = { x: 0, y: 0 };
    this.padMove = { x: 0, y: 0 };
    this.padPrev = [];
    this.pad = null;
    this.binds = {};
    for (const [id, , def] of ACTIONS) this.binds[id] = def;
    try {
      Object.assign(this.binds, JSON.parse(localStorage.getItem('starwind.keys') || '{}'));
    } catch (e) {}
    this.rebuildMap();

    window.addEventListener('keydown', (e) => {
      if (this.capture) return;
      if (!this.enabled) return;
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      const code = this.canon(e.code);
      if (!code) return;
      if (!this.keys.has(code)) this.pressed.add(code);
      this.keys.add(code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(this.canon(e.code)));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseButtons.clear();
    });

    dom.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      this.mouseButtons.add(e.button);
      if (!this.locked && !this.dragMode) {
        // first click only captures the mouse
        this.requestLock();
        return;
      }
      if (this.dragMode) {
        // in drag mode a short click attacks, a drag turns the camera
        this.dragging = true;
        this.downAt = performance.now();
        this.dragDist = 0;
        if (e.button !== 0) this.mousePressed.add(e.button);
      } else this.mousePressed.add(e.button);
    });
    window.addEventListener('mouseup', (e) => {
      this.mouseButtons.delete(e.button);
      if (this.dragMode && this.dragging && e.button === 0 && performance.now() - this.downAt < 260 && this.dragDist < 8) this.mousePressed.add(0);
      this.dragging = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (this.locked || (this.dragMode && this.dragging)) {
        this.mouseDX += e.movementX || 0;
        this.mouseDY += e.movementY || 0;
        if (this.dragging) this.dragDist += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0);
      }
    });
    dom.addEventListener(
      'wheel',
      (e) => {
        if (!this.enabled) return;
        e.preventDefault();
        this.wheel += Math.sign(e.deltaY);
      },
      { passive: false }
    );
    dom.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
    });
    document.addEventListener('pointerlockerror', () => {
      this.dragMode = true;
    });
  }

  requestLock() {
    if (this.noLock) return;
    try {
      const r = this.dom.requestPointerLock && this.dom.requestPointerLock();
      if (r && r.catch) r.catch(() => (this.dragMode = true));
    } catch (e) {
      this.dragMode = true;
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // ---- key rebinding: physical key -> the default code the game reads
  rebuildMap() {
    this.map = {};
    const defaults = new Set(ACTIONS.map((a) => a[2]));
    for (const [id, , def] of ACTIONS) {
      const phys = this.binds[id];
      if (phys) this.map[phys] = def;
    }
    // a default key whose action moved elsewhere does nothing (unless reused)
    for (const d of defaults) if (!(d in this.map)) this.map[d] = null;
  }

  canon(code) {
    return code in this.map ? this.map[code] : code;
  }

  bind(action, code) {
    // swap if the key already belongs to another action
    for (const [id] of ACTIONS) if (id !== action && this.binds[id] === code) this.binds[id] = this.binds[action];
    this.binds[action] = code;
    this.rebuildMap();
    try {
      localStorage.setItem('starwind.keys', JSON.stringify(this.binds));
    } catch (e) {}
  }

  resetBinds() {
    for (const [id, , def] of ACTIONS) this.binds[id] = def;
    this.rebuildMap();
    try {
      localStorage.removeItem('starwind.keys');
    } catch (e) {}
  }

  // ---- gamepad: sticks move / look, buttons press virtual keys
  pollPad(dt, game) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let p = null;
    for (const x of pads) if (x && x.connected) p = p || x;
    if (!p) {
      if (this.pad) {
        this.pad = null;
        this.padMove.x = this.padMove.y = 0;
        for (const code of Object.values(PAD)) this.keys.delete(code);
        this.mouseButtons.delete(0);
      }
      return;
    }
    if (!this.pad) {
      this.pad = p.id;
      game.hud.toast('<b>게임패드</b> 연결됨 · 왼쪽 스틱 이동 · 오른쪽 스틱 시점', '#9fe8ff');
      this.dragMode = true;
    }
    const dz = (v) => (Math.abs(v) < 0.16 ? 0 : (v - Math.sign(v) * 0.16) / 0.84);
    this.padMove.x = dz(p.axes[0] || 0);
    this.padMove.y = -dz(p.axes[1] || 0);
    const lx = dz(p.axes[2] || 0),
      ly = dz(p.axes[3] || 0);
    if (this.enabled) {
      this.mouseDX += lx * Math.abs(lx) * 900 * dt;
      this.mouseDY += ly * Math.abs(ly) * 600 * dt;
    }
    const b = p.buttons.map((x) => x.pressed || x.value > 0.5);
    const edge = (i) => b[i] && !this.padPrev[i];
    const playing = game.state === 'playing';
    if (playing) {
      for (const [i, code] of Object.entries(PAD)) {
        if (edge(+i)) this.press(code);
        else if (!b[i] && this.padPrev[i]) this.release(code);
      }
      if (edge(2)) {
        this.mousePressed.add(0);
        this.mouseButtons.add(0);
      } else if (!b[2] && this.padPrev[2]) this.mouseButtons.delete(0);
      if (edge(8)) game.openMap();
      if (edge(6)) game.openPanel(game.bag);
      if (edge(9)) game.pause();
      if (edge(11)) game.cameraCtl.yaw = game.player.yaw + Math.PI;
    } else {
      // menus: A advances / confirms, B backs out, Start resumes
      const key = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code }));
      if (edge(0)) key('Enter');
      if (edge(1)) key('Escape');
      if (edge(12)) key('Digit1');
      if (edge(13)) key('Digit2');
      if (edge(9) && game.state === 'paused') game.resume();
      if (edge(8) && game.state === 'map') game.closeMap();
    }
    this.padPrev = b;
  }

  // virtual keys (touch buttons)
  press(code) {
    if (!this.enabled) return;
    if (!this.keys.has(code)) this.pressed.add(code);
    this.keys.add(code);
  }
  release(code) {
    this.keys.delete(code);
  }

  down(code) {
    return this.keys.has(code);
  }
  hit(code) {
    return this.pressed.has(code);
  }
  mouseHit(b) {
    return this.mousePressed.has(b);
  }

  moveVector() {
    let x = 0,
      y = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) y += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) y -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
    if (this.down('KeyA') || this.down('ArrowLeft')) x -= 1;
    x += this.touchMove.x + this.padMove.x;
    y += this.touchMove.y + this.padMove.y;
    const l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    return { x, y };
  }

  endFrame() {
    this.pressed.clear();
    this.mousePressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
}
