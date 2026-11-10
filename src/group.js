"use strict";
/* ===== Караван: урон группы (данные от KaravanMeter.exe) ===== */
const GM = { url: 'http://127.0.0.1:48713', data: null, err: null, view: 'current', timer: 0, lastOk: 0 };
const SLOT = ['Оружие', 'Л. рука', 'Шлем', 'Броня', 'Обувь', 'Сумка', 'Плащ', 'Маунт', 'Зелье', 'Еда'];
const HEAL_WEAPONS = /(HOLYSTAFF|NATURESTAFF)/;
const GEAR_NAME = (() => { const m = {}; for (const g of DB.gear) m[g[0]] = g[1]; return m; })();

function parseItem(uid) {
  if (!uid) return null;
  const m = uid.match(/^T(\d)_(.+?)(?:@(\d))?$/); if (!m) return { uid, t: 0, e: 0, base: uid };
  return { uid, t: +m[1], e: +(m[3] || 0), base: m[2].replace(/_LEVEL\d$/, '') };
}
function itemLabel(it, slot) {
  if (!it) return '';
  const n = GEAR_NAME[it.base];
  if (n) return n;
  return slot === 8 ? 'Зелье' : slot === 9 ? 'Еда' : slot === 7 ? 'Маунт' : it.base.toLowerCase().replace(/_/g, ' ');
}
const isHealer = eq => !!(eq && eq[0] && HEAL_WEAPONS.test(eq[0]));
const gearTier = eq => { const s = [0, 2, 3, 4].map(i => parseItem(eq && eq[i])).filter(Boolean); return s.length ? s.reduce((a, x) => a + x.t + x.e, 0) / s.length : null; };

async function gmPoll() {
  if ($('#tab-group').hidden || document.hidden) return;
  try {
    const ac = new AbortController(), tm = setTimeout(() => ac.abort(), 2500);
    const r = await fetch(GM.url + '/state', { signal: ac.signal, cache: 'no-store' }); clearTimeout(tm);
    GM.data = await r.json(); GM.err = null; GM.lastOk = Date.now();
  } catch (e) { GM.err = 'off'; }
  renderGroup();
}
function gmStart() { gmPoll(); clearInterval(GM.timer); GM.timer = setInterval(gmPoll, 1000); }
function gmStop() { clearInterval(GM.timer); GM.timer = 0; }

function analyse(f) {
  const rows = Object.values(f.players || {}), dur = Math.max(1, (f.end - f.start) / 1000);
  const totD = rows.reduce((s, r) => s + r.damage, 0), totH = rows.reduce((s, r) => s + r.heal, 0);
  for (const r of rows) { r.healer = isHealer(r.equip); r.dps = r.damage / dur; r.hps = r.heal / dur; r.share = totD ? r.damage / totD : 0; r.tier = gearTier(r.equip); }
  const dd = rows.filter(r => !r.healer).map(r => r.dps).sort((a, b) => a - b), med = dd.length ? dd[Math.floor(dd.length / 2)] : 0;
  const tiers = rows.map(r => r.tier).filter(x => x != null), avgT = tiers.length ? tiers.reduce((a, b) => a + b, 0) / tiers.length : null;
  for (const r of rows) {
    r.flags = [];
    if (!r.healer && rows.length > 1 && med > 0 && r.dps < med * 0.6) r.flags.push(`урон на ${Math.round((1 - r.dps / med) * 100)}% ниже середины группы`);
    if (r.healer && totD > 0 && r.heal < totD * 0.05) r.flags.push('почти не лечит');
    if (r.equip && r.equip.some(Boolean)) { if (!r.equip[8]) r.flags.push('без зелья'); if (!r.equip[9]) r.flags.push('без еды'); }
    if (avgT != null && r.tier != null && r.tier < avgT - 0.75) r.flags.push('снаряжение слабее группы');
  }
  rows.sort((a, b) => (b.damage + b.heal) - (a.damage + a.heal));
  return { rows, dur, totD, totH };
}

function gearHTML(eq) {
  if (!eq || !eq.some(Boolean)) return '<div class="imeta">Снаряжение пока не видно: подойди к игроку поближе.</div>';
  return `<div class="gear">${eq.map((u, i) => { const it = parseItem(u); return `<span class="gslot${it ? '' : ' empty'}" title="${esc(SLOT[i] + (it ? ': ' + itemLabel(it, i) + ' ' + it.t + '.' + it.e : ': пусто'))}">${it ? `<b>${it.t}.${it.e}</b><img alt="" loading="lazy" src="https://render.albiononline.com/v1/item/${esc(u)}.png?size=64" onerror="this.remove()">` : '<b>—</b>'}<i>${SLOT[i]}</i></span>`; }).join('')}</div>`;
}

function fightHTML(f, live) {
  const a = analyse(f), maxV = Math.max(1, ...a.rows.map(r => Math.max(r.damage, r.heal)));
  const when = new Date(f.start).toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return `<div class="sheet"><div class="sheethead"><h2>${live ? 'Текущий бой' : 'Бой в ' + when}</h2><span>${mmssG(a.dur)} · урон ${fmtShort(a.totD)} · хил ${fmtShort(a.totH)}</span></div>
    <div class="list">${a.rows.map((r, i) => `<div class="item"><div class="mrow">
      <div class="mname"><b>${i + 1}. ${esc(r.name)}</b>${r.self ? ' <span class="tag">это ты</span>' : ''}${r.healer ? ' <span class="tag">хил</span>' : ''}<div class="imeta">${esc(itemLabel(parseItem(r.equip && r.equip[0]), 0) || 'оружие не видно')}${r.tier != null ? ', тир снаряжения ≈ ' + r.tier.toFixed(1).replace('.', ',') : ''}</div></div>
      <div class="mnum"><b>${fmtShort(r.damage)}</b><span>${fmtShort(r.dps)}/с · ${(r.share * 100).toFixed(0)}%</span></div></div>
      <div class="mbar"><i class="d" style="width:${(r.damage / maxV * 100).toFixed(1)}%"></i></div>
      ${r.heal > 0 ? `<div class="mbar"><i class="h" style="width:${(r.heal / maxV * 100).toFixed(1)}%"></i></div><div class="imeta">Хил ${fmtShort(r.heal)} (${fmtShort(r.hps)}/с)</div>` : ''}
      <div class="imeta">Получил урона ${fmtShort(r.taken)}</div>
      ${r.flags.length ? `<div class="flags">${r.flags.map(x => `<span>${esc(x)}</span>`).join('')}</div>` : ''}
      ${gearHTML(r.equip)}</div>`).join('')}</div>
    <div class="acts"><button type="button" class="tbtn" data-g="copy">Скопировать итог боя</button></div></div>`;
}
const mmssG = s => { s = Math.round(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

function setupGroupHTML() {
  const d = GM.data;
  let status;
  if (GM.err || !d) status = `<div class="note warn"><b>Счётчик не запущен.</b> Скачай KaravanMeter.exe в разделе Releases на GitHub и запусти его на том же компьютере, где играешь. Нужен бесплатный драйвер <a href="https://npcap.com/" target="_blank" rel="noopener">Npcap</a>: при установке отметь «WinPcap API-compatible Mode».</div>`;
  else if (!d.packets) status = `<div class="note warn">Счётчик запущен, но пакетов игры пока нет. Зайди в игру. Если ты уже в игре, перезапусти счётчик от имени администратора.</div>`;
  else if (!d.events) status = `<div class="note warn">Пакеты игры идут, но события урона не распознаются${d.encrypted ? ' (часть данных зашифрована)' : ''}. Скорее всего, после обновления игры поменялись коды событий: напиши, обновлю счётчик.</div>`;
  else status = `<div class="note ok">Счётчик работает${d.self ? ': ты — ' + esc(d.self) : ''}. Пакетов: ${fmt(d.packets)}, событий: ${fmt(d.events)}.</div>${UPD.meter > (d.version || 1) ? `<div class="note warn">Вышла новая версия счётчика. <a href="${UPD.release}" target="_blank" rel="noopener">Скачать с GitHub</a>, затем замени KaravanMeter.exe в папке Каравана.</div>` : ''}`;
  const party = (d && d.party) || [];
  return `<section class="setup"><h2>Группа</h2>${status}
    ${party.length ? `<div class="chipgroup"><span class="lbl">Пати</span>${party.map(p => `<div class="pmem"><b>${esc(p.name)}</b>${p.seen ? '' : ' <span class="imeta">не рядом</span>'}${p.seen ? gearHTML(p.equip) : ''}</div>`).join('')}</div>` : ''}
    <div class="acts"><button type="button" class="tbtn2" data-g="reset" ${GM.err ? 'disabled' : ''}>Начать новый бой</button><button type="button" class="tbtn2" data-g="clear" ${GM.err ? 'disabled' : ''}>Очистить историю</button></div></section>`;
}
function renderGroup() {
  const el = $('#tab-group'); if (el.hidden) return;
  const d = GM.data, hist = (d && d.history) || [];
  let right = '';
  const cur = d && d.current && Object.keys(d.current.players || {}).length ? d.current : null;
  const sel = GM.view === 'current' ? (cur || hist[0]) : hist[+GM.view];
  if (sel) right += fightHTML(sel, sel === cur);
  else right += `<div class="empty"><h2>Здесь будет урон группы</h2><ol><li>Запусти KaravanMeter.exe и зайди в игру.</li><li>Собери пати и начни бой.</li><li>Здесь появится урон, хил и снаряжение каждого, а также кто отстаёт.</li></ol></div>`;
  if (hist.length) right += `<div class="journal" style="margin-top:16px"><h2>Прошлые бои</h2>${cur ? `<div class="jrow"><div>Текущий бой<small>идёт сейчас</small></div><span></span><button type="button" data-g="view" data-v="current">Открыть</button></div>` : ''}${hist.map((f, i) => { const a = analyse(JSON.parse(JSON.stringify(f))); return `<div class="jrow"><div>${new Date(f.start).toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit' })}, ${mmssG(a.dur)}<small>урон ${fmtShort(a.totD)}, лучший: ${esc((a.rows[0] || {}).name || '—')}</small></div><span></span><button type="button" data-g="view" data-v="${i}">Открыть</button></div>`; }).join('')}</div>`;
  const keepScroll = window.scrollY;
  el.innerHTML = setupGroupHTML() + `<section aria-live="off">${right}</section>`;
  window.scrollTo(0, keepScroll);
}
function fightText(f) {
  const a = analyse(JSON.parse(JSON.stringify(f)));
  return [`Бой ${mmssG(a.dur)}, урон ${fmt(a.totD)}, хил ${fmt(a.totH)}`].concat(a.rows.map((r, i) => `${i + 1}. ${r.name}: урон ${fmt(r.damage)} (${fmt(r.dps)}/с, ${(r.share * 100).toFixed(0)}%)${r.heal ? ', хил ' + fmt(r.heal) : ''}${r.flags.length ? ' — ' + r.flags.join(', ') : ''}`)).join('\n');
}
$('#tab-group').addEventListener('click', async e => {
  const b = e.target.closest('[data-g]'); if (!b) return;
  const a = b.dataset.g;
  if (a === 'view') { GM.view = b.dataset.v; return renderGroup(); }
  if (a === 'reset' || a === 'clear') { try { await fetch(GM.url + '/reset' + (a === 'clear' ? '?all=1' : ''), { method: 'POST' }); GM.view = 'current'; toast(a === 'clear' ? 'История очищена' : 'Начат новый бой'); } catch (x) { toast('Счётчик не отвечает'); } return gmPoll(); }
  if (a === 'copy') {
    const d = GM.data, f = GM.view === 'current' ? ((d.current && Object.keys(d.current.players || {}).length) ? d.current : d.history[0]) : d.history[+GM.view];
    if (!f) return; const txt = fightText(f);
    navigator.clipboard.writeText(txt).then(() => toast('Итог боя скопирован'), () => { modal(`<h3>Итог боя</h3><textarea readonly>${esc(txt)}</textarea><div class="dlgacts"><button type="button" data-close>Закрыть</button></div>`); $('#modal textarea').select(); });
  }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('#tab-group').hidden) gmPoll(); });
