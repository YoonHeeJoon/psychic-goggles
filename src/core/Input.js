// Keyboard + mouse input. Uses pointer lock when available and falls back to
// click-and-drag camera control (e.g. inside sandboxed iframes).

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

    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseButtons.clear();
    });

    dom.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      this.mouseButtons.add(e.button);
      this.mousePressed.add(e.button);
      if (!this.locked && !this.dragMode) this.requestLock();
      if (this.dragMode) this.dragging = true;
    });
    window.addEventListener('mouseup', (e) => {
      this.mouseButtons.delete(e.button);
      this.dragging = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (this.locked || (this.dragMode && this.dragging)) {
        this.mouseDX += e.movementX || 0;
        this.mouseDY += e.movementY || 0;
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
    x += this.touchMove.x;
    y += this.touchMove.y;
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
