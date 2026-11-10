"use strict";
/* ===== Караван: крафт под Чёрный рынок ===== */
const QP = [0, 0.689, 0.25, 0.056, 0.005]; // примерный шанс качества при крафте: обычное, хорошее, выдающееся, отличное
const RRR = [[15.2, 'Без фокуса'], [24.8, 'Бонус города'], [43.5, 'С фокусом'], [47.9, 'Фокус и бонус города']];
const CDEF = { src: 'Martlock', dst: 'Black Market', budget: 2000000, rrr: 24.8, fee: 0, cats: ['melee', 'ranged', 'magic', 'plate', 'leather', 'cloth', 'offhand', 'cape', 'bag'], tiers: [5, 6, 7], enchs: [0, 1], arts: true, fp: 10000, fdisc: 0 };
const CF = { cfg: Object.assign({}, CDEF, LS.get('karavan.craft', {})), busy: false, scan: null, rows: [], plan: null, open: null, error: null };
for (const k of ['cats', 'tiers', 'enchs']) if (!Array.isArray(CF.cfg[k]) || !CF.cfg[k].length) CF.cfg[k] = CDEF[k].slice();
const cSave = () => LS.set('karavan.craft', CF.cfg);
const matId = (kind, t, e) => kind.startsWith('A:') ? `T${t}_${kind.slice(2)}` : (e ? `T${t}_${kind}_LEVEL${e}@${e}` : `T${t}_${kind}`);
const MATN = { METALBAR: 'Слитки', LEATHER: 'Кожа', CLOTH: 'Ткань', PLANKS: 'Брусья', STONEBLOCK: 'Блоки' };
const matName = (kind, t, e) => kind.startsWith('A:') ? 'Артефакт T' + t : `${MATN[kind] || kind} ${t}.${e}`;

function craftItems(c) {
  const out = [], cats = new Set(c.cats);
  for (const g of DB.gear) {
    const r = DB.rec[g[0]]; if (!r || !cats.has(g[2])) continue;
    const hasArt = r.some(m => m[0].startsWith('A:')); if (hasArt && !c.arts) continue;
    const maxE = g.length > 4 ? g[4] : 4;
    for (const t of c.tiers) for (const e of c.enchs) {
      if (e > maxE) continue;
      out.push({ id: `T${t}_${g[0]}` + (e ? `@${e}` : ''), name: g[1], tier: t, ench: e, cat: g[2], w: g[3][t - 4], gear: true, mats: r.map(m => ({ kind: m[0], n: m[1], ret: !!m[2], id: matId(m[0], t, e), t, e })) });
    }
  }
  return out;
}

function craftCompute(items, P, hist, c, now) {
  const fee = (cfg.premium ? cfg.taxPremium : cfg.taxFree) / 100, rr = c.rrr / 100, rows = [];
  for (const it of items) {
    const D = P[it.id] && P[it.id][c.dst]; if (!D) continue;
    let cost = 0, aMat = 0, ok = true;
    const mats = it.mats.map(m => {
      const s = P[m.id] && P[m.id][c.src] && P[m.id][c.src][1];
      const a = s ? ageH(s.sell_price_min_date, now) : Infinity;
      if (!s || !(s.sell_price_min > 0) || a > cfg.maxAge) { ok = false; return null; }
      const eff = m.n * (m.ret ? 1 - rr : 1);
      cost += eff * s.sell_price_min; aMat = Math.max(aMat, a);
      return Object.assign({}, m, { price: s.sell_price_min, eff, age: a });
    });
    if (!ok) continue;
    cost += c.fee;
    let best = 0, exp = 0, aSell = 0, q1 = 0;
    for (let q = 1; q <= 4; q++) {
      const d = D[q];
      if (d && d.buy_price_max > 0 && ageH(d.buy_price_max_date, now) <= cfg.maxAge) { if (d.buy_price_max > best) { best = d.buy_price_max; aSell = Math.max(aSell, ageH(d.buy_price_max_date, now)); } }
      if (q === 1) q1 = best;
      exp += QP[q] * best;
    }
    if (!(exp > 0)) continue;
    const net = exp * (1 - fee), profit = net - cost, roi = profit / cost;
    if (profit <= 0 || roi * 100 < cfg.minRoi || roi * 100 > cfg.maxRoi) continue;
    let vol = null; for (let q = 1; q <= 5; q++) { const h = hist[it.id + '|' + q]; if (h) vol = (vol || 0) + h.vol; }
    rows.push({ it, mats, cost, exp, q1, net, profit, roi, aMat, aSell, conf: Math.pow(0.5, (aMat + aSell) / cfg.halfLife), vol });
  }
  return rows.sort((a, b) => b.profit * b.conf - a.profit * a.conf);
}

/* План: раздаём бюджет самым выгодным на вложенное серебро позициям, не больше доли дневного объёма */
function craftPlan(rows, c) {
  let left = c.budget; const plan = [];
  const sorted = rows.slice().sort((a, b) => b.roi * b.conf - a.roi * a.conf);
  for (const r of sorted) {
    const cap = r.vol != null ? Math.max(1, Math.floor(r.vol * cfg.share / 100)) : 1;
    const qty = Math.min(cap, Math.floor(left / r.cost));
    if (qty < 1 || r.profit * qty < cfg.minPosProfit) continue;
    plan.push({ r, qty }); left -= r.cost * qty;
    if (plan.length >= 30) break;
  }
  plan.sort((a, b) => b.r.profit * b.qty * b.r.conf - a.r.profit * a.qty * a.r.conf);
  const t = plan.reduce((s, p) => (s.cost += p.r.cost * p.qty, s.profit += p.r.profit * p.qty, s.exp += p.r.profit * p.qty * p.r.conf, s.n += p.qty, s), { cost: 0, profit: 0, exp: 0, n: 0 });
  return { plan, t };
}

function craftUrls(items, c) {
  const host = apiHost(cfg.server), urls = [], mats = new Set();
  for (const it of items) for (const m of it.mats) mats.add(m.id);
  for (const ch of chunkIds([...mats], 3300)) urls.push(`${host}/api/v2/stats/prices/${ch.join(',')}.json?locations=${encodeURIComponent(c.src)}&qualities=1`);
  for (const ch of chunkIds(items.map(i => i.id), 3300)) urls.push(`${host}/api/v2/stats/prices/${ch.join(',')}.json?locations=${encodeURIComponent(c.dst)}&qualities=1,2,3,4`);
  const rids = new Set(); for (const r of DB.refine) if (c.tiers.includes(r[2]) && c.enchs.includes(r[3])) { rids.add(r[0]); for (const m of r[5]) rids.add(m[0]); }
  for (const ch of chunkIds([...rids], 3300)) urls.push(`${host}/api/v2/stats/prices/${ch.join(',')}.json?locations=${encodeURIComponent(c.src)}&qualities=1`);
  return urls;
}

async function craftScan(demo) {
  if (CF.busy) return;
  const c = CF.cfg, items = craftItems(c); if (!items.length) return;
  CF.busy = true; CF.error = null; renderCraft();
  const now = Date.now(), P = {}, H = {};
  try {
    if (demo) {
      const d = demoData(items, { src: c.dst, dst: c.dst }, now); indexPrices(d.rows, P); indexHistory(d.hist, H, now);
      for (const it of items) {
        const D = P[it.id] && P[it.id][c.dst]; if (!D) continue;
        const ref = (D[1] || D[2] || {}).buy_price_max || 0, arts = it.mats.filter(m => !m.ret), units = it.mats.filter(m => m.ret).reduce((s, m) => s + m.n, 0);
        for (const m of it.mats) {
          if (P[m.id]) continue;
          const base = m.ret ? ref * 0.86 / Math.max(units, 1) * (0.8 + 0.4 * ((m.id.length * 7) % 10) / 10) : ref * 0.25 / arts.length;
          indexPrices([{ item_id: m.id, city: c.src, quality: 1, sell_price_min: Math.round(base), sell_price_min_date: new Date(now - 36e5 * (1 + (m.id.length % 6))).toISOString().slice(0, 19) }], P);
        }
      }
      await sleep(250);
    } else {
      const urls = craftUrls(items, c); let done = 0;
      await pooled(urls, rows => { indexPrices(rows, P); setCraftBar(0.05 + 0.8 * (++done / urls.length)); });
      const pre = craftCompute(items, P, {}, c, now).slice(0, 200).map(r => r.it.id);
      const d0 = new Date(now - 9 * 864e5), date = `${d0.getUTCMonth() + 1}-${d0.getUTCDate()}-${d0.getUTCFullYear()}`;
      try { await pooled(chunkIds(pre, 3300).map(ch => `${apiHost(cfg.server)}/api/v2/stats/history/${ch.join(',')}.json?locations=${encodeURIComponent(c.dst)}&qualities=1,2,3,4&time-scale=24&date=${date}`), rows => indexHistory(rows, H, now)); } catch (e) { }
    }
    CF.scan = { time: now, items, P, H, demo: !!demo, src: c.src, dst: c.dst };
    CF.open = null;
  } catch (e) { CF.error = e.status === 429 ? 'limit' : (e.status ? 'http' + e.status : 'net'); }
  CF.busy = false; craftRecalc();
}
function craftRecalc() {
  if (CF.scan) { const c = Object.assign({}, CF.cfg, { src: CF.scan.src, dst: CF.scan.dst }); CF.rows = craftCompute(CF.scan.items, CF.scan.P, CF.scan.H, c, Date.now()); CF.plan = craftPlan(CF.rows, c); }
  renderCraft();
}
function setCraftBar(f) { const b = $('#cbar'); if (b) { b.hidden = false; b.firstElementChild.style.width = Math.round(f * 100) + '%'; } }


/* ===== Фокус: сколько серебра добавляет одно очко ===== */
const REF_BONUS = { METALBAR: 'Thetford', PLANKS: 'Fort Sterling', CLOTH: 'Lymhurst', LEATHER: 'Martlock', STONEBLOCK: 'Bridgewatch' };
function focusUses(s, c, now) {
  const fee = (cfg.premium ? cfg.taxPremium : cfg.taxFree) / 100, disc = 1 - c.fdisc / 100, out = [], P = s.P;
  const bonus = c.rrr === 24.8 || c.rrr === 47.9, rNo = bonus ? 0.248 : 0.152, rF = bonus ? 0.479 : 0.435;
  const price = (id, city) => { const d = P[id] && P[id][city] && P[id][city][1]; return d && d.sell_price_min > 0 && ageH(d.sell_price_min_date, now) <= cfg.maxAge ? d : null; };
  for (const it of s.items) {
    const D = P[it.id] && P[it.id][s.dst], F = DB.focus[it.id.replace(/^T\d_/, '').replace(/@\d$/, '')]; if (!D || !F) continue;
    const ms = it.mats.map(m => ({ m, d: price(m.id, s.src) })); if (ms.some(x => !x.d)) continue;
    let best = 0, exp = 0, aS = 0;
    for (let q = 1; q <= 4; q++) { const d = D[q]; if (d && d.buy_price_max > best && ageH(d.buy_price_max_date, now) <= cfg.maxAge) { best = d.buy_price_max; aS = Math.max(aS, ageH(d.buy_price_max_date, now)); } exp += QP[q] * best; }
    if (!(exp > 0)) continue;
    const cost = rr => ms.reduce((t, x) => t + x.m.n * x.d.sell_price_min * (x.m.ret ? 1 - rr : 1), 0) + c.fee;
    const net = exp * (1 - fee), pF = net - cost(rF), pN = net - cost(rNo), focus = F * Math.pow(1.75, it.tier - 4 + it.ench) * disc;
    if (pF <= 0) continue;
    const aM = Math.max(...ms.map(x => ageH(x.d.sell_price_min_date, now)));
    out.push({ kind: 'craft', name: it.name + ' ' + tierLabel(it), id: it.id, focus, gain: pF - Math.max(0, pN), pF, conf: Math.pow(0.5, (aM + aS) / cfg.halfLife), where: cityName(s.src) + ' → ' + cityName(s.dst) });
  }
  for (const r of DB.refine) {
    const [id, , t, e, F, mats] = r; if (!c.tiers.includes(t) || !c.enchs.includes(e)) continue;
    const kind = id.replace(/^T\d_/, '').replace(/_LEVEL\d@\d$/, ''), b = REF_BONUS[kind] === s.src;
    const sell = P[id] && P[id][s.src] && P[id][s.src][1]; if (!sell || !(sell.buy_price_max > 0) || ageH(sell.buy_price_max_date, now) > cfg.maxAge) continue;
    const ms = mats.map(([mid, n]) => ({ n, d: price(mid, s.src) })); if (ms.some(x => !x.d)) continue;
    const rN = b ? 0.367 : 0.152, rFf = b ? 0.539 : 0.435, cost = rr => ms.reduce((tt, x) => tt + x.n * x.d.sell_price_min * (1 - rr), 0);
    const net = sell.buy_price_max * (1 - fee), pF = net - cost(rFf), pN = net - cost(rN), focus = F * disc;
    if (pF <= 0) continue;
    const aM = Math.max(...ms.map(x => ageH(x.d.sell_price_min_date, now)), ageH(sell.buy_price_max_date, now));
    out.push({ kind: 'refine', name: 'Переработка: ' + (MATN[kind] || kind) + ' ' + t + '.' + e + (b ? ', бонус города' : ''), id, focus, gain: pF - Math.max(0, pN), pF, conf: Math.pow(0.5, aM / cfg.halfLife), where: cityName(s.src) });
  }
  for (const u of out) u.spf = u.gain * u.conf / u.focus;
  return out.filter(u => u.spf > 0).sort((a, b) => b.spf - a.spf).slice(0, 12);
}
function focusHTML() {
  const s = CF.scan, c = CF.cfg, uses = focusUses(s, Object.assign({}, c, { src: s.src, dst: s.dst }), Date.now());
  if (!uses.length) return `<div class="sheet" style="margin-top:16px"><div class="sheethead"><h2>Куда тратить фокус</h2></div><p style="font-size:14px">По этим ценам фокус ничего не добавляет. Попробуй другие тиры или город.</p></div>`;
  for (const u of uses) { u.times = Math.floor(c.fp / u.focus); u.total = u.times * u.focus * u.spf; }
  const best = uses.slice().sort((a, b) => b.total - a.total)[0], crafts = best.times;
  if (!crafts) return `<div class="sheet" style="margin-top:16px"><div class="sheethead"><h2>Куда тратить фокус</h2></div><p style="font-size:14px">${fmt(c.fp)} очков не хватит ни на одну вещь из списка: самой дешёвой нужно ${fmt(Math.min(...uses.map(u => u.focus)))}. Укажи больше фокуса или скидку от специализации.</p><div class="two"><div><label for="cFp" class="lbl" style="color:var(--pmute)">Очков фокуса</label><input id="cFp" type="number" min="0" step="1000" value="${c.fp}" class="pin"></div><div><label for="cFd" class="lbl" style="color:var(--pmute)">Скидка фокуса от специализации, %</label><input id="cFd" type="number" min="0" max="90" step="1" value="${c.fdisc}" class="pin"></div></div></div>`;
  return `<div class="sheet" style="margin-top:16px"><div class="sheethead"><h2>Куда тратить фокус</h2><span>серебро, которое добавляет одно очко</span></div>
    <div class="sum"><div class="big"><span>${fmt(c.fp)} очков фокуса лучше всего потратить так</span><b>${fmt(best.total)}</b><small>${esc(best.name)}: около ${fmt(crafts)} ${plural(crafts, 'раз', 'раза', 'раз')}, ${best.spf.toFixed(1).replace('.', ',')} серебра за очко. Это ожидаемая прибавка к тому, что дал бы тот же крафт без фокуса.</small></div>
    <div class="two"><div><label for="cFp" class="lbl" style="color:var(--pmute)">Очков фокуса</label><input id="cFp" type="number" min="0" step="1000" value="${c.fp}" class="pin"></div><div><label for="cFd" class="lbl" style="color:var(--pmute)">Скидка фокуса от специализации, %</label><input id="cFd" type="number" min="0" max="90" step="1" value="${c.fdisc}" class="pin"></div></div></div>
    <div class="list">${uses.map(u => `<div class="item"><div class="irow" style="grid-template-columns:1fr auto"><div><div class="iname">${esc(u.name)}</div><div class="imeta">${esc(u.where)}, ${fmt(u.focus)} фокуса за ${u.kind === 'refine' ? 'единицу' : 'вещь'}, доверие ${Math.round(u.conf * 100)}%</div></div><div class="iprofit"><b>${u.spf.toFixed(1).replace('.', ',')}</b><span>за очко</span></div></div></div>`).join('')}</div>
    <p class="imeta" style="margin-top:10px">Возврат ресурсов с фокусом: 43,5% или 47,9% в городе с бонусом крафта, при переработке в городе с бонусом 53,9%. Если в игре цифры другие, поменяй возврат в настройках.</p></div>`;
}

function craftSetupHTML() {
  const c = CF.cfg, items = craftItems(c), chips = (list, key, label) => list.map(v => `<button type="button" class="chip" data-ck="${key}" data-v="${v.id}" aria-pressed="${c[key].includes(v.id)}">${label(v)}</button>`).join('');
  const cityOpts = (sel, withBM) => CITIES.filter(x => withBM || !x.sellOnly).map(x => `<option value="${esc(x.id)}" ${x.id === sel ? 'selected' : ''}>${x.name}</option>`).join('');
  return `<section class="setup"><h2>Что крафтить</h2>
    <div class="fld"><div class="route"><div><label for="cSrc">Материалы и крафт в</label><select id="cSrc">${cityOpts(c.src, false)}</select></div><span></span><div><label for="cDst">Сдать в</label><select id="cDst">${cityOpts(c.dst, true)}</select></div></div></div>
    <div class="two fld"><div><label for="cBudget">Серебро на крафт</label><input id="cBudget" type="text" value="${c.budget ? fmt(c.budget) : ''}" placeholder="например 2 млн"></div>
      <div><label for="cRrr">Возврат ресурсов</label><select id="cRrr">${RRR.map(([v, n]) => `<option value="${v}" ${c.rrr === v ? 'selected' : ''}>${n}, ${String(v).replace('.', ',')}%</option>`).join('')}${RRR.some(x => x[0] === c.rrr) ? '' : `<option value="${c.rrr}" selected>Свой, ${c.rrr}%</option>`}</select></div></div>
    <div class="chipgroup"><span class="lbl">Что крафтить</span><div class="chips">${chips(CATS.filter(x => x.id !== 'raw' && x.id !== 'refined'), 'cats', v => v.name)}</div></div>
    <div class="chipgroup"><span class="lbl">Тир</span><div class="chips">${chips([4, 5, 6, 7, 8].map(t => ({ id: t })), 'tiers', v => 'T' + v.id)}</div></div>
    <div class="chipgroup"><span class="lbl">Зачарование</span><div class="chips">${chips([0, 1, 2, 3, 4].map(t => ({ id: t })), 'enchs', v => '.' + v.id)}</div></div>
    <div class="rowline"><label class="switch"><input type="checkbox" id="cArts" ${c.arts ? 'checked' : ''}> Вещи с артефактами</label></div>
    <div class="fld"><label for="cFee">Плата станции за одну вещь, серебро</label><input id="cFee" type="number" min="0" step="100" value="${c.fee}"><div class="hint">Посмотри в окне станции перед крафтом. Налог с продажи и премиум берутся из вкладки «Рейс».</div></div>
    <button class="go" type="button" data-c="scan" ${CF.busy || !items.length ? 'disabled' : ''}>${CF.busy ? 'Проверяю цены…' : CF.scan ? 'Обновить цены' : 'Найти выгодный крафт'}</button>
    <div class="gocap">${items.length ? fmt(items.length) + ' рецептов' : 'Под эти фильтры рецептов нет'}</div>
    <div class="bar" id="cbar" hidden><i></i></div></section>`;
}
function craftRowHTML(p, i) {
  const r = p.r, it = r.it, open = CF.open === it.id, dot = r.conf >= 0.55 ? 'g' : r.conf >= 0.25 ? 'a' : 'r';
  let h = `<div class="item" data-id="${esc(it.id)}"><div class="irow" style="grid-template-columns:auto 1fr auto">
    <span class="ic">${tierLabel(it)}<img loading="lazy" alt="" src="https://render.albiononline.com/v1/item/${it.id}.png?size=64" onerror="this.remove()"></span>
    <button type="button" class="imain" data-c="open" aria-expanded="${open}"><div class="iname">${esc(it.name)}</div>
      <div class="imeta"><b>${tierLabel(it)}</b>, <b>${p.qty} шт.</b>, себестоимость ${fmt(r.cost)}</div>
      <div class="imeta"><span class="dot ${dot}"></span>${r.vol != null ? 'продаётся около ' + fmt(r.vol) + ' в день' : 'объём неизвестен'}</div></button>
    <div class="iprofit"><b>+${fmtShort(r.profit * p.qty)}</b><span>+${fmtShort(r.profit)} за шт.</span></div></div>`;
  if (open) {
    h += `<div class="idet"><dl>
      <div><dt>Ожидаемая цена сдачи</dt><dd>${fmt(r.exp)}</dd></div><div><dt>Ордер на обычное качество</dt><dd>${fmt(r.q1)}</dd></div>
      <div><dt>Чистыми за штуку</dt><dd>+${fmt(r.profit)} (${(r.roi * 100).toFixed(0)}%)</dd></div><div><dt>Доверие к ценам</dt><dd>${Math.round(r.conf * 100)}%</dd></div>
      <div><dt>Цены материалов</dt><dd>${fmtAge(r.aMat)} назад</dd></div><div><dt>Цена сдачи</dt><dd>${fmtAge(r.aSell)} назад</dd></div></dl>
      <div class="bought" style="display:block"><span class="lbl" style="color:var(--pmute)">Закупка на ${p.qty} шт. с учётом возврата ${String(CF.cfg.rrr).replace('.', ',')}%</span>
      ${r.mats.map(m => `<div class="imeta" style="font-size:13.5px;margin-top:4px"><b>${fmt(Math.ceil(m.eff * p.qty))} шт.</b> ${esc(matName(m.kind, m.t, m.e))} по ${fmt(m.price)}${m.ret ? '' : ', не возвращается'}</div>`).join('')}
      </div></div>`;
  }
  return h + '</div>';
}
function craftResultHTML() {
  let h = '';
  if (CF.error) h += `<div class="note err">${CF.error === 'net' ? 'Не получилось связаться с базой цен. Открой файл в обычном браузере с интернетом.' : CF.error === 'limit' ? 'База цен просит подождать минуту.' : 'База цен ответила ошибкой, попробуй позже.'}<br><button type="button" data-c="scan">Попробовать ещё раз</button> <button type="button" data-c="demo">Посмотреть на выдуманных ценах</button></div>`;
  if (!CF.scan) return h + `<div class="empty"><h2>Что выгодно скрафтить?</h2><ol><li>Выбери город, где покупаешь материалы и крафтишь, и куда сдаёшь.</li><li>Укажи возврат ресурсов: с фокусом и в городе с бонусом он выше.</li><li>Караван сравнит себестоимость с ордерами на покупку и соберёт план на твой бюджет.</li></ol></div>`;
  const p = CF.plan, t = p.t, s = CF.scan;
  if (s.demo) h += `<div class="note warn">Демо: цены выдуманы, чтобы показать, как выглядит план.</div>`;
  if (!p.plan.length) return h + `<div class="empty"><h2>Выгодного крафта не нашлось</h2><p>Попробуй другие тиры или зачарования, другой город материалов или возврат ресурсов с фокусом.</p></div>` + focusHTML();
  h += `<div class="sheet"><div class="sheethead"><h2>План крафта</h2><span>${esc(cityName(s.src))} → ${esc(cityName(s.dst))}, цены в ${new Date(s.time).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span></div>
    <div class="sum"><div class="big"><span>Ожидаемая прибыль</span><b>${fmt(t.exp)}</b><small>По ценам из базы ${fmt(t.profit)}. Качество при крафте случайное, оно уже учтено в цене сдачи.</small></div>
    <dl class="kv"><div><dt>Вложить</dt><dd>${fmtShort(t.cost)}</dd></div><div><dt>Вещей</dt><dd>${t.n}</dd></div><div><dt>Доходность</dt><dd>${(t.profit / t.cost * 100).toFixed(0)}%</dd></div></dl></div>
    <div class="list"><div class="listhead"><h3>Что крафтить</h3><span>${p.plan.length} ${plural(p.plan.length, 'позиция', 'позиции', 'позиций')}</span></div>${p.plan.map(craftRowHTML).join('')}</div>
    <div class="acts"><button type="button" class="tbtn solid" data-c="copy">Скопировать список закупки</button></div></div>`;
  return h + focusHTML();
}
function renderCraft() { const el = $('#tab-craft'); if (el.hidden) return; el.innerHTML = craftSetupHTML() + `<section aria-live="polite">${craftResultHTML()}</section>`; }

function craftShopping() {
  const s = CF.scan, need = new Map();
  for (const p of CF.plan.plan) for (const m of p.r.mats) { const k = m.id, x = need.get(k) || { m, n: 0 }; x.n += m.eff * p.qty; need.set(k, x); }
  const lines = [`Крафт: материалы в ${cityName(s.src)}, сдать в ${cityName(s.dst)}`, 'Купить:'];
  for (const { m, n } of need.values()) lines.push(`- ${fmt(Math.ceil(n))} шт. ${matName(m.kind, m.t, m.e)} (${m.id}) по ~${fmt(m.price)}`);
  lines.push('Скрафтить:');
  for (const p of CF.plan.plan) lines.push(`- ${p.qty} шт. ${p.r.it.name} ${tierLabel(p.r.it)}, сдавать от ${fmt(p.r.q1)}`);
  return lines.join('\n');
}
$('#tab-craft').addEventListener('click', e => {
  const ch = e.target.closest('[data-ck]');
  if (ch) { const k = ch.dataset.ck, v = k === 'cats' ? ch.dataset.v : Number(ch.dataset.v), a = CF.cfg[k], i = a.indexOf(v); if (i >= 0) { if (a.length === 1) return toast('Нужен хотя бы один вариант'); a.splice(i, 1); } else a.push(v); cSave(); return renderCraft(); }
  const b = e.target.closest('[data-c]'); if (!b) return;
  const a = b.dataset.c;
  if (a === 'scan') return craftScan(false);
  if (a === 'demo') return craftScan(true);
  if (a === 'open') { const id = b.closest('.item').dataset.id; CF.open = CF.open === id ? null : id; return renderCraft(); }
  if (a === 'copy') { const txt = craftShopping(); navigator.clipboard.writeText(txt).then(() => toast('Список закупки скопирован'), () => { modal(`<h3>Список закупки</h3><textarea readonly>${esc(txt)}</textarea><div class="dlgacts"><button type="button" data-close>Закрыть</button></div>`); $('#modal textarea').select(); }); }
});
$('#tab-craft').addEventListener('change', e => {
  const t = e.target, c = CF.cfg;
  if (t.id === 'cSrc') c.src = t.value; else if (t.id === 'cDst') c.dst = t.value;
  else if (t.id === 'cBudget') c.budget = parseSilver(t.value);
  else if (t.id === 'cRrr') c.rrr = Number(t.value);
  else if (t.id === 'cFee') c.fee = Math.max(0, Number(t.value) || 0);
  else if (t.id === 'cArts') c.arts = t.checked;
  else if (t.id === 'cFp') c.fp = Math.max(0, Number(t.value) || 0);
  else if (t.id === 'cFd') c.fdisc = Math.min(90, Math.max(0, Number(t.value) || 0));
  else return;
  if (c.src === c.dst) { c.dst = 'Black Market'; }
  cSave();
  if (['cSrc', 'cDst'].includes(t.id)) { CF.scan = null; renderCraft(); } else craftRecalc();
});
