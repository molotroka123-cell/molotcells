// core/data.js — весь контент data-driven (никакого хардкода в системах).
// Эти же таблицы позже переносятся в UE5 DataAssets / JSON без изменения логики.

export const TILE = { DEEP: 0, WATER: 1, SAND: 2, GRASS: 3, FOREST: 4, HILL: 5, MOUNTAIN: 6 };
export const WALKABLE = new Set([TILE.SAND, TILE.GRASS, TILE.FOREST, TILE.HILL]);

export const ERAS = [
  { id: 'stone',      name: 'Stone Age',       ru: 'Каменный век' },
  { id: 'bronze',     name: 'Bronze Age',      ru: 'Бронзовый век' },
  { id: 'iron',       name: 'Iron Age',        ru: 'Железный век' },
  { id: 'classical',  name: 'Classical Era',   ru: 'Античность' },
  { id: 'medieval',   name: 'Middle Ages',     ru: 'Средневековье' },
  { id: 'renaissance',name: 'Renaissance',     ru: 'Ренессанс' },
  { id: 'industrial', name: 'Industrial Age',  ru: 'Индустриальная эпоха' },
  { id: 'modern',     name: 'Modern Age',      ru: 'Современность' },
  { id: 'future',     name: 'Future Age',      ru: 'Будущее' },
];

// Технологии: prereq — массив id; era — если задано, открытие переводит цивилизацию в эпоху.
export const TECHS = [
  { id: 'fire',        name: 'Огонь',             cost: 0,    prereq: [], effect: 'Тепло, приготовление пищи, защита от зверей.' },
  { id: 'tools',       name: 'Орудия труда',      cost: 20,   prereq: ['fire'], effect: '+30% к добыче дерева, камня и собирательству.' },
  { id: 'hunting',     name: 'Охота',             cost: 35,   prereq: ['fire'], effect: 'Жители могут охотиться на животных.' },
  { id: 'farming',     name: 'Земледелие',        cost: 70,   prereq: ['tools'], effect: 'Открывает Ферму — стабильный источник еды.' },
  { id: 'pottery',     name: 'Гончарство',        cost: 90,   prereq: ['farming'], effect: 'Открывает Амбар (+300 к запасу еды), +10% счастья.' },
  { id: 'bronze',      name: 'Бронза',            cost: 140,  prereq: ['pottery'], era: 'bronze', effect: 'Открывает Шахту. Новая эпоха.' },
  { id: 'writing',     name: 'Письменность',      cost: 170,  prereq: ['bronze'], effect: 'Открывает Библиотеку. +50% к генерации знаний.' },
  { id: 'iron',        name: 'Железо',            cost: 280,  prereq: ['bronze'], era: 'iron', effect: '+25% ко всей добыче. Новая эпоха.' },
  { id: 'philosophy',  name: 'Философия',         cost: 340,  prereq: ['writing'], era: 'classical', effect: '+30% знаний. Новая эпоха.' },
  { id: 'engineering', name: 'Инженерия',         cost: 550,  prereq: ['philosophy'], effect: 'Стройка в 2 раза быстрее.' },
  { id: 'feudalism',   name: 'Феодализм',         cost: 650,  prereq: ['iron'], era: 'medieval', effect: '+20% еды с ферм. Новая эпоха.' },
  { id: 'printing',    name: 'Книгопечатание',    cost: 850,  prereq: ['engineering'], era: 'renaissance', effect: 'Библиотеки вдвое эффективнее. Новая эпоха.' },
  { id: 'steam',       name: 'Паровая машина',    cost: 1200, prereq: ['printing'], era: 'industrial', effect: 'Открывает Мануфактуру. Новая эпоха.' },
  { id: 'electricity', name: 'Электричество',     cost: 1800, prereq: ['steam'], era: 'modern', effect: 'Открывает Лабораторию. Новая эпоха.' },
  { id: 'computing',   name: 'Вычислительная техника', cost: 2800, prereq: ['electricity'], era: 'future', effect: 'Финальная эпоха. Цивилизация у будущего.' },
];

// Здания: workers — слоты работы; out — добыча на работника в день; housing — места жилья.
export const BUILDINGS = {
  campfire:  { name: 'Кострище',      cost: {},                        housing: 6, workers: 0, desc: 'Сердце племени. Даёт 6 мест жилья.' },
  hut:       { name: 'Хижина',        cost: { wood: 12 },              housing: 4, workers: 0, desc: '+4 места жилья.' },
  forager:   { name: 'Стоянка собирателей', cost: { wood: 8 },         workers: 3, out: { food: 2.2 }, desc: 'Собиратели добывают еду с ближайших угодий.' },
  lumber:    { name: 'Лесопилка',     cost: { wood: 10 },              workers: 3, out: { wood: 1.3 }, needTile: TILE.FOREST, desc: 'Добыча дерева. Ставить рядом с лесом.' },
  quarry:    { name: 'Каменоломня',   cost: { wood: 15 },              workers: 3, out: { stone: 1.1 }, needTile: TILE.HILL, desc: 'Добыча камня. Ставить на холме.' },
  farm:      { name: 'Ферма',         cost: { wood: 20 },              workers: 4, out: { food: 3.0 }, needTile: TILE.GRASS, req: 'farming', desc: 'Стабильная еда. Зимой не работает.' },
  granary:   { name: 'Амбар',         cost: { wood: 25, stone: 10 },   workers: 0, req: 'pottery', desc: '+300 к максимальному запасу еды.' },
  mine:      { name: 'Шахта',         cost: { wood: 30, stone: 20 },   workers: 4, out: { stone: 2.2 }, needTile: TILE.HILL, req: 'bronze', desc: 'Глубокая добыча камня и руды.' },
  library:   { name: 'Библиотека',    cost: { wood: 40, stone: 20 },   workers: 3, out: { knowledge: 0.7 }, req: 'writing', desc: 'Учёные производят знания.' },
  workshop:  { name: 'Мануфактура',   cost: { wood: 50, stone: 60 },   workers: 5, out: { wood: 2.0, stone: 2.0 }, req: 'steam', desc: 'Индустриальное производство материалов.' },
  lab:       { name: 'Лаборатория',   cost: { wood: 60, stone: 100 },  workers: 5, out: { knowledge: 1.6 }, req: 'electricity', desc: 'Наука эпохи электричества.' },
};

export const NAMES = [
  'Арт','Бела','Ворн','Гала','Даг','Эрна','Жар','Зоя','Ивар','Кара','Лев','Мира','Нор','Ода','Пир','Руна','Саг','Тая','Ульф','Фара','Хаг','Цера','Шам','Эла','Юг','Яра',
  'Бор','Веда','Грим','Дара','Ерм','Зара','Инан','Кель','Лада','Маг','Ния','Орм','Пала','Рог','Сива','Тор','Уна','Фей','Хора','Эгон','Яна'
];

export const SEASONS = ['Весна', 'Лето', 'Осень', 'Зима'];
export const DAYS_PER_SEASON = 25;

// Погода по сезонам: [тип, вес]. mult — модификаторы добычи.
export const WEATHER_TABLE = {
  'Весна': [['clear', .55], ['rain', .35], ['storm', .10]],
  'Лето':  [['clear', .60], ['drought', .15], ['rain', .15], ['storm', .10]],
  'Осень': [['clear', .45], ['rain', .40], ['storm', .15]],
  'Зима':  [['clear', .45], ['snow', .45], ['storm', .10]],
};
export const WEATHER = {
  clear:   { ru: 'Ясно',   forage: 1.0, farm: 1.0,  wood: 1.0, stone: 1.0 },
  rain:    { ru: 'Дождь',  forage: 0.9, farm: 1.2,  wood: 0.8, stone: 0.9 },
  snow:    { ru: 'Снег',   forage: 0.6, farm: 0.0,  wood: 0.7, stone: 0.8 },
  drought: { ru: 'Засуха', forage: 0.6, farm: 0.3,  wood: 1.0, stone: 1.0 },
  storm:   { ru: 'Буря',   forage: 0.4, farm: 0.5,  wood: 0.5, stone: 0.5 },
};

// Случайные события (вес, условие, эффект) — см. simulation.rollEvent
export const EVENT_DEFS = [
  { id: 'wanderer',  w: 30, ru: 'Странник просится в племя' },
  { id: 'wanderers', w: 12, ru: 'Семья беженцев присоединилась к вам' },
  { id: 'bountiful', w: 15, ru: 'Щедрый урожай ягод и кореньев' },
  { id: 'pack',      w: 12, ru: 'Стадо оленей подошло к поселению' },
  { id: 'cold',      w: 10, ru: 'Лютые холода: расход еды вырос' },
  { id: 'sickness',  w: 9,  ru: 'Болезнь по поселению' },
  { id: 'insight',   w: 12, ru: 'Один из жителей сделал наблюдение (+знания)' },
];

export const OBJECTIVES = [
  { id: 'hut',       text: 'Постройте хижину',            check: (s) => s.countBuilding('hut') >= 1 },
  { id: 'lumber',    text: 'Постройте лесопилку у леса',  check: (s) => s.countBuilding('lumber') >= 1 },
  { id: 'pop10',     text: 'Население — 10 жителей',      check: (s) => s.villagers.length >= 10 },
  { id: 'farming',   text: 'Откройте земледелие и постройте ферму', check: (s) => s.countBuilding('farm') >= 1 },
  { id: 'bronze',    text: 'Войдите в Бронзовый век',     check: (s) => s.eraIndex >= 1 },
  { id: 'library',   text: 'Постройте библиотеку',        check: (s) => s.countBuilding('library') >= 1 },
  { id: 'medieval',  text: 'Достигните Средневековья',    check: (s) => s.eraIndex >= 4 },
  { id: 'industrial',text: 'Достигните Индустриальной эпохи', check: (s) => s.eraIndex >= 6 },
  { id: 'future',    text: 'Достигните Эпохи Будущего',   check: (s) => s.eraIndex >= 8 },
  { id: 'utopia',    text: 'Эпоха Будущего + 60 жителей — ПОБЕДА', check: (s) => s.eraIndex >= 8 && s.villagers.length >= 60 },
];
