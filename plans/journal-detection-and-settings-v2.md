# Journaux v2 (detect + explain) and Réglages v2 (hidden rules)

2026-10-06. Owner's ask: make /system/logs and /system/settings more organised, catch every
error on our server or an outside server, and say *why* it happens. Clarity over density.
Branch `feat/system-logs-settings`, worktree `.claude/worktrees/system-ops`, off main 3df204d.

## What prod showed (2026-10-06)

- `app_errors`: 720 occurrences of `/api/cities GET 500`. The journal says only « Internal
  server error ». The cause is a super_admin on « Tous les marchés »: the route sends
  `market_id = ''` to Postgres (22P02). **179 routes answer with that generic sentence**, so
  the wrapper records it and the cause is lost every time.
- `integration_calls` only records carrier **upload** (7 rows in 14 days). The Darb/Navex
  polls, Meta, WhatsApp, Sheets and the Darb bind/verify calls are invisible.
- `poll-carriers`: 48 errors out of 139 parcels every 10 minutes. The run at 04:30 hung three
  nights in a row. `job_failing` needs 2 failures *in a row*, so it never opens a problem.
- No `error.tsx` or `global-error.tsx` in the app. A crash in the browser is seen by nobody.
- Navex: 91 parcels « Livrer Paye » (5 479 TND) are never marked delivered, and 48 returns are
  refused. The problem is muted. **Separate PR, next** (owner, 2026-10-06).

## Owner decisions (2026-10-06)

1. Full coverage: server cause, outside calls, browser crashes, hung jobs. Every problem says
   « Pourquoi » and « Que faire ».
2. Alerts stay in the app: badge and bell. Nothing is sent outside.
3. Navex fix goes in its own PR, right after this one.
4. New editable rules: Surveillance thresholds, the card surcharge (10 %), Prospects (max
   attempts, hot window).

## Build

### A. The real cause of a server error

- `src/lib/journal/request-context.ts` keeps an AsyncLocalStorage per request. It holds the
  causes seen during the request.
- Both Supabase clients get a `global.fetch` that notes any PostgREST answer ≥ 400: code,
  message, hint, and the table or RPC name.
- `console.error` inside a request is noted too. Most routes log the real error, then answer
  with the generic sentence.
- On a 500, `withRouteErrors` keeps the most telling cause. New columns on `app_errors`:
  `cause_kind` (db | external | code), `cause_code`, `cause_detail`, `cause_target`.
- The fingerprint gets the cause code, so two different bugs on one route are two problems.

### B. Outside services

- `monitoredFetch(system, operation)` wraps `fetch` in the carrier, Meta and WhatsApp clients.
  The Sheets client gets a catch.
- It records **failures only**: HTTP ≥ 400, timeouts and network errors go to
  `integration_calls`. Successes are not recorded; polling would write ~20k rows a day.
- New operations: `poll`, `sync`, `read`.
- New rule `external_failing`: ≥ N failures in 1 h per system and operation.

### C. Browser crashes

- `[locale]/error.tsx` and `global-error.tsx` show a calm French screen with « Réessayer ».
- `ClientErrorReporter` listens to `error` and `unhandledrejection`. It keeps only our own
  script errors, dedupes, and sends at most 5 per page load.
- `POST /api/journal/browser-error` requires a signed-in user and writes an `app_errors` row
  with `source = 'browser'`.
- New rule `browser_error`: the same crash ≥ 3 times, or by ≥ 2 people, in 24 h.

### D. Jobs that hang

New rule `job_hanging`: the same job abandoned (reaped) ≥ 2 times in 7 days, even when the
runs in between succeed.

### E. Thresholds become settings

- `journal_rule_settings(rule_key PK, enabled, params jsonb)`, super_admin only. It holds
  defaults equal to today's hard-coded values.
- `journal_detect()` reads it. A rule can be switched off.

### F. Explanations

- `src/lib/journal/explain.ts` is pure. It turns (rule, params) into an `{ key, params }` for
  « Pourquoi » and « Que faire ».
- For a server error it uses the cause: Postgres SQLSTATE class, PostgREST code, HTTP status of
  the outside service, timeout, or network.
- The sentences live in `journaux.explain.*` (fr and ar).

### G. Journaux screen

**Aperçu**
- A verdict.
- Problems in two groups: « À régler maintenant » (critical) and « À surveiller ».
- Problems of the same rule fold into one card (« 30 transporteurs désactivés ont encore des
  colis ») that opens to the list.
- Each card shows one « Pourquoi » line.

**Systems**
- Only systems that are not OK get a tile.
- Everything healthy is one line, « 38 systèmes en service », which opens the grid.

**Problem panel**
- Pourquoi, then Que faire, then « Détail technique » (folded).

**Historique**
- An error row says its cause, not « Internal server error ».

### H. Réglages

- The menu is grouped into Ventes · Expédition · Clients & pub · Système.
- New topic « Prospects » (manager may edit): max lead attempts and hot window.
- New topic « Surveillance » (super_admin only, not market-scoped): one row per rule, with a
  switch and its thresholds.
- Commandes gets « Majoration paiement par carte » (per market, default 10 %). It is read by
  `computeOrderTotal` callers and by `merge_orders` SQL.

### I. Small fixes found on the way

- `/api/cities` with no market answers `[]` instead of a 500.

## Decisions I made as the expert

- Successes of outside calls are not recorded, for volume. The rate rule counts failures per
  hour, not a percentage.
- Browser errors from extensions or other origins are dropped. « ResizeObserver loop » is
  dropped.
- Thresholds are global (one value for both markets). A market split can come later if needed.
- Muting stays at 7 days. The panel says when it comes back.

## SQL for the owner to paste (MCP apply is declined)

These are in order, in `supabase/migrations/2026100612*`. Every writer swallows a missing
column, so deploying the app first is safe.
