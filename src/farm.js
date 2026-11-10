"use strict";
/* ===== Караван: остров ===== */
const FDEF = { city: 'Martlock', farm: 0, herb: 0, pasture: 0, kennel: 0, slots: 9, wFarm: 0, wHerb: 0, wPasture: 0, wKennel: 0, fdisc: 0, mult: 1, ownFood: true, buyOrder: true, v: 2 };
const FSAVED = LS.get('karavan.farm', {});
const FM = { cfg: Object.assign({}, FDEF, FSAVED), busy: false, scan: null, error: null };
if (FSAVED.v !== 2) Object.assign(FM.cfg, { farm: 0, herb: 0, pasture: 0, kennel: 0, v: 2 });
const fSave = () => LS.set('karavan.farm', FM.cfg);
const FKIND = { farm: 'Поле', herbgarden: 'Сад трав', pasture: 'Пастбище', kennel: 'Питомник' };

function farmIds() {
  const F = DB.farm, s = new Set();
  for (const p of F.plants) { s.add(p.seed); s.add(p.crop); }
  for (const a of F.animals) { s.add(a.baby); s.add(a.grown); if (a.prod) s.add(a.prod); }
  for (const id in F.foods) s.add(id);
  return [...s];
}
function farmCalc(P, c, now) {
  const tax = (cfg.premium ? cfg.taxPremium : cfg.taxFree) / 100, setup = cfg.setupFee / 100, city = c.city;
  const get = id => { const d = P[id] && P[id][city] && P[id][city][1]; return d || null; };
  const fresh = (d, k) => d && d[k] > 0 && ageH(d[k + '_date'], now) <= cfg.maxAge;
  const market = id => { const d = get(id); return fresh(d, 'sell_price_min') ? d.sell_price_min : null; };
  /* Покупка: свой ордер на покупку (цена лучшего ордера + сбор) или выкуп самого дешёвого предложения */
  const buy = id => { const d = get(id), m = market(id); if (c.buyOrder && fresh(d, 'buy_price_max')) { const o = (d.buy_price_max + 1) * (1 + setup); return m != null ? Math.min(o, m) : o; } return m; };
  /* Продажа: что выгоднее — свой ордер на продажу или сдать в лучший ордер на покупку */
  const sell = id => { const d = get(id); let v = null; if (fresh(d, 'sell_price_min')) v = d.sell_price_min * (1 - tax - setup); if (fresh(d, 'buy_price_max')) v = Math.max(v || 0, d.buy_price_max * (1 - tax)); return v; };
  const vol = id => { const h = FM.scan && FM.scan.H[id + '|1']; return h ? h.vol : null; };
  /* цена одной единицы питания: самый дешёвый подходящий корм */
  const foodCost = (cat, fav, favb) => {
    let best = null, what = null;
    for (const id in DB.farm.foods) {
      const [n, fc] = DB.farm.foods[id]; if (fc !== cat) continue;
      const p = c.ownFood ? (sell(id) != null ? sell(id) : buy(id)) : buy(id); if (p == null) continue;
      const per = p / (n * (id === fav ? 1 + favb : 1));
      if (best == null || per < best) { best = per; what = id; }
    }
    return best == null ? null : { per: best, id: what };
  };
  const rows = [];
  for (const p of DB.farm.plants) {
    const ps = buy(p.seed), cs = sell(p.crop); if (ps == null || cs == null) continue;
    const seedSell = sell(p.seed) || ps * 0.85, days = Math.max(1, Math.ceil(p.days));
    /* Семена: вернувшееся семя сажаешь снова, а всё, что сверх одного, продаёшь */
    const econ = foc => { const seeds = p.sc + (foc ? p.fb : 0), crop = p.y * c.mult * cs, buySeed = seeds < 1 ? ps * (1 - seeds) : 0, sellSeed = seeds > 1 ? (seeds - 1) * seedSell : 0; return { seeds, crop, buySeed, sellSeed, day: (crop - buySeed + sellSeed) / days }; };
    const calc = foc => econ(foc).day;
    const pn = calc(false), pf = calc(true);
    const en = econ(false), ef = econ(true), seedTxt = e => e.seeds >= 1 ? `семя вернётся${e.seeds > 1 ? `, лишних ${(e.seeds - 1).toFixed(2).replace('.', ',')} шт. на продажу +${fmt(e.sellSeed)}` : ''}` : `семя вернётся в ${Math.round(e.seeds * 100)}% случаев, докупка ${fmt(e.buySeed)}`;
    rows.push({ kind: p.kind, name: p.name, t: p.t, id: p.crop, icon: p.seed, perDay: pn, pn, pf, focus: p.fc, fday: p.fc / days, invest: ps,
      note: `урожай ~${(p.y * c.mult).toFixed(1).replace('.', ',')} шт. по ${fmt(cs)} = ${fmt(en.crop)}, ${seedTxt(en)}`, fnote: p.fc ? `с поливом: ${seedTxt(ef)}` : '', vol: vol(p.crop) });
  }
  for (const a of DB.farm.animals) {
    const pb = buy(a.baby); if (pb == null) continue;
    const f = a.cat ? foodCost(a.cat, a.fav, a.favb) : null; if (!f) continue;
    const days = Math.max(1, Math.ceil(a.days)), grownSell = sell(a.grown);
    if (grownSell != null) {
      const oc = foc => Math.min(a.oc + (foc ? a.fb * a.cycles : 0), 2), food = a.nutr * f.per;
      const calc = foc => (grownSell + oc(foc) * pb - pb - food) / days;
      const ocNow = oc(false);
      rows.push({ kind: a.kind, name: a.name + ': вырастить и продать', t: a.t, id: a.grown, icon: a.baby, perDay: calc(false), pn: calc(false), pf: calc(true), focus: a.fc * a.cycles, fday: a.fc * a.cycles / days, invest: pb + food, fnote: a.fc ? `с фокусом детёныш вернётся в ${Math.round(oc(true) * 100)}% случаев` : '',
        note: `продажа ${fmt(grownSell)} + возврат детёныша ${Math.round(ocNow * 100)}% (${fmt(ocNow * pb)}) − детёныш ${fmt(pb)} − корм ${fmt(food)} (${esc(nmFood(f.id))}), растёт ${days} дн.`, vol: vol(a.grown) });
    }
    if (a.prod) {
      const ps = sell(a.prod), pf2 = foodCost(a.cat, a.fav, a.favb);
      if (ps != null && pf2) {
        const v = a.py * c.mult * ps - a.pnutr * pf2.per;
        rows.push({ kind: a.kind, name: a.name + ': ' + a.pname.toLowerCase(), t: a.t, id: a.prod, icon: a.grown, perDay: v, pn: v, pf: v, focus: 0, fday: 0, invest: pb, note: `~${(a.py * c.mult).toFixed(0)} шт. в день по ${fmt(ps)}, корм ${fmt(a.pnutr * pf2.per)} в день`, vol: vol(a.prod), product: true });
      }
    }
  }
  return rows;
}
function nmFood(id) { const p = DB.farm.plants.find(x => x.crop === id); if (p) return p.name; const m = id.match(/^T(\d)_MEAT/); return m ? 'мясо T' + m[1] : id; }

async function farmScan(demo) {
  if (FM.busy) return;
  FM.busy = true; FM.error = null; renderFarm();
  const now = Date.now(), P = {}, H = {}, c = FM.cfg, ids = farmIds();
  try {
    if (demo) {
      const iso = ms => new Date(ms).toISOString().slice(0, 19); let k = 0;
      for (const id of ids) {
        const t = +id[1], base = /SEED/.test(id) ? 2500 * t : /BABY/.test(id) ? 9000 * Math.pow(2.1, t - 3) : /GROWN/.test(id) ? 16000 * Math.pow(2.1, t - 3) : 90 * Math.pow(1.7, t);
        const v = Math.round(base * (0.8 + 0.4 * ((++k * 37) % 100) / 100));
        indexPrices([{ item_id: id, city: c.city, quality: 1, sell_price_min: v, sell_price_min_date: iso(now - 36e5 * (1 + k % 5)), buy_price_max: Math.round(v * 0.85), buy_price_max_date: iso(now - 36e5 * (1 + k % 5)) }], P);
      }
      await sleep(200);
    } else {
      const host = apiHost(cfg.server), loc = encodeURIComponent(c.city);
      await pooled(chunkIds(ids, 3300).map(ch => `${host}/api/v2/stats/prices/${ch.join(',')}.json?locations=${loc}&qualities=1`), rows => indexPrices(rows, P));
      const d0 = new Date(now - 9 * 864e5), date = `${d0.getUTCMonth() + 1}-${d0.getUTCDate()}-${d0.getUTCFullYear()}`;
      const sellIds = [...new Set([...DB.farm.plants.map(p => p.crop), ...DB.farm.animals.map(a => a.grown), ...DB.farm.animals.filter(a => a.prod).map(a => a.prod)])];
      try { await pooled(chunkIds(sellIds, 3300).map(ch => `${host}/api/v2/stats/history/${ch.join(',')}.json?locations=${loc}&qualities=1&time-scale=24&date=${date}`), rows => indexHistory(rows, H, now)); } catch (e) { }
    }
    FM.scan = { time: now, P, H, demo: !!demo, city: c.city };
  } catch (e) { FM.error = e.status === 429 ? 'limit' : (e.status ? 'http' + e.status : 'net'); }
  FM.busy = false; renderFarm();
}

function farmSetupHTML() {
  const c = FM.cfg, num = (id, label, v, min, max, step) => `<div><label for="${id}">${label}</label><div class="stepper"><button type="button" data-fs="-1" data-for="${id}" aria-label="Меньше">−</button><input id="${id}" type="text" inputmode="decimal" data-min="${min}" data-max="${max}" data-step="${step || 1}" value="${String(v).replace('.', ',')}"><button type="button" data-fs="1" data-for="${id}" aria-label="Больше">+</button></div></div>`;
  return `<section class="setup"><h2>Мой остров</h2>
    <div class="fld"><label for="fCity">Рынок, где покупаешь и продаёшь</label><select id="fCity">${CITIES.filter(x => !x.sellOnly).map(x => `<option value="${esc(x.id)}" ${x.id === c.city ? 'selected' : ''}>${x.name}</option>`).join('')}</select></div>
    <div class="two fld">${num('fFarm', 'Полей', c.farm, 0, 30)}${num('fHerb', 'Садов трав', c.herb, 0, 30)}</div>
    <div class="two fld">${num('fPasture', 'Пастбищ', c.pasture, 0, 30)}${num('fKennel', 'Питомников', c.kennel, 0, 30)}</div>
    <div class="two fld">${num('fSlots', 'Мест на одном участке', c.slots, 1, 20)}${num('fMult', 'Множитель урожая', c.mult, 0.1, 5, 0.1)}</div>
    <div class="hint" style="margin-top:-6px;margin-bottom:12px">Множитель — если в игре урожай или продукт другой, чем в расчёте, поставь, например, 0,5 или 2.</div>
    <span class="lbl">Сколько участков поливать или кормить с фокусом</span>
    <div class="two fld">${num('fwFarm', 'Полей с фокусом', Math.min(c.wFarm || 0, c.farm), 0, c.farm)}${num('fwHerb', 'Садов с фокусом', Math.min(c.wHerb || 0, c.herb), 0, c.herb)}</div>
    <div class="two fld">${num('fwPasture', 'Пастбищ с фокусом', Math.min(c.wPasture || 0, c.pasture), 0, c.pasture)}${num('fwKennel', 'Питомников с фокусом', Math.min(c.wKennel || 0, c.kennel), 0, c.kennel)}</div>
    <div class="fld">${num('fDisc', 'Скидка фокуса от мастерства, %', c.fdisc || 0, 0, 90, 1)}<div class="hint">Посмотри в игре, сколько фокуса стоит полить одну грядку, и подбери скидку, чтобы расход совпал.</div></div>
    <div class="rowline" style="flex-direction:column;align-items:flex-start;gap:10px">

      <label class="switch"><input type="checkbox" id="fOwn" ${c.ownFood ? 'checked' : ''}> Кормить своим урожаем</label>
      <label class="switch"><input type="checkbox" id="fBuyO" ${c.buyOrder ? 'checked' : ''}> Покупать семена и детёнышей через свой ордер</label></div>
    <div class="hint" style="margin-top:-4px;margin-bottom:12px">Свой урожай считается по цене, за которую ты бы его продал, а не купил. Свой ордер на покупку обычно дешевле, но ждать приходится дольше.</div>
    <button class="go" type="button" data-f="scan" ${FM.busy ? 'disabled' : ''}>${FM.busy ? 'Проверяю цены…' : FM.scan ? 'Обновить цены' : 'Посчитать остров'}</button>
    <div class="gocap">Налог и премиум берутся из вкладки «Рейс»</div></section>`;
}
function farmResultHTML() {
  let h = '';
  if (FM.error) h += `<div class="note err">${FM.error === 'net' ? 'Не получилось связаться с базой цен. Открой файл в обычном браузере с интернетом.' : FM.error === 'limit' ? 'База цен просит подождать минуту.' : 'База цен ответила ошибкой, попробуй позже.'}<br><button type="button" data-f="scan">Попробовать ещё раз</button> <button type="button" data-f="demo">Посмотреть на выдуманных ценах</button></div>`;
  if (!FM.scan) return h + `<div class="empty"><h2>Что выгоднее всего держать на острове?</h2><ol><li>Укажи, сколько у тебя полей, садов трав, пастбищ и питомников.</li><li>Выбери рынок, где покупаешь семена и детёнышей и продаёшь урожай.</li><li>Караван посчитает прибыль в день с каждого места и соберёт лучший план острова.</li></ol></div>`;
  const c = FM.cfg, s = FM.scan, rows = farmCalc(s.P, Object.assign({}, c, { city: s.city }), Date.now());
  if (s.demo) h += `<div class="note warn">Демо: цены выдуманы, чтобы показать, как выглядит расчёт.</div>`;
  const groups = [['farm', c.farm], ['herbgarden', c.herb], ['pasture', c.pasture], ['kennel', c.kennel]];
  let total = 0, focusUsed = 0; const plan = [], disc = 1 - (c.fdisc || 0) / 100;
  const wOf = { farm: c.wFarm, herbgarden: c.wHerb, pasture: c.wPasture, kennel: c.wKennel };
  for (const [k, n] of groups) {
    if (!(n > 0)) continue;
    const w = Math.min(n, wOf[k] || 0), list = rows.filter(r => r.kind === k);
    /* На участки с фокусом берём то, что выгоднее с фокусом, на остальные — то, что выгоднее без него */
    const bestN = list.slice().sort((a, b) => b.pn - a.pn)[0], bestF = list.slice().sort((a, b) => b.pf - a.pf)[0];
    if (!bestN) continue;
    const vN = Math.max(0, bestN.pn) * c.slots * (n - w), vF = w && bestF ? Math.max(0, bestF.pf) * c.slots * w : 0, fz = w && bestF ? bestF.fday * disc * c.slots * w : 0;
    total += vN + vF; focusUsed += fz;
    const parts = [];
    if (n - w > 0 && bestN.pn > 0) parts.push(`${n - w} — ${bestN.name} T${bestN.t}`);
    if (w && bestF && bestF.pf > 0) parts.push(`${w} с фокусом — ${bestF.name} T${bestF.t}`);
    if (parts.length) plan.push(`${FKIND[k]} ×${n}: ${parts.join('; ')}, +${fmtShort(vN + vF)} в день`);
  }
  h += `<div class="sheet"><div class="sheethead"><h2>План острова</h2><span>${esc(cityName(s.city))}, цены в ${new Date(s.time).toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit' })}</span></div>
    <div class="sum"><div class="big"><span>Прибыль острова в день</span><b>${fmt(total)}</b><small>${total > 0 ? 'За месяц около ' + fmtShort(total * 30) + '.' : 'При этих ценах участки не приносят прибыли.'}${focusUsed ? ` Фокуса нужно около ${fmt(focusUsed)} в день.` : ''}</small></div>
    <div style="font-size:14px">${plan.length ? plan.map(p => `<div style="margin:4px 0">${esc(p)}</div>`).join('') : 'Укажи кнопками + слева, сколько у тебя полей, садов, пастбищ и питомников, и план соберётся.'}</div></div>`;
  for (const [k] of groups) {
    const list = rows.filter(r => r.kind === k).sort((a, b) => b.pn - a.pn).slice(0, 8); if (!list.length) continue;
    h += `<div class="list"><div class="listhead"><h3>${FKIND[k]}</h3><span>прибыль в день с одного места</span></div>${list.map(r => `<div class="item"><div class="irow" style="grid-template-columns:auto 1fr auto">
      <span class="ic">T${r.t}<img loading="lazy" alt="" src="https://render.albiononline.com/v1/item/${r.icon}.png?size=64" onerror="this.remove()"></span>
      <div style="min-width:0"><div class="iname">${esc(r.name)}</div><div class="imeta">${r.note}</div><div class="imeta">${r.vol != null ? 'продаётся около ' + fmt(r.vol) + ' в день' : 'объём продаж неизвестен'}</div>${!r.product && r.pf > r.pn && r.fday ? `<div class="imeta">Фокус: +${fmt(r.pf - r.pn)} в день за ${fmt(r.fday * (1 - (c.fdisc || 0) / 100))} очков (${((r.pf - r.pn) / (r.fday * (1 - (c.fdisc || 0) / 100) || 1)).toFixed(1).replace('.', ',')} серебра за очко)${r.fnote ? ', ' + esc(r.fnote) : ''}</div>` : ''}</div>
      <div class="iprofit"><b class="${r.perDay >= 0 ? '' : 'negc'}" style="${r.perDay >= 0 ? '' : 'color:var(--pred)'}">${r.perDay >= 0 ? '+' : '−'}${fmtShort(Math.abs(r.perDay))}</b><span>×${c.slots}: ${fmtShort(r.perDay * c.slots)}</span></div></div></div>`).join('')}</div>`;
  }
  h += `<p class="imeta" style="margin-top:12px">Урожай, шанс вернуть семя или детёныша, расход корма и фокуса взяты из данных игры. Вернувшееся семя сажается снова, лишние семена продаются. Корм считается самым дешёвым подходящим на рынке, любимый корм животного даёт вдвое больше питания. Продажа считается по лучшему из двух вариантов: свой ордер на продажу или сдать в ордер на покупку, с налогом. Для продуктов (молоко, яйца) не учтена стоимость самого животного: её нужно вырастить один раз.</p></div>`;
  return h;
}
function renderFarm() { const el = $('#tab-farm'); if (el.hidden) return; el.innerHTML = farmSetupHTML() + `<section aria-live="polite">${farmResultHTML()}</section>`; }
const FMAP = { fFarm: 'farm', fHerb: 'herb', fPasture: 'pasture', fKennel: 'kennel', fSlots: 'slots', fMult: 'mult', fwFarm: 'wFarm', fwHerb: 'wHerb', fwPasture: 'wPasture', fwKennel: 'wKennel', fDisc: 'fdisc' };
function farmSetNum(input, v) {
  const min = +input.dataset.min, max = +input.dataset.max, step = +input.dataset.step;
  v = Math.min(max, Math.max(min, Math.round(v / step) * step));
  v = Math.round(v * 100) / 100;
  FM.cfg[FMAP[input.id]] = v; fSave();
  const id = input.id; renderFarm(); const again = document.getElementById(id); if (again && document.activeElement !== again) again.blur();
}
$('#tab-farm').addEventListener('click', e => {
  const s = e.target.closest('[data-fs]');
  if (s) { const inp = document.getElementById(s.dataset.for); const cur = parseFloat(String(inp.value).replace(',', '.')) || 0; return farmSetNum(inp, cur + (+s.dataset.fs) * (+inp.dataset.step)); }
  const b = e.target.closest('[data-f]'); if (!b) return; if (b.dataset.f === 'scan') farmScan(false); if (b.dataset.f === 'demo') farmScan(true);
});
$('#tab-farm').addEventListener('keydown', e => { if (e.key === 'Enter' && FMAP[e.target.id]) e.target.blur(); });
$('#tab-farm').addEventListener('change', e => {
  const t = e.target, c = FM.cfg;
  if (FMAP[t.id]) { const v = parseFloat(String(t.value).replace(',', '.')); if (isFinite(v) && v >= 0) return farmSetNum(t, v); return renderFarm(); }
  else if (t.id === 'fOwn') c.ownFood = t.checked;
  else if (t.id === 'fBuyO') c.buyOrder = t.checked;
  else if (t.id === 'fCity') { c.city = t.value; FM.scan = null; }
  else return;
  fSave(); renderFarm();
});
