// im-hits — visitor counting for ianduncanmagee.com, self-hosted on Ian's
// existing Railway (no third-party analytics account, no cookies, NO IPs).
// POST /hit {p,r}  ← 3-line beacon on the site
// GET  /stats?token=…&days=7  → totals, per-day, top paths, top referrers
const http = require('http'), { Client } = require('pg'), url = require('url'), crypto = require('crypto');
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.STATS_TOKEN || '';
const ORIGINS = ['https://www.ianduncanmagee.com','https://ianduncanmagee.com'];
const geoCache = new Map();
const db = new Client({ connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway.internal') ? false : { rejectUnauthorized: false } });

async function main() {
  await db.connect();
  await db.query(`CREATE TABLE IF NOT EXISTS site_hits(
    id serial primary key, ts timestamptz default now(),
    path text, ref text, ua text)`);
  for (const c of ['vid text','country text','city text','device text'])
    await db.query(`ALTER TABLE site_hits ADD COLUMN IF NOT EXISTS ${c}`);
  http.createServer(async (req, res) => {
    const reqO = req.headers.origin || '';
    const cors = { 'Access-Control-Allow-Origin': ORIGINS.includes(reqO) ? reqO : ORIGINS[0],
      'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'content-type' };
    const u = url.parse(req.url, true);
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    if (req.method === 'POST' && u.pathname === '/hit') {
      let body = '';
      req.on('data', c => { if (body.length < 2000) body += c });
      req.on('end', async () => {
        try {
          const d = JSON.parse(body || '{}');
          const ua = String(req.headers['user-agent'] || '').slice(0, 150);
          // Daily-unique fingerprint: hash(day+salt+ip+ua). The raw IP is used
          // for this hash and a country lookup, then DISCARDED — never stored.
          const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '')
            .split(',')[0].trim();
          const day = new Date().toISOString().slice(0, 10);
          const vid = crypto.createHash('sha256')
            .update(day + (process.env.STATS_TOKEN || 's') + ip + ua).digest('hex').slice(0, 16);
          const device = /Mobile|iPhone|Android|iPad/.test(ua) ? 'mobile' : 'desktop';
          if (ip && !geoCache.has(ip)) {
            try {
              const g = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=country,city`,
                { signal: AbortSignal.timeout(1500) }).then(r => r.json());
              geoCache.set(ip, { country: g.country || null, city: g.city || null });
              if (geoCache.size > 500) geoCache.clear();
            } catch { geoCache.set(ip, { country: null, city: null }); }
          }
          const geo = geoCache.get(ip) || {};
          await db.query(
            'INSERT INTO site_hits(path,ref,ua,vid,country,city,device) VALUES($1,$2,$3,$4,$5,$6,$7)',
            [String(d.p || '/').slice(0, 200), String(d.r || '').slice(0, 300),
             ua, vid, geo.country || null, geo.city || null, device]);
        } catch {}
        res.writeHead(204, cors); res.end();
      });
      return;
    }
    if (req.method === 'GET' && u.pathname === '/stats') {
      if (!TOKEN || u.query.token !== TOKEN) { res.writeHead(403); return res.end('no'); }
      const days = Math.min(90, +u.query.days || 7);
      const [tot, byday, paths, refs, geo] = await Promise.all([
        db.query(`SELECT count(*) n, count(distinct vid) u FROM site_hits WHERE ts > now()-interval '${days} days'`),
        // `u` is that DAY's unique visitors. The fingerprint is already
        // day-scoped — sha256(day+salt+ip+ua) — so a distinct count inside one
        // day is exactly the people who came that day, and views minus uniques
        // is the repeat visits they made. Across days it means nothing: the
        // same person gets a fresh vid every midnight, deliberately, so nobody
        // can be followed from one day to the next. The window-wide `uniques`
        // total below is therefore a sum of day-visitors, not distinct people.
        db.query(`SELECT date(ts) d, count(*) n, count(distinct vid) u FROM site_hits WHERE ts > now()-interval '${days} days' GROUP BY 1 ORDER BY 1`),
        db.query(`SELECT path, count(*) n FROM site_hits WHERE ts > now()-interval '${days} days' GROUP BY 1 ORDER BY 2 DESC LIMIT 8`),
        db.query(`SELECT coalesce(nullif(ref,''),'(direct)') r, count(*) n FROM site_hits WHERE ts > now()-interval '${days} days' GROUP BY 1 ORDER BY 2 DESC LIMIT 8`),
        db.query(`SELECT coalesce(country,'?') c, coalesce(city,'') ci, count(distinct vid) u FROM site_hits WHERE ts > now()-interval '${days} days' GROUP BY 1,2 ORDER BY 3 DESC LIMIT 8`)]);
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ days, total: +tot.rows[0].n,
        uniques: +tot.rows[0].u, by_day: byday.rows, places: geo.rows,
        top_paths: paths.rows, top_refs: refs.rows }));
    }
    if (u.pathname === '/') { res.writeHead(200); return res.end('im-hits ok'); }
    res.writeHead(404); res.end();
  }).listen(PORT, () => console.log('im-hits on', PORT));
}
main().catch(e => { console.error(e); process.exit(1) });
