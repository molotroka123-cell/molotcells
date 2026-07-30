// core/world.js — процедурная генерация мира (engine-agnostic, детерминированная по seed)
import { createRng, makeNoise2D } from './rng.js';
import { TILE } from './data.js';

export const WORLD_W = 96;
export const WORLD_H = 96;

export function generateWorld(seed) {
  const rng = createRng(seed);
  const elevN = makeNoise2D(createRng(seed ^ 0x9E3779B9));
  const moistN = makeNoise2D(createRng(seed ^ 0x85EBCA6B));
  const tiles = new Uint8Array(WORLD_W * WORLD_H);
  const cx = WORLD_W / 2, cy = WORLD_H / 2;
  const maxD = Math.hypot(cx, cy);

  for (let y = 0; y < WORLD_H; y++) {
    for (let x = 0; x < WORLD_W; x++) {
      // островной градиент: центр выше, края — океан
      const d = Math.hypot(x - cx, y - cy) / maxD;
      let e = elevN(x * 0.045, y * 0.045, 5) * 0.75 + elevN(x * 0.15, y * 0.15, 3) * 0.25;
      e = e + (0.55 - d * 1.15);
      const m = moistN(x * 0.06 + 100, y * 0.06 + 100, 4);
      let t;
      if (e < -0.28) t = TILE.DEEP;
      else if (e < -0.16) t = TILE.WATER;
      else if (e < -0.10) t = TILE.SAND;
      else if (e > 0.42) t = TILE.MOUNTAIN;
      else if (e > 0.26) t = TILE.HILL;
      else if (m > 0.08) t = TILE.FOREST;
      else t = TILE.GRASS;
      tiles[y * WORLD_W + x] = t;
    }
  }

  // Гарантируем пригодный стартовый участок в центре: поляна с лесом и холмом рядом
  const sx = cx, sy = cy;
  for (let y = sy - 4; y <= sy + 4; y++)
    for (let x = sx - 4; x <= sx + 4; x++)
      if (inBounds(x, y) && tiles[y * WORLD_W + x] !== TILE.HILL)
        tiles[y * WORLD_W + x] = TILE.GRASS;
  // гарантированный лес и холм рядом со стартом
  for (let y = sy - 10; y <= sy - 6; y++)
    for (let x = sx - 3; x <= sx + 3; x++)
      if (inBounds(x, y)) tiles[y * WORLD_W + x] = TILE.FOREST;
  for (let y = sy + 6; y <= sy + 8; y++)
    for (let x = sx + 4; x <= sx + 8; x++)
      if (inBounds(x, y)) tiles[y * WORLD_W + x] = TILE.HILL;

  // Животные: олени на траве/лесу, пара мамонтов
  const animals = [];
  let tries = 0;
  while (animals.length < 26 && tries++ < 3000) {
    const x = rng.int(4, WORLD_W - 5), y = rng.int(4, WORLD_H - 5);
    const t = tiles[y * WORLD_W + x];
    if (t === TILE.GRASS || t === TILE.FOREST)
      animals.push(makeAnimal(rng, 'deer', x + 0.5, y + 0.5));
  }
  for (let i = 0; i < 2; i++) {
    const a = makeAnimal(rng, 'mammoth', sx + rng.range(-15, 15), sy + rng.range(-15, 15));
    if (!isWater(tiles, Math.floor(a.x), Math.floor(a.y))) animals.push(a);
  }

  return { seed, tiles, animals, rngState: rng.getState() };
}

let animalSeq = 1;
export function makeAnimal(rng, kind, x, y) {
  return {
    id: animalSeq++, kind,
    x, y,
    tx: x, ty: y,
    food: kind === 'mammoth' ? 120 : 25,
    hp: kind === 'mammoth' ? 3 : 1,
    speed: kind === 'mammoth' ? 1.2 : 2.2,
    retarget: rng.range(0, 4),
  };
}

export function inBounds(x, y) { return x >= 0 && y >= 0 && x < WORLD_W && y < WORLD_H; }
export function tileAt(tiles, x, y) { return inBounds(x, y) ? tiles[y * WORLD_W + x] : TILE.DEEP; }
export function isWater(tiles, x, y) { const t = tileAt(tiles, x, y); return t === TILE.DEEP || t === TILE.WATER; }

// Поиск ближайшего тайла нужного типа (кольцевой обход — O(r²), но вызывается редко)
export function findNearestTile(tiles, fromX, fromY, predicate, maxR = 40) {
  const fx = Math.floor(fromX), fy = Math.floor(fromY);
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = fx + dx, y = fy + dy;
        if (inBounds(x, y) && predicate(tiles[y * WORLD_W + x], x, y))
          return { x, y };
      }
    }
  }
  return null;
}

// Простое движение с обходом воды: шаг к цели, при препятствии — боковой сдвиг
export function stepToward(tiles, ent, tx, ty, dist) {
  let dx = tx - ent.x, dy = ty - ent.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return true;
  // анти-overshoot: если шаг больше оставшейся дистанции — встаём на цель
  if (dist >= len) {
    if (!isWater(tiles, Math.floor(tx), Math.floor(ty))) { ent.x = tx; ent.y = ty; return true; }
    dist = len * 0.5;
  }
  dx /= len; dy /= len;
  const tryMove = (vx, vy) => {
    const nx = ent.x + vx * dist, ny = ent.y + vy * dist;
    if (!isWater(tiles, Math.floor(nx), Math.floor(ny))) { ent.x = nx; ent.y = ny; return true; }
    return false;
  };
  if (tryMove(dx, dy)) return false;
  // обход: пробуем перпендикулярно и по диагоналям
  for (const [vx, vy] of [[-dy, dx], [dy, -dx], [-dy + dx, dx + dy], [dy + dx, -dx + dy]])
    if (tryMove(vx * 0.7, vy * 0.7)) return false;
  return false;
}
