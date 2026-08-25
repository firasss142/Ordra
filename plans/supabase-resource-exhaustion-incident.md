# Login still failing: Supabase Postgres resource exhaustion (not a code bug)

## Context

The original ask was to fix a Vercel `MIDDLEWARE_INVOCATION_TIMEOUT` (504) hitting every route, including `/login`, on `ordra-gamma.vercel.app`. That was traced to `src/middleware.ts` calling `await supabase.auth.getUser()` unconditionally on every request, with no timeout — when Supabase Auth degraded, the middleware hung until Vercel's own 25s cap killed it. That fix (public paths short-circuit before touching Supabase; every Supabase call in the middleware now has a bounded 6s timeout and fails closed to a login redirect) is **already shipped**: commit `16002bf`, pushed straight to `origin/main` (isolated from the unrelated `feat/entrepot-redesign` work sitting on the branch this was developed on, per instruction to merge only the fix).

The error was reported to still persist, reproduced live with test credentials (`admin@oms.tn` / `admin@oms.tn`). Doing so surfaced a **different, more serious, still-ongoing problem**:

- The login page itself now loads fine (the middleware fix works). But submitting the form leaves the button stuck on "Connexion..." forever. That call (`supabase.auth.signInWithPassword`) runs entirely client-side, straight from the browser to Supabase — it never touches `middleware.ts`, so no fix to that file could ever help this path.
- Supabase's own Postgres logs (`postgres_logs`) show, from ~15:05 UTC onward: `could not accept SSL connection: Connection reset by peer`, `cron job N job startup timeout` (pg_cron itself failing to get a database connection), `canceling statement due to statement timeout`, and `unexpected EOF on standby connection`. By ~15:45 UTC the database stopped responding to anything at all — even a trivial `select 1` run through Supabase's own SQL tool timed out with `Connection terminated due to connection timeout`, and it still does as of this writing.
- This is isolated to the OMS project specifically: a sibling Supabase project in the same account answered `select 1` instantly. That rules out an account-wide problem or a problem with the diagnostic tooling itself. It's also not a listed incident on `status.supabase.com` (eu-central-1 shows Operational).
- An Explore agent audited the entire codebase for anything that could self-inflict this (raw Postgres connections bypassing Supabase's pooled HTTP client, unbounded concurrency in the cron/batch routes, sub-minute pg_cron schedules) and found nothing: no `pg`/`postgres`/`DATABASE_URL` usage anywhere in runtime code, and every cron route is either fully sequential or capped at `CONCURRENCY = 3` (spot-checked directly in `src/app/api/darb-assabil/sync-market/route.ts:29` and `sync-batch/route.ts:32`).
- The Supabase project dashboard itself shows a banner: *"Your project is currently exhausting multiple resources, and its performance is affected. Upgrade your compute or use the AI Assistant to identify and optimize the most expensive queries."*

Put together: this is a live Supabase compute/resource-exhaustion incident on the OMS project's database, confirmed by Supabase's own monitoring, not a bug in this repository. **No code change can restore connectivity to a database that infrastructure itself says is out of resources.** The plan below is two tracks that run in parallel — one infra-side, one code-side (once the database is reachable again).

## Track 1 — Restore service (infrastructure)

No dashboard/billing access from here, so these are manual:

1. Supabase dashboard → the project's **AI Assistant** / Advisors panel — this is the exact tool the banner points at, and it has visibility into live resource metrics unreachable through the API right now (every `get_advisors` / `execute_sql` call is timing out the same way the app is).
2. Consider a temporary **compute upgrade** (Settings → Compute) to break the exhaustion spiral — scalable back down afterward. Billing decision.
3. If it doesn't clear on its own or via a compute bump, this is worth a **Supabase support ticket** — the connection-reset / cron-startup-timeout / standby-EOF pattern above, with timestamps, is exactly the evidence they'll want, and it isn't showing on their public status page yet.

## Track 2 — Find and fix the actual expensive query (code, once the DB responds)

The moment the database is reachable again (verify with a trivial `select 1`):

1. Run `get_advisors(type=performance)` and query `pg_stat_statements` (ordered by `total_exec_time` and by `mean_exec_time`) to name the actual offending query/table — not yet possible, every attempt has timed out throughout this investigation.
2. `EXPLAIN ANALYZE` the top 2–3 offenders to see whether it's a missing index, a sequential scan on a large table, or an N+1 pattern from application code.
3. Fix exactly what the data shows — a migration under `supabase/migrations/` for a missing index, or a targeted query fix in the responsible file — scoped to the actual finding, not a speculative guess.

Deliberately not pre-guessing an index or query fix here: adding one without evidence risks being wrong (or irrelevant), and the codebase audit found nothing structurally wrong on the app side to point at.

## Ruled out (so this doesn't get re-investigated)

- **Connection leak / raw Postgres usage in the app** — none. Only `@supabase/ssr` + `@supabase/supabase-js` in `package.json`; no `pg`, `postgres`, `knex`, `prisma`, `drizzle`, or `DATABASE_URL` anywhere in runtime code.
- **Runaway cron concurrency** — every cron/batch route is sequential or capped at `CONCURRENCY = 3` (`darb-assabil/sync-market`, `sync-batch`); nothing else fans out. pg_cron schedules are all ≥1 minute apart, nothing sub-minute.
- **Account-wide Supabase outage** — ruled out; a sibling project in the same org answers instantly.
- **Public platform incident** — ruled out; status.supabase.com shows eu-central-1 Operational with no matching incident.

## Verification (once Track 1 unblocks the database)

1. `select 1` via Supabase's SQL tool resolves instantly (currently times out).
2. Playwright: navigate to `https://ordra-gamma.vercel.app/fr/login`, submit real credentials, confirm the button actually resolves (success redirect or a real "invalid credentials" message) instead of hanging on "Connexion...".
3. Watch `postgres_logs` for ~10 minutes for the absence of `connection reset`, `job startup timeout`, and `SSL connection` errors.
4. After any Track 2 fix lands, re-run `get_advisors(performance)` to confirm the finding is resolved and nothing new critical appeared.
