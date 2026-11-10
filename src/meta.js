"use strict";
/* ===== Караван: мета-сеты по киллборду, с ценой сета под бюджет ===== */
const MTDEF = { kills: 1000, group: 'all', tier: 6, ench: 0, budget: 0, city: 'Caerleon', sort: 'kills' };
const MT = { cfg: Object.assign({}, MTDEF, LS.get('karavan.metacfg', {})), data: LS.get('karavan.meta', null), busy: false, err: null, prices: {}, pricing: false, via: null };
const GI_HOST = { europe: 'gameinfo-ams.albiononline.com', west: 'gameinfo.albiononline.com', east: 'gameinfo-sgp.albiononline.com' };
const MGROUP = [['all', 'Все бои'], ['solo', 'Соло'], ['small', 'Малые группы 2–5'], ['large', 'Большие группы 6+']];
const mtSave = () => LS.set('karavan.metacfg', MT.cfg);
const baseOf = t => t ? t.replace(/^T\d_/, '').replace(/@\d$/, '') : '';
const DAY = 864e5;

async function giPage(offset) {
  const direct = `https://${GI_HOST[cfg.server]}/api/gameinfo/events?limit=51&offset=${offset}`;
  const proxy = `${GM.url}/gi?server=${cfg.server}&limit=51&offset=${offset}`;
  const order = MT.via === 'proxy' ? [proxy] : MT.via === 'direct' ? [direct] : [direct, proxy];
  let last;
  for (const u of order) {
    try {
      await gate();
      const ac = new AbortController(), tm = setTimeout(() => ac.abort(), 25000);
      const r = await fetch(u, { signal: ac.signal, cache: 'no-store' }); clearTimeout(tm);
      if (!r.ok) { last = new Error('HTTP ' + r.status); continue; }
      const j = await r.json(); MT.via = u === direct ? 'direct' : 'proxy'; return j;
    } catch (e) { last = e; }
  }
  throw last || new Error('net');
}

async function metaRefresh() {
  if (MT.busy) return;
  MT.busy = true; MT.err = null; renderMeta();
  const seen = new Set(), B = { all: {}, solo: {}, small: {}, large: {} };
  const add = (cat, eq, kind, ip) => {
    if (!eq || !eq.MainHand) return;
    const parts = ['MainHand', 'OffHand', 'Head', 'Armor', 'Shoes'].map(s => baseOf(eq[s] && eq[s].Type));
    const key = parts.join('|');
    for (const c of ['all', cat]) {
      const b = B[c][key] || (B[c][key] = { parts, kills: 0, deaths: 0, ip: 0, ipn: 0, capes: {} });
      b[kind]++;
      if (kind === 'kills' && ip) { b.ip += ip; b.ipn++; }
      const cp = baseOf(eq.Cape && eq.Cape.Type); if (cp && kind === 'kills') b.capes[cp] = (b.capes[cp] || 0) + 1;
    }
  };
  let got = 0;
  try {
    const pages = Math.ceil(MT.cfg.kills / 51);
    for (let i = 0; i < pages; i++) {
      const arr = await giPage(i * 51);
      if (!Array.isArray(arr) || !arr.length) break;
      for (const ev of arr) {
        if (seen.has(ev.EventId)) continue; seen.add(ev.EventId); got++;
        const g = ev.groupMemberCount || 1, cat = g <= 1 ? 'solo' : g <= 5 ? 'small' : 'large';
        add(cat, ev.Killer && ev.Killer.Equipment, 'kills', ev.Killer && ev.Killer.AverageItemPower);
        add(cat, ev.Victim && ev.Victim.Equipment, 'deaths', 0);
      }
      const bar = $('#mtbar'); if (bar) { bar.hidden = false; bar.firstElementChild.style.width = Math.round((i + 1) / pages * 100) + '%'; }
    }
    if (!got) throw new Error('empty');
    const pack = {}; for (const c in B) pack[c] = Object.values(B[c]).filter(b => b.kills >= 2).sort((a, b) => b.kills - a.kills).slice(0, 150);
    MT.data = { time: Date.now(), server: cfg.server, events: got, builds: pack, via: MT.via };
    LS.set('karavan.meta', MT.data); MT.prices = {};
  } catch (e) { MT.err = e.message === 'empty' ? 'empty' : 'net'; }
  MT.busy = false; await metaPrice(); renderMeta();
}

function setIds(b, c) {
  const sfx = c.ench ? '@' + c.ench : '', cape = Object.entries(b.capes || {}).sort((x, y) => y[1] - x[1])[0];
  const parts = b.parts.concat([cape ? cape[0] : '']);
  return parts.map(p => p ? `T${c.tier}_${p}${sfx}` : '');
}
async function metaPrice() {
  if (!MT.data || MT.pricing) return;
  const c = MT.cfg, list = (MT.data.builds[c.group] || []).slice(0, 60), need = new Set();
  for (const b of list) for (const id of setIds(b, c)) if (id && !(id + '|' + c.city in MT.prices)) need.add(id);
  if (!need.size) return;
  MT.pricing = true;
  try {
    const P = {};
    await pooled(chunkIds([...need], 3300).map(ch => `${apiHost(cfg.server)}/api/v2/stats/prices/${ch.join(',')}.json?locations=${encodeURIComponent(c.city)}&qualities=1,2,3`), rows => indexPrices(rows, P));
    const now = Date.now();
    for (const id of need) {
      const p = (P[id] || {})[c.city] || {}; let best = 0;
      for (const q of [1, 2, 3]) if (p[q] && p[q].sell_price_min > 0 && ageH(p[q].sell_price_min_date, now) < 72 && (!best || p[q].sell_price_min < best)) best = p[q].sell_price_min;
      MT.prices[id + '|' + c.city] = best;
    }
  } catch (e) { }
  MT.pricing = false;
}
function setPrice(b, c) {
  let sum = 0, miss = 0; const items = setIds(b, c).map(id => { if (!id) return null; const p = MT.prices[id + '|' + c.city]; if (!p) miss++; else sum += p; return { id, p }; });
  return { sum, miss, items };
}

function renderMeta() {
  const el = $('#tab-meta'); if (el.hidden) return;
  const c = MT.cfg, d = MT.data, age = d ? Date.now() - d.time : Infinity;
  const setup = `<section class="setup"><h2>Мета-сеты</h2>
    <p class="imeta" style="margin:0 0 12px;color:var(--mute)">Сводка по последним убийствам с официального киллборда: какие сеты чаще всего убивают и сколько стоит собрать такой сет.</p>
    ${MT.err ? `<div class="note err">${MT.err === 'empty' ? 'Киллборд вернул пустой ответ, попробуй позже.' : 'Не получилось загрузить свежий киллборд напрямую. Ниже — последняя сводка с сайта Каравана, она обновляется раз в сутки.'}</div>` : ''}
    ${d ? `<div class="note ${age > DAY ? 'warn' : 'ok'}">Сводка от ${new Date(d.time).toLocaleString(LOC, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}, убийств: ${fmt(d.events)}.${age > DAY ? ' Сводка старше суток.' : ''}</div>` : ''}
    <div class="fld"><label for="mtGroup">Какие бои</label><select id="mtGroup">${MGROUP.map(([k, n]) => `<option value="${k}" ${c.group === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    <div class="two fld"><div><label for="mtTier">Собрать в тире</label><select id="mtTier">${[4, 5, 6, 7, 8].map(t => `<option value="${t}" ${c.tier === t ? 'selected' : ''}>T${t}</option>`).join('')}</select></div>
      <div><label for="mtEnch">Зачарование</label><select id="mtEnch">${[0, 1, 2, 3, 4].map(t => `<option value="${t}" ${c.ench === t ? 'selected' : ''}>.${t}</option>`).join('')}</select></div></div>
    <div class="two fld"><div><label for="mtBudget">Бюджет на сет</label><input id="mtBudget" type="text" placeholder="без лимита" value="${c.budget ? fmt(c.budget) : ''}"></div>
      <div><label for="mtCity">Где покупать</label><select id="mtCity">${CITIES.filter(x => !x.sellOnly).map(x => `<option value="${esc(x.id)}" ${x.id === c.city ? 'selected' : ''}>${x.name}</option>`).join('')}</select></div></div>
    <div class="two fld"><div><label for="mtKills">Сколько убийств брать</label><select id="mtKills">${[500, 1000, 2000].map(n => `<option value="${n}" ${c.kills === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      <div><label for="mtSort">Сортировать</label><select id="mtSort"><option value="kills" ${c.sort === 'kills' ? 'selected' : ''}>По убийствам</option><option value="wr" ${c.sort === 'wr' ? 'selected' : ''}>По доле побед</option><option value="price" ${c.sort === 'price' ? 'selected' : ''}>По цене</option></select></div></div>
    <button class="go" type="button" data-mt="refresh" ${MT.busy ? 'disabled' : ''}>${MT.busy ? 'Загружаю киллборд…' : d ? 'Обновить сводку' : 'Собрать сводку'}</button>
    <div class="gocap">Сводку раз в сутки собирает сайт Каравана, скачивать ничего не нужно</div>
    <div class="bar" id="mtbar" hidden><i></i></div></section>`;
  let right;
  if (!d) right = `<div class="empty"><h2>Что сейчас в мете?</h2><ol><li>Нажми «Собрать сводку»: Караван загрузит последние убийства с киллборда.</li><li>Выбери тир и бюджет: Караван посчитает цену каждого сета на рынке.</li><li>Сводка будет обновляться раз в сутки.</li></ol></div>`;
  else {
    let list = (d.builds[c.group] || []).slice(0, 60).map(b => Object.assign({}, b, { wr: b.kills / Math.max(1, b.kills + b.deaths), price: setPrice(b, c) }));
    if (c.budget) list = list.filter(b => b.price.sum > 0 && b.price.sum <= c.budget);
    list.sort((a, b) => c.sort === 'wr' ? b.wr - a.wr : c.sort === 'price' ? (a.price.sum || 9e15) - (b.price.sum || 9e15) : b.kills - a.kills);
    const SL = ['Оружие', 'Левая рука', 'Шлем', 'Броня', 'Обувь', 'Плащ'];
    right = !list.length ? `<div class="empty"><h2>Под этот бюджет сетов нет</h2><p>Подними бюджет, выбери тир пониже или другой рынок.</p></div>`
      : `<div class="sheet"><div class="sheethead"><h2>Мета: ${MGROUP.find(x => x[0] === c.group)[1].toLowerCase()}</h2><span>T${c.tier}.${c.ench}, цены: ${esc(cityName(c.city))}${MT.pricing ? ', считаю цены…' : ''}</span></div>
      <div class="list">${list.slice(0, 30).map((b, i) => `<div class="item"><div class="mrow">
        <div class="mname"><b>${i + 1}. ${esc(GEAR_NAME[b.parts[0]] || b.parts[0])}</b><div class="imeta">убийств ${b.kills}, смертей ${b.deaths}, побед ${Math.round(b.wr * 100)}%${b.ipn ? ', средний IP ' + Math.round(b.ip / b.ipn) : ''}</div></div>
        <div class="mnum"><b>${b.price.sum ? fmtShort(b.price.sum) : '—'}</b><span>${b.price.miss ? 'нет цены: ' + b.price.miss : 'цена сета'}</span></div></div>
        <div class="gear">${b.price.items.map((x, k) => x ? `<span class="gslot" title="${esc(SL[k] + ': ' + (GEAR_NAME[baseOf(x.id)] || baseOf(x.id)) + (x.p ? ', ' + fmt(x.p) : ', нет цены'))}"><b>${c.tier}.${c.ench}</b><img alt="" loading="lazy" src="https://render.albiononline.com/v1/item/${esc(x.id)}.png?size=64" onerror="this.remove()"><i>${x.p ? fmtShort(x.p) : '—'}</i></span>` : `<span class="gslot empty"><b>—</b><i>${SL[k]}</i></span>`).join('')}</div>
        <div class="imeta">${b.parts.slice(1).map((p, k) => p ? esc(SL[k + 1] + ': ' + (GEAR_NAME[p] || p)) : '').filter(Boolean).join(' · ')}</div></div>`).join('')}</div>
      <p class="imeta" style="margin-top:10px">«Побед» — доля убийств от всех появлений сета в выборке (убийства и смерти). Киллборд видит только бои со смертью, поэтому это ориентир, а не точная статистика.</p></div>`;
  }
  el.innerHTML = setup + `<section aria-live="off">${right}</section>`;
}
const SITE = 'https://enotsbeye.github.io/karavan-albion/';
/* Готовая сводка, которую раз в сутки собирает GitHub: работает с телефона, без счётчика */
async function metaFromSite() {
  try {
    const r = await fetch(SITE + 'data/meta-' + cfg.server + '.json?t=' + Math.floor(Date.now() / 6e5), { cache: 'no-store' });
    if (!r.ok) return false;
    const d = await r.json();
    if (d && d.builds && (!MT.data || MT.data.server !== cfg.server || d.time > MT.data.time)) { MT.data = d; LS.set('karavan.meta', d); MT.prices = {}; return true; }
  } catch (e) { }
  return false;
}
async function metaOpen() {
  renderMeta();
  if (!MT.busy && (!MT.data || Date.now() - MT.data.time > 6 * 3600e3 || MT.data.server !== cfg.server)) await metaFromSite();
  renderMeta();
  if (!MT.busy && (!MT.data || Date.now() - MT.data.time > DAY || MT.data.server !== cfg.server)) metaRefresh(); else metaPrice().then(renderMeta);
}
$('#tab-meta').addEventListener('click', e => { const b = e.target.closest('[data-mt]'); if (b && b.dataset.mt === 'refresh') metaRefresh(); });
$('#tab-meta').addEventListener('change', async e => {
  const t = e.target, c = MT.cfg;
  if (t.id === 'mtGroup') c.group = t.value; else if (t.id === 'mtTier') c.tier = +t.value; else if (t.id === 'mtEnch') c.ench = +t.value;
  else if (t.id === 'mtBudget') c.budget = parseSilver(t.value); else if (t.id === 'mtCity') c.city = t.value; else if (t.id === 'mtKills') c.kills = +t.value; else if (t.id === 'mtSort') c.sort = t.value; else return;
  mtSave(); renderMeta(); await metaPrice(); renderMeta();
});
