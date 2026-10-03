# Journaux — the journal system

Système › Journaux (`/system/logs`, super_admin only, always French). Built 2026-10-03
from `prototypes/journaux-v2.html`. Plan and investigation: `plans/journaux-redesign.md`.

Two questions, two tabs:

- **Aperçu** — *does everything work?* A verdict, one card per open problem, and one
  calm tile per system.
- **Historique** — *what happened?* One stream, five chips:
  - Tout
  - Systèmes externes (`ext`)
  - Équipe (`team`)
  - Automatique (`auto`)
  - Sécurité et erreurs (`sec`)

  Plus « Problèmes seulement ».

The rules that shaped it:
- Success carries no colour.
- Routine passes are counted, not listed.
- The detail lives in the side panels.

## 1. What writes the journal

| Table | Written by | What |
|---|---|---|
| `audit_events` | trigger `journal_row_change()` on 20 tables + RPC `journal_record()` | who changed what, `{column: [before, after]}`; explicit events (sign-in, export, campaign). **Append-only** (`ledger_append_only`). |
| `integration_calls` | `recordIntegrationCall()` in `performDispatch` | every carrier upload, `ok` / `refused` / `timeout` / `error`. Before this, a refused upload was written nowhere. |
| `app_errors` | `withRouteErrors()` around **every** `app/api/**/route.ts` export | every answer ≥ 500 and every throw: route, method, code, redacted message, session user. |
| `job_runs` | `startJobRun()` in `cron/poll-carriers` and `cron/dispatch-scheduled` | what those runs really did (pg_cron only knows the HTTP call was queued). |
| `journal_issues` | `journal_detect()`, pg_cron every 5 min | problems: fingerprinted, opened, refreshed, closed automatically. |

Existing logs are **read, not replaced**:
- `order_history`
- `inventory_log`
- `delivery_actions`
- `lead_history`
- `customer_feedback_events`
- `settings_history`
- `user_audit_log`
- `agent_availability_log`
- `agent_commission_ledger`
- `investor_deal_statements`
- the six run tables
- `carrier_event_log`
- `webhook_delivery_log`
- `darb_timeline_events`
- `label_prints`
- `whatsapp_messages`

### Who wrote it — `journal_actor()`
1. **A session** (role `authenticated`): the JWT `sub`.
2. **The service role with the header `x-ordra-actor: <uuid>`**: that user. `createAdminClient({ actorId: user.id })` sets the header. Routes that write an audited table through the admin client **must** pass it, or the event says « Le serveur » instead of a name.
3. **Anything else**: `service` (the service role with no header) or `system` (pg_cron), with no author. Never a guessed name.

The header is honoured **only** for the service role.

### Adding a table to the audit
Add one line to the `DO $attach$` list in a new migration. The arguments are:
- secret columns (masked `••••`);
- ignored columns (system-written stamps, heartbeats, stock totals that `inventory_log` already holds);
- the label column;
- `people`, which journals only when a person writes. Use it for tables the system churns, like `order_items` and `ad_spend`.

Then add the table to `kinds.entities` and `kinds.types` in the catalog.

### Adding an explicit event
- **From a session**, `journal_record()` accepts only these actions:
  - `auth.login`
  - `export.orders`
  - `export.customers`
  - `export.history`
- **From the server**, call `recordJournalEvent(createAdminClient({ actorId }), …)`. It accepts any `domain.verb` action, never throws, and waits at most 1.5 s.
- **Wording**: add the sentence under `journaux.kinds.<domain>.<verb>`.

## 2. Problems — `journal_detect()`

| rule_key | Opens when | Closes when |
|---|---|---|
| `job_failing` | a pg_cron job, or a run table, fails ≥ 2 times in a row | the next success |
| `connection_silent` | an active Darb account has no sync for 30 min | a sync arrives |
| `carrier_inactive` | an inactive carrier account still has parcels out | reactivated, or parcels settled |
| `carrier_stuck` | a carrier's statuses are unknown or refused (both causes, one problem per carrier) | no such event for 24 h |
| `import_rows` | sheet rows refused for > 24 h, unresolved | rows resolved |
| `upload_failing` | ≥ 3 refused uploads in 1 h, per carrier and code | quieter hour |
| `whatsapp_down` | number `paused` / `auth_failed` | status back to active |
| `ads_no_orders` | ad spend since yesterday, no order for 12 h | an order arrives |
| `server_error` | the same server error (route + method + status + code) ≥ 3 times in 24 h | 24 h without it |
| `login_failures` | ≥ 5 failed sign-ins on one **account** (hash of the full address, never the masked label) in 1 h | quieter hour |
| `large_export` | an export of > 1 000 rows | after 24 h |

How the detector behaves:
- `journal_reap_runs()` runs first. It closes any run stuck in `running` for more than 30 min as `failed`.
- A muted problem (« Ignorer 7 jours », `journal_issue_mute`) stays quiet until its date, but still **closes** if its cause goes away.
- The database stores only `rule_key` + `params`. The screen writes the sentences from the catalog.

## 3. What the screen reads

All are `SECURITY DEFINER` with the super_admin check inside.

| Function | Route | |
|---|---|---|
| `journal_overview()` | `/api/admin/journal/overview` | problems, tiles (48 h bars), jobs, security counts |
| `journal_feed(before, before_id, limit, family, only_issues, market)` | `/api/admin/journal/feed` | one stream, keyset-paged; filters applied **inside each source** so the top N stays exact |
| `journal_routine(from, to, tz)` | (same route) | routine passes per local day |
| `journal_find_order(q)` / `journal_order_trace(id)` | `/api/admin/journal/trace` | « Retrouver une commande » (`/`) |
| `journal_counts()` | `/api/admin/journal/counts` | the red badge on Système › Journaux |
| — | `/api/admin/journal/detail?ref=` | a row's panel: `audit:`, `settings:`, `error:`, `call:`, `webhook:` |
| `journal_issue_mute(id, days)` | `/api/admin/journal/issues/[id]/mute` | |

How the screen builds the stream:
- **Series.** The screen merges rows with `groupSeries()` (`src/lib/journal/series.ts`). A series is the same actor, kind and outcome, each row within 10 minutes of the last, on the same day.
- **Sentences.** `src/components/journal/describe.ts` writes them.

## 4. Retention (`20261003160500_journal_retention.sql`, separate and skippable)

The one-off fold collapses `carrier_event_log`'s repeats (≈ 900 000 rows). After that, `journal_purge()` runs nightly at 03:30 UTC:
- **30 days**: raw payloads are set to NULL, `app_errors` rows are deleted, `cron.job_run_details` is trimmed.
- **90 days**: `integration_calls` and `job_runs`.
- **180 days**: `carrier_event_log`.

`audit_events` is kept.

## 5. Tests

- `supabase/tests/journal_system_test.sql` (under real JWTs) covers:
  - author attribution;
  - masking;
  - append-only;
  - `journal_record` rights;
  - repeat folding;
  - detector open / mute / close;
  - stuck runs;
  - read access.

  On the local image (CLI 2.48.3), **any** « permission denied for function » crashes the backend, so anon refusals are proven with `has_function_privilege`, not by calling.
- `src/lib/journal/__tests__/routes-are-wrapped.test.ts` fails if a route exports an unwrapped handler.
- The screen: `src/components/journal/__tests__/` and `src/app/api/admin/journal/route.test.ts`.
