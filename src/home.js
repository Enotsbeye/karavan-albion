"use strict";
/* ===== Караван: главная со сводкой ===== */
async function homeFetch() {
  const get = async p => { const ac = new AbortController(), tm = setTimeout(() => ac.abort(), 2000); try { const r = await fetch(GM.url + p, { signal: ac.signal, cache: 'no-store' }); return await r.json(); } finally { clearTimeout(tm); } };
  try { GM.data = await get('/state'); GM.err = null; } catch (e) { GM.err = 'off'; }
  try { MP.data = await get('/maps'); MP.err = null; await mpPrice(); } catch (e) { MP.err = 'off'; }
  if (!$('#tab-home').hidden) renderHome();
}
function renderHome() {
  const el = $('#tab-home'); if (el.hidden) return;
  const card = (title, num, lines, tab, btn, cls) => `<div class="hc"><h3>${title}</h3><b class="n ${cls || ''}">${num}</b>${lines.filter(Boolean).map(l => `<p>${l}</p>`).join('')}<button type="button" data-go="${tab}">${btn}</button></div>`;
  const out = [];
  /* рейс */
  if (S.plan && S.plan.rows.length) {
    const pc = planCfg(), rk = routeRisk(pc.src, pc.dst);
    out.push(card('Рейс', '+' + fmtShort(S.plan.totals.exp), [`${esc(cityName(pc.src))} → ${esc(cityName(pc.dst))}, ${S.plan.rows.length} ${plural(S.plan.rows.length, 'позиция', 'позиции', 'позиций')}`, `Вложить ${fmtShort(S.plan.totals.cost)}, риск ${String(rk.p).replace('.', ',')}%, цены в ${hhmm(S.scan.time)}`], 'run', 'Открыть накладную', 'pos'));
  } else out.push(card('Рейс', '—', ['Груз ещё не собран. Укажи серебро и вес, Караван подберёт самый выгодный набор.'], 'run', 'Собрать груз'));
  /* крафт */
  if (typeof CF !== 'undefined' && CF.plan && CF.plan.plan.length) { const t = CF.plan.t, top = CF.plan.plan[0].r.it; out.push(card('Крафт', '+' + fmtShort(t.exp), [`Лучшее: ${esc(top.name)} ${tierLabel(top)}`, `Вложить ${fmtShort(t.cost)}, вещей ${t.n}`], 'craft', 'Открыть план', 'pos')); }
  else out.push(card('Крафт', '—', ['План крафта ещё не посчитан.'], 'craft', 'Найти выгодный крафт'));
  /* остров */
  if (FM.summary && FM.summary.total > 0) out.push(card('Остров', '+' + fmtShort(FM.summary.total), ['в день', esc(FM.summary.plan[0] || '')], 'farm', 'Открыть остров', 'pos'));
  else out.push(card('Остров', '—', ['Укажи свои участки, и Караван посчитает прибыль в день.'], 'farm', 'Посчитать остров'));
  /* мета */
  if (MT.data && MT.data.builds && (MT.data.builds.all || []).length) { const top = MT.data.builds.all.slice(0, 3).map(b => esc(GEAR_NAME[b.parts[0]] || b.parts[0])); out.push(card('Мета дня', top[0], [top.slice(1).length ? 'Дальше: ' + top.slice(1).join(', ') : '', `Сводка от ${new Date(MT.data.time).toLocaleString(LOC, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}, убийств: ${fmt(MT.data.events)}`], 'meta', 'Открыть сеты')); }
  else out.push(card('Мета дня', '—', ['Сводка сетов по киллборду ещё не собрана.'], 'meta', 'Собрать сводку'));
  /* группа */
  const d = GM.data, f = d && !GM.err ? ((d.current && Object.keys(d.current.players || {}).length) ? d.current : (d.history || [])[0]) : null;
  if (f) { const a = analyse(JSON.parse(JSON.stringify(f))), lag = a.rows.filter(r => r.flags.length); out.push(card('Группа', fmtShort(a.totD), [`Последний бой ${mmssG(a.dur)}, лучший: ${esc((a.rows[0] || {}).name || '—')}`, lag.length ? 'Отстают: ' + lag.map(r => esc(r.name)).join(', ') : 'Никто не отстаёт'], 'group', 'Открыть бой')); }
  else out.push(card('Группа', GM.err || !d ? 'Выкл.' : 'Ждёт боя', [GM.err || !d ? 'Счётчик не запущен. Запусти KaravanMeter.exe перед игрой.' : 'Счётчик работает, боёв пока не было.'], 'group', 'Открыть группу'));
  /* карты */
  const maps = MP.data && !MP.err ? mpAggregate().filter(a => a.h >= 0.25).sort((a, b) => b.ph - a.ph) : [];
  if (maps.length) out.push(card('Карты', fmtShort(maps[0].ph), [`в час: ${esc(maps[0].info.name)}`, `Записано заходов: ${(MP.data.visits || []).length}`], 'maps', 'Открыть рейтинг'));
  else out.push(card('Карты', '—', ['Рейтинг карт появится после нескольких заходов с запущенным счётчиком.'], 'maps', 'Открыть карты'));
  /* журнал */
  const j = LS.get('karavan.journal', []), tot = j.reduce((s, r) => s + r.profit, 0);
  out.push(card('Журнал', j.length ? (tot >= 0 ? '+' : '−') + fmtShort(Math.abs(tot)) : '—', [j.length ? `Рейсов: ${j.length}, потеряно грузов: ${j.filter(r => r.lost).length}` : 'Завершённых рейсов пока нет.'], 'journal', 'Открыть журнал', j.length ? (tot >= 0 ? 'pos' : 'negc') : ''));
  el.innerHTML = `<h2 class="pagetitle">Сводка</h2><div class="home">${out.join('')}</div>`;
}
$('#tab-home').addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) showTab(b.dataset.go); });
showTab('home');
