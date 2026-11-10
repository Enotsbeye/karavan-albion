"use strict";
/* ===== Караван: расчётное ядро (без DOM) ===== */
const DB = /*__DB__*/null;

const QN = ['', 'Обычное', 'Хорошее', 'Выдающееся', 'Отличное', 'Шедевр'];
const CATS = [
  { id: 'melee', name: 'Ближний бой' }, { id: 'ranged', name: 'Дальний бой' }, { id: 'magic', name: 'Магия' },
  { id: 'plate', name: 'Латы' }, { id: 'leather', name: 'Кожа' }, { id: 'cloth', name: 'Ткань' },
  { id: 'offhand', name: 'Левая рука' }, { id: 'cape', name: 'Плащи' }, { id: 'bag', name: 'Сумки' },
  { id: 'raw', name: 'Сырьё' }, { id: 'refined', name: 'Материалы' }
];
const CITIES = [
  { id: 'Bridgewatch', name: 'Бриджвотч' }, { id: 'Fort Sterling', name: 'Форт Стерлинг' },
  { id: 'Lymhurst', name: 'Лимхерст' }, { id: 'Martlock', name: 'Мартлок' }, { id: 'Thetford', name: 'Тетфорд' },
  { id: 'Caerleon', name: 'Каэрлеон' }, { id: 'Brecilien', name: 'Бресилиен' },
  { id: 'Black Market', name: 'Чёрный рынок', sellOnly: true }
];
const SERVERS = [
  { id: 'europe', name: 'Европа' }, { id: 'west', name: 'Америка' }, { id: 'east', name: 'Азия' }
];
const cityName = id => (CITIES.find(c => c.id === id) || { name: id }).name;
const apiHost = server => `https://${server}.albion-online-data.com`;

/* Список предметов под выбранные категории, тиры и зачарования */
function buildItems(sel) {
  const out = [];
  const cats = new Set(sel.cats), tiers = [...sel.tiers].sort(), enchs = [...sel.enchs].sort();
  for (const g of DB.gear) {
    if (!cats.has(g[2])) continue;
    const maxE = g.length > 4 ? g[4] : 4;
    for (const t of tiers) for (const e of enchs) {
      if (e > maxE) continue;
      out.push({ id: `T${t}_${g[0]}` + (e ? `@${e}` : ''), name: g[1], tier: t, ench: e, cat: g[2], w: g[3][t - 4], gear: true });
    }
  }
  for (const r of DB.res) {
    if (!cats.has(r[1])) continue;
    for (const t of tiers) {
      const row = r[2][t - 4]; if (!row) continue;
      for (const e of enchs) {
        if (e > row[2]) continue;
        out.push({ id: e ? `T${t}_${r[0]}_LEVEL${e}@${e}` : `T${t}_${r[0]}`, name: row[0], tier: t, ench: e, cat: r[1], w: row[1], gear: false });
      }
    }
  }
  return out;
}

/* Режем список ID на запросы: у API предел длины адреса 4096 символов */
function chunkIds(ids, maxChars) {
  const chunks = []; let cur = [], len = 0;
  for (const id of ids) {
    if (len + id.length + 1 > maxChars && cur.length) { chunks.push(cur); cur = []; len = 0; }
    cur.push(id); len += id.length + 1;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

function indexPrices(rows, map) {
  for (const r of rows) {
    const a = map[r.item_id] || (map[r.item_id] = {});
    const b = a[r.city] || (a[r.city] = {});
    b[r.quality || 1] = r;
  }
  return map;
}

/* История: средний дневной объём и средняя цена сделок за последние 7 дней */
function indexHistory(rows, map, now) {
  const from = now - 8 * 864e5;
  for (const r of rows) {
    let cnt = 0, sum = 0, days = 0;
    for (const p of (r.data || [])) {
      const ts = Date.parse(p.timestamp + 'Z');
      if (!(ts >= from) || !p.item_count) continue;
      cnt += p.item_count; sum += p.avg_price * p.item_count; days++;
    }
    if (days) map[r.item_id + '|' + (r.quality || 1)] = { vol: cnt / Math.max(days, 1), avg: sum / cnt };
  }
  return map;
}

const ageH = (d, now) => (!d || d.startsWith('0001')) ? Infinity : Math.max(0, (now - Date.parse(d + 'Z')) / 36e5);

function feeRate(cfg) {
  return (cfg.premium ? cfg.taxPremium : cfg.taxFree) / 100 + (cfg.mode === 'order' ? cfg.setupFee / 100 : 0);
}

/* Кандидаты: одна лучшая сделка на каждую пару «предмет + качество покупки» */
function computeCandidates(items, prices, cfg, now) {
  const fee = feeRate(cfg), best = new Map();
  for (const it of items) {
    const p = prices[it.id]; if (!p) continue;
    const S = p[cfg.src], D = p[cfg.dst]; if (!S || !D) continue;
    const quals = it.gear ? [1, 2, 3, 4, 5] : [1];
    for (const qs of quals) {
      const d = D[qs]; if (!d) continue;
      let sell, sellDate;
      if (cfg.mode === 'order') { sell = d.sell_price_min > 1 ? d.sell_price_min - 1 : 0; sellDate = d.sell_price_min_date; }
      else { sell = d.buy_price_max; sellDate = d.buy_price_max_date; }
      if (!(sell > 0)) continue;
      const aS = ageH(sellDate, now); if (aS > cfg.maxAge) continue;
      /* В ордер на покупку можно сдать вещь качества не ниже указанного; свой ордер сравниваем с тем же качеством */
      const qbList = (it.gear && cfg.mode !== 'order') ? quals.filter(q => q >= qs) : [qs];
      for (const qb of qbList) {
        const s = S[qb]; if (!s || !(s.sell_price_min > 0)) continue;
        const aB = ageH(s.sell_price_min_date, now); if (aB > cfg.maxAge) continue;
        const buy = s.sell_price_min, net = sell * (1 - fee), profit = net - buy, roi = profit / buy;
        if (profit <= 0 || roi * 100 < cfg.minRoi || roi * 100 > cfg.maxRoi) continue;
        const conf = Math.pow(0.5, (aB + aS) / cfg.halfLife);
        const c = { key: it.id + '|' + qb, id: it.id, item: it, qb, qs, buy, sell, net, profit, roi, ageB: aB, ageS: aS, conf, vol: null, avg: null };
        const prev = best.get(c.key);
        if (!prev || prev.profit * prev.conf < c.profit * c.conf) best.set(c.key, c);
      }
    }
  }
  return [...best.values()].sort((a, b) => b.profit * b.conf - a.profit * a.conf);
}

function applyHistory(cands, hist) {
  for (const c of cands) {
    const h = hist[c.id + '|' + c.qs];
    if (h) { c.vol = h.vol; c.avg = h.avg; }
  }
}

/* Сколько штук разумно брать и шаг (для стаков шаг больше одной штуки) */
function capFor(c, cfg) {
  let cap;
  if (c.item.gear) cap = c.vol != null ? Math.floor(c.vol * cfg.share / 100) : 1, cap = Math.min(Math.max(cap, 1), cfg.maxPerPos);
  else cap = c.vol != null ? Math.floor(c.vol * cfg.share / 100) : 50, cap = Math.min(Math.max(cap, 1), 9999);
  const steps = Math.min(cap, 20), lot = Math.floor(cap / steps);
  return { cap: steps * lot, steps, lot };
}

/* Деньги позиции при количестве qty: каждая следующая ступень дороже в закупке и дешевле в продаже */
function posMoney(c, qty, lot, cfg, actualBuy) {
  const s = cfg.slip / 100, fee = feeRate(cfg);
  let cost = 0, net = 0, left = qty, k = 0;
  while (left > 0) {
    const n = Math.min(lot, left);
    cost += c.buy * Math.pow(1 + s, k) * n;
    net += c.sell * Math.pow(1 - s, k) * (1 - fee) * n;
    left -= n; k++;
  }
  if (actualBuy > 0) cost = actualBuy * qty;
  return { cost, net, profit: net - cost, weight: c.item.w * qty };
}

function buildUnits(c, cfg) {
  const { steps, lot } = capFor(c, cfg), s = cfg.slip / 100, fee = feeRate(cfg), units = [];
  for (let k = 0; k < steps; k++) {
    const b = c.buy * Math.pow(1 + s, k), net = c.sell * Math.pow(1 - s, k) * (1 - fee), pu = net - b;
    if (pu <= 0 || pu / b * 100 < cfg.minRoi) break;
    units.push({ c: b * lot, w: c.item.w * lot, p: pu * lot, e: pu * lot * c.conf });
  }
  return { units, lot };
}

/* Рюкзак с двумя ограничениями (серебро и вес): жадный выбор по нескольким весам критериев, берём лучший */
function optimize(pos, B, W) {
  const n = pos.length; let best = null;
  const alphas = (W === Infinity) ? [1] : [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
  for (const a of alphas) {
    const take = new Array(n).fill(0), open = new Array(n).fill(true);
    let b = B, w = W, tot = 0;
    for (;;) {
      let bi = -1, bs = 0;
      for (let i = 0; i < n; i++) {
        if (!open[i]) continue;
        const u = pos[i].units[take[i]];
        if (!u || u.c > b || u.w > w) { open[i] = false; continue; }
        const denom = a * (u.c / B) + (W === Infinity ? 0 : (1 - a) * (u.w / W)) + 1e-12;
        const sc = u.e / denom;
        if (sc > bs) { bs = sc; bi = i; }
      }
      if (bi < 0) break;
      const u = pos[bi].units[take[bi]];
      take[bi]++; b -= u.c; w -= u.w; tot += u.e;
    }
    if (!best || tot > best.tot) best = { take, tot };
  }
  return best || { take: [], tot: 0 };
}

/* Сборка плана. locked — уже купленные позиции (их серебро и вес вычитаем), excluded — вычеркнутые */
function makePlan(cands, cfg, locked, excluded) {
  locked = locked || new Map(); excluded = excluded || new Set();
  const W0 = cfg.weight > 0 ? cfg.weight : Infinity;
  let B = cfg.budget, W = W0;
  const rows = [];
  for (const [key, L] of locked) {
    const { lot } = capFor(L.cand, cfg);
    const m = posMoney(L.cand, L.qty, lot, cfg, L.actualBuy);
    rows.push({ key, cand: L.cand, qty: L.qty, lot, locked: true, actualBuy: L.actualBuy || 0, ...m, exp: m.profit * (L.actualBuy > 0 ? Math.pow(0.5, L.cand.ageS / cfg.halfLife) : L.cand.conf) });
    B -= m.cost; W -= m.weight;
  }
  B = Math.max(0, B); W = Math.max(0, W);
  let free = cands.filter(c => !locked.has(c.key) && !excluded.has(c.key));
  let picked = [];
  for (let round = 0; round < 4; round++) {
    const pos = free.map(c => ({ c, ...buildUnits(c, cfg) })).filter(p => p.units.length);
    const { take } = optimize(pos, B, W);
    picked = [];
    pos.forEach((p, i) => { if (take[i] > 0) picked.push({ p, steps: take[i] }); });
    const small = picked.filter(x => x.p.units.slice(0, x.steps).reduce((s, u) => s + u.p, 0) < cfg.minPosProfit);
    if (!small.length) break;
    const drop = new Set(small.map(x => x.p.c.key));
    free = free.filter(c => !drop.has(c.key));
  }
  for (const x of picked) {
    const c = x.p.c, qty = x.steps * x.p.lot, m = posMoney(c, qty, x.p.lot, cfg, 0);
    if (m.profit < cfg.minPosProfit) continue;
    rows.push({ key: c.key, cand: c, qty, lot: x.p.lot, locked: false, actualBuy: 0, ...m, exp: m.profit * c.conf });
  }
  rows.sort((a, b) => (b.locked - a.locked) || (b.exp - a.exp));
  const t = { cost: 0, net: 0, profit: 0, exp: 0, weight: 0 };
  for (const r of rows) { t.cost += r.cost; t.net += r.net; t.profit += r.profit; t.exp += r.exp; t.weight += r.weight; }
  const inPlan = new Set(rows.map(r => r.key));
  const leftB = cfg.budget - t.cost, leftW = W0 - t.weight;
  const leftovers = [];
  for (const c of cands) {
    if (inPlan.has(c.key) || excluded.has(c.key)) continue;
    const { lot } = capFor(c, cfg);
    const cost = c.buy * lot, w = c.item.w * lot;
    const reason = (cost > leftB && w > leftW) ? 'не хватило серебра и веса' : cost > leftB ? 'не хватило серебра' : w > leftW ? 'не хватило веса' : 'прибыль с позиции слишком мала';
    leftovers.push({ cand: c, reason });
    if (leftovers.length >= 25) break;
  }
  return { rows, totals: t, leftovers, budget: cfg.budget, weightCap: W0 };
}

/* Риск дороги: p — вероятность потерять весь груз за рейс */
function riskMath(totals, pPct, minutes) {
  const p = pPct / 100, P = totals.exp, C = totals.cost;
  return {
    ev: (1 - p) * P - p * C,
    breakEven: (P + C) > 0 ? P / (P + C) * 100 : 0,
    runsPerGank: P > 0 ? C / P : Infinity,
    perHour: minutes > 0 ? ((1 - p) * P - p * C) / minutes * 60 : null
  };
}

/* Демо-данные: выдуманные цены, чтобы посмотреть интерфейс без сети */
function demoData(items, cfg, now) {
  const rows = [], hist = [];
  const h = s => { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return (x >>> 0) / 4294967296; };
  const iso = ms => new Date(ms).toISOString().slice(0, 19);
  for (const it of items) {
    const catF = it.gear ? ({ bag: 1.6, cape: 0.8, offhand: 0.7 }[it.cat] || 1.2) : 0.012;
    const v = 9000 * Math.pow(2.05, it.tier - 4) * Math.pow(2.6, it.ench) * catF * (0.7 + 0.6 * h(it.id + 'v'));
    for (const q of (it.gear ? [1, 2, 3, 4, 5] : [1])) {
      const k = it.id + q, qf = 1 + (q - 1) * 0.04;
      if (h(k + 'm') < 0.35) continue;
      const src = Math.round(v * qf * (0.86 + 0.2 * h(k + 's')));
      const dstBuy = Math.round(v * qf * (0.8 + 0.42 * h(k + 'd')));
      const aB = now - (0.3 + 20 * Math.pow(h(k + 'ab'), 1.5)) * 36e5, aS = now - (0.2 + 9 * Math.pow(h(k + 'as'), 1.5)) * 36e5;
      rows.push({ item_id: it.id, city: cfg.src, quality: q, sell_price_min: src, sell_price_min_date: iso(aB), buy_price_max: Math.round(src * 0.8), buy_price_max_date: iso(aB) });
      rows.push({ item_id: it.id, city: cfg.dst, quality: q, sell_price_min: Math.round(dstBuy * 1.12), sell_price_min_date: iso(aS), buy_price_max: dstBuy, buy_price_max_date: iso(aS) });
      const vol = Math.round((it.gear ? 4 + 260 * h(k + 'vol') : 2000 + 60000 * h(k + 'vol')) / Math.pow(1.6, it.ench));
      hist.push({ item_id: it.id, location: cfg.dst, quality: q, data: [1, 2, 3, 4, 5, 6, 7].map(dd => ({ item_count: Math.max(1, vol), avg_price: dstBuy, timestamp: iso(now - dd * 864e5) })) });
    }
  }
  return { rows, hist };
}

/* Форматирование и разбор чисел */
const fmt = n => Math.round(n).toLocaleString('ru-RU').replace(/ /g, ' ');
function fmtShort(n) {
  const a = Math.abs(n), s = n < 0 ? '−' : '';
  if (a >= 1e9) return s + (a / 1e9).toFixed(2).replace('.', ',') + ' млрд';
  if (a >= 1e6) return s + (a / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace('.', ',') + ' млн';
  if (a >= 1e4) return s + Math.round(a / 1e3) + ' тыс.';
  return s + fmt(a);
}
function parseSilver(str) {
  if (typeof str === 'number') return str;
  let s = String(str || '').toLowerCase().replace(/[\s  _]/g, '').replace(',', '.');
  let mul = 1;
  if (/(млрд|b|kkk)$/.test(s)) mul = 1e9; else if (/(млн|m|м|kk|кк)$/.test(s)) mul = 1e6; else if (/(тыс|k|к)$/.test(s)) mul = 1e3;
  s = s.replace(/[^0-9.]/g, '');
  const v = parseFloat(s);
  return isFinite(v) ? Math.round(v * mul) : 0;
}
function fmtAge(h) {
  if (!isFinite(h)) return '—';
  if (h < 1) return Math.max(1, Math.round(h * 60)) + ' мин';
  if (h < 48) return Math.round(h) + ' ч';
  return Math.round(h / 24) + ' дн';
}
const tierLabel = it => it.tier + '.' + it.ench;

if (typeof module !== 'undefined') module.exports = { DB, QN, CATS, CITIES, SERVERS, cityName, apiHost, buildItems, chunkIds, indexPrices, indexHistory, ageH, feeRate, computeCandidates, applyHistory, capFor, posMoney, buildUnits, optimize, makePlan, riskMath, demoData, fmt, fmtShort, parseSilver, fmtAge, tierLabel };
