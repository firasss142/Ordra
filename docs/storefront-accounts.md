# Boutiques — plusieurs comptes par plateforme

Since 2026-10-04. Plan and investigation: `plans/storefront-multi-account.md`.

## The rule
**One account = one storefront row.** A second Shopify store, a second EasyOrders
account, a second Converty account: each is its own `storefronts` row, created from
Réglages › Boutiques › Ajouter. Each row owns:

| Thing | Keyed by |
|---|---|
| Webhook URL + secret (`/api/webhooks/{id}`) | storefront id |
| Order dedupe `UNIQUE (storefront_id, external_id)` | storefront id |
| Product mappings `storefront_product_mappings` | storefront id (not shared between accounts — owner's call) |
| Sheet cursor, failed rows, the one-run-in-flight lock | storefront id |

One Shopify store with several **domains** is still one store and one webhook stream:
nothing to add.

## Converty = a Google Sheets shop
Platform `google_sheets`; `storefronts.config = { spreadsheet_id, sheet_name, sheet_adapter }`
(`sheet_adapter` defaults to `converty`). `getSheetsSources()` builds the import list from
these rows; an archived shop is not imported.

`settings.google_sheets_sources` is **legacy**: read only as an override of an existing
shop's sheet (the first Libya sheet was wired there by hand). An entry with no storefront
is ignored — it used to fail every row on the orders FK. Nothing writes it any more.

### Connecting one (`POST /api/storefronts`, platform `google_sheets`)
1. Share the sheet, read-only, with the service account (`GET /api/storefronts/sheets-service-account`).
2. The server reads the tab once: 403/404 → `no_access`, bad tab → `no_tab`, missing
   Converty columns → `missing_columns`, same sheet+tab already in the market →
   `already_connected` (409; two shops on one sheet would import every order twice).
3. The shop is inserted **archived**, its cursor is ALWAYS written (`import_from: "now"`,
   the default = after the rows already there; `"all"` = an explicit 0), read back, and
   only then is the shop switched on. If the cursor does not stick, the shop is deleted.
   PATCH refuses to switch on a Sheets shop that has no cursor (`409 cursor_missing`) —
   with no cursor the account's whole history would be imported.
4. `webhook_secret` is NOT NULL, so a sheet shop holds an unused random one.

`platform` and `config` cannot be PATCHed: a new sheet under an old cursor skips or
re-reads rows. Archive and add a new shop.

### Running
pg_cron every 15 min → `runSyncForMarket`, sources share a 45 s deadline. Both the
markets and the accounts inside each are **rotated each tick** so one backlog cannot
starve the others. Réglages › Boutiques › (a Sheets shop) shows the last good read, the
last error, rows read, the rows that did not import, and « Lire maintenant ».

Webhooks: a delivery logged `error` no longer blocks its retries; when a Shopify retry then
succeeds it takes over the error row (UNIQUE `(storefront_id, delivery_id)`).

## Known, not fixed
- Cursors still live in one JSON row per market (`settings.google_sheets_sync_state`), but
  each write goes through `set_sheet_cursor()` (jsonb_set inside one UPDATE), so two syncs
  on different accounts no longer roll each other back. Until that migration is applied the
  app falls back to the old read-modify-write.
- Two simultaneous "create" clicks on the same sheet could both pass the duplicate check
  (super admin only; the button is disabled while busy). A unique index on the sheet would
  close it.
- An `order.updated` from the shop still overwrites a city an agent corrected by hand.
- The Converty export's `City` column is empty on every row (customers type the city into
  `Address`), so every Converty order is `mapping_status = unmatched` and the agent picks
  the destination. Owner chose to leave it (2026-10-04).
- `order.cancelled` moves an order to `deleted`, not `cancelled`.
