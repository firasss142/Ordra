# Confirmation agent interface — overhaul

> App root is `Ordra/`, not the repo root. All paths below are relative to `Ordra/`.
> Durable copy to save at `Ordra/plans/agent-interface-overhaul.md`.

## Context

The confirmation queue is the screen an agent stares at for a full shift. It went through a
v2 redesign (`plans/agent-queue-redesign-v2.md`) that fixed density and hierarchy, but eight
problems survived or were introduced. Four are cosmetic, four are real defects confirmed
against the live database and the source:

- **`autre` is the single most-used rejection reason** — 651 of 1798 rejections (36%) — and
  **68% of those carry no note at all**. The reason is permanently lost on ~440 orders. The
  taxonomy is too coarse, so agents dump into the escape hatch.
- **A future-scheduled call or delivery matches no sub-tab.** `bucketForStatus`
  ([QueuePage.tsx:139-152](../src/components/queue/QueuePage.tsx#L139-L152)) is time-blind and
  sends `callback_scheduled` / `dispatch_scheduled` to `en_cours`, but every predicate in
  `matchesEnCoursSubfilter` ([:161-187](../src/components/queue/QueuePage.tsx#L161-L187))
  rejects a future time. The order shows under **En cours → Tous** and vanishes from Rappel,
  Tentative and Livraison alike. This is the reported "falls under no category".
- **The counts lie.** `enCoursTotal` ([QueueHeader.tsx:330-331](../src/components/queue/QueueHeader.tsx#L330-L331))
  sums the three time-filtered bucket counts and drives both the *En cours* tab badge and the
  *Tous* chip — so *Tous* reports fewer than the rows it renders. `docs/design-system.md`
  §4.17 G ("Counts must not lie") makes this a hard project violation.
- **Half the notification system has never fired.** All four pg_cron jobs are healthy
  (1440/1440 successful `notifications-check` ticks in 24h — the scheduler is fine). But
  `agent_notifications` contains only `callback_due` rows, because **every one of the 264
  `attempt_1/2/3` orders has `callback_scheduled_at = NULL`** — and
  [`lib/orders/next-retry-slot.ts`](../src/lib/orders/next-retry-slot.ts), the module that
  would populate it, **has zero non-test callers**. Separately there is **no `dispatch_due`
  kind at all**, so a scheduled *delivery* coming due notifies nobody.

## Decisions already taken (do not re-open)

| Question | Answer |
|---|---|
| Scope | Agent queue **+** OrderDetailPanel **+** admin orders console (`src/components/orders/**`) |
| Elapsed time | Two-unit compound (`2h 15mn`, `1d 4h`) with the exact timestamp on hover |
| Rejection reasons | Full redesign, **5 groups → sub-reason, two clicks** |
| "Customer wants it later" | **Not a rejection** — swaps to the callback picker |
| Rejection reason display | **The reason replaces the word "rejected"** in the pill |
| Darb Tripoli vs Benghazi | Same logo, **different tint ring** |
| Status pills | **Exactly the reference** — lucide icon + visible border on every status |
| Accent | **Green chrome, violet stays on KPI tiles** |

---

## 0. The reference design language

Both screenshots are **restyled mockups over real screenshots**, not the current app. Verified:
the pipeline legend row, the orange `188`, the `▼ 40.8` delta and every French string match
`main` exactly, but no `Hourglass` (or any lucide icon) exists in `OrdersKpiStrip.tsx`, the
active tile is violet not green, `NavItem` uses `--sidebar-active #333333`, and
`OrderStatusBadge` renders the abstract 8px `StatusGlyph` with `border-transparent`. Local
`main` is identical to `origin/main` and no branch carries this. **Treat it as the target.**

The extracted system, to be applied across console + queue + panel:

**Chrome — green.** Sidebar active nav item: solid `--agent-primary` fill, white text,
`rounded-lg`, count badge inline. Primary CTA: solid green, white text, `rounded-lg`, leading
icon. Bell badge, agent avatars, source logo chips, the `ADMIN` tag: green. **Violet stays on
the KPI strip's active tile** so navigation-by-tile reads as a different instrument from
navigation-by-tab.

**Tinted icon holder.** The repeated motif: a 40px `rounded-lg` square filled with ~10% of the
tile's hue, holding a 20px lucide icon in the full hue, leading every KPI tile. Hues seen:
peach (unassigned), green (rate, today, confirmed), amber (waiting), red (to-recall), blue
(uploaded).

**Tiles.** White, `rounded-xl`, 1px `--oms-border`, flat at rest. Value ~28px `font-[650]`
`tabular-nums` — hue-coloured on alert tiles, `--oms-ink-1` otherwise. Uppercase micro-label
10.5px `tracking-[0.075em]` `--oms-ink-2`. Period sub-label `--oms-ink-3`. A thin hue progress
bar along the bottom edge.

**Status pill.** `rounded-pill`, tinted fill, **1px border in the hue**, 14px lucide icon +
~12.5px semibold label in the hue's `-ink` step.

**Controls.** Filter dropdowns: white `rounded-lg` bordered buttons, label + `ChevronDown`,
~36px. Search: full-width white `rounded-lg` input, leading magnifier, trailing sliders icon.

**Table.** Uppercase micro headers; 40px `rounded-lg` product thumb; bold customer name with
`product · city` beneath in `--oms-ink-3`; price right-aligned with the currency demoted;
quiet age; agent as avatar + name; source as a logo circle; trailing `⋮`.

**Page header.** ~28px bold title, green dot + market name beneath, secondary outline button
and primary green button top-right.

### Design-system amendments — do these first, not after

The reference contradicts written, reasoned rules. Amend the doc in the same PR or the next
session will correctly revert the work.

- **Rewrite §4.17 F-bis.** It currently states "a border is the only treatment that reads as
  an alarm, so it is spent last", backed by a measurement (35% of rows `uploaded`, 28%
  `rejected`, both settled). Bordering every pill retires that lever — record the decision and
  its cost explicitly. **Keep `weight` driving fill opacity and font-weight** so the ladder
  degrades rather than vanishes, and keep the `StatusHue`/`StatusWeight` data intact.
- **Amend §1 rule 3 and §4.17 C.** Green becomes the chrome accent; violet is retained for the
  KPI tile only. §4.17 C already flags the emerald/violet split as "a live decision, not a
  settled rule" — this closes it.
- **Add §4.18 "Segmented navigation"** (below) and **§4.19 "Tinted icon holder"**, since
  §4.10 currently forbids tinted backgrounds as section identity.
- **Amend §"Buttons"** — primary is green, not `#1A1A1A`.

---

## 1. Rejection reasons — new two-level taxonomy

Derived from the 211 free-text `autre` notes actually written by agents, not invented.

### The model

`rejection_reason` stays the group (5 values); a new `rejection_subreason` carries the detail.

| Group (`rejection_reason`) | Sub-reasons (`rejection_subreason`) |
|---|---|
| `refus_client` — رفض العميل / Refus client | `prix_eleve` السعر مرتفع · `frais_livraison` رفض رسوم التوصيل · `achete_ailleurs` اشترى من مكان آخر · `changement_avis` غيّر رأيه · `produit_non_voulu` يريد منتجاً آخر |
| `commande_invalide` — الطلب غير حقيقي / Commande non réelle **(new)** | `non_commande` لم يطلب المنتج · `doublon` طلب مكرر · `simple_info` استفسار فقط · `non_serieux` طلب غير جاد |
| `injoignable` — تعذر الاتصال / Injoignable | `pas_de_reponse` لا يرد · `numero_invalide` رقم خاطئ · `numero_hors_service` مغلق / خارج الخدمة · `mauvais_interlocuteur` الرقم لشخص آخر · `raccroche` يغلق الخط |
| `livraison_impossible` — تعذر التوصيل / Livraison impossible **(new)** | `hors_couverture` خارج التغطية · `paiement_impossible` وسيلة الدفع غير متاحة · `adresse_invalide` عنوان غير صحيح · `absent_ville` خارج المدينة |
| `autre` — أخرى / Autre | none — **note becomes mandatory**, enforced in the RPC as well as the sheet |

**"Reporté / مؤجل" is deliberately absent.** A sixth option in the reject screen labelled
*"يؤجل الطلب / Le client veut plus tard"* does not reject — it closes the reject screen and
opens `CallbackPicker`. The order stays alive with a scheduled date instead of dying as
rejected and polluting the rejection rate.

### Short labels for the pill

The status column is 172px ([row-grid.ts:17-24](../src/components/queue/row-grid.ts#L17-L24)),
and the pill now also carries an icon. Each sub-reason therefore needs a **short** display form
distinct from its picker label — `achete_ailleurs` → `مكان آخر` / `Ailleurs`;
`numero_invalide` → `رقم خاطئ` / `Faux n°`; `prix_eleve` → `السعر` / `Prix`. Both go in
`messages/{ar,fr}.json` under `orders.rejectionSubreasons.<key>` and
`orders.rejectionSubreasonsShort.<key>`.

### Migrations (three, in order — `ALTER TYPE … ADD VALUE` cannot be used in the same transaction that writes the new value)

1. `…_rejection_taxonomy_enum.sql` — `ALTER TYPE rejection_reason ADD VALUE 'commande_invalide'`,
   `… 'livraison_impossible'`. Add `orders.rejection_subreason TEXT` + a `CHECK` listing the
   18 sub-keys (text + check, not a second enum — sub-reasons will keep moving, and a check
   constraint is a one-line migration where an enum is not).
2. `…_rejection_taxonomy_backfill.sql` — map the legacy rows:
   `prix → (refus_client, prix_eleve)` · `faux_numero → (injoignable, numero_invalide)` ·
   `doublon → (commande_invalide, doublon)` · `non_serieux → (commande_invalide, non_serieux)` ·
   `injoignable → (injoignable, pas_de_reponse)` · `refus_client → (refus_client, NULL)` ·
   `autre → unchanged`. Legacy enum values stay in the type (history integrity, and PG cannot
   drop an enum value without recreating it) but leave the picker.
3. `…_rejection_subreason_in_transition.sql` — add `p_rejection_subreason` to
   `transition_order_status`. Base it on the **current live definition**,
   `supabase/migrations/20260519000002_allow_dispatch_scheduled_to_confirmed.sql:25-125` —
   not an older overload. Keep the existing `RAISE EXCEPTION` for a missing reason, add one
   for a missing note on `autre`.

Update the four auto-reject sites that write `rejection_reason = 'injoignable'`
(`005_carrier_dispatch.sql:283`, `015_session9_no_response_rpc.sql:101`,
`20260418_attempts_count_and_retry_times.sql:134`, `20260505233818…:440`) to also write
`rejection_subreason = 'pas_de_reponse'`.

### Code

- `src/types/order-status.ts:52-62` — replace `REJECTION_REASONS` with `REJECTION_GROUPS` +
  `REJECTION_SUBREASONS: Record<RejectionGroup, readonly string[]>`; export
  `subreasonGroup(sub)` for reverse lookup.
- `src/components/queue/RejectionReasonSelect.tsx` — rebuild as two panes: group list →
  sub-reason list, with a back affordance and the "يؤجل الطلب" escape at the foot of pane 1.
  Number keys stay live (the sheet already binds `1/2/3/4`, see
  [QueuePage.tsx:567-635](../src/components/queue/QueuePage.tsx#L567-L635)).
- `src/components/queue/PostCallActionSheet.tsx` — thread `rejection_subreason` through the
  submit at `:583-609`; pre-select `(injoignable, pas_de_reponse)` when `atMax` (today it
  pre-selects bare `injoignable` at `:738-742`); disable submit until a sub-reason exists for
  every group except `autre`, and until a note exists for `autre`.
- `src/components/queue/RejectionReasonPicker.tsx` — older `<select>` variant. Delete if
  unreferenced; otherwise port.
- Manager filter: `src/components/orders/OrdersAdvancedDrawer.tsx:255` and
  `src/lib/orders/list-filters.ts` (`:62, 92, 133, 208`) gain the sub-reason dimension.
- Analytics: the dashboard rejection breakdown keys on **sub-reason** — that is the whole point
  of the change. `src/lib/products/signals.ts:17,85` (`top_rejection_reason`) too.

### Display — the reason replaces "rejected"

**Delete `src/components/queue/RejectionReasonHover.tsx`.** The hover popover is the problem
being solved, and nothing else uses it.

In `presentAgentStatus` ([src/lib/queue/agent-status.ts](../src/lib/queue/agent-status.ts)),
when `status === "rejected"` return the short sub-reason label instead of
`orders.statuses.rejected`. Fallbacks in order: short sub-reason → group label → the note (for
`autre`) → the plain "rejected" label. Hue and icon stay red/`XCircle`, so the row still reads
as rejected from colour and icon alone — the word was the redundant encoding. Mirror it in
`OrderStatusBadge`. Keep the full reason plus free-text note in the OrderDetailPanel, where
there is room.

---

## 2. Segmented tabs and sub-tabs

### The shared primitive

There is **no `Tabs` primitive today** — every surface hand-rolls one. Create
**`src/components/ui/SegmentedTabs.tsx`** (+ `SegmentedTabs.test.tsx` first) and use it for the
queue's Level-1 buckets, Level-2 chips, and the console.

```tsx
type Segment = {
  key: string;
  label: string;
  count?: number;
  icon?: LucideIcon;
  /** Drives hue + icon via presentStatus; null = neutral ("all"). */
  status?: string | null;
};
type Props = {
  segments: Segment[];
  value: string;
  onChange: (key: string) => void;
  size?: "md" | "sm";          // md = Level 1, sm = Level 2
  role?: "tablist" | "group";  // tablist for buckets, group for filters
  ariaLabel: string;
};
```

Visual contract, existing tokens only:

- Segment: `inline-flex items-center gap-2 rounded-lg border px-3` · `h-[38px]` (md) /
  `h-[30px]` (sm) · `text-[13.5px]`/`[12.5px] font-semibold`
- Rest `border-agent-outline-variant bg-agent-surface text-agent-on-surface-variant` ·
  hover `border-agent-outline text-agent-on-surface` ·
  active `border-agent-outline bg-agent-surface text-agent-on-surface`
- Count badge: `grid h-5 min-w-[21px] place-items-center rounded-pill px-1.5 text-[11px]
  font-bold tabular-nums`; **active `bg-agent-primary text-agent-on-primary`**, inactive
  `bg-agent-surface-low text-agent-ink-3`
- Row: `flex items-center gap-2 overflow-x-auto custom-scrollbar` over a
  `border-b border-agent-outline-variant` baseline
- Logical properties only (`ps`/`pe`/`border-s`) — the row must mirror under `dir="rtl"`

Below the row: `QueueSearchBar` moves out of the Topbar `searchSlot` to sit under the tabs,
beside a **`تصفية` / Filtres** button carrying a count badge of *active* filters (sub-filter +
tentative + search) — matching the reference.

New **§4.18 "Segmented navigation"** in the doc: the queue carries three nested levels of
navigation where the console carries one; an underline cannot express nesting, so segments
carry levels 1 and 2 and the accent moves from the underline to the **active count badge**.
§4.11 ("Pills-as-tabs are deprecated") is superseded for these surfaces.

### Files

`QueueHeader.tsx` — `TabButton` (`:113-174`) and `FilterChip` (`:183-246`) both collapse into
`SegmentedTabs`; keep `chipFace`/`CHIP_HUE` (`:81-104`) and pass `status` through so chips keep
inheriting the hue and icon of the pills they reveal. The Level-3 tentative popover
(`:457-525`) stays as a `trailing` slot. `src/components/layout/AgentNavTabs.tsx` and the
console tab row adopt the same primitive.

---

## 3. Scheduled call / delivery — bucketing, counts, notifications

### The bucket model

Reuse the shape already proven in
[`src/lib/to-ship/group.ts:66-82`](../src/lib/to-ship/group.ts#L66-L82) (`bucketOf` →
`overdue | today | tomorrow | later | unscheduled`, UTC day boundaries). Extract it to
**`src/lib/queue/schedule-bucket.ts`** so both surfaces share one definition rather than a
second copy.

Widen the sub-filter union so a future schedule has a home:

```ts
export type EnCoursSubfilter =
  | "all" | "tentative" | "rappel" | "livraison" | "planifie";
```

- `rappel` / `livraison` keep their meaning — **due now** (unscheduled or past-due).
- **`planifie`** (`مجدول` / *Planifié*) is new: `callback_scheduled` **or** `dispatch_scheduled`
  whose time is still in the future. Violet hue, `CalendarClock` icon, count of orders
  scheduled ahead.
- Every `en_cours` order now matches exactly one of
  `tentative | rappel | livraison | planifie`. **Add a test asserting the partition is total**
  — that is the regression that lets this bug come back.

### Make the counts honest

Three places compute counts and must agree:

1. Server — `src/app/api/agent/queue/route.ts:179-225`: add `planifie`; keep `rappel_prevu` /
   `livraison_planifiee` as due-now.
2. Client mirror — `src/lib/agent-queue/buckets.ts:54-103`: same change, byte-for-byte.
3. `QueueHeader.tsx:330-331` — `enCoursTotal` becomes
   `tentative_total + rappel_prevu + livraison_planifiee + planifie`, which then equals the
   rows *Tous* actually renders.

`src/lib/agent-queue/__tests__/cache-patch.test.ts:221` ("callback_scheduled with future time
does NOT count in rappel_prevu") stays **true and should be kept** — the future callback now
counts in `planifie`. Add the complementary assertion rather than editing that one.

### Notifications

- Migration `…_dispatch_due_notification.sql`: widen the `kind` CHECK
  (`supabase/migrations/20260418_agent_notifications.sql:18`) to include `dispatch_due`, and add
  a third insert block to `run_notifications_check()`
  (`supabase/migrations/20260624000003_pg_cron_notifications.sql:13-58`) for
  `status = 'dispatch_scheduled' AND scheduled_dispatch_at <= now() AND assigned_to IS NOT NULL`.
  Extend `resolve_stale_notifications()` to clear it. The unique partial index
  `(order_id, kind) WHERE read_at IS NULL` already makes the every-minute tick idempotent.
- `src/components/layout/NotificationBell.tsx:19-47` — add `dispatch_due` to the urgency palette
  (violet, below `callback_due` red and `attempt_due` amber) and `notifications.dispatch_due` to
  both message files.
- **`attempt_due`: wire it, don't delete it.** `next-retry-slot.ts` is fully written and tested
  with zero callers; the missing link is that no transition writes `callback_scheduled_at` on an
  `attempt_*` row. Call it from the attempt transition so a retry slot is stamped. If you would
  rather not open a new notification stream in the same pass, delete `next-retry-slot.ts` and
  drop the `attempt_due` insert instead — but leaving it half-wired is the worst option.
- `dispatch_scheduled_ready` only returns `scheduled_dispatch_auto = true`, so **manual**
  scheduled deliveries have no automation and, until now, no signal. `dispatch_due` gives them
  one.

### Adjacent consistency fix

`src/components/orders/OrdersFacetBar.tsx:65-85` omits `dispatch_scheduled` from both
`CALL_STATUSES` and `DELIVERY_STATUSES`, so scheduled deliveries are unreachable from the
manager console facets. Add it to `CALL_STATUSES` (still pre-carrier work).

---

## 4. Status pills — the reference treatment

One icon map for the whole app, added as an `icon` field on
`src/lib/orders/status-presentation.ts`'s `BASE` map (`:78-112`) so `QueueStatusPill` and
`OrderStatusBadge` cannot drift — the doc's "one presentation map" rule:

| | | | |
|---|---|---|---|
| `pending`/`new` `Clock` | `assigned` `UserCheck` | `unverified` `HelpCircle` | `attempt_*` `PhoneOutgoing` |
| `callback_scheduled` `PhoneCall` | `dispatch_scheduled` `CalendarClock` | `confirmed` `CheckCircle2` | `uploaded` `DownloadCloud` |
| `scanned` `ScanLine` | `dispatched` `Truck` | `deposit` `PackageOpen` | `in_transit` `Route` |
| `delivered` `CheckCircle2` | `received` `PackageCheck` | `to_be_returned` `CornerUpLeft` | `returned` `PackageX` |
| `rejected` `XCircle` | `cancelled` `Ban` | `deleted` `Trash2` | |

Both `QueueStatusPill.tsx` and `OrderStatusBadge.tsx`: `rounded-pill`, **`border-hue-*-edge` on
every status**, 14px lucide icon in a fixed-width slot (so labels still start at the same x),
label to 12.5px, `h-[24px]`, datum well keeps `tabular-nums`.

Two things to preserve while doing it, so the change costs only what it must:

- **Replace `bg-current/[0.13]`** on the queue pill's datum well (`QueueStatusPill.tsx:135`) —
  it takes the *text* colour at 13% over an already-tinted pill and muddies differently in each
  hue. Use an explicit per-hue `-edge` token at fixed alpha.
- **Keep `weight` driving fill opacity and font-weight** (the existing `FONT` map). The border
  lever is spent, but the ladder should degrade, not vanish.

`StatusGlyph` is left with no consumers once the chips adopt icons too — delete it and its
test, and drop the `tone="inherit"` prop added for it. Re-run
`src/lib/orders/status-contrast.test.ts` after any token change; it reads `globals.css` and
fails any pair below 4.5:1.

---

## 5. Elapsed time — compound + exact on hover

`src/lib/orders/order-age.ts:51-62` floors to one unit (`3 h`). Replace `formatOrderAge` with a
two-unit compound and the requested abbreviations:

```
UNITS.fr = { min: "mn", hour: "h", day: "d" }   // as specified — note FR convention is min/j
UNITS.ar = { min: "د",  hour: "س",  day: "ي"  }

45mn · 2h 15mn · 1d 4h · 12d       (second unit dropped when zero, and above ~7d)
```

Wrap each cell with `title={formatDateTime(created_at, locale)}` —
`src/components/orders/OrderRow.tsx:351-356` already does exactly this, so match it rather than
inventing a tooltip. Keep `AGE_TONE` and the `⚠` breach glyph: §4.17 D requires the glyph to
carry the signal in greyscale.

Four call sites move together: `OrderRow.tsx:351-356`, `OrderCard.tsx:391-402` (twice),
`OrderDetailPanel/PanelHeader.tsx:96-98`. Update `src/lib/orders/order-age.test.ts` first.

Three private duplicates of this logic exist and should be folded in or left alone
deliberately, not by accident: `src/components/alerts/format.ts`,
`src/components/in-delivery/InFlightTable.tsx:186-192`, and the two copies of `timeAgo` in
`src/components/warehouse/{preparation/ScanFirstPreparationStage,returns/ScanFirstReturnsStage}.tsx`.
`src/lib/format.ts`'s `formatRelativeDate` is dead (no app callers) — delete it.

---

## 6. Console chrome — bring `main` up to the reference

- `src/components/layout/NavItem.tsx:47` — active state becomes a solid green `rounded-lg` fill
  with white text and an inline count badge, replacing `--sidebar-active #333333` + the white
  inline-start border.
- `src/components/ui/Button.tsx` — primary variant goes green (`--agent-primary`), white text,
  `rounded-lg`. The `.agent-theme` block in `globals.css:305-320` already force-maps
  `bg-ink-primary` to emerald for the agent shell; unifying the variant lets those `!important`
  overrides be deleted.
- `src/components/orders/OrdersKpiStrip.tsx` — add the tinted icon holder to each tile and the
  hue progress bar along the bottom edge. **Active tile keeps violet** (`tileClass`, `:241-252`)
  — that is the one place violet survives.
- `src/components/orders/OrdersFacetBar.tsx` / `OrdersFilterBar.tsx` — dropdowns to white
  `rounded-lg` bordered buttons with `ChevronDown`; search input gains the trailing sliders icon.

---

## 7. Order tracking + the order panel

### Tracking

The delivery tab (`OrderDetailPanel/index.tsx:1263-1350`, tab key **`"shipping"`**) has no
OMS-side stage timeline — only the two carrier widgets. Meanwhile
`src/components/in-delivery/OrderTimeline.tsx` **already computes exactly that** from
`order_history` via `/api/orders/[id]/timeline`, and the panel never uses it.

Lift it in and modernise it. It is 114 lines of inline `style={{}}` with hardcoded hex
(`#1A1A1A`, `#E3E5E7`, `#F6F6F7`) that predates the token system. Rebuild as a horizontal rail:
a connected track with a node per stage carrying that stage's icon from the §4 map, reached
nodes filled in the stage hue, the current node ringed, unreached hollow on
`--oms-surface-sunken`, dwell time under each node in `tabular-nums`, and the return path
swapping the tail when `to_be_returned`/`returned` appears (logic already at `:20-26`). Logical
properties so it mirrors in Arabic.

**Blocker:** `/api/orders/[id]/timeline` is gated to super_admin / market_manager
(`route.ts:53-55`). Agents need read access for their own orders — widen it to the agent role
scoped by `assigned_to`, or the panel renders an empty tab for the people who use it most.

### Panel UX

Read `OrderDetailPanel/index.tsx:1-44` first — its header comment is an unusually good guide to
changing this file without rewriting it. Work within §4.17 G's rules: fixed masthead over a
single scroller; a tab is a disclosure and holds no nested cards; hide panels with `hidden` on
an element that sets no `display`; one money spine; editable values declare themselves with a
dotted underline at rest; never promote a destructive action beside the primary CTA.

Concrete targets: the delivery tab stacks six unrelated blocks with no section labels (§4.10
gives the label + icon pattern); `CustomerCard` repeats address, city, carrier and tracking that
the masthead already shows; and the carrier status blocks render at full height whether or not
the carrier has said anything.

---

## 8. Duplicate + repeat-buyer badges

Both are 11px lucide glyphs in tinted chips (`src/components/shared/DuplicateOrderBadge.tsx`,
`RepeatBuyerBadge.tsx`) that read as the same object at a glance, which is wrong — they mean
opposite things:

- **Repeat buyer is an asset.** Same person, ordering again. `Repeat2`, calm tone, **pill**.
- **Duplicate is a defect.** This order is probably misplaced and must not ship twice. `Copy`,
  **square/angular chip** so shape alone separates them. (The file's doc comment at `:36-41`
  says "Layers" while the code uses `Copy` — fix the comment.)

Keep the escalation where a duplicate with `hasUploadedSibling` goes critical (`:106-108`) —
"already shipped, do not ship again" is the most valuable signal either badge carries. Raise
both glyphs to 12px; show a count only when > 1.

`repeat_kind === "risk"` (≥2 prior orders, ≥50% rejected —
`src/lib/customer-history/classify.ts:30-43`) currently borrows the critical tone from
duplicate. Give it amber instead so red means exactly one thing in the row.

---

## 9. Darb Assabil — Tripoli vs Benghazi

There is **no `darb_assabil_benghazi` code and no second logo asset**. Libya runs two accounts
as two `carriers` rows sharing `code = 'darb_assabil'`, distinguished only by `name` — see
`supabase/migrations/20260816000003_carriers_unique_per_account.sql`. `getCarrierLogo()`
([src/lib/carriers/carrier-logos.ts](../src/lib/carriers/carrier-logos.ts)) keys on `code`
alone, so both render the identical PNG.

- Add `carrier_id` to `QueueOrder` (`src/types/queue.ts:19-23`) and to the queue route's select
  — `carrier_name` alone would make the mark depend on an editable display string.
- New `carrierAccentFor(carrierId)` returning a ring colour; render the 20px logo in
  `OrderCard.tsx:451-477` inside a `ring-1` wrapper tinted per account.
- Fold the duplicate logo map at `src/components/settings/carriers/CarrierHealthBadge.tsx:5-9`
  back into `carrier-logos.ts` so there is one map, not two.
- A carrier account is not a status, so colour alone must not carry it: keep `carrier_name` in
  the `title` and add the city to the `aria-label` so the distinction survives greyscale and
  screen readers. Record the exception in §4.18.

---

## Sequencing

Each phase is independently shippable and verifiable.

1. **Defects** — §3 bucketing + counts + notifications, §5 time format. Highest regression risk,
   so they land while the surface is otherwise unchanged.
2. **Design-system amendments** — §0. Written before the code that violates the old rules.
3. **Data model** — §1 rejection taxonomy (3 migrations + picker + pill display).
4. **Visual system** — §4 status pills, §2 `SegmentedTabs`, §6 console chrome. One pass, since
   they share tokens and would otherwise half-migrate the app twice.
5. **Polish** — §8 badges, §9 Darb rings.
6. **Panel** — §7 tracking + panel UX, largest and least urgent.

## Verification

- **TDD is non-negotiable** (`CLAUDE.md`, `.claude/skills/test-driven-development`). Failing test
  first for every unit: `order-age.test.ts`, `agent-status.test.ts`, `cache-patch.test.ts`, a new
  `schedule-bucket.test.ts` (including the *partition is total* assertion),
  `SegmentedTabs.test.tsx`, `RejectionReasonSelect.test.tsx`.
- `npm run test:run` — baseline is **4492 passing**; pre-existing failures are `webhook-handler`,
  `TeamSection`, `CarriersSection`, the dexpress/buybox adapters and `DateRangePicker`. Anything
  beyond that set is a regression.
- `npm run typecheck` and `npm run build` clean. (`npm run lint` is not runnable — no ESLint
  config; `next lint` drops into an interactive prompt. Pre-existing.)
- `src/lib/orders/status-contrast.test.ts` must still pass after every token change.
- **Drive it in the browser** against the dev server, in Arabic/RTL as `agent1.ly` and in French
  as `admin`: schedule a call for tomorrow and confirm it lands under **مجدول** and that every
  chip count equals the rows it yields; schedule a delivery and confirm a `dispatch_due`
  notification arrives within a minute; reject an order and confirm the pill reads the reason,
  not "مرفوض"; confirm the two Darb accounts render distinguishably; compare the console
  side-by-side with the reference.
- **Verify counts against SQL, not the UI** — §4.17 G exists because a headline number and the
  view it opened drifted apart before.
- Confirm no physical CSS properties (`left`/`right`/`ml-`/`pr-`) in any changed file.

---

# What shipped

## Defects fixed

- **Future-scheduled orders matched no sub-tab.** `lib/queue/schedule-bucket.ts` is now the
  single rule, used by the list filter, the server counts and the realtime cache mirror alike.
  A new `planifie` chip holds calls and deliveries scheduled ahead. A test asserts the four
  sub-buckets *partition* the whole en-cours set — that is the regression that let this happen.
- **The counts lied.** `enCoursTotal` now includes `planifie`, so the tab badge equals the rows
  it opens. Verified against SQL, not the UI: 225 + 93 + 3 + 3 = 324, zero unbucketed.
- **Scheduled deliveries notified nobody.** Added the `dispatch_due` kind; the function emitted
  3 notifications on its first tick for deliveries that were already past due and silent.
- **`attempt_due` had never fired once.** `attempt_retry_times` (11:00/14:00/18:00) has been a
  configured setting since April and nothing read it — `no_response_with_auto_reject` explicitly
  wrote `callback_scheduled_at = NULL`. It now stamps the next slot via `next_retry_slot()`,
  which resolves in the market's own timezone. `lib/orders/next-retry-slot.ts` (dead TS twin)
  deleted.

## Rejection taxonomy

Five groups → sub-reason, derived from the 211 free-text notes agents actually wrote under
`autre` (36% of all rejections; 68% of those had no note at all). `autre` now requires a note,
enforced in the RPC as well as the API. "The customer wants it later" is an escape that opens
the callback picker instead of rejecting. All 1799 rows migrated; zero remain on a retired value.

The 339 legacy `refus_client` rows keep a null sub-reason on purpose — they carry no note, so
any sub-reason would be invented data.

## Visual system

Status pills take the reference treatment on both surfaces — a lucide icon per status from one
map, and a border on every state. `StatusGlyph`'s shape encoding is retired for orders (the CRM
lead badge still uses it). `SegmentedTabs` replaces the underline tabs. Brand green is chrome;
violet is retained for the KPI tile only.

**Caught during the work:** Tailwind v3 cannot apply an opacity modifier to a `var()`-backed
colour, so `bg-hue-amber-bg/70` and `border-hue-amber-edge/25` compiled to *nothing* — every
pill would have shipped wearing the preflight grey border. Fixed with explicit
`-fill-soft` / `-edge-soft` / `-edge-mid` tokens. Do not reintroduce the modifier form.

## Verified

- `npm run typecheck` and `npm run build` clean.
- **Zero regressions.** The failing set is byte-identical to clean `main` (15 files / 31 tests:
  leads metrics, warehouse routes, settings sections, AgentDrilldown, DatePicker, dexpress and
  buybox adapters, webhook-handler). `OrderCard.test.tsx` failed on `main` and now passes.
- Live DB: 1968/1968 cron runs succeeded in 24h; `agent_notifications` now carries `dispatch_due`.
- `next_retry_slot` checked against both markets' real settings, including roll-over past the
  last slot of the day.

## Not done

- **The Level-2 chip row was restyled, not rebuilt on `SegmentedTabs`.** It anchors the
  tentative popover inline, and moving it would have meant reworking that positioning; the
  chips were given the segment's border-at-rest and accent count badge instead.
- **Panel UX beyond tracking** (§7's second half) — `CustomerCard` still repeats address, city
  and carrier from the masthead, and the carrier blocks still render full-height when the
  carrier has said nothing.
- **Nothing was driven in a browser.** Every claim above is from tests, typecheck, build and
  SQL. The reference design should be compared side-by-side on a real screen before shipping.
