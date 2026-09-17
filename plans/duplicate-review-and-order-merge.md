# Doublons : revue en lot + fusion de commandes

## Context

Two separate problems, both currently solved by hand, one order at a time.

**1. Duplicates.** Ordra already detects them (`get_duplicate_orders_batch`: same market +
same normalized phone + same product + ±24 h), shows a badge, and blocks dispatch with a
409. What it does *not* have is a place to act on them in bulk — so every duplicate is
opened and deleted individually. The live data confirms the cost: **694 of the 868 orders
already in `deleted` sit on a repeat phone, and 569 of them were same-product-within-24 h**
— i.e. two thirds of all manual deletions were duplicates the system had already flagged.

**2. Basket split.** A customer orders product A, then product B minutes or hours later.
Today the only available action is to delete one, losing the sale. There is no merge.

### What the production data actually says (measured 2026-09-17, live DB `vshynigvgrlihngozuwb`)

This is what shapes the design, and it overturns two intuitions.

| Signal | Libya | Tunisia |
|---|---|---|
| Same-product pairs, median gap | **0.2 h** (12 min) | **118 h** (~5 days) |
| Fast pairs (≤1 h), same product | 350 | 155 |
| …of which already ended in a manual deletion | 97% | 97% |
| …that ever *both* shipped or *both* delivered | **0** | **0** |
| Different-product pairs (the merge case) | 297 (median 5.3 h) | **8** (median 538 h) |

- **Tunisia has no duplicate problem.** All 50 live TN "duplicate" groups are the *same
  product* — `Biovera - Routine Anti-Cellulite` — 36 of them with **both orders delivered**,
  median gap 328 h, **none within an hour**. These are loyal repeat buyers of a consumable.
  Any rule loose enough to catch them deletes real revenue.
- **`external_id` never matches** on these pairs, so they are genuine separate submissions,
  not webhook replays (that layer already works).
- **Merging on phone alone is unsafe.** Of 187 LY different-product pairs within 24 h,
  **96 have a different `customer_address` and 65 a different `customer_city`**. A phone is
  not a delivery destination.
- **Blind auto-delete would be destructive.** A same-product + ≤1 h + same qty + same price
  rule flags 277 LY orders — but **60 of them are already committed** (uploaded / scanned /
  delivered). Only **3** are currently safely actionable.

### Decisions that follow

1. **No silent auto-deletion.** Partly because it would be wrong (the 60 committed orders
   above), and partly because it is impossible as asked: `manual_delete_orders` hard-requires
   `auth.uid() = p_actor_id` and a `super_admin`/`market_manager` role, so no cron or webhook
   can call it. Instead: a **review screen that batches the work** — the pre-checked list does
   in one click what you do in twenty.
2. **Merging is manual and agent-confirmed, never automatic**, and it must force an explicit
   address choice.
3. **Market behaviour differs via settings rows only — never a `market.code` branch in app code.**
   Merge ships disabled in Tunisia (`merge_window_hours = 0`).
4. Soft delete stays exactly what it is today: `status = 'deleted'`, audited in `order_history`,
   reversible via the existing `recover_deleted_order`. Nothing new, nothing destructive.

---

## Feature A — « Doublons », the bulk review screen

### A0. Wire the window setting (it exists but is inert)

`duplicate_window_hours` is defined in `src/types/settings.ts` and editable in
`OperationsSection.tsx:213-231`, but detection hardcodes `interval '86400 seconds'`. Fix that
first so the rule is configurable before anything is built on it.

- Migration `20261002000001_duplicate_window_setting.sql`: `get_duplicate_orders_batch` gains
  `p_window_hours integer DEFAULT 24`; keep `interval '1 second' * (p_window_hours*3600)` —
  **seconds, not `interval '1 day'`**, which is calendar arithmetic and drifts 23/25 h across DST
  (the reason is already documented in `20260829000002`).
- `src/lib/duplicate-orders/window.ts` — resolve per market via the existing
  `getMarketSetting` (`src/lib/settings/getMarketSetting.ts`), clamp 0..168.
- Thread it through `enrichRowsWithDuplicates` (`src/lib/duplicate-orders/detect.ts`).
  Default 24 ⇒ **no behaviour change**; `detect.test.ts` must stay green untouched.

### A1. Grouping RPC

Migration `20261002000002_duplicate_groups.sql` — `get_duplicate_groups(p_market_id, p_window_hours,
p_limit, p_offset)`. Same predicate as `get_duplicate_orders_batch` (reuse it; do not fork the
rule), but returns **groups** rather than per-row siblings, each with:

- members (id, external_id, status, created_at, product, qty, price, customer, address, city),
- `is_anchor` — newest member, the one kept, matching `deriveDuplicateEnrichment`,
- `already_shipped` per member, and `deletable` mirroring `DUPLICATE_DIALOG_DELETE_STATUSES`
  (`src/lib/order-permissions.ts:117-130`),
- `address_matches` / `city_matches`,
- `confidence`: **`high`** = same product + same qty + same price + within
  `duplicate_autoselect_window_hours` (new setting, default **1**); **`review`** otherwise.

`SECURITY DEFINER` with the same market guard as the existing batch RPC. Scope to the last 90
days and to `customer_phone` only (not `customer_phone_2`) in v1 — keep the surface small.

A drift test must assert the SQL `deletable` list and the TS `DUPLICATE_DIALOG_DELETE_STATUSES`
stay identical.

### A2. Bulk delete

`src/lib/orders/duplicate-bulk-delete.ts` — **loop `verifyAndDeleteDuplicateSibling`**
(`src/lib/orders/duplicate-delete.ts`), do not reimplement it. Its 8-step gate re-derives the
siblings server-side under the actor's RLS client, so a forged `targetId` fails with 422. Cap at
50 pairs per call, continue past per-item failures, return a per-item outcome list.

Route `POST /api/orders/bulk-delete-duplicates` (+ `route.test.ts` first). Returns 200 even on
partial failure, with the failures itemised. Handle the order lock (`lockedResponse`).

### A3. The screen

`/[locale]/(dashboard)/orders/duplicates` + `DuplicatesPageClient.tsx`, and a third entry in the
`commandes` section of `NAV_SECTIONS` (`src/components/layout/Sidebar.tsx:120-136`) after
*Commandes* and *Archivées*.

- **Reuse `src/components/shared/RelatedOrderCard.tsx`** for every member, so the review screen
  and the existing badge popover render an order identically.
- Anchor card marked « Conserver »; siblings carry checkboxes. **`high` pre-checked, `review`
  never pre-checked.**
- `SegmentedTabs` for *Tous* / *Haute confiance*; bulk bar follows the existing `OrdersBulkBar`
  geometry.
- An amber `AlertTriangle` line when `address_matches` is false — deleting the wrong half of a
  pair with two addresses destroys a genuinely different delivery.
- Members with `already_shipped` or `deletable = false` are shown but **not selectable**. This is
  the guard for the 60 committed orders.
- Confidence is never colour-only (glyph + chip), money and counts `tabular-nums`, `dir="auto"`
  per text node, logical CSS properties throughout — `docs/design-system.md` §4.17.

**Answering "let me know what was duplicated / deleted":** a result modal listing what was
deleted (external_id, product, amount), what was kept, and what failed and why, with a link to
`/orders/archive?status=deleted`. That link is what makes the soft delete legibly reversible.

**Roles (decided).**

- `super_admin` + `market_manager`: full screen, selection and bulk delete (the delete path calls
  `manual_delete_orders`, whose role check already refuses anyone else — so this is enforced at the
  database, not only in the UI).
- `agent`: **read-only**, scoped to groups where the agent owns at least one member. No checkboxes,
  no bulk bar; the result modal and the delete affordances are not rendered. The value is that an
  agent sees a duplicate before calling the customer.
- The bulk-delete route must reject agents with 403 independently of the UI — a read-only screen is
  not an access control.

Agents reach it from `AgentNavTabs.tsx` (there is no `(agent)` route group — the agent shell is a
role branch inside `(dashboard)`, per `CLAUDE.md`), not from `Sidebar.tsx`.

**Tunisia (decided):** the screen is shown in both markets. TN's wide-gap groups fall into
`review` and are never pre-checked, so the tool exists if a real TN double-submit appears without
any risk of bulk-deleting repeat buyers. No per-market sidebar difference.

---

## Feature B — Fusion, agent-confirmed

### B1. `merge_orders` RPC — one transaction

Migration `20261002000003_merge_orders.sql`. It **must** be a single Postgres RPC: the
two-PostgREST-call pattern used by `/api/orders/[id]/items` needs a compensating delete to stay
consistent (see its own comment at `route.ts:195-232`), and a merge touches two orders plus N
item rows.

`merge_orders(p_survivor_id, p_absorbed_id, p_actor_id, p_customer_address, p_customer_city, p_note)`:

1. Actor guard copied verbatim from `manual_delete_orders` (`auth.uid() = p_actor_id`), with the
   role set widened to include `agent`, who must own **both** orders.
2. **Explicit `assert_order_unlocked` on both.** Mandatory, not belt-and-braces: the function is
   `SECURITY DEFINER` and runs as the owner, so the `current_user`-keyed lock trigger will not
   fire for its writes. Needs its own test.
3. `SELECT … FOR UPDATE` both, ordered by id, so a concurrent reverse-direction merge cannot deadlock.
4. Gates, each with a distinct ERRCODE: same market; same normalized phone; **both statuses in
   `pending | assigned | attempt_* | callback_scheduled`**; within `merge_window_hours` (0 = disabled).
   `confirmed` is **deliberately excluded** — a confirmed total was agreed with the customer by
   phone, and silently changing it is a different act from deleting a never-discussed duplicate.
5. Materialize each order's flat columns into `order_items` when it has none — intake never
   creates them. Transliterate the backfill primitive at `/api/orders/[id]/items/route.ts:129-149`.
6. Move the absorbed lines, recompute `total_price` mirroring `computeOrderTotal`, charging
   **one** delivery fee (the survivor's).
   *Card surcharge, resolved:* the rule at `/api/orders/[id]/route.ts:247-262` is derivable —
   `true` for TN; for LY `true` only when `dexpress_state_id IS NOT NULL` (Dexpress fallback),
   else `false` (Darb bills cards natively). Implement it in SQL. It is currently moot anyway:
   **zero of the 671 mergeable orders are `card_payment`, and none are on the Dexpress fallback.**
7. **Keep `orders.product_id` populated** with the survivor's original product. Setting it NULL is
   semantically truer but breaks `manual_delete_orders` (stock restoration) and the scan RPCs,
   which move stock only for `orders.product_id`. The multi-product stock gap is pre-existing
   (`plans/warehouse-scan-run.md`) — do not widen it here.
8. Soft-delete the absorbed order inline (not via `manual_delete_orders`, whose role set excludes
   agents), and append **two `order_history` rows** — one each side — each carrying a stable
   machine-readable marker (`[merge:into]` / `[merge:absorbed]`) so the UI chip parses a token,
   not French prose that Arabic or a copy edit would break.

`get_merge_candidates(p_order_id)` — `SECURITY INVOKER`, RLS does the isolation. Same phone,
**different product**, both mergeable, within the window; returns `enabled: false` when the
market's window is 0 so the affordance disappears entirely in Tunisia.

### B2. TS + API

`src/lib/orders/merge.ts` (pure, tested first): `canMergeOrders`, `resolveMergeAddress`,
`previewMergeTotal`. The key test encodes the 96-of-187 finding — **`resolveMergeAddress` must
refuse to fall through to a default when the addresses differ.**

`POST /api/orders/[id]/merge` (`[id]` = survivor), body `{ absorbed_id, address_choice, note? }`.
**400 `address_choice_required` when the addresses differ and no choice was made — enforced at the
API, not merely in the UI.**

### B3. UI

`MergeOrderPanel.tsx`, a slide-over from the order detail panel (merging is decided while looking
at one order's contents). Candidates as `RelatedOrderCard`s; then a two-column confirmation with
**both addresses shown in full, an explicit radio pair, no default selection, and the confirm
button disabled until one is chosen**, plus an amber warning when they differ. Shows the merged
receipt with the single delivery fee and the new total, and states the consequence plainly.
`MergedFromChip` renders the link on both sides from the history marker.

### B4. Settings

Add `merge_window_hours` (default **0**) and `duplicate_autoselect_window_hours` (default **1**)
to `src/types/settings.ts` + `OperationsSection.tsx`, mirroring the existing
`duplicate_window_hours` block and its validator test.

| Setting | LY | TN | Why |
|---|---|---|---|
| `duplicate_window_hours` | 24 | 24 | Parity with today's badge. |
| `duplicate_autoselect_window_hours` | 1 | 1 | The measured high-confidence signature (LY median 0.2 h). Yields almost nothing in TN — correct, since TN's fast pairs are its only real duplicates. |
| `merge_window_hours` | 24 | **0** | LY: 297 different-product pairs. TN: 8, median 538 h — a foot-gun with no upside. |

---

## Sequencing

Each phase is green before the next; A and B are independent.

| Phase | Content | Gate |
|---|---|---|
| 0 | window setting + migration `…0001` | `detect.test.ts` green, unchanged; no visible change |
| A1 | `get_duplicate_groups` + migration `…0002` | RPC verified by hand: expect ~2 live same-product groups |
| A2 | bulk-delete lib + route | route tests green; one known pair deleted and recovered |
| A3 | page, components, sidebar, i18n (fr + ar) | component tests green; typecheck, lint, build |
| A4 | agent read-only variant + `AgentNavTabs` entry | test: agent sees only own groups, no checkboxes; bulk route 403s for agents |
| B0 | settings types + fields | `settings.test.ts` green |
| B1 | `merge.ts` pure | `merge.test.ts` green — **before any SQL** |
| B2 | migration `…0003` | exercised on a **Supabase branch, never prod**, against the one live LY candidate |
| B3 | routes + `MergeOrderPanel` + i18n | route + component tests green; full build |

## Verification

- **TDD throughout** — failing test first at every step (`CLAUDE.md`, non-negotiable).
- `npm test`, then `npm run typecheck && npm run lint && npm run build`.
- **RPC behaviour must be checked under a real JWT, not as owner** — the project has been bitten
  twice by this (`rls-helpers-search-path-trap`, `rls-initplan-per-row-helpers`).
- End-to-end A: log in as `manager.ly@oms.local`, open **Commandes → Doublons**, confirm the two
  live LY groups appear, that shipped/committed members cannot be selected, delete one pair, then
  confirm it is recoverable from Archivées.
- End-to-end B: the single live LY candidate — `محمود السنوسي`, two Qur'an editions 5.5 h apart,
  both `pending` — merge them, confirm one delivery fee, a correct total, both history rows, and
  the absorbed order in Archivées.
- Re-run the measurement queries afterwards to confirm counts moved as expected.

## Decisions taken (2026-09-17)

1. **Merge role:** agents may merge orders **they own**; managers and super_admin may merge any
   order in their market. Enforced in `merge_orders` step 1, not in the UI.
2. **Agent view of Doublons:** read-only, own groups only. Bulk-delete route returns 403 for agents.
3. **Tunisia:** Doublons shown, nothing pre-checked. Merge stays disabled (`merge_window_hours = 0`).

## Known gaps, deliberately not closed here

- **Multi-line intake truncation.** Every storefront adapter takes `line_items[0]` and discards the
  rest while keeping the order-level `total_price` (`shopify-adapter.ts:95-102` and siblings, with
  Buybox explicit about it). So a 3-line order already arrives as one row naming one product but
  carrying the whole basket's revenue. Revenue is safe (`orders.total_price`), but product
  attribution, margin and stock are wrong for lines 2+. **Fixing this would prevent some of these
  "duplicates" from ever being created** — it is the upstream cause and deserves its own plan.
- The two disagreeing definitions of customer "risk" (`CLAUDE.md` open discrepancy #1) are
  untouched.
