"use strict";
/* ===== Караван: обновление через GitHub =====
   Сайт на GitHub Pages всегда свежий. Программа для Windows раз в 6 часов (и по кнопке) смотрит version.json на сайте,
   скачивает новую страницу, кладёт её в localStorage и предлагает перезапуск. Загрузчик программы запускает самую новую версию,
   а если она не смогла запуститься, возвращается к встроенной. Настройки и журнал не теряются: адрес страницы тот же. */
const BUILD = /*__BUILD__*/0;
const UPD = { site: 'https://enotsbeye.github.io/karavan-albion/', release: 'https://github.com/Enotsbeye/karavan-albion/releases/latest', meter: 0, busy: false, ready: 0 };
const IS_SITE = /github\.io$/.test(location.hostname);
const buildDate = b => b ? new Date(b * 1000).toLocaleString(LOC, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'разработка';

async function checkUpdate(manual) {
  if (UPD.busy) return;
  UPD.busy = true; updLine();
  try {
    const r = await fetch(UPD.site + 'version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const v = await r.json();
    UPD.meter = v.meter || 0;
    if (typeof renderGroup === 'function' && !$('#tab-group').hidden) renderGroup();
    if (IS_SITE || !(v.build > BUILD)) { if (manual) toast(IS_SITE ? 'Сайт всегда последней версии' : 'У тебя последняя версия'); return; }
    if ((+LS.get('karavan.codev', 0)) >= v.build) { UPD.ready = v.build; return; }
    if ((+LS.get('karavan.badv', 0)) === v.build) return;
    const h = await fetch(UPD.site + 'index.html?t=' + Date.now(), { cache: 'no-store' });
    if (!h.ok) throw new Error('HTTP ' + h.status);
    const code = await h.text();
    if (!code.includes('/* karavan-build ' + v.build + ' */')) throw new Error('bad');
    localStorage.setItem('karavan.code', code); localStorage.setItem('karavan.codev', String(v.build));
    UPD.ready = v.build;
  } catch (e) { if (manual) toast('Не удалось проверить обновления. Проверь интернет.'); }
  finally { UPD.busy = false; updLine(); }
}
function updLine() {
  const el = $('#updLine'); if (!el) return;
  el.innerHTML = UPD.ready
    ? `<button type="button" class="updbtn" data-upd="restart">Обновление готово — перезапустить</button>`
    : `<span>Версия: ${esc(buildDate(BUILD))}</span><button type="button" class="linkbtn" data-upd="check">${UPD.busy ? 'Проверяю…' : 'Проверить обновления'}</button>`;
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-upd]'); if (!b) return;
  if (b.dataset.upd === 'restart') location.reload();
  else checkUpdate(true);
});
try { localStorage.setItem('karavan.okv', String(BUILD)); } catch (e) { }
updLine();
if (BUILD) { setTimeout(() => checkUpdate(false), 4000); setInterval(() => checkUpdate(false), 6 * 3600e3); }
