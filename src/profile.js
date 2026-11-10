"use strict";
/* ===== Караван: профиль — мастерство и куда тратить фокус ===== */
/* Расход фокуса = базовый × 0,5^(эффективность / 10 000).
   Эффективность = мастерство × 30 + специализация на этой вещи × 250 (+ другие специализации ветки × 30). */
const PF_AREAS = [
  ['farm', 'Огородник: поля'], ['herb', 'Травник: сады трав'], ['pasture', 'Скотовод: пастбища'], ['kennel', 'Скотовод: питомники'],
  ['ref:METALBAR', 'Переработка: слитки'], ['ref:PLANKS', 'Переработка: брусья'], ['ref:CLOTH', 'Переработка: ткань'], ['ref:LEATHER', 'Переработка: кожа'], ['ref:STONEBLOCK', 'Переработка: блоки'],
  ['melee', 'Крафт: ближний бой'], ['ranged', 'Крафт: дальний бой'], ['magic', 'Крафт: магия'], ['plate', 'Крафт: латы'], ['leather', 'Крафт: кожа'], ['cloth', 'Крафт: ткань'], ['offhand', 'Крафт: левая рука'], ['cape', 'Крафт: плащи'], ['bag', 'Крафт: сумки']
];
const PF = { cfg: Object.assign({ focusDay: 10000, other: true, lv: {} }, LS.get('karavan.profile', {})) };
const pfSave = () => LS.set('karavan.profile', PF.cfg);
function fceOf(area) { const l = PF.cfg.lv[area] || {}; return (l.m || 0) * 30 + (l.s || 0) * 250 + (PF.cfg.other ? (l.o || 0) * 30 : 0); }
function focusFactor(area) { return Math.pow(0.5, fceOf(area) / 10000); }

/* Все способы потратить фокус, у которых есть цены: крафт и переработка (вкладка «Крафт»), остров (вкладка «Остров») */
function pfUses() {
  const out = [];
  if (typeof CF !== 'undefined' && CF.scan) {
    for (const u of focusUses(CF.scan, Object.assign({}, CF.cfg, { src: CF.scan.src, dst: CF.scan.dst }), Date.now(), true)) {
      const cap = u.kind === 'refine' ? 2000 : 30;
      out.push({ src: u.kind === 'refine' ? 'Переработка' : 'Крафт', name: u.name, where: u.where, cost: u.focus, gain: u.gain * u.conf, cap, unit: 'шт.' });
    }
  }
  if (FM.scan) {
    const c = FM.cfg, rows = farmCalc(FM.scan.P, Object.assign({}, c, { city: FM.scan.city }), Date.now()), n = { farm: c.farm, herbgarden: c.herb, pasture: c.pasture, kennel: c.kennel };
    for (const k of Object.keys(n)) {
      if (!(n[k] > 0)) continue;
      const best = rows.filter(r => r.kind === k && r.fday && r.pf > r.pn).sort((a, b) => (b.pf - b.pn) / b.fday - (a.pf - a.pn) / a.fday)[0];
      if (best) out.push({ src: FKIND[k], name: best.name + ' T' + best.t, where: cityName(FM.scan.city), cost: best.fday * focusFactor(k === 'herbgarden' ? 'herb' : k), gain: best.pf - best.pn, cap: n[k] * c.slots, unit: 'мест' });
    }
  }
  for (const u of out) u.spf = u.gain / Math.max(1, u.cost);
  return out.filter(u => u.spf > 0).sort((a, b) => b.spf - a.spf);
}
function pfPlan(uses) {
  let left = PF.cfg.focusDay; const plan = [];
  for (const u of uses) { if (left < u.cost) continue; const k = Math.min(u.cap, Math.floor(left / u.cost)); if (k < 1) continue; left -= k * u.cost; plan.push({ u, k, focus: k * u.cost, gain: k * u.gain }); }
  return { plan, left, total: plan.reduce((s, p) => s + p.gain, 0) };
}

function renderProfile() {
  const el = $('#tab-profile'); if (el.hidden) return;
  const c = PF.cfg, step = (id, v, max, st, wide) => `<div class="stepper sm${wide ? ' wide' : ''}"><button type="button" data-ps="-${st}" data-for="${id}" aria-label="Меньше">−</button><input id="${id}" type="text" inputmode="numeric" value="${v}" data-max="${max}"><button type="button" data-ps="${st}" data-for="${id}" aria-label="Больше">+</button></div>`;
  const rows = PF_AREAS.map(([k, n]) => { const l = c.lv[k] || {}, f = focusFactor(k); return `<tr><td>${esc(n)}</td><td>${step('m|' + k, l.m || 0, 100, 10)}</td><td>${step('s|' + k, l.s || 0, 100, 10)}</td><td class="pfx">${Math.round(f * 100)}%</td></tr>`; }).join('');
  const uses = pfUses(), pl = pfPlan(uses);
  const need = [];
  if (typeof CF === 'undefined' || !CF.scan) need.push('<button type="button" class="tbtn2" data-pp="craft">Посчитать крафт и переработку</button>');
  if (!FM.scan) need.push('<button type="button" class="tbtn2" data-pp="farm">Посчитать остров</button>');
  el.innerHTML = `<section class="setup"><h2>Профиль</h2>
    <label class="switch" style="margin-bottom:12px"><input type="checkbox" id="pPrem" ${cfg.premium ? 'checked' : ''}> Премиум-статус</label>
    <div class="fld"><label>Фокуса в день</label>${step('pFocus', c.focusDay, 60000, 1000, 1)}<div class="hint">С премиумом дают 10 000 в день. Если копил, укажи, сколько есть сейчас.</div></div>
    <div class="hint" style="margin-bottom:8px">Мастерство — уровень общей ветки (например, «Огородник» или «Кузнец»), специализация — уровень на то, что делаешь чаще всего. В последнем столбце — сколько фокуса уходит от обычного.</div>
    <div class="pftable"><table><thead><tr><th>Ветка</th><th>Мастерство</th><th>Специализация</th><th>Фокус</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="imeta" style="margin-top:8px">Формула из открытых калькуляторов: расход = базовый × 0,5^(эффективность / 10 000), эффективность = мастерство × 30 + специализация × 250.</p></section>
    <section aria-live="off"><div class="sheet"><div class="sheethead"><h2>Куда лить фокус сегодня</h2><span>${fmt(c.focusDay)} очков</span></div>
    ${need.length ? `<p class="imeta">Для совета нужны цены: ${need.join(' ')}</p>` : ''}
    ${pl.plan.length ? `<div class="sum"><div class="big"><span>Фокус принесёт сверху</span><b>+${fmt(pl.total)}</b><small>Это прибавка к тому, что дали бы те же действия без фокуса.${pl.left > 100 ? ' Останется ' + fmt(pl.left) + ' фокуса.' : ''}</small></div></div>
    <div class="list">${pl.plan.map((p, i) => `<div class="item"><div class="mrow"><div class="mname"><b>${i + 1}. ${esc(p.u.src)}: ${esc(p.u.name)}</b><div class="imeta">${esc(p.u.where)} · ${fmt(p.k)} ${p.u.unit} × ${fmt(p.u.cost)} фокуса = ${fmt(p.focus)}</div></div><div class="mnum"><b>+${fmtShort(p.gain)}</b><span>${p.u.spf.toFixed(1).replace('.', ',')} за очко</span></div></div></div>`).join('')}</div>`
      : (need.length ? '' : '<p>По текущим ценам фокус нигде не даёт прибавки. Попробуй другие тиры в «Крафте» или другой рынок на «Острове».</p>')}
    ${uses.length > pl.plan.length ? `<details class="left"><summary>Другие варианты: ${uses.length - pl.plan.length}</summary><ul>${uses.filter(u => !pl.plan.some(p => p.u === u)).slice(0, 15).map(u => `<li>${esc(u.src)}: ${esc(u.name)} — ${u.spf.toFixed(1).replace('.', ',')} серебра за очко</li>`).join('')}</ul></details>` : ''}
    </div></section>`;
}
function pfSetFromInput(inp, v) {
  const id = inp.id, max = +inp.dataset.max; v = Math.max(0, Math.min(max, Math.round(+v || 0)));
  if (id === 'pFocus') PF.cfg.focusDay = v;
  else { const [w, k] = id.split('|'); PF.cfg.lv[k] = Object.assign({}, PF.cfg.lv[k], { [w]: v }); }
  pfSave(); renderProfile();
}
$('#tab-profile').addEventListener('click', e => {
  const s = e.target.closest('[data-ps]');
  if (s) { const inp = document.getElementById(s.dataset.for); return pfSetFromInput(inp, (+String(inp.value).replace(/\s/g, '') || 0) + (+s.dataset.ps)); }
  const b = e.target.closest('[data-pp]'); if (!b) return;
  b.disabled = true; b.textContent = 'Считаю…';
  (b.dataset.pp === 'craft' ? craftScan(false) : farmScan(false)).then(renderProfile);
});
$('#tab-profile').addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'pPrem') { cfg.premium = t.checked; saveCfg(); const p = $('#premium'); if (p) p.checked = cfg.premium; return renderProfile(); }
  if (t.dataset.max) pfSetFromInput(t, String(t.value).replace(/\s/g, ''));
});
$('#tab-profile').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset && e.target.dataset.max) e.target.blur(); });
