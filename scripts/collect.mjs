// Сбор открытых данных киллборда для Каравана (запускается GitHub Actions каждый час).
// activity-<server>.json — убийств в минуту по часам (для прайм-тайма и риска дороги).
// meta-<server>.json — мета-сеты по последним ~1000 убийствам (раз в сутки).
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
  // Мета раз в сутки
  const meta = await readJSON(`data/meta-${server}.json`, null);
  if (meta && now - meta.time < 20 * 3600e3) continue;
  const seen = new Set(), B = { all: {}, solo: {}, small: {}, large: {} };
  const add = (cat, eq, kind, ip) => {
    if (!eq || !eq.MainHand) return;
    const parts = ['MainHand', 'OffHand', 'Head', 'Armor', 'Shoes'].map(s => baseOf(eq[s] && eq[s].Type)), key = parts.join('|');
    for (const c of ['all', cat]) {
      const b = B[c][key] || (B[c][key] = { parts, kills: 0, deaths: 0, ip: 0, ipn: 0, capes: {} });
      b[kind]++;
      if (kind === 'kills' && ip) { b.ip += ip; b.ipn++; }
      const cp = baseOf(eq.Cape && eq.Cape.Type); if (cp && kind === 'kills') b.capes[cp] = (b.capes[cp] || 0) + 1;
    }
  };
  for (let i = 0; i < 20; i++) {
    const arr = await page(host, i * 51); if (!arr.length) break;
    for (const ev of arr) {
      if (seen.has(ev.EventId)) continue; seen.add(ev.EventId);
      const g = ev.groupMemberCount || 1, cat = g <= 1 ? 'solo' : g <= 5 ? 'small' : 'large';
      add(cat, ev.Killer && ev.Killer.Equipment, 'kills', ev.Killer && ev.Killer.AverageItemPower);
      add(cat, ev.Victim && ev.Victim.Equipment, 'deaths', 0);
    }
    await sleep(400);
  }
  if (!seen.size) continue;
  const builds = {}; for (const c in B) builds[c] = Object.values(B[c]).filter(b => b.kills >= 2).sort((a, b) => b.kills - a.kills).slice(0, 150);
  await fs.writeFile(`data/meta-${server}.json`, JSON.stringify({ time: now, server, events: seen.size, builds, via: 'github' }));
}
