// main.js — точка входа браузерного клиента: склейка слоёв.
// core (симуляция) ← независим; render/ui зависят от core, core не зависит от них.
import { Simulation, DAY_SECONDS } from './core/simulation.js';
import { Renderer } from './render/renderer.js';
import { Hud } from './ui/hud.js';
import { BrowserSave } from './save/saveSystem.js';

const canvas = document.getElementById('cv');
const renderer = new Renderer(canvas);

let sim = null;
const hud = new Hud(renderer, () => startNew());

function startNew(seed) {
  sim = new Simulation(seed);
  hud.attach(sim);
}

// автозапуск, если есть автосейв — иначе ждём выбора в оверлее
(async () => {
  const bs = new BrowserSave();
  if (await bs.has('auto')) hud.loadFrom('auto').then(ok => { if (ok) sim = hud.sim; });
  if (!sim) {
    // фоновый мир за оверлеем для красоты
    sim = new Simulation(20260730);
    hud.attach(sim);
  }
})();

// ---- ввод: камера, стройка ----
let dragging = false, dragMoved = false, lastX = 0, lastY = 0;
const keys = {};

canvas.addEventListener('mousedown', (e) => {
  if (e.button === 1 || (e.button === 0 && !renderer.placing)) {
    dragging = true; dragMoved = false; lastX = e.clientX; lastY = e.clientY;
  }
});
window.addEventListener('mousemove', (e) => {
  const r = canvas.getBoundingClientRect();
  const px = e.clientX - r.left, py = e.clientY - r.top;
  const w = renderer.screenToWorld(px, py);
  renderer.mouse = { x: px, y: py, wx: w.x, wy: w.y };
  if (dragging) {
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    if (Math.abs(dx) + Math.abs(dy) > 3) dragMoved = true;
    renderer.cam.x -= dx / (26 * renderer.cam.zoom);
    renderer.cam.y -= dy / (26 * renderer.cam.zoom);
    lastX = e.clientX; lastY = e.clientY;
  }
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 1 || (e.button === 0 && dragging)) dragging = false;
});
canvas.addEventListener('click', (e) => {
  if (dragMoved || !sim) return;
  if (renderer.placing) {
    const gx = Math.floor(renderer.mouse.wx), gy = Math.floor(renderer.mouse.wy);
    const r = sim.placeBuilding(renderer.placing, gx, gy);
    if (!r.ok) hud.print(r.why, 'err');
    else { hud.print(`${renderer.placing} заложено`, 'ok'); }
    renderer.placing = null;
    hud.refreshSide();
    e.preventDefault();
  }
});
canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); renderer.placing = null; hud.refreshSide(); });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const before = renderer.screenToWorld(renderer.mouse.x, renderer.mouse.y);
  renderer.cam.zoom = Math.min(3, Math.max(0.4, renderer.cam.zoom * (e.deltaY < 0 ? 1.15 : 0.87)));
  const after = renderer.screenToWorld(renderer.mouse.x, renderer.mouse.y);
  renderer.cam.x += before.x - after.x;
  renderer.cam.y += before.y - after.y;
}, { passive: false });
window.addEventListener('keydown', (e) => { keys[e.code] = true; });
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

// ---- главный цикл ----
let last = performance.now();
function frame(now) {
  const dtReal = Math.min(0.1, (now - last) / 1000);
  last = now;

  // камера со стрелок/WASD
  const pan = 14 * dtReal / renderer.cam.zoom;
  if (keys['ArrowLeft'] || keys['KeyA']) renderer.cam.x -= pan;
  if (keys['ArrowRight'] || keys['KeyD']) renderer.cam.x += pan;
  if (keys['ArrowUp'] || keys['KeyW']) renderer.cam.y -= pan;
  if (keys['ArrowDown'] || keys['KeyS']) renderer.cam.y += pan;

  if (sim && !hud.paused) {
    const overlayHidden = document.getElementById('overlay').classList.contains('hidden');
    if (overlayHidden) sim.tick((dtReal / DAY_SECONDS) * hud.speed);
  }
  if (sim) {
    renderer.draw(sim, dtReal);
    hud.refresh();
    hud.flushConsole();
    hud.tooltip(sim, renderer.mouse.wx, renderer.mouse.wy, renderer.mouse.x, renderer.mouse.y);
    canvas.classList.toggle('placing', !!renderer.placing);
    // валидация призрака стройки
    if (renderer.placing) {
      const gx = Math.floor(renderer.mouse.wx), gy = Math.floor(renderer.mouse.wy);
      renderer.placingValid = sim.canPlace(renderer.placing, gx, gy).ok;
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
