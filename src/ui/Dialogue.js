// Story dialogue box: speaker name, typewriter text, and choice options on
// the right. Scripts are plain async functions:
//   await d.say('하르반', '어서 오게.');
//   const i = await d.choose([{ text: '도와드릴게요', icon: 'quest' }, ...]);

const el = (tag, cls, html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

const ICONS = {
  talk: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 5h16v10H9l-5 4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  quest: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill="currentColor"/></svg>',
  shop: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 016 0v2" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  bye: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 12h12M13 7l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

export class Dialogue {
  constructor(game, root) {
    this.g = game;
    this.el = el(
      'div',
      'dialogue hidden',
      `<div class="dlg-shade"></div>
       <div class="dlg-box"><div class="dlg-name"><span class="n"></span><span class="t"></span></div>
         <div class="dlg-text"></div><div class="dlg-next">▼</div></div>
       <div class="dlg-options"></div>`
    );
    root.appendChild(this.el);
    this.nameEl = this.el.querySelector('.dlg-name .n');
    this.titleEl = this.el.querySelector('.dlg-name .t');
    this.textEl = this.el.querySelector('.dlg-text');
    this.nextEl = this.el.querySelector('.dlg-next');
    this.optEl = this.el.querySelector('.dlg-options');
    this.active = false;
    this.el.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.dlg-options')) return;
      this.advance();
    });
    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      if (['Space', 'Enter', 'KeyF', 'NumpadEnter'].includes(e.code)) {
        e.preventDefault();
        this.advance();
      }
      const m = /^Digit([1-9])$/.exec(e.code);
      if (m && this.options) this.pick(+m[1] - 1);
    });
  }

  async run(fn) {
    this.active = true;
    this.el.classList.remove('hidden');
    try {
      await fn(this);
    } finally {
      this.active = false;
      this.el.classList.add('hidden');
      this.optEl.innerHTML = '';
      this.options = null;
    }
  }

  // show a line; resolves when the player advances past it
  say(name, text, title = '') {
    return new Promise((resolve) => {
      this.nameEl.textContent = name;
      this.titleEl.textContent = title;
      this.el.classList.toggle('narration', !name);
      this.textEl.textContent = '';
      this.nextEl.classList.remove('show');
      this.optEl.innerHTML = '';
      this.options = null;
      const chars = [...text];
      let i = 0;
      clearInterval(this.timer);
      this.typing = true;
      const finish = () => {
        clearInterval(this.timer);
        this.typing = false;
        this.textEl.textContent = text;
        this.nextEl.classList.add('show');
      };
      this.timer = setInterval(() => {
        i += 2;
        this.textEl.textContent = chars.slice(0, i).join('');
        if (i % 6 === 0) this.g.sfx.blip();
        if (i >= chars.length) finish();
      }, 28);
      this.onAdvance = () => {
        if (this.typing) finish();
        else {
          this.onAdvance = null;
          resolve();
        }
      };
    });
  }

  // choice list (keeps the last line visible); resolves to the index
  choose(options) {
    return new Promise((resolve) => {
      clearInterval(this.timer);
      this.typing = false;
      this.nextEl.classList.remove('show');
      this.options = options;
      this.optEl.innerHTML = options.map((o, i) => `<button class="dlg-opt ${o.icon || 'talk'}" data-i="${i}"><span class="ic">${ICONS[o.icon || 'talk']}</span><span>${o.text}</span></button>`).join('');
      this.optEl.querySelectorAll('.dlg-opt').forEach((b) => b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.pick(+b.dataset.i);
      }));
      this.onPick = (i) => {
        this.onPick = null;
        this.options = null;
        this.optEl.innerHTML = '';
        resolve(i);
      };
      this.onAdvance = null;
    });
  }

  pick(i) {
    if (!this.options || i < 0 || i >= this.options.length || !this.onPick) return;
    this.g.sfx.click();
    this.onPick(i);
  }

  advance() {
    if (this.onAdvance) this.onAdvance();
  }
}
