// render/renderer.js — СЛОЙ ОТОБРАЖЕНИЯ. Читает состояние симуляции, ничего в ней не меняет.
// В UE5 этот слой заменяется на Nanite-рендер; ядро при этом не трогаем.
import { TILE } from '../core/data.js';
import { WORLD_W, WORLD_H } from '../core/world.js';

const TS = 26; // размер тайла в мировых единицах (до зума)

const TILE_COLORS = {
  [TILE.DEEP]:     '#0e2a3d',
  [TILE.WATER]:    '#1a4a66',
  [TILE.SAND]:     '#c2b280',
  [TILE.GRASS]:    '#5d7a3a',
  [TILE.FOREST]:   '#2f5223',
  [TILE.HILL]:     '#7a7466',
  [TILE.MOUNTAIN]: '#9aa0a6',
};
const SEASON_TINT = {
  'Весна': [1.0, 1.05, 0.9],
  'Лето':  [1.08, 1.05, 0.85],
  'Осень': [1.1, 0.85, 0.6],
  'Зима':  [1.25, 1.25, 1.35],
};
const ERA_HUE = ['#8a8578', '#b08d57', '#9aa0a6', '#e8e0c8', '#a0522d', '#d4af37', '#5a6b7a', '#4aa3c7', '#7de3ff'];

export class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.cam = { x: WORLD_W / 2, y: WORLD_H / 2, zoom: 1.0 };
    this.mouse = { x: 0, y: 0, wx: 0, wy: 0 };
    this.placing = null;   // тип здания в режиме стройки
    this.placingValid = false;
    this.particles = [];
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }
  resize() {
    this.cv.width = this.cv.clientWidth * devicePixelRatio;
    this.cv.height = this.cv.clientHeight * devicePixelRatio;
  }
  screenToWorld(px, py) {
    const w = this.cv.width / devicePixelRatio, h = this.cv.height / devicePixelRatio;
    return {
      x: (px - w / 2) / (TS * this.cam.zoom) + this.cam.x,
      y: (py - h / 2) / (TS * this.cam.zoom) + this.cam.y,
    };
  }

  draw(sim, dtReal) {
    const ctx = this.ctx, z = this.cam.zoom;
    const w = this.cv.width / devicePixelRatio, h = this.cv.height / devicePixelRatio;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.fillStyle = '#0a1420';
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(TS * z, TS * z);
    ctx.translate(-this.cam.x, -this.cam.y);

    const tint = SEASON_TINT[sim.season()];
    // видимые тайлы
    const x0 = Math.max(0, Math.floor(this.cam.x - w / 2 / (TS * z)) - 1);
    const x1 = Math.min(WORLD_W - 1, Math.ceil(this.cam.x + w / 2 / (TS * z)) + 1);
    const y0 = Math.max(0, Math.floor(this.cam.y - h / 2 / (TS * z)) - 1);
    const y1 = Math.min(WORLD_H - 1, Math.ceil(this.cam.y + h / 2 / (TS * z)) + 1);

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const t = sim.tiles[y * WORLD_W + x];
        ctx.fillStyle = this.tinted(TILE_COLORS[t], tint, t);
        ctx.fillRect(x, y, 1.02, 1.02);
        if (t === TILE.FOREST) {
          ctx.fillStyle = 'rgba(20,40,15,.8)';
          ctx.beginPath(); ctx.arc(x + 0.3, y + 0.35, 0.16, 0, 7); ctx.fill();
          ctx.beginPath(); ctx.arc(x + 0.65, y + 0.6, 0.2, 0, 7); ctx.fill();
        } else if (t === TILE.MOUNTAIN) {
          ctx.fillStyle = 'rgba(255,255,255,.55)';
          ctx.beginPath(); ctx.moveTo(x + 0.5, y + 0.15); ctx.lineTo(x + 0.8, y + 0.6); ctx.lineTo(x + 0.2, y + 0.6); ctx.fill();
        } else if (t === TILE.HILL) {
          ctx.fillStyle = 'rgba(0,0,0,.18)';
          ctx.beginPath(); ctx.arc(x + 0.5, y + 0.55, 0.3, Math.PI, 0); ctx.fill();
        }
      }
    }

    // животные
    for (const a of sim.animals) {
      ctx.fillStyle = a.kind === 'mammoth' ? '#6b4a2f' : '#a98a5b';
      ctx.beginPath();
      ctx.arc(a.x, a.y, a.kind === 'mammoth' ? 0.42 : 0.24, 0, 7);
      ctx.fill();
    }

    // здания
    for (const b of sim.buildings) this.drawBuilding(ctx, sim, b);

    // жители
    for (const v of sim.villagers) {
      ctx.fillStyle = v.hp < 40 ? '#c05746' : '#e8dcc0';
      ctx.beginPath(); ctx.arc(v.x, v.y, 0.18, 0, 7); ctx.fill();
      if (v.job === 'build') { ctx.fillStyle = '#c9a227'; ctx.fillRect(v.x - 0.06, v.y - 0.34, 0.12, 0.12); }
    }

    // призрак стройки
    if (this.placing) {
      const gx = Math.floor(this.mouse.wx), gy = Math.floor(this.mouse.wy);
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = this.placingValid ? '#7fb069' : '#c05746';
      ctx.fillRect(gx, gy, 1, 1);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#fff'; ctx.strokeRect(gx, gy, 1, 1);
    }

    ctx.restore();

    // погода (частицы, в экранных координатах)
    this.drawWeather(ctx, sim, w, h, dtReal);

    // лёгкая ночная виньетка по времени суток
    const dayFrac = sim.day % 1;
    const night = Math.max(0, Math.cos(dayFrac * Math.PI * 2) * 0.22);
    if (night > 0.02) {
      ctx.fillStyle = `rgba(6,10,30,${night})`;
      ctx.fillRect(0, 0, w, h);
    }
  }

  drawBuilding(ctx, sim, b) {
    const eraColor = ERA_HUE[sim.eraIndex];
    const x = b.gx, y = b.gy;
    if (!b.done) {
      ctx.fillStyle = 'rgba(200,180,120,.5)';
      ctx.fillRect(x + 0.15, y + 0.15, 0.7, 0.7);
      ctx.strokeStyle = '#c9a227';
      ctx.strokeRect(x + 0.15, y + 0.15, 0.7, 0.7);
      ctx.fillStyle = '#c9a227';
      ctx.fillRect(x + 0.15, y - 0.06, 0.7 * b.progress, 0.05);
      return;
    }
    const walls = sim.eraIndex >= 6 ? '#6a7684' : sim.eraIndex >= 3 ? '#cbbfa5' : '#a08050';
    ctx.fillStyle = walls;
    switch (b.type) {
      case 'campfire':
        ctx.fillStyle = '#5c4326'; ctx.beginPath(); ctx.arc(x + 0.5, y + 0.55, 0.3, 0, 7); ctx.fill();
        ctx.fillStyle = '#ff9d2e';
        ctx.beginPath(); ctx.arc(x + 0.5, y + 0.5, 0.14 + Math.random() * 0.04, 0, 7); ctx.fill();
        return;
      case 'hut':
        ctx.fillRect(x + 0.2, y + 0.35, 0.6, 0.45);
        ctx.fillStyle = '#6e4f2a';
        ctx.beginPath(); ctx.moveTo(x + 0.15, y + 0.38); ctx.lineTo(x + 0.5, y + 0.12); ctx.lineTo(x + 0.85, y + 0.38); ctx.fill();
        return;
      case 'farm':
        ctx.fillStyle = '#8a6d3b'; ctx.fillRect(x + 0.08, y + 0.08, 0.84, 0.84);
        ctx.strokeStyle = '#c9b458';
        for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(x + 0.08, y + i * 0.21 + 0.08); ctx.lineTo(x + 0.92, y + i * 0.21 + 0.08); ctx.stroke(); }
        return;
      default:
        ctx.fillRect(x + 0.18, y + 0.3, 0.64, 0.55);
        ctx.fillStyle = eraColor;
        ctx.beginPath(); ctx.moveTo(x + 0.12, y + 0.32); ctx.lineTo(x + 0.5, y + 0.08); ctx.lineTo(x + 0.88, y + 0.32); ctx.fill();
        if (b.type === 'library' || b.type === 'lab') {
          ctx.fillStyle = '#3a6ea8'; ctx.fillRect(x + 0.42, y + 0.45, 0.16, 0.4);
        }
        if (b.type === 'workshop' || b.type === 'mine') {
          ctx.fillStyle = '#444'; ctx.fillRect(x + 0.62, y + 0.02, 0.1, 0.32);
        }
    }
  }

  drawWeather(ctx, sim, w, h, dt) {
    const kind = sim.weather;
    if (kind === 'clear') { this.particles.length = 0; return; }
    const want = kind === 'snow' ? 90 : kind === 'rain' ? 130 : kind === 'storm' ? 170 : 40;
    while (this.particles.length < want)
      this.particles.push({ x: Math.random() * w, y: Math.random() * h, s: 0.5 + Math.random() });
    if (this.particles.length > want) this.particles.length = want;
    ctx.strokeStyle = kind === 'snow' ? 'rgba(255,255,255,.8)' : 'rgba(160,190,220,.6)';
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    for (const p of this.particles) {
      if (kind === 'snow') {
        p.y += p.s * 40 * dt; p.x += Math.sin(p.y * 0.02) * 0.4;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.s * 1.4, 0, 7); ctx.fill();
      } else if (kind === 'drought') {
        p.x += p.s * 25 * dt; p.y += p.s * 6 * dt;
        ctx.fillStyle = 'rgba(210,190,140,.25)';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.s * 2, 0, 7); ctx.fill();
      } else {
        p.y += p.s * 320 * dt;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - 2, p.y + 9); ctx.stroke();
      }
      if (p.y > h + 10) { p.y = -10; p.x = Math.random() * w; }
      if (p.x > w + 10) p.x = -10;
    }
  }

  tinted(hex, tint, tile) {
    if (tile === TILE.DEEP || tile === TILE.WATER) return hex;
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, ((n >> 16) & 255) * tint[0]);
    const g = Math.min(255, ((n >> 8) & 255) * tint[1]);
    const b = Math.min(255, (n & 255) * tint[2]);
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  }
}
