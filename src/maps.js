"use strict";
/* ===== Караван: рейтинг карт по луту (данные заходов от KaravanMeter.exe) ===== */
const MP = { cfg: Object.assign({ city: 'Caerleon', cat: 'solo', minH: 0.25, kind: 'all' }, LS.get('karavan.maps', {})), data: null, err: null, prices: {}, pricing: false, timer: 0 };
const ZONE = { OUT: 'Чёрная зона', ROY: 'Королевские земли', RDS: 'Дороги Авалона', DNG: 'Подземелье', HEL: 'Врата ада', EXP: 'Экспедиция', COR: 'Осквернённое подземелье', CTY: 'Город', ISL: 'Остров', HDO: 'Убежище', PGU: 'Портал', ARE: 'Арена' };
const INST = { RANDOMDUNGEON: 'Случайное подземелье', MISTS: 'Туманы', MIST: 'Туманы', HELLCLUSTER: 'Врата ада', HELLGATE: 'Врата ада', CORRUPTED: 'Осквернённое подземелье', AVALON: 'Подземелье Авалона', EXPEDITION: 'Экспедиция', HIDEOUT: 'Убежище', ISLAND: 'Остров', ARENA: 'Арена' };
const SAFE = new Set(['Город', 'Остров', 'Убежище', 'Портал', 'Арена']);
const DUNG = new Set(['Подземелье', 'Врата ада', 'Экспедиция', 'Осквернённое подземелье', 'Инстанс']);
const MKIND = [['all', 'Все'], ['open', 'Открытый мир'], ['dung', 'Подземелья']];
const kindOf = info => info.key === '?' || SAFE.has(info.zone) ? 'safe' : DUNG.has(info.zone) || info.key[0] === '@' ? 'dung' : 'open';
const MCAT = [['solo', 'Соло'], ['group', 'Группа'], ['guild', 'Гильдия']];
const mSave = () => LS.set('karavan.maps', MP.cfg);
const catOf = n => n <= 1 ? 'solo' : n <= 7 ? 'group' : 'guild';

function mapInfo(idx) {
  if (!idx || idx === '?') return { key: '?', name: 'Карта до запуска счётчика', zone: '', tier: 0, q: 0 };
  if (idx[0] === '@') {
    const tok = idx.split('@').filter(Boolean)[0] || '';
    const k = Object.keys(INST).find(x => tok.toUpperCase().includes(x));
    return { key: '@' + (k || tok), name: k ? INST[k] : tok, zone: 'Подземелье', tier: 0, q: 0 };
  }
  const m = DB.maps[idx];
  if (!m) return { key: idx, name: idx, zone: '', tier: 0, q: 0 };
  return { key: idx, name: m[0], zone: ZONE[m[2]] || ZONE[m[1]] || 'Карта', tier: m[3], q: m[4] };
}

async function mpPoll() {
  if ($('#tab-maps').hidden || document.hidden) return;
  try {
    const ac = new AbortController(), tm = setTimeout(() => ac.abort(), 3000);
    const r = await fetch(GM.url + '/maps', { signal: ac.signal, cache: 'no-store' }); clearTimeout(tm);
    MP.data = await r.json(); MP.err = null;
    await mpPrice();
  } catch (e) { MP.err = 'off'; }
  renderMaps();
}
function mpStart() { mpPoll(); clearInterval(MP.timer); MP.timer = setInterval(mpPoll, 15000); }
function mpStop() { clearInterval(MP.timer); MP.timer = 0; }

/* Цена лута: лучшее из ордера Чёрного рынка и цены продажи на выбранном рынке */
async function mpPrice() {
  if (MP.pricing || !MP.data) return;
  const vs = (MP.data.visits || []).concat(MP.data.current ? [MP.data.current] : []), need = new Set();
  for (const v of vs) for (const u in (v.loot || {})) if (!(u + '|' + MP.cfg.city in MP.prices)) need.add(u);
  if (!need.size) return;
  MP.pricing = true;
  try {
    const host = apiHost(cfg.server), loc = ['Black Market', MP.cfg.city].map(encodeURIComponent).join(','), P = {};
    await pooled(chunkIds([...need], 3300).map(ch => `${host}/api/v2/stats/prices/${ch.join(',')}.json?locations=${loc}&qualities=1,2,3`), rows => indexPrices(rows, P));
    const now = Date.now();
    for (const u of need) {
      const p = P[u] || {}, bm = p['Black Market'] || {}, c = p[MP.cfg.city] || {};
      let best = 0;
      for (const q of [1, 2, 3]) {
        if (bm[q] && bm[q].buy_price_max > best && ageH(bm[q].buy_price_max_date, now) < 72) best = bm[q].buy_price_max;
        if (c[q] && c[q].sell_price_min > 0 && ageH(c[q].sell_price_min_date, now) < 72) best = Math.max(best, c[q].sell_price_min * 0.9);
      }
      MP.prices[u + '|' + MP.cfg.city] = best;
    }
  } catch (e) { }
  MP.pricing = false;
}
function visitValue(v) {
  let loot = 0, unknown = 0;
  for (const u in (v.loot || {})) { const p = MP.prices[u + '|' + MP.cfg.city]; if (p == null) unknown++; else loot += p * v.loot[u]; }
  return { loot, silver: v.silver || 0, total: loot + (v.silver || 0), unknown };
}
function mpAggregate() {
  const out = {};
  for (const v of (MP.data && MP.data.visits) || []) {
    const h = (v.end - v.start) / 36e5; if (h <= 0) continue;
    const info = mapInfo(v.map), k = info.key + '|' + catOf(v.party);
    const a = out[k] || (out[k] = { info, cat: catOf(v.party), h: 0, val: 0, fame: 0, n: 0, loot: {}, deaths: 0, kills: 0, pvp: 0, players: 0 });
    const val = visitValue(v); a.h += h; a.val += val.total; a.fame += v.fame || 0; a.n++; a.deaths += v.deaths || 0; a.kills += v.kills || 0; a.pvp += v.pvp || 0; a.players += v.players || 0;
    for (const u in (v.loot || {})) a.loot[u] = (a.loot[u] || 0) + (MP.prices[u + '|' + MP.cfg.city] || 0) * v.loot[u];
  }
  return Object.values(out).map(a => Object.assign(a, { ph: a.val / a.h, fh: a.fame / a.h, danger: a.players / a.h, deathsH: a.deaths / a.h }));
}

function renderMaps() {
  const el = $('#tab-maps'); if (el.hidden) return;
  const c = MP.cfg, d = MP.data, all = d ? mpAggregate() : [];
  const list = all.filter(a => a.cat === c.cat && a.h >= c.minH && kindOf(a.info) !== 'safe' && (c.kind === 'all' || kindOf(a.info) === c.kind)).sort((a, b) => b.ph - a.ph);
  const dungN = all.filter(a => kindOf(a.info) === 'dung').length;
  const total = ((d && d.visits) || []).length, hours = ((d && d.visits) || []).reduce((s, v) => s + (v.end - v.start) / 36e5, 0);
  let status;
  if (MP.err || !d) status = `<div class="note warn"><b>Счётчик не запущен.</b> Рейтинг строится по твоим заходам: запусти KaravanMeter.exe перед игрой, он запишет каждую карту, лут, серебро и славу.</div>`;
  else status = `<div class="note ok">Записано заходов: ${fmt(total)}, ${hours.toFixed(1).replace('.', ',')} ч игры. Чем больше бегаешь, тем точнее рейтинг.</div>`;
  const cur = d && d.current, ci = cur && mapInfo(cur.map), cv = cur && visitValue(cur), cmin = cur ? (cur.end - cur.start) / 6e4 : 0;
  const setup = `<section class="setup"><h2>Карты</h2>${status}
    <div class="seg" style="margin-bottom:12px" role="group" aria-label="Состав">${MCAT.map(([k, n]) => `<button type="button" data-m="cat" data-v="${k}" aria-pressed="${c.cat === k}">${n}</button>`).join('')}</div>
    <div class="seg" style="margin-bottom:12px" role="group" aria-label="Тип карт">${MKIND.map(([k, n]) => `<button type="button" data-m="kind" data-v="${k}" aria-pressed="${c.kind === k}">${n}</button>`).join('')}</div>
    <div class="two fld"><div><label for="mCity">Цены лута</label><select id="mCity">${CITIES.filter(x => !x.sellOnly).map(x => `<option value="${esc(x.id)}" ${x.id === c.city ? 'selected' : ''}>${x.name}</option>`).join('')}</select></div>
      <div><label for="mMin">Мин. часов на карте</label><input id="mMin" type="number" min="0" step="0.25" value="${c.minH}"></div></div>
    ${cur ? `<div class="pmem" style="margin-top:14px"><span class="lbl">Сейчас</span><b>${esc(ci.name)}</b> <span class="imeta">${esc(ci.zone)}${ci.tier ? ' T' + ci.tier : ''}</span><div class="imeta">${Math.round(cmin)} мин, лут и серебро ${fmtShort(cv.total)}, слава ${fmtShort(cur.fame || 0)}${cmin > 5 ? ', это ' + fmtShort(cv.total / cmin * 60) + ' в час' : ''}</div></div>` : ''}
    </section>`;
  let right;
  if (!list.length) right = c.kind === 'dung' && !dungN ? `<div class="empty"><h2>Подземелий пока нет</h2><p>Рейтинг подземелий строится по твоим заходам, общих открытых данных о луте в подземельях нет. Зайди в подземелье, Туманы или Врата ада с запущенным KaravanMeter.exe: после выхода заход появится здесь.</p></div>`
    : `<div class="empty"><h2>Рейтинга пока нет</h2><p>${total ? 'Для этого состава и типа карт нет заходов дольше ' + String(c.minH).replace('.', ',') + ' ч. Уменьши «Мин. часов на карте» или выбери другой состав.' : 'Запусти KaravanMeter.exe перед игрой и побегай по картам. Здесь появятся карты, где у тебя выходит больше всего серебра в час.'}</p><p class="imeta">Города, острова, убежища и порталы в рейтинг не входят.</p></div>`;
  else {
    const top = list[0].ph || 1;
    right = `<div class="sheet"><div class="sheethead"><h2>Рейтинг карт: ${MCAT.find(x => x[0] === c.cat)[1].toLowerCase()}</h2><span>серебро в час по твоим заходам</span></div>
      <div class="list">${list.slice(0, 40).map((a, i) => { const lt = Object.entries(a.loot).sort((x, y) => y[1] - x[1]).slice(0, 3); return `<div class="item"><div class="mrow">
        <div class="mname"><b>${i + 1}. ${esc(a.info.name)}</b><div class="imeta">${esc(a.info.zone)}${a.info.tier ? ' T' + a.info.tier : ''}${a.info.q ? ', уровень ' + a.info.q : ''} · заходов ${a.n}, ${a.h.toFixed(1).replace('.', ',')} ч${a.h < 1 ? ' — мало данных' : ''}</div></div>
        <div class="mnum"><b>${fmtShort(a.ph)}</b><span>в час · слава ${fmtShort(a.fh)}</span></div></div>
        <div class="mbar"><i class="d" style="width:${Math.max(2, a.ph / top * 100).toFixed(1)}%"></i></div>
        <div class="imeta">${a.players ? 'Игроков в час: ' + fmt(a.danger) : 'Чужих игроков не было'}${a.deaths ? ' · ваших смертей: ' + a.deaths : ''}${a.kills ? ' · убийств: ' + a.kills : ''}${a.pvp ? ' · всего смертей: ' + a.pvp : ''}</div>
        ${lt.length ? `<div class="imeta">Больше всего принесли: ${lt.map(([u, v]) => esc(itemLabel(parseItem(u), -1) + ' ' + (parseItem(u) || {}).t + '.' + (parseItem(u) || {}).e) + ' (' + fmtShort(v) + ')').join(', ')}</div>` : ''}</div>`; }).join('')}</div>
      <p class="imeta" style="margin-top:10px">Учтены лут твоей пати и серебро с мобов. Потерянное снаряжение не вычитается. Города, острова и убежища не учитываются.</p></div>`;
  }
  el.innerHTML = setup + `<section aria-live="off">${right}</section>`;
}
$('#tab-maps').addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (!b) return; if (b.dataset.m === 'cat' || b.dataset.m === 'kind') { MP.cfg[b.dataset.m] = b.dataset.v; mSave(); renderMaps(); } });
$('#tab-maps').addEventListener('change', async e => {
  const t = e.target;
  if (t.id === 'mCity') { MP.cfg.city = t.value; mSave(); await mpPrice(); }
  else if (t.id === 'mMin') { const v = parseFloat(String(t.value).replace(',', '.')); if (v >= 0) MP.cfg.minH = v; mSave(); }
  renderMaps();
});
