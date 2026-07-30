// core/simulation.js — ЯДРО СИМУЛЯЦИИ. Не импортирует ничего из DOM/Canvas.
// Этот модуль переносится в Unreal Engine 5 без переписывания логики —
// меняется только язык, не архитектура.
import { createRng } from './rng.js';
import {
  TILE, WALKABLE, ERAS, TECHS, BUILDINGS, NAMES, SEASONS, DAYS_PER_SEASON,
  WEATHER_TABLE, WEATHER, EVENT_DEFS, OBJECTIVES,
} from './data.js';
import { generateWorld, tileAt, isWater, findNearestTile, stepToward, makeAnimal, WORLD_W, WORLD_H } from './world.js';

const DAY_SECONDS = 6;          // реальных секунд на игровой день при скорости 1x
const EAT_PER_DAY = 0.7;        // еды на жителя в день
const MOVE_SPEED = 7;           // тайлов в день

let villagerSeq = 1;

export class Simulation {
  constructor(seed = (Math.random() * 1e9) | 0) {
    const world = generateWorld(seed);
    this.rng = createRng(seed ^ 0xC2B2AE35);
    this.seed = seed;
    this.tiles = world.tiles;
    this.animals = world.animals;

    this.day = 1;
    this.seasonIndex = 0;
    this.weather = 'clear';
    this.weatherDays = 3;

    this.res = { food: 60, wood: 30, stone: 10, knowledge: 0 };
    this.foodCapBase = 200;
    this.tech = new Set(['fire']);
    this.eraIndex = 0;

    this.villagers = [];
    this.buildings = [];
    this.log = [];              // последние события (для UI)
    this.consoleLog = [];       // вывод консоли
    this.objectiveState = {};
    this.stats = { foodPerDay: 0, eaten: 0 };
    this.victory = false;
    this.godmode = false;
    this.fastResearch = false;
    this.plagueDays = 0;
    this._acc = 0;
    this._dirtyObjectives = true;

    // стартовое племя у костра
    const cx = WORLD_W / 2, cy = WORLD_H / 2;
    this.placeFree('campfire', cx, cy);
    for (let i = 0; i < 6; i++) this.spawnVillager(cx + this.rng.range(-3, 3), cy + this.rng.range(2, 5));
    this.emit(`Племя осело у костра. День 1 — начало истории.`);
  }

  // ---------- утилиты ----------
  emit(msg) { this.log.unshift({ day: Math.floor(this.day), msg }); if (this.log.length > 80) this.log.pop(); }
  cprint(msg, cls = '') { this.consoleLog.push({ msg, cls }); if (this.consoleLog.length > 60) this.consoleLog.shift(); }
  season() { return SEASONS[this.seasonIndex]; }
  hasTech(id) { return this.tech.has(id); }
  countBuilding(type) { return this.buildings.filter(b => b.type === type && b.done).length; }

  housingCap() {
    let cap = 0;
    for (const b of this.buildings) if (b.done) cap += BUILDINGS[b.type].housing || 0;
    return cap;
  }
  foodCap() {
    let cap = this.foodCapBase;
    for (const b of this.buildings) if (b.done && b.type === 'granary') cap += 300;
    return cap;
  }
  happiness() {
    let h = 0.55;
    if (this.res.food > this.villagers.length * 3) h += 0.15;
    if (this.res.food <= 0) h -= 0.35;
    if (this.hasTech('pottery')) h += 0.10;
    if (this.plagueDays > 0) h -= 0.2;
    h += Math.min(0.1, this.countBuilding('library') * 0.03);
    return Math.max(0, Math.min(1, h));
  }
  gatherMult() {
    let m = 1;
    if (this.hasTech('tools')) m *= 1.3;
    if (this.hasTech('iron')) m *= 1.25;
    if (this.godmode) m *= 3;
    return m;
  }
  knowledgeMult() {
    let m = 1;
    if (this.hasTech('writing')) m *= 1.5;
    if (this.hasTech('philosophy')) m *= 1.3;
    if (this.fastResearch) m *= 10;
    return m;
  }
  buildMult() { return this.hasTech('engineering') ? 2 : 1; }

  // ---------- строительство ----------
  canPlace(type, gx, gy) {
    const def = BUILDINGS[type];
    if (!def) return { ok: false, why: 'Неизвестное здание' };
    if (def.req && !this.hasTech(def.req)) return { ok: false, why: `Нужна технология: ${def.req}` };
    if (!WALKABLE.has(tileAt(this.tiles, gx, gy))) return { ok: false, why: 'Здесь нельзя строить' };
    if (def.needTile !== undefined && tileAt(this.tiles, gx, gy) !== def.needTile)
      return { ok: false, why: def.needTile === TILE.FOREST ? 'Нужен лесной тайл' : def.needTile === TILE.HILL ? 'Нужен холм' : 'Нужна трава' };
    if (this.buildings.some(b => b.gx === gx && b.gy === gy)) return { ok: false, why: 'Тайл занят' };
    for (const [r, n] of Object.entries(def.cost))
      if (!this.godmode && this.res[r] < n) return { ok: false, why: 'Не хватает ресурсов' };
    return { ok: true };
  }
  placeBuilding(type, gx, gy) {
    const chk = this.canPlace(type, gx, gy);
    if (!chk.ok) return chk;
    if (!this.godmode) for (const [r, n] of Object.entries(BUILDINGS[type].cost)) this.res[r] -= n;
    this.buildings.push({ type, gx, gy, progress: 0, done: false, workers: [] });
    this.emit(`Заложено: ${BUILDINGS[type].name}`);
    this._dirtyObjectives = true;
    return { ok: true };
  }
  placeFree(type, gx, gy) {
    this.buildings.push({ type, gx, gy, progress: 1, done: true, workers: [] });
  }

  // ---------- население ----------
  spawnVillager(x, y) {
    const v = {
      id: villagerSeq++, name: this.rng.pick(NAMES) + ' ' + this.rng.pick(NAMES).toLowerCase(),
      x, y, tx: x, ty: y,
      hp: 100, age: this.rng.int(16, 35),
      job: 'idle',           // idle | build | work | forage | hunt
      workplace: null,       // ref на здание
      targetAnimal: null,
      busy: 0,
    };
    this.villagers.push(v);
    return v;
  }

  // ---------- исследования ----------
  availableTechs() {
    return TECHS.filter(t => !this.tech.has(t.id) && t.prereq.every(p => this.tech.has(p)));
  }
  research(id) {
    const t = TECHS.find(t => t.id === id);
    if (!t) return { ok: false, why: 'Нет такой технологии' };
    if (this.tech.has(id)) return { ok: false, why: 'Уже открыто' };
    if (!t.prereq.every(p => this.tech.has(p))) return { ok: false, why: 'Нет пререквизитов' };
    if (!this.godmode && !this.fastResearch && this.res.knowledge < t.cost)
      return { ok: false, why: `Нужно ${t.cost} знаний` };
    if (!this.godmode && !this.fastResearch) this.res.knowledge -= t.cost;
    this.tech.add(id);
    this.emit(`ОТКРЫТИЕ: ${t.name}! ${t.effect}`);
    if (t.era) {
      this.eraIndex = ERAS.findIndex(e => e.id === t.era);
      this.emit(`★ Новая эпоха: ${ERAS[this.eraIndex].ru}`);
      this.newEra = t.era; // флаг для UI-баннера
    }
    this._dirtyObjectives = true;
    return { ok: true };
  }

  // ---------- главный цикл ----------
  // dt — игровые дни (realSeconds / DAY_SECONDS * speed)
  tick(dt) {
    if (this.victory) return;
    const prevDay = Math.floor(this.day);
    this.day += dt;

    this.tickVillagers(dt);
    this.tickAnimals(dt);
    this.tickConstruction(dt);

    if (Math.floor(this.day) > prevDay) this.onNewDay();
    if (this._dirtyObjectives) this.checkObjectives();
  }

  tickVillagers(dt) {
    // 1) стройка имеет приоритет
    const sites = this.buildings.filter(b => !b.done);
    for (const v of this.villagers) {
      if (v.job === 'build' && (!v.workplace || v.workplace.done)) { v.job = 'idle'; v.workplace = null; }
      if (v.job === 'hunt' && (!v.targetAnimal || !this.animals.includes(v.targetAnimal))) { v.job = 'idle'; v.targetAnimal = null; }
    }
    for (const v of this.villagers) {
      if (v.job !== 'idle') continue;
      const site = sites.find(s => s.workers.length < 3);
      if (site) {
        v.job = 'build'; v.workplace = site; site.workers.push(v.id);
        v.tx = site.gx + 0.5; v.ty = site.gy + 0.5;
        continue;
      }
      // 2) работа на здании со свободным слотом
      const job = this.findWorkplace(v);
      if (job) { v.job = 'work'; v.workplace = job; job.workers.push(v.id); v.tx = job.gx + 0.5; v.ty = job.gy + 0.5; continue; }
      // 3) охота (если открыта и есть дичь)
      if (this.hasTech('hunting') && this.animals.length > 0 && this.res.food < this.foodCap() * 0.8) {
        const a = this.nearestAnimal(v);
        if (a) { v.job = 'hunt'; v.targetAnimal = a; continue; }
      }
      // 4) собирательство по умолчанию
      v.job = 'forage';
      const spot = findNearestTile(this.tiles, v.x, v.y,
        t => t === TILE.FOREST || t === TILE.GRASS, 12);
      if (spot) { v.tx = spot.x + 0.5; v.ty = spot.y + 0.5; }
    }

    const wMult = WEATHER[this.weather];
    for (const v of this.villagers) {
      // движение
      if (v.job === 'hunt' && v.targetAnimal) { v.tx = v.targetAnimal.x; v.ty = v.targetAnimal.y; }
      stepToward(this.tiles, v, v.tx, v.ty, MOVE_SPEED * dt);
      const near = Math.hypot(v.tx - v.x, v.ty - v.y) < 0.7;
      if (!near) {
        // анти-застревание: если долго не дошёл — сброс задачи, переназначение на следующий тик
        v.busy = (v.busy || 0) + dt;
        if (v.busy > 3) { v.busy = 0; v.job = 'idle'; v.workplace = null; v.targetAnimal = null; }
        continue;
      }
      v.busy = 0;

      // работа на месте
      switch (v.job) {
        case 'forage': {
          const t = tileAt(this.tiles, Math.floor(v.x), Math.floor(v.y));
          const base = t === TILE.FOREST ? 1.8 : 1.2;
          this.addRes('food', base * wMult.forage * this.gatherMult() * dt);
          break;
        }
        case 'work': {
          const b = v.workplace;
          if (!b || !b.done) { v.job = 'idle'; break; }
          const out = BUILDINGS[b.type].out || {};
          for (const [r, n] of Object.entries(out)) {
            let mult = this.gatherMult();
            if (r === 'food') mult *= (b.type === 'farm' ? wMult.farm * (this.hasTech('feudalism') ? 1.2 : 1) : wMult.forage);
            if (r === 'wood') mult *= wMult.wood;
            if (r === 'stone') mult *= wMult.stone;
            if (r === 'knowledge') mult *= this.knowledgeMult() * (b.type === 'library' && this.hasTech('printing') ? 2 : 1);
            if (b.type === 'farm' && this.season() === 'Зима') mult = 0;
            this.addRes(r, n * mult * dt);
          }
          break;
        }
        case 'hunt': {
          const a = v.targetAnimal;
          if (!a) { v.job = 'idle'; break; }
          a.hp -= dt * 1.5;
          if (a.hp <= 0) {
            this.animals.splice(this.animals.indexOf(a), 1);
            this.addRes('food', a.food);
            this.emit(`${v.name} добывает ${a.kind === 'mammoth' ? 'мамонта' : 'оленя'} (+${a.food} еды)`);
            v.job = 'idle'; v.targetAnimal = null;
          }
          break;
        }
      }
    }
  }

  findWorkplace(v) {
    let best = null, bestD = 1e9;
    for (const b of this.buildings) {
      const def = BUILDINGS[b.type];
      if (!b.done || !def.workers || !def.out) continue;
      if (b.workers.length >= def.workers) continue;
      const d = Math.hypot(b.gx + 0.5 - v.x, b.gy + 0.5 - v.y);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  }

  nearestAnimal(v) {
    let best = null, bestD = 35;
    for (const a of this.animals) {
      const d = Math.hypot(a.x - v.x, a.y - v.y);
      if (d < bestD) { bestD = d; best = a; }
    }
    return best;
  }

  tickConstruction(dt) {
    for (const b of this.buildings) {
      if (b.done) continue;
      // прогресс вносят строители, стоящие на месте
      const builders = this.villagers.filter(v => v.job === 'build' && v.workplace === b &&
        Math.hypot(b.gx + 0.5 - v.x, b.gy + 0.5 - v.y) < 0.8).length;
      b.progress += builders * 0.25 * this.buildMult() * dt;
      if (b.progress >= 1) {
        b.progress = 1; b.done = true;
        b.workers = [];
        this.emit(`Построено: ${BUILDINGS[b.type].name}`);
        this._dirtyObjectives = true;
      }
    }
  }

  tickAnimals(dt) {
    for (const a of this.animals) {
      a.retarget -= dt;
      if (a.retarget <= 0) {
        a.retarget = this.rng.range(2, 6);
        const spot = findNearestTile(this.tiles, a.x, a.y,
          t => t === TILE.GRASS || t === TILE.FOREST, 8);
        if (spot) { a.tx = spot.x + 0.5; a.ty = spot.y + 0.5; }
      }
      stepToward(this.tiles, a, a.tx, a.ty, a.speed * dt);
    }
    // медленное восстановление популяции дичи
    if (this.animals.length < 20 && this.rng.chance(dt * 0.02)) {
      const spot = findNearestTile(this.tiles, WORLD_W / 2, WORLD_H / 2,
        t => t === TILE.GRASS || t === TILE.FOREST, 60);
      if (spot) this.animals.push(makeAnimal(this.rng, 'deer', spot.x + 0.5, spot.y + 0.5));
    }
  }

  onNewDay() {
    // погода
    if (--this.weatherDays <= 0) {
      const table = WEATHER_TABLE[this.season()];
      let roll = this.rng.next(), acc = 0;
      for (const [w, p] of table) { acc += p; if (roll <= acc) { this.weather = w; break; } }
      this.weatherDays = this.rng.int(2, 5);
    }
    // смена сезона
    if (Math.floor(this.day) % DAYS_PER_SEASON === 0) {
      this.seasonIndex = (this.seasonIndex + 1) % 4;
      this.emit(`Наступает ${this.season().toLowerCase()}.`);
      if (this.season() === 'Зима') this.emit('Зима: фермы замерзают, запасайте еду.');
    }

    // еда
    const eat = this.villagers.length * EAT_PER_DAY * (this.weather === 'snow' ? 1.25 : 1);
    this.res.food = Math.max(0, this.res.food - eat);
    this.stats.eaten = eat;
    const starving = this.res.food <= 0;

    // пассивные знания: люди наблюдают мир
    this.addRes('knowledge', this.villagers.length * 0.05 * this.knowledgeMult());

    // здоровье, голод, старение
    for (const v of [...this.villagers]) {
      if (starving && !this.godmode) v.hp -= 12; else v.hp = Math.min(100, v.hp + 3);
      if (this.plagueDays > 0) v.hp -= 6;
      v.age += 1 / (DAYS_PER_SEASON * 4);
      if (v.age > 62 && this.rng.chance((v.age - 62) * 0.004)) v.hp = 0;
      if (v.hp <= 0) {
        this.removeVillager(v);
        this.emit(`${v.name} умер${starving ? ' от голода' : ''}. Население: ${this.villagers.length}.`);
      }
    }
    if (this.plagueDays > 0 && --this.plagueDays === 0) this.emit('Эпидемия отступила.');

    // рождения
    const cap = this.housingCap();
    if (this.villagers.length < cap && !starving && this.happiness() > 0.5 &&
        this.res.food > this.villagers.length * 2 && this.rng.chance(0.10)) {
      const c = this.buildings.find(b => b.type === 'campfire');
      const v = this.spawnVillager(c.gx + this.rng.range(-2, 2), c.gy + this.rng.range(1, 3));
      v.age = 16;
      this.emit(`Родился ребёнок — ${v.name}. Население: ${this.villagers.length}.`);
    }

    // случайные события
    if (this.rng.chance(0.03)) this.rollEvent();

    // автосейв-пинг (UI подписывается)
    if (Math.floor(this.day) % 30 === 0) this.autosaveRequested = true;
  }

  removeVillager(v) {
    const i = this.villagers.indexOf(v);
    if (i >= 0) this.villagers.splice(i, 1);
    for (const b of this.buildings) {
      const wi = b.workers.indexOf(v.id);
      if (wi >= 0) b.workers.splice(wi, 1);
    }
  }

  rollEvent() {
    const total = EVENT_DEFS.reduce((s, e) => s + e.w, 0);
    let roll = this.rng.next() * total, def = EVENT_DEFS[0];
    for (const e of EVENT_DEFS) { roll -= e.w; if (roll <= 0) { def = e; break; } }
    const c = this.buildings.find(b => b.type === 'campfire');
    switch (def.id) {
      case 'wanderer':
        if (this.villagers.length < this.housingCap()) {
          const v = this.spawnVillager(c.gx + 1, c.gy + 1);
          this.emit(`Странник ${v.name} присоединился к племени.`);
        } else this.emit('Странник прошёл мимо — жить негде.');
        break;
      case 'wanderers':
        for (let i = 0; i < 3 && this.villagers.length < this.housingCap(); i++)
          this.spawnVillager(c.gx + this.rng.range(-2, 2), c.gy + this.rng.range(1, 3));
        this.emit('Семья беженцев присоединилась к вам.');
        break;
      case 'bountiful': this.addRes('food', 40); this.emit('Щедрый урожай! +40 еды.'); break;
      case 'pack':
        for (let i = 0; i < 4; i++)
          this.animals.push(makeAnimal(this.rng, 'deer', c.gx + this.rng.range(-6, 6), c.gy + this.rng.range(-6, 6)));
        this.emit('Стадо оленей подошло к поселению.');
        break;
      case 'cold': this.weather = 'snow'; this.weatherDays = 3; this.emit('Лютые холода накрыли землю.'); break;
      case 'sickness': this.plagueDays = 4; this.emit('Болезнь по поселению! Держитесь.'); break;
      case 'insight': this.addRes('knowledge', 15); this.emit('Житель сделал наблюдение. +15 знаний.'); break;
    }
  }

  addRes(r, n) {
    if (r === 'food') this.res.food = Math.min(this.foodCap(), this.res.food + n);
    else this.res[r] += n;
  }

  checkObjectives() {
    this._dirtyObjectives = false;
    for (const o of OBJECTIVES) {
      if (!this.objectiveState[o.id] && o.check(this)) {
        this.objectiveState[o.id] = true;
        this.emit(`✓ Цель: ${o.text}`);
        if (o.id === 'utopia') { this.victory = true; this.emit('★ ЦИВИЛИЗАЦИЯ ВОШЛА В БУДУЩЕЕ. ПОБЕДА!'); }
      }
    }
  }

  // ---------- консоль разработчика ----------
  execCommand(raw) {
    const parts = raw.trim().replace(/^\//, '').split(/\s+/);
    const cmd = (parts[0] || '').toLowerCase();
    const args = parts.slice(1);
    const c = this.buildings.find(b => b.type === 'campfire');
    switch (cmd) {
      case 'help':
        this.cprint('give <food|wood|stone|knowledge> <n> · spawn <deer|mammoth|villager> <n> · weather <clear|rain|snow|storm|drought> · age <era> · research <id|all> · simulate <n> days|years · godmode · fastresearch · plague · meteor · kill · pop', 'ok');
        break;
      case 'give': {
        const [r, n] = args;
        if (!(r in this.res)) return this.cprint('Ресурсы: food wood stone knowledge', 'err');
        this.addRes(r, parseFloat(n) || 100);
        this.cprint(`+${n || 100} ${r}`, 'ok');
        break;
      }
      case 'spawn': {
        const [what, nRaw] = args; const n = parseInt(nRaw) || 1;
        if (what === 'villager' || what === 'tribe')
          for (let i = 0; i < n; i++) this.spawnVillager(c.gx + this.rng.range(-3, 3), c.gy + this.rng.range(1, 4));
        else if (what === 'deer' || what === 'mammoth')
          for (let i = 0; i < n; i++) this.animals.push(makeAnimal(this.rng, what, c.gx + this.rng.range(-8, 8), c.gy + this.rng.range(-8, 8)));
        else return this.cprint('spawn deer|mammoth|villager <n>', 'err');
        this.cprint(`Заспавнено: ${what} ×${n}`, 'ok');
        break;
      }
      case 'weather':
        if (!WEATHER[args[0]]) return this.cprint('clear rain snow storm drought', 'err');
        this.weather = args[0]; this.weatherDays = 5;
        this.cprint(`Погода: ${WEATHER[args[0]].ru}`, 'ok');
        break;
      case 'age': {
        const i = ERAS.findIndex(e => e.id === (args[0] || '').toLowerCase());
        if (i < 0) return this.cprint('Эпохи: ' + ERAS.map(e => e.id).join(' '), 'err');
        for (const t of TECHS) if (ERAS.findIndex(e => e.id === t.era) <= i && t.era) this.tech.add(t.id);
        this.eraIndex = i; this.newEra = ERAS[i].id;
        this.emit(`★ Консоль: переход в эпоху ${ERAS[i].ru}`);
        this._dirtyObjectives = true;
        this.cprint(`Эпоха: ${ERAS[i].ru}`, 'ok');
        break;
      }
      case 'research':
        if (args[0] === 'all') { for (const t of TECHS) this.tech.add(t.id); this.eraIndex = 8; this.newEra = 'future'; this._dirtyObjectives = true; this.cprint('Все технологии открыты', 'ok'); }
        else { const r = this.research(args[0]); this.cprint(r.ok ? 'Открыто' : r.why, r.ok ? 'ok' : 'err'); }
        break;
      case 'simulate': {
        let days = parseFloat(args[0]) || 1;
        if ((args[1] || '').startsWith('year')) days *= DAYS_PER_SEASON * 4;
        const steps = Math.min(days, 3650);
        for (let i = 0; i < steps * 4; i++) this.tick(0.25);
        this.cprint(`Промотано ${steps} дней. День ${Math.floor(this.day)}, население ${this.villagers.length}`, 'ok');
        break;
      }
      case 'godmode': this.godmode = !this.godmode; this.cprint(`godmode: ${this.godmode ? 'ON' : 'OFF'}`, 'ok'); break;
      case 'fastresearch': this.fastResearch = !this.fastResearch; this.cprint(`fastresearch: ${this.fastResearch ? 'ON' : 'OFF'}`, 'ok'); break;
      case 'plague': this.plagueDays = 6; this.emit('Чума обрушилась на поселение!'); this.cprint('Чума: 6 дней', 'ok'); break;
      case 'meteor': {
        const b = this.buildings.filter(b => b.type !== 'campfire');
        if (b.length) {
          const t = this.rng.pick(b);
          for (const v of [...this.villagers]) if (v.workplace === t) { v.job = 'idle'; v.workplace = null; }
          this.buildings.splice(this.buildings.indexOf(t), 1);
          this.emit(`☄ МЕТЕОР уничтожил: ${BUILDINGS[t.type].name}!`);
          this.cprint(`Уничтожено: ${BUILDINGS[t.type].name}`, 'ok');
        } else this.cprint('Нечего разрушать', 'err');
        this._dirtyObjectives = true;
        break;
      }
      case 'kill': { const v = this.rng.pick(this.villagers); if (v) { this.removeVillager(v); this.emit(`${v.name} погиб (консоль).`); } break; }
      case 'pop': this.cprint(`Население ${this.villagers.length}/${this.housingCap()}, счастье ${(this.happiness() * 100) | 0}%, еда ${this.res.food | 0}/${this.foodCap()}`, 'ok'); break;
      default: this.cprint(`Неизвестная команда: ${cmd}. /help`, 'err');
    }
  }

  // ---------- сериализация (engine-agnostic формат — тот же JSON поймёт и UE5) ----------
  serialize() {
    return JSON.stringify({
      version: 1, seed: this.seed, day: this.day, seasonIndex: this.seasonIndex,
      weather: this.weather, weatherDays: this.weatherDays,
      res: this.res, tech: [...this.tech], eraIndex: this.eraIndex,
      villagers: this.villagers.map(v => ({ ...v, workplace: null, targetAnimal: null,
        _w: v.workplace ? this.buildings.indexOf(v.workplace) : -1 })),
      buildings: this.buildings.map(b => ({ ...b })),
      animals: this.animals,
      objectiveState: this.objectiveState, victory: this.victory,
      godmode: this.godmode, fastResearch: this.fastResearch, plagueDays: this.plagueDays,
      log: this.log.slice(0, 40),
    });
  }
  static deserialize(json) {
    const d = JSON.parse(json);
    if (d.version !== 1) throw new Error('Несовместимая версия сейва');
    const sim = new Simulation(d.seed);
    Object.assign(sim, {
      day: d.day, seasonIndex: d.seasonIndex, weather: d.weather, weatherDays: d.weatherDays,
      eraIndex: d.eraIndex, objectiveState: d.objectiveState, victory: d.victory,
      godmode: d.godmode, fastResearch: d.fastResearch, plagueDays: d.plagueDays, log: d.log || [],
    });
    sim.res = d.res; sim.tech = new Set(d.tech);
    sim.buildings = d.buildings; sim.animals = d.animals;
    sim.villagers = d.villagers.map(v => {
      const { _w, ...rest } = v;
      return { ...rest, workplace: _w >= 0 ? sim.buildings[_w] : null, targetAnimal: null };
    });
    sim.emit('Игра загружена.');
    return sim;
  }
}

export { DAY_SECONDS };
