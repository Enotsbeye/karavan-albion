// Сбор открытых данных киллборда для Каравана (запускается GitHub Actions каждый час).
// activity-<server>.json — убийств в минуту по часам (для прайм-тайма и риска дороги).
// meta-<server>.json — мета по оружию за последние сутки: убийства копятся каждый час, вес старых падает вдвое за 12 часов.
import fs from 'node:fs/promises';

const HOSTS = { europe: 'gameinfo-ams.albiononline.com', west: 'gameinfo.albiononline.com', east: 'gameinfo-sgp.albiononline.com' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const baseOf = t => t ? t.replace(/^T\d_/, '').replace(/@\d$/, '') : '';

async function page(host, offset) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`https://${host}/api/gameinfo/events?limit=51&offset=${offset}`, { headers: { 'User-Agent': 'karavan-albion (github.com/Enotsbeye/karavan-albion)' } });
      if (r.ok) return await r.json();
    } catch (e) { }
    await sleep(3000 * (i + 1));
  }
  return [];
}
const SLOTS = ['OffHand', 'Head', 'Armor', 'Shoes', 'Cape'];
function addW(W, cat, eq, kind, ip) {
  if (!eq || !eq.MainHand) return;
  const wpn = baseOf(eq.MainHand.Type); if (!wpn) return;
  for (const c of ['all', cat]) {
    const w = W[c][wpn] || (W[c][wpn] = { kills: 0, deaths: 0, ip: 0, ipn: 0, s: {} });
    w[kind]++;
    if (kind !== 'kills') continue;
    if (ip) { w.ip += ip; w.ipn++; }
    for (const sl of SLOTS) { const it = baseOf(eq[sl] && eq[sl].Type) || '-'; const m = w.s[sl] || (w.s[sl] = {}); m[it] = (m[it] || 0) + 1; }
  }
}
function scale(w, f) { w.kills *= f; w.deaths *= f; w.ip *= f; w.ipn *= f; for (const sl in w.s) for (const k in w.s[sl]) { w.s[sl][k] *= f; if (w.s[sl][k] < 0.2) delete w.s[sl][k]; } }
function packW(W) {
  const out = {};
  for (const c in W) out[c] = Object.entries(W[c]).filter(([, w]) => w.kills >= 2).map(([wpn, w]) => {
    const top = sl => Object.entries(w.s[sl] || {}).sort((a, b) => b[1] - a[1]);
    const alt = {}; for (const sl of SLOTS) { const t = top(sl), n = t.reduce((x, y) => x + y[1], 0) || 1; alt[sl] = t.slice(0, 3).map(([k, v]) => [k === '-' ? '' : k, Math.round(v / n * 100)]); }
    const pick = sl => (alt[sl][0] || [''])[0];
    return { parts: [wpn, pick('OffHand'), pick('Head'), pick('Armor'), pick('Shoes')], capes: Object.fromEntries((alt.Cape || []).filter(x => x[0]).map(x => [x[0], x[1]])), alt, kills: Math.round(w.kills), deaths: Math.round(w.deaths), ip: Math.round(w.ip), ipn: Math.round(w.ipn) };
  }).sort((a, b) => b.kills - a.kills).slice(0, 120);
  return out;
}
async function readJSON(p, d) { try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch (e) { return d; } }

for (const [server, host] of Object.entries(HOSTS)) {
  const now = Date.now();
  // Активность
  const evs = [...await page(host, 0), ...await page(host, 51)];
  const ts = evs.map(e => Date.parse(e.TimeStamp)).filter(Number.isFinite).sort((a, b) => a - b);
  const act = await readJSON(`data/activity-${server}.json`, []);
  if (ts.length > 20 && now - ts[ts.length - 1] < 3600e3) {
    const mins = Math.max(1, (ts[ts.length - 1] - ts[0]) / 6e4);
    act.push({ ts: now, hour: new Date(now).getUTCHours(), rate: Math.round(ts.length / mins * 100) / 100 });
  }
  await fs.writeFile(`data/activity-${server}.json`, JSON.stringify(act.filter(x => now - x.ts < 30 * 864e5)));
  // Мета: копим убийства каждый час, старые постепенно забываются (половина веса за 12 часов)
  const stPath = `data/meta-state-${server}.json`, S0 = await readJSON(stPath, null);
  const S = S0 && S0.v === 2 ? S0 : { v: 2, lastId: 0, time: now, events: 0, W: { all: {}, solo: {}, small: {}, large: {} } };
  const decay = Math.pow(0.5, Math.max(0, now - S.time) / (12 * 3600e3));
  for (const c in S.W) for (const k in S.W[c]) { const w = S.W[c][k]; scale(w, decay); if (w.kills + w.deaths < 0.3) delete S.W[c][k]; }
  S.events *= decay;
  let maxId = S.lastId, fresh = 0;
  for (let i = 0; i < 20; i++) {
    const arr = await page(host, i * 51); if (!arr.length) break;
    let old = false;
    for (const ev of arr) {
      if (ev.EventId <= S.lastId) { old = true; continue; }
      maxId = Math.max(maxId, ev.EventId); fresh++;
      const g = ev.groupMemberCount || 1, cat = g <= 1 ? 'solo' : g <= 5 ? 'small' : 'large';
      addW(S.W, cat, ev.Killer && ev.Killer.Equipment, 'kills', ev.Killer && ev.Killer.AverageItemPower);
      addW(S.W, cat, ev.Victim && ev.Victim.Equipment, 'deaths', 0);
    }
    if (old) break;
    await sleep(400);
  }
  if (!fresh && !S0) continue;
  S.lastId = maxId; S.time = now; S.events += fresh;
  await fs.writeFile(stPath, JSON.stringify(S));
  await fs.writeFile(`data/meta-${server}.json`, JSON.stringify({ time: now, server, events: Math.round(S.events), builds: packW(S.W), via: 'github', window: 'сутки' }));
}
