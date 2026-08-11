# stats — the site's own visitor counter

A tiny self-hosted analytics server (one file, no framework) behind the
site's visit numbers. Privacy-first by design: no cookies, no accounts,
and IP addresses are never stored — daily unique visitors are counted via
a salted one-way hash that changes every day, so visitors can't be tracked
across days even by the server itself.

- `POST /hit` — the page pings it once per view
- `GET /stats?token=…` — totals, per-day uniques, top pages and referrers
  (token-protected, set via `STATS_TOKEN`)

Runs as its own small service on Railway (`railway up` from this folder).
