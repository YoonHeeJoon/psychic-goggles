// Touch controls for phones and tablets: a floating joystick on the left half,
// drag-to-look on the right half, and the HUD skill / party / prompt widgets
// become buttons. Everything feeds the same Input object as the keyboard.

const el = (tag, cls, html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

export class TouchControls {
  static wanted() {
    const q = new URLSearchParams(location.search).get('touch');
    if (q === '1') return true;
    if (q === '0') return false;
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    return !!coarse && navigator.maxTouchPoints > 0;
  }

  constructor(game) {
    this.g = game;
    const input = (this.input = game.input);
    input.dragMode = true; // never ask for pointer lock
    input.noLock = true;
    document.body.classList.add('touch-mode');

    const root = (this.root = el('div', 'touch-ui hidden'));
    this.zone = el('div', 't-zone');
    this.stick = el('div', 't-stick', '<div class="t-knob"></div>');
    this.knob = this.stick.firstChild;
    this.ghost = el('div', 't-stick ghost', '<div class="t-knob"></div>');
    this.jumpBtn = el('div', 't-btn jump', '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M12 4l7 8h-4v8H9v-8H5z" fill="#fff"/></svg>');
    this.sprintBtn = el('div', 't-btn sprint', '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M5 6l7 6-7 6M12 6l7 6-7 6" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>');
    root.append(this.zone, this.ghost, this.stick, this.jumpBtn, this.sprintBtn);
    game.container.appendChild(root);

    this.stickId = null;
    this.lookId = null;
    this.origin = { x: 0, y: 0 };
    this.lastLook = { x: 0, y: 0 };
    this.R = 58;
    this.bindZone();
    this.hold(this.jumpBtn, 'Space');
    this.hold(this.sprintBtn, 'ShiftLeft');
    this.bindHud();
  }

  bindZone() {
    const z = this.zone;
    const input = this.input;
    z.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (e.clientX < window.innerWidth * 0.45 && this.stickId === null) {
        this.stickId = e.pointerId;
        this.origin.x = e.clientX;
        this.origin.y = e.clientY;
        this.stick.style.left = e.clientX + 'px';
        this.stick.style.top = e.clientY + 'px';
        this.stick.classList.add('on');
        this.ghost.classList.add('off');
        this.moveStick(e.clientX, e.clientY);
      } else if (this.lookId === null) {
        this.lookId = e.pointerId;
        this.lastLook.x = e.clientX;
        this.lastLook.y = e.clientY;
      }
      try {
        z.setPointerCapture(e.pointerId);
      } catch (err) {}
    });
    z.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickId) this.moveStick(e.clientX, e.clientY);
      else if (e.pointerId === this.lookId) {
        const k = 1.7;
        input.mouseDX += (e.clientX - this.lastLook.x) * k;
        input.mouseDY += (e.clientY - this.lastLook.y) * k;
        this.lastLook.x = e.clientX;
        this.lastLook.y = e.clientY;
      }
    });
    const end = (e) => {
      if (e.pointerId === this.stickId) {
        this.stickId = null;
        input.touchMove.x = 0;
        input.touchMove.y = 0;
        this.stick.classList.remove('on');
        this.ghost.classList.remove('off');
        this.knob.style.transform = '';
      } else if (e.pointerId === this.lookId) this.lookId = null;
    };
    z.addEventListener('pointerup', end);
    z.addEventListener('pointercancel', end);
  }

  moveStick(x, y) {
    let dx = x - this.origin.x,
      dy = y - this.origin.y;
    const len = Math.hypot(dx, dy);
    const R = this.R;
    // floating stick: the base follows a finger that drags far away
    if (len > R * 1.4) {
      const k = (len - R * 1.4) / len;
      this.origin.x += dx * k;
      this.origin.y += dy * k;
      this.stick.style.left = this.origin.x + 'px';
      this.stick.style.top = this.origin.y + 'px';
      dx = x - this.origin.x;
      dy = y - this.origin.y;
    }
    const l = Math.min(Math.hypot(dx, dy), R);
    const a = Math.atan2(dy, dx);
    const kx = Math.cos(a) * l,
      ky = Math.sin(a) * l;
    this.knob.style.transform = `translate(${kx}px, ${ky}px)`;
    const dead = 0.12;
    const m = l / R;
    const s = m < dead ? 0 : (m - dead) / (1 - dead);
    this.input.touchMove.x = Math.cos(a) * s;
    this.input.touchMove.y = -Math.sin(a) * s;
  }

  // a held virtual key
  hold(node, code) {
    const input = this.input;
    node.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      input.press(code);
      node.classList.add('down');
    });
    const up = () => {
      input.release(code);
      node.classList.remove('down');
    };
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
    node.addEventListener('pointerleave', up);
  }

  tap(node, fn) {
    node.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      fn();
      node.classList.add('down');
      setTimeout(() => node.classList.remove('down'), 120);
    });
  }

  bindHud() {
    const g = this.g;
    const hud = g.hud;
    const input = this.input;
    const S = hud.skills;
    // attack: held (mouse button 0)
    const atk = S.querySelector('.atk');
    atk.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!input.enabled) return;
      input.mousePressed.add(0);
      input.mouseButtons.add(0);
      atk.classList.add('down');
    });
    const atkUp = () => {
      input.mouseButtons.delete(0);
      atk.classList.remove('down');
    };
    atk.addEventListener('pointerup', atkUp);
    atk.addEventListener('pointercancel', atkUp);
    atk.addEventListener('pointerleave', atkUp);
    this.tap(S.querySelector('.e'), () => this.pulse('KeyE'));
    this.tap(S.querySelector('.q'), () => this.pulse('KeyQ'));
    this.tap(hud.prompt, () => this.pulse('KeyF'));
    // party portraits switch characters (rows are rebuilt by setParty)
    hud.partyEl.addEventListener('pointerdown', (e) => {
      const row = e.target.closest('.member');
      if (!row) return;
      e.preventDefault();
      const i = [...hud.partyEl.children].indexOf(row);
      if (i >= 0) this.pulse('Digit' + (i + 1));
    });
    for (const p of hud.topRight.querySelectorAll('.keyhint')) {
      const act = p.dataset.act;
      this.tap(p, () => (act === 'map' ? g.openMap() : act === 'bag' ? g.openPanel(g.bag) : g.pause()));
    }
  }

  // press for one frame
  pulse(code) {
    const input = this.input;
    if (!input.enabled) return;
    input.press(code);
    setTimeout(() => input.release(code), 60);
  }

  setVisible(v) {
    if (v === this.visible) return;
    this.visible = v;
    this.root.classList.toggle('hidden', !v);
    if (!v) {
      this.stickId = this.lookId = null;
      this.input.touchMove.x = this.input.touchMove.y = 0;
      this.stick.classList.remove('on');
    }
  }
}
