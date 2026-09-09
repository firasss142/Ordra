# Dispatch flow redesign — carrier picker, scheduling, Darb options (2026-09-08)

Source: 3 screenshots showing a green-accented "meilleur choix" carrier
comparison, a delivery-scheduling modal with carrier re-selection + slider
preview, and the Darb Assabil options modal already built (session prior).

## Scope

1. **New `dispatch-*` color tokens** — `globals.css` + `tailwind.config.ts`,
   following the `wh-*`/`oms-*` scoped-family pattern. Not `accent` (reserved,
   two chrome slots only per design-system.md §1) and not `status.*` (that's
   what an order IS; this is "this choice is good").
2. **`compareCarriers`** (`src/lib/carriers/carrier-comparison.ts`) — pure
   scoring: cost (lower better) + 30d delivery rate (higher better) + median
   transit hours (lower better), min-max normalized within the candidate set,
   partial-data tolerant. Picks `bestChoiceCarrierId`.
3. **`useCarrierPerformance`** hook — thin SWR wrapper on
   `/api/carriers/performance`, fail-soft like `useCarrierRates`.
4. **`canReadCarrierPerformance`** permission — narrower than
   `canReadSettings`; lets an agent read their OWN market's carrier
   performance (needed for the queue-facing picker) without opening the
   settings page to them.
5. **`PostCallActionSheet.tsx`** carrier picker (`upload_after_confirm`) —
   redesign to stat-card layout: fee / delivery-rate (colored dot) / transit
   days, "meilleur choix" badge on `compareCarriers`'s winner, green selected
   state.
6. **`PostCallActionSheet.tsx`** schedule step (`schedule_after_confirm`) —
   add carrier re-selection (labeled "choisi à l'étape précédente" on the
   carrier picked in step 5), green auto-dispatch confirmation card, timeline
   preview row ("maintenant" → scheduled date/time).
7. **`ScheduleDispatchModal.tsx`** — full Tailwind rewrite (was 100% inline
   `style={}`, flagged non-compliant with design-system.md §"New components
   use Tailwind"). Same green auto-dispatch card + timeline preview; carrier
   picker gains the "meilleur choix" stats too since it already fetches
   `marketId`-scoped carriers.
8. **`DarbAssabilDispatchModal.tsx`** — visual pass: green selected states on
   fulfilment tiles / service tiles / pickup-carrying checkbox, risk-warning
   hint lines under Inspection ("risque de retour plus élevé" style) and
   Testing, frais de livraison + à encaisser (COD) summary bar above the
   submit button.

## Explicitly out of scope
- No change to any OTHER screen's palette — `dispatch-*` tokens are new and
  additive, nothing global repointed.
- No change to confirm/reject/callback flows' visuals in PostCallActionSheet.
