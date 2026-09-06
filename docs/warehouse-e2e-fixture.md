# Libya warehouse E2E fixture — how to rerun, and what it found

The warehouse section runs against the **production** Supabase project (there
is no local stack), and the Libyan scan-out talks to Darb Assabil before it
commits anything. Testing it end to end therefore needs (a) test rows that can
be removed without trace and (b) a Darb that is not Darb. Both live in
`scripts/`. The audit that used them is in
`plans/warehouse-ly-e2e-test-fixture.md` (§Outcome).

## The three files

| File | Role |
|---|---|
| `scripts/wh-test-scenarios.mjs` | One manifest: the test orders, products, sandbox carrier, and what the sandbox "knows". Both other scripts read it, so the OMS side and the Darb side cannot drift. |
| `scripts/darb-sandbox.mjs` | A stand-in for `v2.sabil.ly` on `127.0.0.1:4545` — the shipment lookup and the reference PATCH the bench uses, with modes `ok / refuse / down / slow`, header checks, and a bind log at `/__sandbox/state`. |
| `scripts/wh-test-fixture.ts` | `seed / status / teardown / session / report-returns`, dry-run unless `--apply`. Service-role writes, tagged rows only. |

Tagging: fixed uuids under `ffffffff-0000-4000-8000-…`, `external_id`
prefix `WH-TEST-`, `[TEST]` in every name. Teardown deletes by id and prefix,
never by name.

## Run

```bash
node scripts/darb-sandbox.mjs                          # terminal 1
npm run dev                                            # terminal 2
node_modules/.bin/vite-node scripts/wh-test-fixture.ts seed --apply
# log in as a Libyan warehouse agent, phone viewport, /ar/warehouse
node_modules/.bin/vite-node scripts/wh-test-fixture.ts status     # DB + sandbox oracle, real-row diff
```

The sandbox carrier row is `code = darb_assabil`, **`is_active = false`**,
`api_endpoint = http://127.0.0.1:4545`. Inactive is what keeps the pg_cron
sync, the rate harvest and the dispatch pickers away from it; the scan-out
route reads the carrier by the order's `carrier_id`, so test orders bind
against the sandbox and real orders never see it.

Stickers to type (the QR encodes the bare number): `7700001`… per scenario,
`9900101/9900102` for returns, `7700777` for the simulated Darb return
(`SELECT promote_darb_status(<p>, 'returned', '7700777')`).

## Teardown

```bash
node_modules/.bin/vite-node scripts/wh-test-fixture.ts teardown      # prints the ledger SQL
node_modules/.bin/vite-node scripts/wh-test-fixture.ts teardown --apply
```

`inventory_log` is append-only **by trigger**, so its test rows need one
owner-level transaction (printed by the dry run: disable trigger → delete →
enable) through the Supabase SQL editor or MCP before `--apply`. If the
orders delete hits the PostgREST statement timeout (it did once, 19 orders
with cascades), run `DELETE FROM public.orders WHERE external_id LIKE
'WH-TEST-%'` through SQL and re-run `--apply`. `status` afterwards must show
zero tagged rows and no change on real products.

`report-returns` writes `report/ly-returns-without-stock-credit.csv`: every
Libyan order closed as `returned` by the carrier sync with no stock-credit
ledger row (103 orders / 105 units on 2026-09-06). See the plan's §Outcome for
why they exist.
