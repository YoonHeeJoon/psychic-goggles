import './styles.css';
import { Game } from './game/Game.js';

const game = new Game(document.getElementById('app'));
game.init().catch((err) => {
  console.error(err);
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;color:#fff;font:14px sans-serif;background:#0b1222;z-index:99;padding:20px;text-align:center';
  box.textContent = '게임을 시작하지 못했습니다: ' + (err && err.message ? err.message : err) + ' (WebGL2를 지원하는 브라우저가 필요합니다)';
  document.body.appendChild(box);
});
