"use strict";
/* ===== Караван: интерфейс ===== */
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
};

const DEF = {
  server: 'europe', src: 'Lymhurst', dst: 'Black Market', budget: 2000000, weight: 0, premium: true, mode: 'instant',
  cats: ['melee', 'ranged', 'magic', 'plate', 'leather', 'cloth', 'offhand', 'cape', 'bag'], tiers: [5, 6, 7], enchs: [0, 1, 2],
  maxAge: 24, halfLife: 8, minRoi: 5, maxRoi: 150, minPosProfit: 3000, share: 10, slip: 2, maxPerPos: 5,
  taxPremium: 4, taxFree: 8, setupFee: 2.5, gank: 10, minutes: 15, auto: false, fresh: false
};
const ADV = ['maxAge', 'halfLife', 'minRoi', 'maxRoi', 'minPosProfit', 'maxPerPos', 'share', 'slip', 'taxPremium', 'taxFree', 'setupFee'];
let cfg = Object.assign({}, DEF, LS.get('karavan.cfg', {}));
for (const k of ['cats', 'tiers', 'enchs']) if (!Array.isArray(cfg[k]) || !cfg[k].length) cfg[k] = DEF[k].slice();
if (!CITIES.some(c => c.id === cfg.src && !c.sellOnly)) cfg.src = DEF.src;
if (!CITIES.some(c => c.id === cfg.dst)) cfg.dst = DEF.dst;
if (!SERVERS.some(s => s.id === cfg.server)) cfg.server = DEF.server;

const S = { scan: null, cands: [], plan: null, locked: new Map(), excluded: new Set(), busy: false, open: null, error: null, histFail: false };
const saveCfg = () => LS.set('karavan.cfg', cfg);
const scanKey = () => JSON.stringify([cfg.server, cfg.src, cfg.dst, [...cfg.cats].sort(), [...cfg.tiers].sort(), [...cfg.enchs].sort()]);
const routeKey = () => cfg.server + '|' + cfg.src + '|' + cfg.dst;
const sameCity = () => cfg.src === 'Caerleon' && cfg.dst === 'Black Market';

function routeDefaults() {
  if (sameCity()) return { gank: 0, minutes: 3 };
  const risky = ['Caerleon', 'Black Market', 'Brecilien'];
  if (risky.includes(cfg.src) || risky.includes(cfg.dst)) return { gank: 10, minutes: 15 };
  return { gank: 1, minutes: 20 };
}

/* ---------- форма ---------- */
function chipRow(el, list, key, label) {
  el.innerHTML = list.map(v => `<button type="button" class="chip" data-v="${esc(v.id)}" aria-pressed="${cfg[key].includes(v.id)}">${esc(label(v))}</button>`).join('');
  el.addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    const raw = b.dataset.v, v = (key === 'cats') ? raw : Number(raw);
    const i = cfg[key].indexOf(v);
    if (i >= 0) { if (cfg[key].length === 1) { toast('Нужен хотя бы один вариант'); return; } cfg[key].splice(i, 1); } else cfg[key].push(v);
    b.setAttribute('aria-pressed', String(i < 0));
    saveCfg(); updateGo(); if (S.scan) renderResult();
  });
}
function initForm() {
  $('#server').innerHTML = SERVERS.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  $('#src').innerHTML = CITIES.filter(c => !c.sellOnly).map(c => `<option value="${esc(c.id)}">${c.name}</option>`).join('');
  $('#dst').innerHTML = CITIES.map(c => `<option value="${esc(c.id)}">${c.name}</option>`).join('');
  $('#server').value = cfg.server; $('#src').value = cfg.src; $('#dst').value = cfg.dst;
  $('#budget').value = cfg.budget ? fmt(cfg.budget) : '';
  $('#weight').value = cfg.weight || '';
  $('#premium').checked = !!cfg.premium;
  setMode(cfg.mode);
  chipRow($('#cats'), CATS, 'cats', v => v.name);
  chipRow($('#tiers'), [4, 5, 6, 7, 8].map(t => ({ id: t })), 'tiers', v => 'T' + v.id);
  chipRow($('#enchs'), [0, 1, 2, 3, 4].map(t => ({ id: t })), 'enchs', v => '.' + v.id);
  for (const k of ADV) { const el = $('#' + k); el.value = cfg[k]; el.addEventListener('change', () => { const v = parseFloat(el.value); if (isFinite(v) && v >= 0) { cfg[k] = v; saveCfg(); recalc(); } else el.value = cfg[k]; }); }

  $('#server').addEventListener('change', e => { cfg.server = e.target.value; routeChanged(false); });
  $('#src').addEventListener('change', e => { cfg.src = e.target.value; if (cfg.dst === cfg.src) { cfg.dst = cfg.src === 'Caerleon' ? 'Black Market' : 'Caerleon'; $('#dst').value = cfg.dst; } routeChanged(true); });
  $('#dst').addEventListener('change', e => { cfg.dst = e.target.value; if (cfg.dst === cfg.src) { cfg.src = cfg.dst === 'Lymhurst' ? 'Martlock' : 'Lymhurst'; $('#src').value = cfg.src; } routeChanged(true); });
  $('#swap').addEventListener('click', () => {
    if (cfg.dst === 'Black Market') { toast('На Чёрном рынке нельзя покупать, поэтому маршрут не разворачивается'); return; }
    [cfg.src, cfg.dst] = [cfg.dst, cfg.src]; $('#src').value = cfg.src; $('#dst').value = cfg.dst; routeChanged(true);
  });
  const b = $('#budget');
  const commitBudget = () => { cfg.budget = parseSilver(b.value); b.value = cfg.budget ? fmt(cfg.budget) : ''; saveCfg(); recalc(); };
  b.addEventListener('change', commitBudget);
  b.addEventListener('keydown', e => { if (e.key === 'Enter') b.blur(); });
  $('#budgetQuick').addEventListener('click', e => { const q = e.target.closest('button'); if (!q) return; b.value = q.dataset.v; commitBudget(); });
  $('#weight').addEventListener('change', e => { const v = parseFloat(e.target.value); cfg.weight = isFinite(v) && v > 0 ? v : 0; saveCfg(); recalc(); });
  $('#premium').addEventListener('change', e => { cfg.premium = e.target.checked; saveCfg(); recalc(); });
  $('#mode').addEventListener('click', e => { const m = e.target.closest('button'); if (!m) return; cfg.mode = m.dataset.v; setMode(cfg.mode); saveCfg(); recalc(); });
  $('#lang').value = LANG;
  $('#lang').addEventListener('change', e => { try { localStorage.setItem('karavan.lang', e.target.value); } catch (x) { } location.reload(); });
  $('#auto').checked = !!cfg.auto; $('#fresh').checked = !!cfg.fresh;
  $('#auto').addEventListener('change', e => { cfg.auto = e.target.checked; saveCfg(); if (cfg.auto) toast('Цены обновятся сами, пока окно открыто.'); autoTick(); });
  $('#fresh').addEventListener('change', e => { cfg.fresh = e.target.checked; cfg.maxAge = cfg.fresh ? 6 : 24; $('#maxAge').value = cfg.maxAge; saveCfg(); recalc(); if ($('#tab-craft') && !$('#tab-craft').hidden && typeof craftRecalc === 'function') craftRecalc(); if (typeof renderFarm === 'function') renderFarm(); });
  $('#go').addEventListener('click', () => { S.lastCompare = false; scan(false); });
  $('#cmpgo').addEventListener('click', () => { S.lastCompare = true; compareCities(false); });
  document.querySelector('.tabs').addEventListener('click', e => { const t = e.target.closest('[data-tab]'); if (t) showTab(t.dataset.tab); });
  updateGo();
}
function setMode(m) { for (const b of $('#mode').children) b.setAttribute('aria-pressed', String(b.dataset.v === m)); }
function routeChanged(resetRisk) {
  if (resetRisk) Object.assign(cfg, routeDefaults());
  S.locked.clear(); S.excluded.clear(); S.open = null;
  saveCfg(); updateGo(); if (S.scan) renderResult();
}
function priceUrls(items, locs) {
  const host = apiHost(cfg.server), loc = (locs || [cfg.src, cfg.dst]).map(encodeURIComponent).join(','), urls = [];
  const g = items.filter(i => i.gear).map(i => i.id), r = items.filter(i => !i.gear).map(i => i.id);
  for (const c of chunkIds(g, 3300)) urls.push(`${host}/api/v2/stats/prices/${c.join(',')}.json?locations=${loc}&qualities=1,2,3,4,5`);
  for (const c of chunkIds(r, 3300)) urls.push(`${host}/api/v2/stats/prices/${c.join(',')}.json?locations=${loc}&qualities=1`);
  return urls;
}
function updateGo() {
  const items = buildItems(cfg), n = items.length, req = n ? priceUrls(items).length : 0;
  const go = $('#go');
  go.textContent = S.busy ? 'Проверяю цены…' : !S.scan ? 'Собрать груз' : (S.scan.key !== scanKey() ? 'Собрать груз заново' : 'Обновить цены');
  go.disabled = S.busy || !n;
  const cg = $('#cmpgo'); if (cg) { cg.disabled = S.busy || !n; cg.textContent = S.busy && S.comparing ? 'Сравниваю города…' : 'Сравнить все города закупки'; }
  $('#gocap').textContent = !n ? 'В выбранных категориях нет предметов с такими тирами и зачарованием'
    : `${fmt(n)} предметов, ${req + 2} запросов к базе цен` + (req > 60 ? `, около ${Math.round(req * 0.4)} секунд` : '');
}

/* ---------- сеть ---------- */
let lastStart = 0;
async function gate() { const now = Date.now(), wait = Math.max(0, lastStart + 330 - now); lastStart = now + wait; if (wait) await sleep(wait); }
async function getJSON(url) {
  for (let i = 0; ; i++) {
    await gate();
    const ac = new AbortController(), tm = setTimeout(() => ac.abort(), 30000);
    let r;
    try { r = await fetch(url, { signal: ac.signal }); } finally { clearTimeout(tm); }
    if (r.status === 429 && i < 2) { await sleep(9000 * (i + 1)); continue; }
    if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
    return r.json();
  }
}
async function pooled(urls, onRows) {
  let next = 0;
  const worker = async () => { while (next < urls.length) { const i = next++; onRows(await getJSON(urls[i])); } };
  await Promise.all(Array.from({ length: Math.min(4, urls.length) }, worker));
}
function progress(f) { const bar = $('#bar'); bar.hidden = f == null; if (f != null) bar.firstElementChild.style.width = Math.round(f * 100) + '%'; }

async function scan(demo, quiet) {
  if (S.busy) return;
  const items = buildItems(cfg); if (!items.length) return;
  S.busy = true; S.error = null; S.histFail = false; updateGo(); progress(0.02);
  const key = scanKey(), route = routeKey(), now = Date.now(), prices = {}, hist = {};
  let err = null;
  try {
    if (demo) {
      const d = demoData(items, cfg, now); indexPrices(d.rows, prices); indexHistory(d.hist, hist, now); await sleep(300);
    } else {
      const urls = priceUrls(items); let done = 0;
      await pooled(urls, rows => { indexPrices(rows, prices); progress(0.02 + 0.8 * (++done / urls.length)); });
      const pre = computeCandidates(items, prices, cfg, now).slice(0, 220);
      const gearIds = [...new Set(pre.filter(c => c.item.gear).map(c => c.id))], resIds = [...new Set(pre.filter(c => !c.item.gear).map(c => c.id))];
      const d0 = new Date(now - 9 * 864e5), date = `${d0.getUTCMonth() + 1}-${d0.getUTCDate()}-${d0.getUTCFullYear()}`;
      const host = apiHost(cfg.server), loc = encodeURIComponent(cfg.dst), hurls = [];
      for (const c of chunkIds(gearIds, 3300)) hurls.push(`${host}/api/v2/stats/history/${c.join(',')}.json?locations=${loc}&qualities=1,2,3,4,5&time-scale=24&date=${date}`);
      for (const c of chunkIds(resIds, 3300)) hurls.push(`${host}/api/v2/stats/history/${c.join(',')}.json?locations=${loc}&qualities=1&time-scale=24&date=${date}`);
      try { let hd = 0; await pooled(hurls, rows => { indexHistory(rows, hist, now); progress(0.82 + 0.18 * (++hd / hurls.length)); }); }
      catch (e) { S.histFail = true; }
    }
  } catch (e) { err = e; }
  S.busy = false; progress(null);
  if (err) {
    S.error = err.status === 429 ? 'limit' : (err.status ? 'http' + err.status : 'net');
    updateGo(); renderResult(); return;
  }
  if (S.scan && S.scan.route !== route) { S.locked.clear(); S.excluded.clear(); }
  S.scan = { key, route, time: now, prices, hist, items, demo: !!demo, src: cfg.src, dst: cfg.dst };
  S.open = null; updateGo(); recalc();
  if (!demo && !sameCity()) { activityRefresh(); if (!ACT.remote || !ACT.remote[cfg.server]) activityFromSite(); }
  if (quiet) toast('Цены обновлены ' + hhmm(now)); else if (window.matchMedia('(max-width: 979px)').matches) $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}


/* ---------- где сейчас выгоднее ---------- */
const cmpKey = () => JSON.stringify([cfg.server, cfg.dst, [...cfg.cats].sort(), [...cfg.tiers].sort(), [...cfg.enchs].sort()]);
function riskFor(src) { if (src === 'Caerleon' && cfg.dst === 'Black Market') return 0; const r = ['Caerleon', 'Black Market', 'Brecilien']; return (r.includes(src) || r.includes(cfg.dst)) ? 10 : 1; }
async function compareCities(demo) {
  if (S.busy) return;
  const items = buildItems(cfg); if (!items.length) return;
  const srcs = CITIES.filter(c => !c.sellOnly && c.id !== cfg.dst).map(c => c.id);
  S.busy = true; S.comparing = true; S.error = null; updateGo(); progress(0.02);
  const now = Date.now(), prices = {}, hist = {};
  try {
    if (demo) {
      for (const city of srcs) { const d = demoData(items, Object.assign({}, cfg, { src: city }), now + city.length); indexPrices(d.rows.filter(r => r.city === city), prices); if (city === srcs[0]) { indexPrices(d.rows.filter(r => r.city === cfg.dst), prices); indexHistory(d.hist, hist, now); } }
    } else {
      const urls = priceUrls(items, [...srcs, cfg.dst]); let done = 0;
      await pooled(urls, rows => { indexPrices(rows, prices); progress(0.02 + 0.8 * (++done / urls.length)); });
      const ids = new Set();
      for (const city of srcs) computeCandidates(items, prices, Object.assign({}, cfg, { src: city }), now).slice(0, 60).forEach(c => ids.add(c.id));
      const d0 = new Date(now - 9 * 864e5), date = `${d0.getUTCMonth() + 1}-${d0.getUTCDate()}-${d0.getUTCFullYear()}`, host = apiHost(cfg.server);
      const gid = [...ids].filter(id => items.find(i => i.id === id).gear), rid = [...ids].filter(id => !gid.includes(id)), hurls = [];
      for (const c of chunkIds(gid, 3300)) hurls.push(`${host}/api/v2/stats/history/${c.join(',')}.json?locations=${encodeURIComponent(cfg.dst)}&qualities=1,2,3,4,5&time-scale=24&date=${date}`);
      for (const c of chunkIds(rid, 3300)) hurls.push(`${host}/api/v2/stats/history/${c.join(',')}.json?locations=${encodeURIComponent(cfg.dst)}&qualities=1&time-scale=24&date=${date}`);
      try { let hd = 0; await pooled(hurls, rows => { indexHistory(rows, hist, now); progress(0.82 + 0.18 * (++hd / hurls.length)); }); } catch (e) { S.histFail = true; }
    }
  } catch (e) { S.error = e.status === 429 ? 'limit' : (e.status ? 'http' + e.status : 'net'); S.busy = false; S.comparing = false; progress(null); updateGo(); return renderResult(); }
  const rows = srcs.map(city => {
    const c = Object.assign({}, cfg, { src: city }), cands = computeCandidates(items, prices, c, now); applyHistory(cands, hist);
    const g = routeRisk(city, cfg.dst).p; c.riskP = g / 100; const plan = makePlan(cands, c, new Map(), new Set()), rm = riskMath(plan.totals, g, cfg.minutes);
    return { city, t: plan.totals, n: plan.rows.length, top: plan.rows[0] ? plan.rows[0].cand.item.name + ' ' + tierLabel(plan.rows[0].cand.item) : '', gank: g, ev: rm.ev };
  }).sort((a, b) => b.ev - a.ev);
  S.compare = { key: cmpKey(), time: now, rows, prices, hist, items, demo: !!demo };
  S.busy = false; S.comparing = false; progress(null);
  if (rows[0] && rows[0].n) pickCity(rows[0].city); else { updateGo(); renderResult(); }
}
function pickCity(city) {
  const C = S.compare; cfg.src = city; $('#src').value = city; Object.assign(cfg, routeDefaults()); saveCfg();
  S.locked.clear(); S.excluded.clear(); S.open = null;
  S.scan = { key: scanKey(), route: routeKey(), time: C.time, prices: C.prices, hist: C.hist, items: C.items, demo: C.demo, src: city, dst: cfg.dst };
  updateGo(); recalc();
}
function compareHTML() {
  const C = S.compare; if (!C || C.key !== cmpKey()) return '';
  return `<div class="sheet" style="margin-bottom:16px"><div class="sheethead"><h2>Где сейчас выгоднее</h2><span>сдать в ${esc(cityName(cfg.dst))}, цены в ${hhmm(C.time)}</span></div>
    <table class="cmp"><thead><tr><th>Купить в</th><th>Прибыль</th><th>С учётом риска</th><th>Вложить</th></tr></thead><tbody>
    ${C.rows.map(r => `<tr class="${r.city === cfg.src && S.scan && S.scan.src === r.city ? 'sel' : ''}"><td><button type="button" data-act="pick" data-city="${esc(r.city)}">${esc(cityName(r.city))}</button><small>${r.n ? esc(r.top) + (r.n > 1 ? ' и ещё ' + (r.n - 1) : '') : 'ничего выгодного'}</small></td>
      <td>${r.n ? fmtShort(r.t.exp) : '—'}</td><td class="${r.ev >= 0 ? 'pos' : 'negc'}">${r.n ? (r.ev >= 0 ? '' : '−') + fmtShort(Math.abs(r.ev)) : '—'}<small>риск ${r.gank}%</small></td><td>${r.n ? fmtShort(r.t.cost) : '—'}</td></tr>`).join('')}
    </tbody></table><p class="imeta" style="margin-top:8px">Риск берётся из твоего журнала по каждому маршруту, а пока рейсов мало — обычный: 10% через красные и чёрные зоны, 1% между королевскими городами. Нажми на город, чтобы открыть его накладную.</p></div>`;
}

/* ---------- расчёт и вывод ---------- */
/* Шанс потерять груз: по твоему журналу на этом маршруте, пока рейсов мало — с поправкой на обычный риск маршрута */
function riskDefault(src, dst) { if (src === 'Caerleon' && dst === 'Black Market') return 0; const r = ['Caerleon', 'Black Market', 'Brecilien']; return (r.includes(src) || r.includes(dst)) ? 10 : 1; }
function routeRisk(src, dst) {
  src = src || cfg.src; dst = dst || cfg.dst;
  if (src === 'Caerleon' && dst === 'Black Market') return { p: 0, n: 0, lost: 0, src: 'safe' };
  if (cfg.manualRisk) return { p: cfg.gank, n: 0, lost: 0, src: 'manual' };
  const j = LS.get('karavan.journal', []).filter(r => r.src === src && r.dst === dst && (r.server || 'europe') === cfg.server && !r.demo);
  const n = j.length, lost = j.filter(r => r.lost).length, prior = riskDefault(src, dst) / 100, k = 5, act = activityNow();
  const base = (lost + prior * k) / (n + k), p = Math.min(0.6, base * (act ? act.factor : 1));
  return { p: Math.round(p * 1000) / 10, base: Math.round(base * 1000) / 10, n, lost, act, src: n ? 'journal' : 'default' };
}
/* Активность сервера: убийства в минуту по киллборду сейчас против обычных для этого часа (прайм-тайм) */
const ACT = { busy: false };
async function activityRefresh() {
  if (ACT.busy || typeof giPage !== 'function') return;
  const store = LS.get('karavan.activity', []), last = store.filter(x => x.server === cfg.server).slice(-1)[0];
  if (last && Date.now() - last.ts < 10 * 60000) return;
  ACT.busy = true;
  try {
    const evs = [].concat(await giPage(0), await giPage(51)).filter(e => e && e.TimeStamp);
    const ts = evs.map(e => Date.parse(e.TimeStamp)).filter(isFinite).sort((a, b) => a - b);
    if (ts.length > 20) {
      const mins = Math.max(1, (ts[ts.length - 1] - ts[0]) / 6e4);
      const fresh = Date.now() - ts[ts.length - 1] < 60 * 60000;
      if (fresh) { store.push({ ts: Date.now(), server: cfg.server, hour: new Date().getUTCHours(), rate: ts.length / mins }); LS.set('karavan.activity', store.filter(x => Date.now() - x.ts < 30 * 864e5).slice(-2000)); }
    }
  } catch (e) { }
  ACT.busy = false;
  if (S.scan) recalc();
}
async function activityFromSite() {
  try {
    const r = await fetch('https://enotsbeye.github.io/karavan-albion/data/activity-' + cfg.server + '.json?t=' + Math.floor(Date.now() / 6e5), { cache: 'no-store' });
    if (r.ok) { ACT.remote = ACT.remote || {}; ACT.remote[cfg.server] = (await r.json()).map(x => Object.assign({ server: cfg.server }, x)); if (S.scan) recalc(); }
  } catch (e) { }
}
function activityNow() {
  const local = LS.get('karavan.activity', []).filter(x => x.server === cfg.server), remote = (ACT.remote && ACT.remote[cfg.server]) || [];
  const store = local.concat(remote).sort((a, b) => a.ts - b.ts), last = store.slice(-1)[0];
  if (!last || Date.now() - last.ts > 60 * 60000) return null;
  const same = store.filter(x => x !== last && x.hour === last.hour).map(x => x.rate).sort((a, b) => a - b);
  const all = store.filter(x => x !== last).map(x => x.rate).sort((a, b) => a - b);
  const base = same.length >= 3 ? same[Math.floor(same.length / 2)] : null, day = all.length >= 6 ? all[Math.floor(all.length / 2)] : null;
  const factor = base ? Math.min(2.5, Math.max(0.5, last.rate / base)) : 1;
  return { rate: last.rate, base, day, factor, samples: same.length, prime: day ? last.rate > day * 1.25 : null };
}
function planCfg() { const base = Object.assign({}, cfg, S.scan ? { src: S.scan.src, dst: S.scan.dst } : {}); base.riskP = routeRisk(base.src, base.dst).p / 100; return base; }
function recalc() {
  if (!S.scan) { renderResult(); return; }
  const c = planCfg();
  S.cands = computeCandidates(S.scan.items, S.scan.prices, c, Date.now());
  applyHistory(S.cands, S.scan.hist);
  S.plan = makePlan(S.cands, c, S.locked, S.excluded);
  renderResult();
}
const hhmm = t => new Date(t).toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit' });

function errorHTML() {
  const txt = S.error === 'limit' ? 'База цен просит подождать: слишком много запросов за короткое время. Попробуй через минуту.'
    : S.error === 'net' ? 'Не получилось связаться с базой цен. Если Караван открыт внутри чата или другого приложения, сеть там закрыта: скачай файл и открой его в обычном браузере. Иначе проверь интернет.'
      : 'База цен ответила ошибкой (' + esc(S.error.replace('http', '')) + '). Обычно это проходит само, попробуй ещё раз чуть позже.';
  return `<div class="note err">${txt}<br><button type="button" data-act="retry">Попробовать ещё раз</button> <button type="button" data-act="demo">Посмотреть на выдуманных ценах</button></div>`;
}
function emptyHTML() {
  return `<div class="empty"><h2>Что везти в этот рейс?</h2><ol>
    <li>Укажи маршрут, серебро и свободный вес.</li>
    <li>Нажми «Собрать груз». Караван проверит цены и подберёт набор, который даёт больше всего прибыли и влезает в лимиты.</li>
    <li>Покупай по списку и отмечай купленное. Если цена в игре другая, вычеркни позицию, и остаток груза пересоберётся.</li>
  </ol></div>`;
}
function gaugeHTML(label, used, cap, unit) {
  if (!isFinite(cap)) return `<div class="gauge"><div class="gl"><span>${label}</span><span>${used} ${unit}, лимит не задан</span></div></div>`;
  const pct = cap > 0 ? Math.min(100, used.raw / cap * 100) : 0;
  return `<div class="gauge"><div class="gl"><span>${label}</span><span>${used.txt} из ${used.capTxt} ${unit}</span></div><div class="gt"><i style="width:${pct.toFixed(1)}%"></i></div></div>`;
}
function detailHTML(r, pc) {
  const c = r.cand, it = c.item, order = pc.mode === 'order';
  const sellLine = (it.gear && !order ? 'ордер «' + QN[c.qs] + '», ' : '') + fmt(c.sell);
  let h = `<div class="idet"><dl>
    <div><dt>Купить: ${esc(cityName(pc.src))}</dt><dd>${it.gear ? QN[c.qb] + ', ' : ''}около ${fmt(c.buy)}</dd></div>
    <div><dt>${order ? 'Выставить' : 'Сдать'}: ${esc(cityName(pc.dst))}</dt><dd>${sellLine}</dd></div>
    <div><dt>Потолок цены закупки</dt><dd>${fmt(c.net)}</dd></div>
    <div><dt>Чистыми с первой штуки</dt><dd>+${fmt(c.profit)} (${(c.roi * 100).toFixed(0)}%)</dd></div>
    <div><dt>Продаётся за день</dt><dd>${c.vol != null ? 'около ' + fmt(c.vol) + ' шт.' : 'нет данных'}</dd></div>
    <div><dt>Средняя цена сделок за неделю</dt><dd>${c.avg ? fmt(c.avg) : 'нет данных'}</dd></div>
    <div><dt>Цена закупки записана</dt><dd>${fmtAge(c.ageB)} назад</dd></div>
    <div><dt>Цена сбыта записана</dt><dd>${fmtAge(c.ageS)} назад</dd></div>
    <div><dt>Вес позиции</dt><dd>${(Math.round(r.weight * 10) / 10).toLocaleString(LOC)} кг</dd></div>
    <div><dt>Доверие к ценам</dt><dd>${Math.round(c.conf * 100)}%</dd></div>
  </dl>`;
  if (r.locked) {
    h += `<div class="bought">
      <div><label>Куплено, шт.</label><span class="step"><button type="button" data-act="dec" aria-label="Меньше">−</button><b>${fmt(r.qty)}</b><button type="button" data-act="inc" aria-label="Больше">+</button></span></div>
      <div><label for="ap">Цена за штуку по факту</label><input id="ap" type="text" inputmode="text" data-act="price" placeholder="${fmt(r.cost / r.qty)}" value="${r.actualBuy ? fmt(r.actualBuy) : ''}"></div>
      <button type="button" class="tbtn quiet" data-act="unlock">Снять отметку</button>
    </div>`;
  } else {
    h += `<div class="bought"><button type="button" class="tbtn solid" data-act="lockbtn">Куплено</button><button type="button" class="tbtn quiet" data-act="exclude">Вычеркнуть: цена в игре другая</button></div>`;
  }
  return h + '</div>';
}
function rowHTML(r, pc) {
  const c = r.cand, it = c.item, open = S.open === r.key;
  const dot = c.conf >= 0.55 ? 'g' : c.conf >= 0.25 ? 'a' : 'r';
  return `<div class="item${r.locked ? ' done' : ''}" data-key="${esc(r.key)}">
    <div class="irow">
      <input type="checkbox" class="chk" data-act="lock" ${r.locked ? 'checked' : ''} aria-label="Куплено: ${esc(it.name)} ${tierLabel(it)}">
      <span class="ic">${tierLabel(it)}<img loading="lazy" alt="" src="https://render.albiononline.com/v1/item/${c.id}.png?size=64&amp;quality=${c.qb}" onerror="this.remove()"></span>
      <button type="button" class="imain" data-act="open" aria-haspopup="dialog">
        <div class="iname">${esc(it.name)}</div>
        <div class="imeta"><b>${tierLabel(it)}</b>${it.gear ? ', ' + QN[c.qb].toLowerCase() : ''}, <b>${fmt(r.qty)} шт.</b> по ${fmt(r.cost / r.qty)}</div>
        <div class="imeta"><span class="dot ${dot}"></span>цены ${fmtAge(c.ageB)} и ${fmtAge(c.ageS)} назад</div>
      </button>
      <div class="iprofit"><b>+${fmtShort(r.profit)}</b><span>${fmtShort(r.cost)}</span></div>
    </div>${r.locked && open ? detailHTML(r, pc) : ''}
  </div>`;
}
function riskFactsHTML() {
  const rk = routeRisk(planCfg().src, planCfg().dst), t = S.plan.totals, rm = riskMath(t, rk.p, cfg.minutes), out = [];
  if (rk.p > 0 && S.cands.length) {
    const p = rk.p / 100, cut = S.cands.filter(c => c.profit * c.conf >= cfg.minPosProfit && c.profit * c.conf * (1 - p) - p * c.buy <= 0).length;
    if (cut) out.push(`<div>Из-за риска не взято позиций с маленькой наценкой: <b>${cut}</b>. Если груз отнимут, они бы не окупились.</div>`);
  }
  if (!sameCity()) {
    out.push(`<div>С учётом риска рейс в среднем даёт <b class="${rm.ev >= 0 ? 'pos' : 'negc'}">${rm.ev >= 0 ? '+' : '−'}${fmt(Math.abs(rm.ev))}</b></div>`);
    out.push(`<div>Один потерянный груз съедает прибыль <b>${isFinite(rm.runsPerGank) ? Math.ceil(rm.runsPerGank) : '—'}</b> удачных рейсов</div>`);
    out.push(`<div>Рейс выгоден, пока шанс потери ниже <b>${rm.breakEven.toFixed(0)}%</b></div>`);
  }
  if (rm.perHour != null) out.push(`<div>Это около <b>${fmtShort(rm.perHour)}</b> серебра в час</div>`);
  return out.join('');
}
function updateRisk() { const el = $('#riskfacts'); if (el && S.plan) el.innerHTML = riskFactsHTML(); const o = $('#gankOut'); if (o) o.textContent = cfg.gank + '%'; }
function riskSourceHTML(rk) {
  if (rk.src === 'manual') return `Ты задал шанс вручную. <button type="button" class="linkbtn" data-act="riskauto">Считать по журналу</button>`;
  const base = rk.src === 'journal' ? `По твоему журналу: на этом маршруте ${rk.n} ${plural(rk.n, 'рейс', 'рейса', 'рейсов')}, груз потерян ${rk.lost} ${plural(rk.lost, 'раз', 'раза', 'раз')}.${rk.n < 10 ? ' Рейсов пока мало, поэтому оценка смешана с обычным риском маршрута.' : ''}`
    : 'Рейсов по этому маршруту в журнале ещё нет, поэтому взят обычный риск маршрута. Завершай рейсы через «Завершить рейс», и оценка станет твоей.';
  const a = rk.act;
  const actTxt = !a ? ' Активность сервера ещё не замерена.'
    : ` Сейчас на сервере ${a.rate.toFixed(1).replace('.', ',')} убийств в минуту${a.base ? `, это в ${a.factor.toFixed(1).replace('.', ',')} раза ${a.factor >= 1 ? 'больше' : 'меньше'} обычного для этого часа, поэтому риск ${a.factor >= 1 ? 'повышен' : 'снижен'} с ${String(rk.base).replace('.', ',')}%` : `. Для сравнения с обычным уровнем нужно ещё ${3 - a.samples} ${plural(3 - a.samples, 'замер', 'замера', 'замеров')} в этот же час в другие дни`}${a.prime ? '. Похоже на прайм-тайм' : ''}.`;
  return base + actTxt + ` <button type="button" class="linkbtn" data-act="riskmanual">Задать вручную</button>`;
}

function renderResult() {
  const el = $('#result'); let h = '';
  if (S.error) h += errorHTML();
  h += compareHTML();
  if (!S.scan) { el.innerHTML = h + (S.compare && S.compare.key === cmpKey() ? '' : emptyHTML()); return; }
  const pc = planCfg(), p = S.plan, t = p.totals;
  if (S.scan.demo) h += `<div class="note warn">Демо: все цены ниже выдуманы, чтобы показать, как выглядит накладная. Настоящие цены загрузятся, когда файл открыт в браузере с интернетом.</div>`;
  if (S.scan.key !== scanKey()) h += `<div class="note warn">Ты поменял маршрут или набор товаров. Накладная ниже собрана по прежним условиям, нажми «Собрать груз заново».</div>`;
  if (S.histFail) h += `<div class="note warn">Объёмы продаж не загрузились, поэтому Караван берёт по одной штуке каждой вещи.</div>`;
  if (!p.rows.length) {
    h += `<div class="empty"><h2>Выгодного груза не нашлось</h2><p>${S.cands.length ? 'Прибыльные позиции есть (' + S.cands.length + '), но они не проходят по серебру, весу или минимальной прибыли.' : 'На этом маршруте сейчас нет позиций, которые проходят фильтры.'} Что можно сделать:</p><ol style="list-style:disc">
      <li>добавить тиры, зачарования или категории;</li><li>в тонкой настройке разрешить цены постарше;</li><li>выбрать другой город закупки.</li></ol></div>`;
    el.innerHTML = h; return;
  }
  const adj = t.profit > 0 ? Math.round((1 - t.exp / t.profit) * 100) : 0;
  const roi = t.cost > 0 ? (t.profit / t.cost * 100) : 0;
  const nLocked = p.rows.filter(r => r.locked).length;
  h += `<div class="sheet">
    <div class="sheethead"><h2>Накладная</h2><span>${esc(cityName(pc.src))} → ${esc(cityName(pc.dst))}, цены загружены в ${hhmm(S.scan.time)}</span></div>
    <div class="sum">
      <div class="big"><span>Ожидаемая прибыль с рейса</span><b>${fmt(t.exp)}</b><small>По ценам из базы ${fmt(t.profit)}. Поправка на устаревшие цены: −${adj}%</small></div>
      <div>
        <dl class="kv"><div><dt>Вложить</dt><dd>${fmtShort(t.cost)}</dd></div><div><dt>Вернётся</dt><dd>${fmtShort(t.net)}</dd></div><div><dt>Доходность</dt><dd>${roi.toFixed(0)}%</dd></div></dl>
        ${gaugeHTML('Серебро', { raw: t.cost, txt: fmtShort(t.cost), capTxt: fmtShort(p.budget) }, p.budget, '')}
        ${isFinite(p.weightCap) ? gaugeHTML('Вес', { raw: t.weight, txt: Math.round(t.weight), capTxt: Math.round(p.weightCap) }, p.weightCap, 'кг') : gaugeHTML('Вес', Math.round(t.weight), Infinity, 'кг')}
      </div>
    </div>
    <div class="risk">
      <h3>Риск дороги</h3>
      ${sameCity() ? '<div style="font-size:14px">Чёрный рынок стоит в Каэрлеоне: везти груз через зоны не нужно.</div>'
      : (() => { const rk = routeRisk(pc.src, pc.dst); return `<div class="riskbig"><b>${String(rk.p).replace('.', ',')}%</b><span>шанс потерять груз за рейс</span></div><p class="imeta" style="margin:6px 0 0">${riskSourceHTML(rk)}</p>
        ${rk.src === 'manual' ? `<div class="riskctl" style="margin-top:8px"><input id="gank" type="range" min="0" max="40" step="1" value="${cfg.gank}" aria-label="Шанс потерять груз за один рейс"><output id="gankOut" for="gank">${cfg.gank}%</output></div>` : ''}
        <p class="imeta" style="margin:6px 0 0">Риск учтён в грузе: Караван выбирает вещи так, чтобы рейс окупался даже с учётом потерь.</p>`; })()}
      <div class="mins"><label for="minutes">Минут на рейс</label><input id="minutes" type="number" min="1" step="1" value="${cfg.minutes}"></div>
      <div class="riskfacts" id="riskfacts">${riskFactsHTML()}</div>
    </div>
    <div class="list">
      <div class="listhead"><h3>Что купить</h3><span>${nLocked ? 'куплено ' + nLocked + ' из ' + p.rows.length : p.rows.length + ' ' + plural(p.rows.length, 'позиция', 'позиции', 'позиций')}</span></div>
      ${p.rows.map(r => rowHTML(r, pc)).join('')}
    </div>
    <div class="acts">
      <button type="button" class="tbtn solid" data-act="finish">Завершить рейс</button>
      <button type="button" class="tbtn" data-act="copy">Скопировать список</button>
      ${S.excluded.size ? `<button type="button" class="tbtn quiet" data-act="restore">Вернуть вычеркнутые (${S.excluded.size})</button>` : ''}
    </div>
    ${p.leftovers.length ? `<details class="left"><summary>Не вошло в груз: ещё ${p.leftovers.length}</summary><ul>${p.leftovers.map(l => `<li>${esc(l.cand.item.name)} ${tierLabel(l.cand.item)}: +${fmt(l.cand.profit)} со штуки, ${l.reason}</li>`).join('')}</ul></details>` : ''}
  </div>`;
  el.innerHTML = h;
}
function plural(n, a, b, c) { const m = n % 100, k = n % 10; return (m > 10 && m < 20) ? c : k === 1 ? a : (k >= 2 && k <= 4) ? b : c; }


/* ---------- карточка позиции ---------- */
function spark(pts, now, mark) {
  if (!pts || pts.length < 2) return '<div class="imeta">Истории цен за неделю нет</div>';
  const W = 300, H = 70, ps = pts.map(p => p.p).concat(mark ? [mark] : []), lo = Math.min(...ps), hi = Math.max(...ps), span = hi - lo || 1;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1, x = t => 4 + (W - 8) * (t - t0) / Math.max(1, t1 - t0), y = v => 6 + (H - 12) * (1 - (v - lo) / span);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + x(p.t).toFixed(1) + ' ' + y(p.p).toFixed(1)).join(' ');
  const my = mark ? y(mark) : null;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="Средняя цена сделок по дням">
    ${mark ? `<line x1="0" x2="${W}" y1="${my.toFixed(1)}" y2="${my.toFixed(1)}" stroke="currentColor" stroke-dasharray="4 4" stroke-width="1.5"/>` : ''}
    <path d="${line}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>
    ${pts.map(p => `<circle cx="${x(p.t).toFixed(1)}" cy="${y(p.p).toFixed(1)}" r="2.6" fill="currentColor"/>`).join('')}</svg>
    <div class="sparkcap"><span>${new Date(t0).toLocaleDateString(LOC, { day: 'numeric', month: 'short' })}</span><span>${mark ? '<i class="sw"></i>цена сейчас' : ''}</span><span>${new Date(t1).toLocaleDateString(LOC, { day: 'numeric', month: 'short' })}</span></div>`;
}
function qtyReason(r, pc) {
  const c = r.cand, { cap, lot } = capFor(c, pc), units = buildUnits(c, pc).units.length * lot;
  if (r.locked) return `Ты отметил ${fmt(r.qty)} шт. как купленные.`;
  if (r.qty >= cap) {
    if (c.vol == null) return c.item.gear ? 'Нет данных, сколько этого продаётся в день, поэтому Караван берёт осторожный минимум: одну штуку.' : 'Нет данных об объёме продаж, поэтому взята небольшая партия.';
    const byVol = Math.floor(c.vol * pc.share / 100);
    if (c.item.gear && byVol >= pc.maxPerPos) return `Продаётся около ${fmt(c.vol)} шт. в день, но в настройках стоит не больше ${pc.maxPerPos} шт. одной вещи. Так рынок не просядет от твоих же продаж.`;
    return `Продаётся около ${fmt(c.vol)} шт. в день. Караван берёт не больше ${pc.share}% дневного объёма, это ${fmt(Math.max(1, byVol))} шт., чтобы груз точно разошёлся.`;
  }
  if (r.qty >= units) return `Каждая следующая штука считается дороже в закупке и дешевле в продаже на ${pc.slip}%, а на ${fmt(r.qty + lot)}-й прибыль уже ниже порога ${pc.minRoi}%.`;
  const t = S.plan.totals, leftB = S.plan.budget - t.cost, leftW = S.plan.weightCap - t.weight;
  const needB = c.buy * lot > leftB, needW = c.item.w * lot > leftW;
  return needB && needW ? 'Больше не влезло: закончились и серебро, и свободный вес. Серебро ушло на позиции с более высокой прибылью.'
    : needW ? `Больше не влезло по весу: одна штука весит ${c.item.w.toLocaleString(LOC)} кг, а свободно ${Math.max(0, Math.round(leftW))} кг.`
      : 'Больше не влезло по серебру: остаток бюджета ушёл на позиции, которые дают больше прибыли на вложенное серебро.';
}
function cardHTML(r, pc) {
  const c = r.cand, it = c.item, order = pc.mode === 'order', rank = S.plan.rows.indexOf(r) + 1, fee = feeRate(pc);
  const conf = Math.round(c.conf * 100), confTxt = conf >= 55 ? 'цены свежие, им можно доверять' : conf >= 25 ? 'цены не первой свежести, сверь в игре' : 'цены старые, сверь обязательно';
  const avgTxt = c.avg ? (() => { const d = (c.sell - c.avg) / c.avg * 100; return Math.abs(d) < 5 ? 'на уровне средней за неделю' : d > 0 ? `на ${d.toFixed(0)}% выше средней за неделю: возможно, ордер скоро уйдёт` : `на ${(-d).toFixed(0)}% ниже средней за неделю`; })() : 'средней за неделю нет';
  const shareOfCargo = S.plan.totals.cost > 0 ? r.cost / S.plan.totals.cost * 100 : 0;
  return `<div class="cardtop"><span class="ic big">${tierLabel(it)}<img alt="" src="https://render.albiononline.com/v1/item/${c.id}.png?size=128&amp;quality=${c.qb}" onerror="this.remove()"></span>
      <div><h3>${esc(it.name)}</h3><div class="imeta"><b>${tierLabel(it)}</b>${it.gear ? ', ' + QN[c.qb].toLowerCase() : ''} · ${esc(cityName(pc.src))} → ${esc(cityName(pc.dst))}</div>
      <div class="cardprofit">+${fmt(r.profit)}<span> за ${fmt(r.qty)} шт., ожидаемо +${fmt(r.exp)}</span></div></div>
      <button type="button" class="x" data-close aria-label="Закрыть">✕</button></div>
    <section class="cs"><h4>Почему эта вещь</h4>
      <p>Место №${rank} в грузе по ожидаемой прибыли. С каждой штуки остаётся <b>+${fmt(c.profit)}</b> чистыми (${(c.roi * 100).toFixed(0)}% к закупке) после налога ${(fee * 100).toFixed(1).replace('.', ',')}%.</p>
      <dl class="cdl"><div><dt>Купить</dt><dd>${fmt(c.buy)}</dd></div><div><dt>${order ? 'Выставить за' : 'Сдать за'}</dt><dd>${fmt(c.sell)}</dd></div><div><dt>Не дороже</dt><dd>${fmt(c.net)}</dd></div></dl>
      <p class="imeta">«Не дороже» — цена закупки, выше которой позиция перестаёт приносить прибыль.${it.gear && !order && c.qs < c.qb ? ` Ордер на Чёрном рынке принимает качество «${QN[c.qs].toLowerCase()}» и выше, поэтому подходит и твоё «${QN[c.qb].toLowerCase()}».` : ''}</p></section>
    <section class="cs"><h4>Почему ${fmt(r.qty)} шт.</h4><p>${qtyReason(r, pc)}</p></section>
    <section class="cs"><h4>Цена за неделю</h4>${spark(c.pts, Date.now(), c.sell)}<p class="imeta">Цена сдачи сейчас ${avgTxt}.${c.avg ? ' Средняя ' + fmt(c.avg) + '.' : ''}</p></section>
    <section class="cs"><h4>Можно ли верить ценам</h4>
      <div class="confbar"><i style="width:${conf}%"></i></div>
      <p>Доверие ${conf}%: ${confTxt}. Цену закупки записали ${fmtAge(c.ageB)} назад, цену сдачи ${fmtAge(c.ageS)} назад. Поэтому в ожидаемой прибыли эта позиция учтена как +${fmt(r.exp)}, а не +${fmt(r.profit)}.</p></section>
    <section class="cs"><h4>Риск</h4><p>Позиция занимает ${shareOfCargo.toFixed(0)}% вложений груза (${fmt(r.cost)}) и весит ${(Math.round(r.weight * 10) / 10).toLocaleString(LOC)} кг. ${sameCity() ? 'Везти через опасные зоны не нужно.' : `Если груз отнимут, потеряешь ${fmt(r.cost)} только на этой позиции.`}</p></section>
    <div class="acts">${r.locked ? `<button type="button" class="tbtn quiet" data-cact="unlock">Снять отметку «куплено»</button>` : `<button type="button" class="tbtn solid" data-cact="lock">Куплено</button><button type="button" class="tbtn quiet" data-cact="exclude">Вычеркнуть: цена в игре другая</button>`}</div>`;
}
function openCard(key) {
  const r = rowByKey(key); if (!r) return;
  modal(cardHTML(r, planCfg()), 'card');
  const box = $('#modal .card');
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-cact]'); if (!b) return;
    const a = b.dataset.cact; closeModal();
    if (a === 'lock') S.locked.set(key, { cand: r.cand, qty: r.qty, actualBuy: 0 });
    if (a === 'unlock') S.locked.delete(key);
    if (a === 'exclude') { S.excluded.add(key); S.locked.delete(key); toast('Вычеркнуто, остаток груза пересобран', 'Вернуть', () => { S.excluded.delete(key); recalc(); }); }
    recalc();
  });
}

/* ---------- действия в накладной ---------- */
function rowByKey(key) { return S.plan && S.plan.rows.find(r => r.key === key); }
function onResultClick(e) {
  const a = e.target.closest('[data-act]'); if (!a) return;
  const act = a.dataset.act, itemEl = a.closest('.item'), key = itemEl && itemEl.dataset.key, r = key && rowByKey(key);
  if (act === 'retry') return scan(false);
  if (act === 'demo') return S.lastCompare ? compareCities(true) : scan(true);
  if (act === 'pick') return pickCity(a.dataset.city);
  if (act === 'riskmanual') { cfg.manualRisk = true; cfg.gank = Math.round(routeRisk().p) || cfg.gank; saveCfg(); return recalc(); }
  if (act === 'riskauto') { cfg.manualRisk = false; saveCfg(); return recalc(); }
  if (act === 'open') return openCard(key);
  if (act === 'lock' || act === 'lockbtn' || act === 'unlock') {
    if (!r) return;
    if (S.locked.has(key)) S.locked.delete(key); else S.locked.set(key, { cand: r.cand, qty: r.qty, actualBuy: 0 });
    return recalc();
  }
  if (act === 'inc' || act === 'dec') { const L = S.locked.get(key); if (!L) return; L.qty = Math.max(1, L.qty + (act === 'inc' ? 1 : -1)); return recalc(); }
  if (act === 'exclude') {
    S.excluded.add(key); S.locked.delete(key); S.open = null; recalc();
    return toast('Вычеркнуто, остаток груза пересобран', 'Вернуть', () => { S.excluded.delete(key); recalc(); });
  }
  if (act === 'restore') { S.excluded.clear(); return recalc(); }
  if (act === 'copy') return copyList();
  if (act === 'finish') return finishDialog();
}
function onResultChange(e) {
  const t = e.target;
  if (t.id === 'minutes') { const v = parseFloat(t.value); if (v > 0) { cfg.minutes = v; saveCfg(); updateRisk(); } return; }
  if (t.dataset.act === 'price') { const key = t.closest('.item').dataset.key, L = S.locked.get(key); if (L) { L.actualBuy = parseSilver(t.value); recalc(); } }
}
function onResultInput(e) { if (e.target.id === 'gank') { cfg.gank = Number(e.target.value); saveCfg(); const o = $('#gankOut'); if (o) o.textContent = cfg.gank + '%'; clearTimeout(S.gankT); S.gankT = setTimeout(recalc, 250); } }

function listText() {
  const pc = planCfg(), p = S.plan, order = pc.mode === 'order';
  const lines = [`Караван: ${cityName(pc.src)} → ${cityName(pc.dst)}`];
  for (const r of p.rows) {
    const c = r.cand, it = c.item;
    lines.push(`${r.locked ? '[x]' : '[ ]'} ${fmt(r.qty)} шт. ${it.name} ${tierLabel(it)}${it.gear ? ' (' + QN[c.qb].toLowerCase() + ')' : ''}: купить около ${fmt(c.buy)}, не дороже ${fmt(c.net)}; ${order ? 'выставить за' : 'сдать от'} ${fmt(c.sell)}`);
  }
  lines.push(`Вложить ${fmt(p.totals.cost)}, ожидаемая прибыль ${fmt(p.totals.exp)}`);
  return lines.join('\n');
}
async function copyList() {
  const text = listText();
  try { await navigator.clipboard.writeText(text); toast('Список скопирован'); }
  catch (e) {
    modal(`<h3>Список для копирования</h3><p>Выдели текст и скопируй вручную.</p><textarea readonly>${esc(text)}</textarea><div class="dlgacts"><button type="button" data-close>Закрыть</button></div>`);
    const ta = $('#modal textarea'); ta.focus(); ta.select();
  }
}
function finishDialog() {
  const p = S.plan, bought = p.rows.filter(r => r.locked), rows = bought.length ? bought : p.rows;
  const invested = rows.reduce((s, r) => s + r.cost, 0), net = rows.reduce((s, r) => s + r.net, 0);
  modal(`<h3>Завершить рейс</h3>
    <p>${bought.length ? 'В рейс идут отмеченные позиции: ' + bought.length + '.' : 'Ничего не отмечено купленным, поэтому считаю весь список.'} Вложено ${fmt(invested)}.</p>
    <div class="fld"><label for="rev">Сколько серебра получил с продажи</label><input id="rev" type="text" inputmode="text" value="${fmt(net)}"></div>
    <label class="switch"><input type="checkbox" id="lost"> Груз потерян в дороге</label>
    <div class="dlgacts"><button type="button" data-close>Отмена</button><button type="button" class="pri" id="saveRun">Записать в журнал</button></div>`);
  $('#saveRun').addEventListener('click', () => {
    const lost = $('#lost').checked, revenue = lost ? 0 : parseSilver($('#rev').value);
    const j = LS.get('karavan.journal', []);
    j.unshift({ ts: Date.now(), server: cfg.server, src: S.scan.src, dst: S.scan.dst, invested: Math.round(invested), revenue, profit: Math.round(revenue - invested), lost, n: rows.length, demo: !!S.scan.demo });
    LS.set('karavan.journal', j.slice(0, 500));
    S.locked.clear(); S.excluded.clear(); S.open = null; closeModal(); recalc();
    toast('Рейс записан в журнал');
  });
}

/* ---------- журнал ---------- */
function renderJournal() {
  const j = LS.get('karavan.journal', []), el = $('#tab-journal');
  if (!j.length) { el.innerHTML = `<div class="empty"><h2>Журнал пуст</h2><p>Здесь появятся завершённые рейсы и общий итог. Собери груз, отметь купленное и нажми «Завершить рейс».</p></div>`; return; }
  const total = j.reduce((s, r) => s + r.profit, 0);
  el.innerHTML = `<section class="journal"><h2>Журнал рейсов</h2>
    <div class="jsum"><div><span>Рейсов</span><b>${j.length}</b></div><div><span>Итог</span><b>${fmtShort(total)}</b></div><div><span>В среднем за рейс</span><b>${fmtShort(total / j.length)}</b></div></div>
    ${j.map((r, i) => `<div class="jrow"><div>${esc(cityName(r.src))} → ${esc(cityName(r.dst))}${r.lost ? ', груз потерян' : ''}${r.demo ? ', демо' : ''}<small>${new Date(r.ts).toLocaleString(LOC, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}, вложено ${fmtShort(r.invested)}, позиций: ${r.n}</small></div>
      <div class="p ${r.profit >= 0 ? 'up' : 'down'}">${r.profit >= 0 ? '+' : '−'}${fmtShort(Math.abs(r.profit))}</div><button type="button" data-del="${i}">Удалить</button></div>`).join('')}
  </section>`;
}
function onJournalClick(e) {
  const b = e.target.closest('[data-del]'); if (!b) return;
  const j = LS.get('karavan.journal', []), i = Number(b.dataset.del), gone = j.splice(i, 1)[0];
  LS.set('karavan.journal', j); renderJournal();
  toast('Рейс удалён', 'Вернуть', () => { const k = LS.get('karavan.journal', []); k.splice(i, 0, gone); LS.set('karavan.journal', k); renderJournal(); });
}
function showTab(tab) {
  for (const b of document.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  $('#tab-home').hidden = tab !== 'home'; $('#tab-run').hidden = tab !== 'run'; $('#tab-journal').hidden = tab !== 'journal'; $('#tab-craft').hidden = tab !== 'craft'; $('#tab-farm').hidden = tab !== 'farm'; $('#tab-group').hidden = tab !== 'group'; $('#tab-maps').hidden = tab !== 'maps'; $('#tab-meta').hidden = tab !== 'meta'; $('#tab-profile').hidden = tab !== 'profile';
  $('.how').hidden = tab !== 'run';
  if (tab === 'home') { renderHome(); homeFetch(); }
  if (tab === 'journal') renderJournal();
  window.scrollTo(0, 0);
  if (tab === 'craft') renderCraft();
  if (tab === 'farm') renderFarm();
  if (tab === 'group') { renderGroup(); gmStart(); } else if (typeof gmStop === 'function') gmStop();
  if (tab === 'maps') mpStart(); else if (typeof mpStop === 'function') mpStop();
  if (tab === 'meta') metaOpen();
  if (tab === 'profile') renderProfile();
}

/* ---------- окно и уведомление ---------- */
function modal(html, cls) {
  $('#modal').innerHTML = `<div class="ovl"><div class="${cls || 'dlg'}" role="dialog" aria-modal="true">${html}</div></div>`;
  const first = $('#modal input, #modal textarea, #modal button'); if (first) first.focus();
}
function closeModal() { $('#modal').innerHTML = ''; }
let toastTimer = 0;
function toast(text, actionLabel, action) {
  const el = $('#toast'); clearTimeout(toastTimer);
  el.innerHTML = `<div class="toast" role="status"><span>${esc(text)}</span>${actionLabel ? `<button type="button">${esc(actionLabel)}</button>` : ''}</div>`;
  if (actionLabel) el.querySelector('button').addEventListener('click', () => { el.innerHTML = ''; action(); });
  toastTimer = setTimeout(() => { el.innerHTML = ''; }, actionLabel ? 6000 : 2600);
}


/* ---------- автообновление ---------- */
const AUTO_MS = 5 * 60 * 1000;
function autoTick() {
  if (!cfg.auto || document.hidden) return;
  const now = Date.now(), tab = (document.querySelector('[data-tab][aria-selected="true"]') || {}).dataset;
  const t = tab ? tab.tab : 'run';
  if (t === 'run' && S.scan && !S.scan.demo && !S.busy && now - S.scan.time > AUTO_MS && S.scan.key === scanKey()) { scan(false, true); }
  if (t === 'craft' && typeof CF !== 'undefined' && CF.scan && !CF.scan.demo && !CF.busy && now - CF.scan.time > AUTO_MS) craftScan(false);
  if (t === 'farm' && typeof FM !== 'undefined' && FM.scan && !FM.scan.demo && !FM.busy && now - FM.scan.time > AUTO_MS) farmScan(false);
}
setInterval(autoTick, 30000);
document.addEventListener('visibilitychange', autoTick);

/* ---------- запуск ---------- */
initForm();
renderResult();
$('#result').addEventListener('click', onResultClick);
$('#result').addEventListener('change', onResultChange);
$('#result').addEventListener('input', onResultInput);
$('#tab-journal').addEventListener('click', onJournalClick);
$('#modal').addEventListener('click', e => { if (e.target.classList.contains('ovl') || e.target.closest('[data-close]')) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
