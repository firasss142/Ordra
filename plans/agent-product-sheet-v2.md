# Fiche produit — editorial redesign + content model

> Copy to `Ordra/plans/agent-product-sheet-v2.md` as the first step (repo rule: every plan lives in `/plans`).

## Context

Phase 1 shipped and is verified in the browser against live data: the pinned brief, the
verification checks, the drawer, the manager authoring form, and WhatsApp sharing all work.
What shipped is *functional* but visually thin — a flat stack of white sections at one type
size, and the content model is only three free-text fields.

This pass does two things:

1. **Makes the sheet look like something.** An agent opens it mid-call and has seconds to
   find one answer. Uniform 14px greyscale means everything is equally scannable, which
   means nothing is. It needs a real type ladder and a deliberate reading order.
2. **Fills in the content model** — the fields that actually come up on a Tunisian/Libyan
   COD confirmation call, plus a computed **Signals** block that needs no authoring at all.

The Signals block is the highest-leverage addition and costs nothing to maintain. Live data
already says Biovera returns at **21%** (423 returned / 1,634 delivered) and that
`دميه ملاكمه حجم متوسط` converts at **21%** with `refus_client` as its top rejection reason.
An agent who sees that before dialing runs a different call.

---

## Decisions taken

| Question | Answer |
|---|---|
| Layout | **Editorial** — big 1:1 image, generous whitespace, one hero price figure |
| Authored facts | composition · contraindications · how-to-use |
| Commercial | floor price · cross-sell alternative |
| Signals | full block — confirmation rate, return rate, top rejection reason, sample size |

Not doing: size/weight/warranty fields, total-to-quote, delivery ETA by region, social-proof
volume line. All easy to add later against the same shape.

---

## 1. Data model

### New product columns

```sql
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS agent_composition       TEXT,
  ADD COLUMN IF NOT EXISTS agent_contraindications TEXT,
  ADD COLUMN IF NOT EXISTS agent_usage             TEXT,
  ADD COLUMN IF NOT EXISTS floor_price             NUMERIC(12,3),
  ADD COLUMN IF NOT EXISTS cross_sell_product_id   UUID REFERENCES products(id) ON DELETE SET NULL;
```

**`floor_price` is super_admin-only to write**, matching `default_price` in the
`PATCH /api/products/[id]` allowlist — it sets revenue, so it belongs with pricing, not with
the selling narrative. It is *readable* by agents in the sheet. The other four go through the
existing `update_product_agent_content` RPC (extend its signature) so market managers can
author them.

Guard the cross-sell FK against self-reference and cross-market pairing in the RPC:
`p_cross_sell_id <> p_product_id` and same `market_id`.

### Signals view

```sql
CREATE OR REPLACE VIEW product_agent_signals AS
SELECT
  o.product_id,
  o.market_id,
  count(*) FILTER (WHERE o.status = 'rejected')                      AS rejected,
  count(*) FILTER (WHERE o.status IN ('confirmed','uploaded','scanned',
                    'dispatched','deposit','in_transit','delivered')) AS confirmed,
  count(*) FILTER (WHERE o.status = 'delivered')                     AS delivered,
  count(*) FILTER (WHERE o.status = 'returned')                      AS returned,
  mode() WITHIN GROUP (ORDER BY o.rejection_reason)
    FILTER (WHERE o.rejection_reason IS NOT NULL)                    AS top_rejection_reason
FROM orders o
WHERE o.product_id IS NOT NULL
GROUP BY o.product_id, o.market_id;
```

`product_return_rate_view` already exists but only carries delivered/returned/damaged — it
has no rejection data, so this view supersedes it for the sheet. **Confirm an index on
`orders(product_id)` exists and time a single-product read before wiring it in** — this DB
already times out on `/dashboard` (`getDashboardSummary` pulls all rows via `fetchAllRows`),
so a slow aggregate here would be felt on every panel open. If a plain view is slow, switch
to a materialised view refreshed by the existing cron.

Rates are computed in TypeScript, not SQL, so they stay unit-testable:

```
confirmationRate = confirmed / (confirmed + rejected)
returnRate       = returned  / (delivered + returned)
```

Thresholds (pure, tested, in `src/lib/products/signals.ts`):

| Signal | success | warning | critical |
|---|---|---|---|
| Confirmation | ≥ 70% | 50–70% | < 50% |
| Returns | ≤ 10% | 10–20% | > 20% |

Suppress both when the denominator is under 20 — a 100% rate off 3 orders is noise, and
showing it would teach agents to distrust the block.

---

## 2. Visual design — `docs/design-system.md` §4.16

Add a **scoped extension**, structured exactly like §4.15 (investor portal). Same
justification shape: this surface has a different reader and a different job — a person
under time pressure with a customer talking at them — and the admin grammar is tuned for
someone at a desk all day.

Applies only to `ProductSheetDrawer` and its children. Four allowances:

1. **A hero image at 1:1.** §4.15 already sanctions product imagery as "the mental model";
   this extends it from a 72px avatar to a full-width square. Match `ProductAvatar`'s
   conventions — `loading="lazy"`, `object-cover`, letter fallback — rather than `next/image`
   (no `images.remotePatterns` configured; raw `<img>` is the codebase convention).
2. **One hero figure.** The price at `text-[24px] font-bold tabular-nums`, per §4.15's
   "one KPI-scale figure per screen". Currency rides at 12px/500 secondary on the baseline.
3. **Status colour on rate figures.** Confirmation and return rates take
   success/warning/critical on the **number**, never a container — §4.15's money-direction
   rule extended to a second kind of status. A rate is a status.
4. **A 20px body rhythm** (`gap-5`) instead of the §4.13 admin default of `gap-3`, because
   this is a reading surface, not a dense form.

Still forbidden, unchanged: tinted section backgrounds (§4.10 — identity comes from icon +
label), gradients, accent green outside its two reserved slots, shadows on resting cards,
hardcoded strings, physical CSS properties.

### Type ladder

| Role | Size / weight | Token |
|---|---|---|
| Price (hero, one only) | 24 / 700, tabular | `ink-primary` |
| Product name | 17 / 600, leading-snug | `ink-primary` |
| Signal figure | 18 / 700, tabular | status colour |
| Section label | 10 / 600, uppercase, 0.1em | `ink-muted` |
| Body emphasis | 13 / 500 | `ink-primary` |
| Reading body | 13 / 400, leading-relaxed | `ink-secondary` |
| Meta / caption | 11 / 400 | `ink-muted` |

`tabular-nums` on every number. Reading blocks (description, notes, usage) get
`leading-relaxed` (~1.65); everything else stays tight.

### Section order

Ordered by what an agent reaches for, not by data shape:

```
[sticky 56px header]  Fiche produit                              ✕

  ┌────────────────────────────┐
  │        image 1:1           │      ← hero, rounded-[8px], border-line-subtle
  └────────────────────────────┘
  ▪ ▫ ▫                              ← 48px thumbs, only when >1

  Biovera 250 ml                     17/600
  49 TND        ● En stock           24/700 + existing Badge

  ⚠ Prix commande 35 ≠ catalogue 49  ← ALERTS (status tint allowed: it IS status)

  SIGNAUX                            ← 3-up, computed
  Confirmation 80%   Retours 21%   n = 2 238
  Refus principal : autre            ← neutral pill

  OFFRES                             ← packs; ordered tier gets a 1px ink-primary
  1 pièce                 49 TND       border, never a tint
    Prix d'appel — ne pas proposer en premier
  Pack 2  ◂ commandé      79 TND
    Meilleure marge
  🔒 Prix plancher 39 TND            ← floor price, once, Lock icon

  DESCRIPTION · ce que le client voit
  NOTES INTERNES · ne pas lire au client
  COMPOSITION
  MODE D'EMPLOI
  ⚠ CONTRE-INDICATIONS               ← critical tone; it is a warning, i.e. status

  ALTERNATIVE                        ← cross-sell card, tappable
  ┌──┐ Biovera Pack Duo    79 TND
  └──┘

  Mis à jour le 05/08/2026           11/400 ink-muted

[sticky footer]  Copier le lien  ·  Envoyer sur WhatsApp
```

Packs sit high because "how much / is there a cheaper option" is the most common mid-call
question. Share actions move to a **sticky footer** (§4.13 footer band) — the editorial
layout scrolls, and they must stay reachable.

---

## 3. Cross-sell drill-through

`GET /api/orders/[id]/product-sheet?product_id=…` currently 404s any product not on the
order — deliberate, so an owned order can't be used to browse the catalogue. A cross-sell
target is by definition not on the order, so widen the allow-set by **exactly one hop**:

```
allowed = {order.product_id} ∪ {order_items[].product_id}
        ∪ {cross_sell_product_id of each of those}
```

Still bounded, still market-checked, still no free browsing. Tapping the alternative
re-keys the drawer to that product; the pinned banner keeps showing the order's primary
product.

---

## 4. Files

**New** — `supabase/migrations/2026082000000X_product_agent_facts.sql`,
`src/lib/products/signals.ts` (+ tests), `src/components/queue/ProductSheetHero.tsx`,
`ProductSheetSignals.tsx`, `ProductSheetPacks.tsx`, `ProductSheetCrossSell.tsx`.

**Modified** — `ProductSheetDrawer.tsx` (recomposed from the new parts; header band 48→56px
per §4.13), `src/app/api/orders/[id]/product-sheet/route.ts` (signals join, new columns,
cross-sell hop), `src/types/product-sheet.ts`, `src/app/api/products/[id]/agent-content/route.ts`
+ its RPC (four new fields), `ProductEditForm.tsx` (new inputs; `floor_price` only when
`canManageCosts`), `src/messages/{fr,ar}.json`, `docs/design-system.md` (§4.16).

Reuse rather than rebuild: `Badge`, `Sheet`, `stockBadge`, `buildWhatsappUrl`,
`checkProductSheet`, `formatDisplayCurrencyCode`, `ProductAvatar` conventions.

---

## 5. Open bug to fix in this pass

During browser testing, clicking **"Voir la fiche produit"** on an *unmapped* order closed
the order panel instead of opening the drawer (URL lost its `open=` param). Not yet
diagnosed — reproduce on order `2d5e9f78-5ac1-4281-87f7-e3b81d7196dd`, and check whether the
newly-mounted drawer overlay is swallowing the same click, or the click is reaching the
row behind. The `p` shortcut on the same order works, so it is specific to the button path.

Also note: §4.13 prescribes **capture-phase** Escape handling so the topmost surface wins.
Phase 1 instead guards with panel state (`if (productSheetOpen) return`). That works and is
tested; leaving it, but it is a documented divergence worth revisiting if a third layer ever
stacks.

---

## 6. Verification

**Unit** — `signals.ts` thresholds at every boundary (69/70/71%, 9/10/11%), the <20 sample
suppression, and division-by-zero when a product has no orders. Route tests for the
cross-sell one-hop allow-set: target reachable, a *second* hop 404s, cross-market 404s,
self-reference rejected. Extend the existing cost-leakage test to assert `floor_price`
**is** present (agents need it) while `unit_cogs` still is not.

**Browser** (dev server on `:3001`, logged in as super admin, market scope Tunisia):
1. Author the new fields on Biovera at `/fr/products/1b28b393-…/edit`.
2. Open order `44df0178-…` (35 vs 49 → price mismatch) and press `p`. Confirm the type
   ladder, the hero price, Signals reading ~80% / ~21% with the return rate in critical, the
   floor price, contraindications in critical tone, and the sticky footer.
3. Tap the cross-sell card → drawer re-keys; Escape returns to the order panel, panel stays open.
4. Re-check the unmapped order — bug from §5 must be gone.
5. Confirm the queue card thumbnail, `/orders` list and add-product picker still render.

**Gates** — `npm run typecheck`, `npm run test:run` (baseline: 15 files / 31 tests fail on
`main`; that count must not grow), `npm run build`. `npm run lint` is unusable — ESLint was
never configured and drops into an interactive prompt.

**Cleanup** — two seeded `product_variants` on Biovera
(`e2e00001-0000-4000-8000-00000000000{1,2}`) are still in the live DB from Phase 1 testing.
Decide whether to keep them as real pack tiers or delete them.
