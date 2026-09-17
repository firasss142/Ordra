# Doublons et fusion de commandes

Shipped 2026-09-17. Two features that share a detection rule and nothing else.

- **Doublons** — a review screen that deletes in bulk what was deleted one by one.
- **Fusion** — two orders of the same customer become one parcel.

---

## 1. Why, in numbers

Measured against the live database on 2026-09-17 (~8 400 orders). These figures
are the argument for every rule below; re-run them before changing any of them.

| Signal | Libya | Tunisia |
| --- | --- | --- |
| Same-product pairs, median gap | **0.2 h** | **118 h** |
| Fast pairs (≤ 1 h), same product | 350 | 155 |
| …already ended in a manual deletion | 97 % | 97 % |
| …where the customer received **both** | **0** | **0** |
| Different-product pairs (merge case) | 297 (median 5.3 h) | 8 (median 538 h) |

Three facts did most of the design work:

1. **Two thirds of manual deletions were duplicates the system had already
   flagged.** 694 of the 868 orders in `deleted` sat on a repeat phone; 569 were
   same-product-within-24 h. The detection was never the missing piece — the
   place to act on it was.
2. **Tunisia has no duplicate problem.** All 50 live TN groups are one product
   (`Biovera - Routine Anti-Cellulite`), 36 with *both* orders delivered, none
   within an hour. They are repeat buyers of a consumable. A rule loose enough to
   catch them deletes real revenue.
3. **A phone number is not a destination.** Of 187 LY different-product pairs
   within 24 h, **96 had a different address and 65 a different city**.

And the guard that matters most: a "same product, ≤ 1 h, same qty and price"
rule flags 277 LY orders, of which **60 are already uploaded / scanned /
delivered**. A real parcel exists. Only 3 were safely actionable.

---

## 2. Doublons — the review screen

`/{locale}/orders/duplicates` · Sidebar → Commandes → Doublons · **both markets**

### What it shows

A group is a `(normalized phone, product)` bucket whose members fall inside the
market's `duplicate_window_hours` of each other — the **same predicate the badge
already uses** (`get_duplicate_orders_batch`). Two answers to "is this a
duplicate?" would be worse than none.

Each group renders the **anchor** (newest, marked « Conserver ») and its copies.

### What may be selected

A member gets a checkbox only when it is **not** the anchor, **is** `deletable`,
and is **not** `already_shipped`. That is stricter than the confidence tier on
purpose: a stale flag can then only ever under-offer, never delete a parcel that
physically exists.

### What arrives pre-ticked

Only `confidence: "high"`, which requires **all** of: same product, same
quantity, same price, same address, nothing shipped, and a gap inside
`duplicate_autoselect_window_hours` (default 1 h). Everything else is `review` —
shown, never pre-ticked.

Each condition is there because the data showed what happens without it.

### Roles

| Role | Sees | Can delete |
| --- | --- | --- |
| `super_admin`, `market_manager` | everything in scope | yes |
| `agent` | read-only | **no** — `/api/orders/bulk-delete-duplicates` returns 403 |
| `warehouse_agent` | redirected to `/warehouse` | — |

The read-only UI is a courtesy. The route is the gate.

### Deletion

`POST /api/orders/bulk-delete-duplicates` loops
`verifyAndDeleteDuplicateSibling` — the existing 8-step gate, which re-derives
the sibling set server-side under the actor's RLS client. **Nothing new decides
what may be removed.** A forged `sibling_id` fails with 422.

Partial success is the contract: HTTP 200 with `succeeded[]` and `failed[]`, each
failure carrying a translatable `reason`. One stale pair must not sink a batch of
twenty. The result modal names every deletion and every failure, and links to
`/{locale}/orders?status=deleted&include_deleted=1`.

Soft delete only: `status='deleted'`, `order_history` appended, recoverable via
the existing `recover_deleted_order`.

---

## 3. Fusion — merging two orders

Opened from the order detail panel. **Manual, agent-confirmed, never automatic.**

### The address question

This is the whole reason the panel exists. When the two orders disagree on where
the parcel goes, both addresses are shown **in full**, nothing is preselected,
and the confirm button stays disabled until the agent chooses.

`POST /api/orders/[id]/merge` refuses with `400 address_choice_required` — the
guard is at the API, not merely in the UI.

### Mechanics (`merge_orders`, one transaction)

One RPC, because a merge touches two orders plus N item rows and the item API
cannot span a transaction (see the compensating-delete comment in
`src/app/api/orders/[id]/items/route.ts`). Half a merge would strand a product on
a deleted order.

1. Actor guard: `auth.uid() = p_actor_id`; role ∈ (super_admin, market_manager,
   agent), and an **agent must own both orders**.
2. **Explicit `assert_order_unlocked` on both.** Mandatory: the function is
   `SECURITY DEFINER`, so the `current_user`-keyed presence trigger does not fire
   for its writes.
3. `FOR UPDATE` in id order, so a reverse-direction merge cannot deadlock.
4. Gates, each with its own SQLSTATE: same market, same normalized phone, both
   statuses mergeable, inside the window.
5. Materializes both orders' flat columns into `order_items` — intake never
   creates them, so without this the original product vanishes.
6. Moves the lines, recomputes the total with **one** delivery fee.
7. Soft-deletes the absorbed order; writes a `[merge:*]` history row on each side.

### Deliberate choices

- **`confirmed` is excluded**, though the duplicate dialog allows deleting it. A
  confirmed total was agreed with the customer by phone; changing it silently is
  a different act from removing a duplicate they never knew about.
- **`orders.product_id` stays populated** with the survivor's original product.
  Nulling it is semantically truer but breaks `manual_delete_orders` (stock
  restoration) and the scan RPCs, which move stock by that column. The
  multi-product stock gap is pre-existing (`plans/warehouse-scan-run.md`) and is
  not widened here.
- **The card surcharge rule is derived, not guessed**: `true` for TN; for LY only
  when `dexpress_state_id IS NOT NULL` (Dexpress fallback), else `false` because
  Darb bills cards natively. Currently moot — zero of the 671 mergeable orders
  are `card_payment`.

---

## 4. Settings — the only per-market difference

**No `market.code` branch exists anywhere in this code.** Markets differ only in
these three rows.

| Setting | LY | TN | Why |
| --- | --- | --- | --- |
| `duplicate_window_hours` | 24 | 24 | Parity with the badge. |
| `duplicate_autoselect_window_hours` | 1 | 1 | The measured double-submit signature. Yields almost nothing in TN — correct. |
| `merge_window_hours` | **24** | **0** (off) | LY: 297 different-product pairs. TN: 8, median 538 h. |

Editable in Système → Paramètres → Opérations → Réception.

---

## 5. Verification

- **Always test the RPCs under a real JWT, never as owner.** As owner
  `get_user_role()` is null and the market guard returns an empty set that looks
  exactly like "no duplicates" — the trap already recorded in
  `rls-helpers-search-path-trap`.
- Verified in production 2026-09-17: badge still resolves on its 2-arg call; LY
  manager sees 0 TN rows; super_admin sees 3 LY / 10 TN groups; all three LY
  groups correctly report `deletable: false`.
- The merge was dry-run on the real pair (محمود السنوسي, two Qur'an editions,
  5.5 h apart) inside a rolled-back transaction: 249 + 249 = **498**, quantity 2,
  1 line moved, nothing left behind.
- Gates refuse correctly: impersonation `42501`, zero window `merge_disabled`
  `23514`, self-merge `22023`.

## 6. Known gaps, deliberately open

- **Multi-line intake truncation.** Every storefront adapter takes
  `line_items[0]` and discards the rest while keeping the order-level
  `total_price` (`shopify-adapter.ts:95-102` and siblings). A 3-line order
  already arrives as one row naming one product but carrying the whole basket's
  revenue. Revenue is safe (`orders.total_price`), but product attribution,
  margin and stock are wrong for lines 2+. **Fixing this would stop some of these
  "duplicates" being created at all** — it is the upstream cause and deserves its
  own plan.
- `MergedFromChip` (reading the `[merge:*]` history marker) is not built, so a
  merged order records its history but does not yet advertise it in the UI. The
  marker is deliberately machine-readable (`[merge:into:<uuid>]` /
  `[merge:from:<uuid>]`) so the chip can parse a token rather than French prose.
- The merge affordance sits next to « Ajouter un produit » in the order detail
  panel's receipt, gated on `canEdit`. It is invisible in Tunisia only in the
  sense that the panel opens and reports « fusion non activée » — the button
  itself does not consult the setting.
