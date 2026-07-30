// save/saveSystem.js — абстракция сохранений.
// Игра зависит ТОЛЬКО от интерфейса ISaveSystem, не от реализации.
// Roadmap: BrowserSave → DesktopSave (UE5) → CloudSave → SteamSave.
//
// interface ISaveSystem {
//   save(slot: string, data: string): Promise<void>
//   load(slot: string): Promise<string|null>
//   has(slot: string): Promise<boolean>
// }

// Реализация для браузерного клиента (прототип).
export class BrowserSave {
  constructor(prefix = 'pe_save_') { this.prefix = prefix; }
  async save(slot, data) { localStorage.setItem(this.prefix + slot, data); }
  async load(slot) { return localStorage.getItem(this.prefix + slot); }
  async has(slot) { return localStorage.getItem(this.prefix + slot) !== null; }
}

// Файловая реализация: экспорт/импорт JSON (работает и в браузере, идея та же на десктопе).
export class FileSave {
  async save(_slot, data) {
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `project_evolution_save_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  async load() { throw new Error('Используйте input[type=file] для импорта'); }
  async has() { return false; }
}
