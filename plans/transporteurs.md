# Transporteurs — carrier performance page (build plan)

Spec: `prototypes/transporteurs-v2.html` — **approved 2026-10-03: « I like the prototype. Follow it exactly. »**
v1 (rejected) stays in the main checkout as history. Branch `feat/transporteurs`, worktree
`.claude/worktrees/transporteurs`.

## 1. What the page answers

« Is each carrier doing its job? », read daily on desktop, by the owner and by market managers (own market;
Libya's in Arabic). Three pillars, one per pain point, in this order everywhere:

| Pillar | Number | Status line |
|---|---|---|
| Livrés | delivered ÷ (delivered + failed), parcels **sent** in the period | target (setting) ; grey « Provisoire » when > 10 % still in flight |
| En retard (now) | open parcels on the road ≥ `carrier_late_days` after pickup, or not picked up 2 days after upload | « dont N bloqués » = no carrier movement for `carrier_stall_days` |
| Retours à scanner (now) | failed parcels the carrier handed back that were never scanned in | « dont N depuis 7 j + » |

No money anywhere (owner: cash is not a problem in either market).

## 2. Owner's answers (binding)

Round 1–2 (prototype): both markets; failures cost nothing; returns come back but nobody scans them; daily on
desktop; overview → brief cards → detail → compare (overall, then city by city); full colour band per account.
Round 3 (2026-10-03, build):
1. The 4 other inflated delivery rates (dashboard carrier block, Connexions badge, « meilleur choix »,
   zone stats behind « Zone difficile ») are fixed in a **second PR right after** this one.
2. « Suivi transporteur » and « Tableau livraison » are **deleted** (the order timeline they hold moves first).
3. Access: **super_admin + market_manager** (own market). Agents and warehouse agents never see it.
4. The agent queue's thin account ring becomes a **solid city pill** in the same colour.

## 3. One definition of a parcel's outcome, shared with Produits v6

`public.carrier_parcel_outcome` (view, `security_invoker`), in its OWN migration file, copied verbatim by the
products-redesign session (agreed by message 2026-10-03; any later change = a new migration). Rules, in order
(« latest Darb shipment » = `darb_shipments` by `carrier_updated_at desc nulls last`):

- **uploaded**: an `order_history` row → `uploaded`, a post-upload status, or a Darb shipment.
- **delivered**: `status = delivered` or latest slug `completed`.
- **failed**: status in (returning, to_be_returned, returned, received) · slug in (returning, returned) ·
  (`cancelled` + slug `released`) · (`cancelled` + slug `cancelled` + picked up). `released` alone is NOT a
  failure: `promote_darb_status` maps released/resent → out_for_delivery.
- **in_flight**: in-flight statuses · (`cancelled` + an active slug) · re-queued after upload.
- **cancelled_before_pickup**: everything else.
- **picked up**: Darb = a timeline `assigned` event; Tunisia = history → dispatched/deposit/in_transit/….

Check figures (orders created 2026-09-04 → 10-03): qr-01 158 → 77/63–64/7–8/10, DA2 → 129/118/10/7,
th-01 65 → 32/19/14/0 (live data; ±1–2 as parcels settle).

## 4. Data layer

1. `…_carrier_parcel_outcome.sql` — the shared view (+ columns this page needs: `last_move_at`,
   `n_postponed`, `handed_back_at`, `scanned_back`, `remark_class`, `city`, `failure_cause`, `open_at_carrier`).
2. `…_carrier_scorecard.sql`
   - `carriers.accent_color` (hex, CHECK) + backfill: Tripoli & Navex `#1F5FBF`, Benghazi & Cosmos `#C24E17`
     (the validated pair: CVD ΔE 25.2, white text ≥ 4.7:1).
   - `get_carrier_scorecard(p_market_id, p_days)` → jsonb: thresholds, per carrier (period cohort + previous
     window, 13 weekly cohorts, now: late buckets + stuck, returns pipeline, reasons 90 d, cities 90 d),
     dormant carriers with open parcels. `STABLE SECURITY DEFINER`, market guard (super_admin any market,
     market_manager own market only, anyone else `{}`), REVOKE PUBLIC/anon, GRANT authenticated.
   - `get_carrier_scorecard_parcels(p_market_id, p_carrier_id, p_kind)` → rows for the drawers
     (`late` | `returns` | `dormant`): tracking number, city, days, last event, stuck flag. Same guard.
3. Settings (defaults in code, read with `delivery_setting_int`): `carrier_delivery_target_pct` = 60,
   `carrier_late_days` = 3, existing `carrier_stall_days` = 5. Editable in Réglages › Livraison.
4. SQL tests: `supabase/tests/carrier_scorecard_test.sql` (each outcome rule, guard per role, anon refused).

## 5. App layer (copy the prototype exactly; px units — root font is 14px)

- Routes: `/carriers` (overview), `/carriers/[carrierId]`, `/carriers/compare` under `(dashboard)`; server page
  resolves market like Salle de contrôle (`getActiveMarketScope`), redirects agent / warehouse_agent.
- API: `GET /api/carriers/scorecard`, `GET /api/carriers/scorecard/parcels` (`getActor` + market resolution).
- Pure view-model `src/lib/carriers/scorecard/` — statuses, provisional, trend, reason groups
  (client / transporteur / nous), weekly trimming, compare winners (< 3 pts = tie), French city names for
  Darb's Arabic `to_city`.
- Components `src/components/carriers/scorecard/` — overview strip, brief card (band + 3 pillars + 8-week
  bars), hero, 5 detail cards, head-to-head, weekly lines, city dumbbell, parcel drawer. Charts are plain SVG
  (as the team pages), mirrored in Arabic.
- i18n namespace `carrierScorecard` (fr + ar), nav key `carriers`.
- Sidebar Livraison = Suivi livraison · Transporteurs.
- Queue: `CarrierCityPill` replaces `carrierAccountRing` in `OrderCard`.
- Delete `/in-delivery` + `/warehouse/carrier-tracking` (pages, components, hooks, routes, tests, i18n);
  `OrderTimeline` + test move to `components/orders/`, its keys to a surviving namespace.

## 6. Order of work (TDD every step: failing test → code → typecheck)

1. View migration + SQL test → send the file to the products session.
2. Scorecard migration + SQL tests; check numbers against the prototype's Libyan figures on prod (read-only CTE).
3. View-model + tests. 4. API routes + tests. 5. Hooks. 6. Components + tests, screen by screen against the
   prototype (screenshot pairs on local seeded data, fr + ar). 7. Sidebar, settings, queue pill.
8. Delete the old pages. 9. Docs (`docs/carrier-scorecard.md`, CLAUDE.md pointer + navigation, design-system
   §ring → account colour). 10. Push + PR + green Vercel preview; prod SQL handed over paste-ready.

**PR 2** (after PR 1): repoint `get_dashboard_health`, Connexions badge, `/api/carriers/performance`,
`refresh_delivery_zone_stats`, `get_carrier_true_cost` to the view.

## 7. Decisions I made as the expert (veto at review)

- Cohort anchor = upload date (the carrier's work starts there); Produits keeps order creation date.
- « En route » for Darb = Darb's own active status on an open order (Ordra's statuses lag); the ~70 Libyan
  orders still `uploaded`/`scanned` with no Darb booking are not counted as late — a separate data clean-up.
- A carrier is a card when it is active and has ever carried a parcel (hides `TestCarrier3`). An inactive or
  idle carrier with open parcels gets the dashed footer line (Dexpress 323; Navex/Cosmos when idle).
- « Ramassé vite » = picked up < 6 h after upload (Darb); « Déposé vite » = < 24 h (Tunisia).
- Reasons groups: client = no_answer, customer_cancelled, not_needed, not_serious, out_of_coverage, no_cash,
  wrong_address, payment_method, refused · nous = wrong_item, duplicate, store_cancelled · transporteur =
  other, none, coordinated, office_pickup, in_progress.

## 8. Risks

- Tunisia: Navex sends no reasons/attempts → those blocks show their prototype empty states.
- Tunisian cities are free text (`customer_city`), grouped after normalisation.
- The view computes per order; measured on prod before shipping, cap the window in the RPC if slow.
