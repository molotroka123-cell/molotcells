// ui/hud.js — слой интерфейса (DOM). Только отображение и ввод; логика — в core.
import { ERAS, TECHS, BUILDINGS, WEATHER, OBJECTIVES } from '../core/data.js';
import { Simulation, DAY_SECONDS } from '../core/simulation.js';
import { BrowserSave, FileSave } from '../save/saveSystem.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor(renderer, onNewGame) {
    this.renderer = renderer;
    this.sim = null;
    this.speed = 1;
    this.paused = false;
    this.tab = 'build';
    this.saveSystem = new BrowserSave();   // ISaveSystem — реализация заменяема
    this.fileSave = new FileSave();
    this.onNewGame = onNewGame;
    this.bind();
  }

  attach(sim) { this.sim = sim; this.refreshSide(); this.refreshObjectives(); }

  bind() {
    $('tabBuild').onclick = () => { this.tab = 'build'; this.refreshSide(); };
    $('tabResearch').onclick = () => { this.tab = 'research'; this.refreshSide(); };
    $('btnPause').onclick = () => this.togglePause();
    document.querySelectorAll('.spd').forEach(b => b.onclick = () => {
      this.speed = +b.dataset.s;
      document.querySelectorAll('.spd').forEach(x => x.classList.toggle('active', x === b));
    });
    $('btnSave').onclick = async () => { await this.saveSystem.save('manual', this.sim.serialize()); this.print('Сохранено (слот manual)', 'ok'); };
    $('btnLoad').onclick = () => this.loadFrom('manual');
    $('btnContinue').onclick = () => this.loadFrom('auto') || this.loadFrom('manual');
    $('btnExport').onclick = () => this.fileSave.save('export', this.sim.serialize());
    $('btnImport').onclick = () => $('fileImport').click();
    $('fileImport').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { this.attach(Simulation.deserialize(await f.text())); this.print('Сейв импортирован', 'ok'); $('overlay').classList.add('hidden'); }
      catch (err) { this.print('Ошибка импорта: ' + err.message, 'err'); }
    };
    $('btnNew').onclick = () => { $('overlay').classList.add('hidden'); this.onNewGame(); };
    $('consoleIn').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && this.sim) {
        const v = e.target.value.trim();
        if (v) { this.print('> ' + v); this.sim.execCommand(v); this.flushConsole(); this.refreshSide(); }
        e.target.value = '';
      }
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && document.activeElement !== $('consoleIn')) { e.preventDefault(); this.togglePause(); }
      if (e.key === 'Escape') this.renderer.placing = null;
    });
  }

  async loadFrom(slot) {
    const data = await this.saveSystem.load(slot);
    if (data) {
      this.attach(Simulation.deserialize(data));
      $('overlay').classList.add('hidden');
      this.print(`Загружено (слот ${slot})`, 'ok');
      return true;
    }
    if (slot === 'manual') this.print('Сейв не найден', 'err');
    return false;
  }

  togglePause() { this.paused = !this.paused; $('btnPause').textContent = this.paused ? '▶' : '⏸'; }
  print(msg, cls = '') {
    const d = document.createElement('div');
    if (cls) d.className = cls;
    d.textContent = msg;
    $('consoleOut').appendChild(d);
    $('consoleOut').scrollTop = 1e6;
  }
  flushConsole() {
    for (const c of this.sim.consoleLog.splice(0)) this.print(c.msg, c.cls);
  }

  // ---- верхняя панель / лог / цели (вызывается каждый кадр, дёшево) ----
  refresh() {
    const s = this.sim; if (!s) return;
    $('rFood').textContent = `${s.res.food | 0}/${s.foodCap()}`;
    $('rWood').textContent = s.res.wood | 0;
    $('rStone').textContent = s.res.stone | 0;
    $('rKnow').textContent = s.res.knowledge | 0;
    $('rPop').textContent = `${s.villagers.length}/${s.housingCap()}`;
    $('rHappy').textContent = `${(s.happiness() * 100) | 0}%`;
    $('eraBadge').textContent = ERAS[s.eraIndex].name;
    $('dateBox').textContent = `День ${s.day | 0} · ${s.season()} · ${WEATHER[s.weather].ru}`;

    // лог событий
    const logEl = $('log');
    const html = s.log.slice(0, 25).map(e => `<div>Д${e.day}: ${e.msg}</div>`).join('');
    if (logEl._last !== html) { logEl.innerHTML = html; logEl._last = html; }

    // баннер новой эпохи
    if (s.newEra) {
      const era = ERAS.find(e => e.id === s.newEra);
      $('bannerTitle').textContent = era.name;
      $('bannerSub').textContent = era.ru;
      const b = $('banner');
      b.style.opacity = 1;
      setTimeout(() => b.style.opacity = 0, 2600);
      s.newEra = null;
    }
    // победа
    if (s.victory && $('overlay').classList.contains('hidden')) {
      $('overlay').classList.remove('hidden');
      $('overlay').querySelector('h1').textContent = 'ПОБЕДА';
      $('overlay').querySelector('p').textContent =
        `Ваша цивилизация вошла в Эпоху Будущего — ${s.villagers.length} жителей, день ${s.day | 0}. История продолжается…`;
    }
    // автосейв
    if (s.autosaveRequested) { s.autosaveRequested = false; this.saveSystem.save('auto', s.serialize()); }
    this.refreshObjectives();
  }

  refreshObjectives() {
    const s = this.sim; if (!s) return;
    $('objectives').innerHTML = OBJECTIVES.map(o =>
      `<li class="${s.objectiveState[o.id] ? 'done' : ''}">${s.objectiveState[o.id] ? '✓' : '○'} ${o.text}</li>`).join('');
  }

  // ---- боковая панель ----
  refreshSide() {
    document.querySelectorAll('#side .tabs button').forEach(b =>
      b.classList.toggle('active', (b.id === 'tabBuild') === (this.tab === 'build')));
    const list = $('sideList');
    list.innerHTML = '';
    if (!this.sim) return;

    if (this.tab === 'build') {
      for (const [type, def] of Object.entries(BUILDINGS)) {
        if (type === 'campfire') continue;
        const locked = def.req && !this.sim.hasTech(def.req);
        const cost = Object.entries(def.cost).map(([r, n]) => `${{ food: '🍞', wood: '🪵', stone: '🪨' }[r]}${n}`).join(' ') || '—';
        const el = document.createElement('div');
        el.className = 'card' + (locked ? ' locked' : '') + (this.renderer.placing === type ? ' selected' : '');
        el.innerHTML = `<h4>${def.name}</h4><div class="cost">${cost}${def.workers ? ` · 👷${def.workers}` : ''}${def.housing ? ` · 🏠${def.housing}` : ''}</div><div class="desc">${def.desc}</div>`;
        if (!locked) el.onclick = () => {
          this.renderer.placing = this.renderer.placing === type ? null : type;
          this.refreshSide();
        };
        list.appendChild(el);
      }
    } else {
      for (const t of TECHS) {
        const owned = this.sim.hasTech(t.id);
        const avail = !owned && t.prereq.every(p => this.sim.hasTech(p));
        const el = document.createElement('div');
        el.className = 'card' + (owned ? ' owned' : avail ? '' : ' locked');
        el.innerHTML = `<h4>${owned ? '✓ ' : ''}${t.name}</h4><div class="cost">📜 ${t.cost} знаний${t.era ? ' · новая эпоха' : ''}</div><div class="desc">${t.effect}</div>`;
        if (avail) el.onclick = () => {
          const r = this.sim.research(t.id);
          this.print(r.ok ? `Открыто: ${t.name}` : r.why, r.ok ? 'ok' : 'err');
          this.refreshSide(); this.refreshObjectives();
        };
        list.appendChild(el);
      }
    }
  }

  tooltip(sim, wx, wy, px, py) {
    const tt = $('tooltip');
    const v = sim.villagers.find(v => Math.hypot(v.x - wx, v.y - wy) < 0.35);
    const gx = Math.floor(wx), gy = Math.floor(wy);
    const b = sim.buildings.find(b => b.gx === gx && b.gy === gy);
    let text = '';
    if (v) text = `${v.name} · ${v.age | 0} лет · ❤${v.hp | 0}<br>Занятие: ${{ idle: 'безделье', build: 'стройка', work: 'работа', forage: 'собирательство', hunt: 'охота' }[v.job]}`;
    else if (b) text = `${BUILDINGS[b.type].name}${b.done ? '' : ` · стройка ${(b.progress * 100) | 0}%`}${b.workers.length ? ` · 👷${b.workers.length}` : ''}`;
    const a = sim.animals.find(a => Math.hypot(a.x - wx, a.y - wy) < 0.4);
    if (!text && a) text = a.kind === 'mammoth' ? 'Мамонт (120 еды)' : 'Олень (25 еды)';
    if (text) {
      tt.innerHTML = text;
      tt.style.display = 'block';
      tt.style.left = px + 14 + 'px';
      tt.style.top = py + 10 + 'px';
    } else tt.style.display = 'none';
  }
}

export { DAY_SECONDS };
