# Suivi livraison — re-engineering the row so an agent reads it at a glance

Decided and prototyped 2026-09-17. Prototype: `prototypes/suivi-livraison-v4.html`
(`?lang=fr|ar&view=desktop|mobile&order=sit|client`). This file is the source of truth; the
transient copy under `~/.claude/plans/` is scratch.

**Decided with the owner, 2026-09-17:** prototype v4 first, then React under TDD; the number
to dial goes inside the row's primary button (desktop agents read it and dial on a handset);
"Veut annuler" and "Colis à risque" join returns in the red *save* tier. Second round, same
day: the *risque* tag follows the **database rule** (`customer_risk_class`; align
`classify.ts` to it afterwards); **coordinated / office_pickup delays leave act-now** while
Darb's retry date is ahead (queued as a small RPC change after the row — simulated in the
prototype); agents work on **desktop and phone about equally**, so both views ship in one
pass. The owner iterates on the prototype before anything is built.

## What shipped (2026-09-17, after the owner reviewed v4)

The owner kept the current design and took **two things** from v4 into the real code:
the **situation as the first column** on desktop and phone, and **one colourful gradient hue
per situation** on the existing chip (`SIT_TONE`, design-system §4.22). Everything else below
(age column, trace line, number inside the button, tags, retired pill, strip changes, tokens)
is **parked**, not rejected — the prototype stays as the reference if it is picked up again.
Files touched: `src/lib/delivery/presentation.ts`, `src/components/delivery/ui.tsx`,
`DeliveryRow.tsx`, `DeliveryWorklistView.tsx`, `DeliveryBoardView.tsx`, their tests, and
`vitest.config.ts` (excludes `.claude/worktrees/**`, which was running another session's
checkout inside `npm test`).

## Follow-up (2026-09-18): the manager screen

The manager board reuses `DeliveryRow`, so situation-first and the per-situation hues arrived
there with no extra work; two regression tests now pin that in `DeliveryBoardView.test.tsx`.
What the pass actually fixed was a contradiction the new hues exposed: surfaces describing one
parcel were still bucket-coloured, so a stalled parcel showed a stone chip against an amber
edge. `DeliveryRow`'s edge, the detail panel's carrier-status dot and the mobile
suggested-action tint now follow `situationOf(...).tone`. Group-level surfaces (the two bucket
strips, the cockpit legend, the per-agent load bar) stay on `BUCKET_TONE` on purpose, and the
mobile action bar stays on `moveTone`. Verified against the live prod data as `manager.ly` in
Arabic and French, desktop and phone.

## Context

The `/delivery` worklist is the agent's most-used screen: 20–60 live parcels, each needing
"what is wrong, how urgent, what do I do, did I already do it". The owner's screenshot
(Arabic, desktop, 13 rows in *À traiter maintenant*) shows that the current row answers none
of those at a glance. The complaint is about **how data is displayed**, not the visual style:
the status tags, the structure, what is emphasised. The Shopify light console look, the page
layout (list + detail panel), the buckets, the sheets and the undo stay.

This plan touches presentation logic, the row, the bucket strip, i18n and tokens — not the
RPC, the buckets or the action ledger.

## 0. What the live data said (measured 2026-09-17, Libya, in flight, dead uploads excluded)

| fact | number | consequence |
|---|---|---|
| out-for-delivery parcels with a courier remark | 24 (11 no_answer, 11 cancel-like, 1 out_of_coverage, 1 other) | the red tier is ~1 in 6 act-now rows, so it keeps its meaning |
| those remarks' age | 1 200–2 200 h | they are the dead stalls; `partitionStalled` already hides them |
| delivery_delayed parcels | 44, of which 40 carry Darb's `delayed_until` (16–18 Sept) | the *delayed* row shows the retry date, not hours on status |
| delayed remarks' age | 12–41 h, ≈ `latest_event_at` | `latest_remark_at` is a reliable age source and matches the RPC's own `remark_unanswered` anchor |
| open proactive-call tasks | 0 (the trigger has not shipped) | the proactive red tier is designed in but dormant |
| human delivery actions ever | 11, on 10 orders, all in the last week | the trace line will mostly show the courier's words at first |
| price points | 129 / 179 / 249 / 199 cover 97 % | the amount discriminates nothing; demote it |
| customers with `risk_class = 'risk'` (DB rule) | 143 of 7 117 | the *risque* tag stays rare |
| settings | only `carrier_stall_days` set (5); `high_value_threshold` off | no high-value bolding until the setting is turned on |

## 1. Diagnosis — what the screenshot gets wrong

Read against `src/components/delivery/DeliveryRow.tsx`, `ui.tsx`, `DeliveryWorklistView.tsx`,
`src/lib/delivery/presentation.ts`.

1. **The chip carries the bucket, not the situation.** `BUCKET_TONE` colours every act-now row
   amber, so inside the list the agent actually works, the 13 chips are identical pills that
   must each be *read*.
2. **The number after the dot means a different thing per row.** For `due` it is hours
   overdue; for `no_answer`/`address`/`cancel` it is `hours_on_status` (time since the last
   Darb *event*), not time since the courier's remark; for `stalled` it is days — and the
   pill's variable width puts it at a different x on every row.
3. **Three time encodings for one fact.** Duration in the chip, a canned sentence that repeats
   the chip, then a timestamp line. Nothing on the row says what has *already been done*.
4. **The row hides the discriminating data it has.** `is_risky`, `risk_reasons`,
   `customer_risk_class`, `resend_count`, `last_action_*`, `latest_remark` are all in
   `WorklistRow` and none reaches the list.
5. **Visual weight ≠ decision weight.** The amount is the largest type on the row. The phone
   line is shown but not actionable. The product title wraps and dominates; the thumbnail is
   the same cover on nearly every row.
6. **The action column has no fixed anchor.** Primary buttons vary in width and colour
   (`moveTone` duplicates the chip's signal); the WhatsApp square appears on some rows only.
7. **The strip lies a little.** "الكل 66" while the subtitle says "33 قيد التنفيذ". Money sums
   per bucket are manager metrics. Zero buckets get the same weight as full ones.
8. **Sort inside act-now is `moved_at` only.**
9. **Selected-row green** collides with *livré* and WhatsApp green.
10. **Label bugs.** `sit.address` reads "À traiter maintenant" (a bucket name). Column head
    "Situation / durée" is two concepts with a slash.
11. **Density.** ~110 px per row; a 1080p screen shows ~7 of 20–60 parcels.

## 2. Principles

The row answers four questions in reading order, each from a **fixed position** with a
**fixed shape**, and colour means one thing on the whole page:

| Question | Zone | Encoding |
|---|---|---|
| How loud? | rail + label ink + sort position | **urgency tier** (hue) |
| What is wrong? | icon in a fixed slot + short label | **situation** (icon + words) |
| How long? | own tabular column | **time**, one definition per situation |
| Already done? / what did the driver say? | second line under the situation | **trace** |
| Who / where? | client cell, name first, address second | plain type + at most two small tags |
| What do I do? | primary button at a fixed x, number to dial inside it | neutral buttons; urgency is *not* repeated here |

Three encodings per §4.17 F-bis of `docs/design-system.md` (hue, icon, weight) so any one
can be lost. Colour is never the only signal. The status *pill* is retired on this page.

## 3. The encoding system

### 3.1 Urgency tier (hue) — `tierOf(row)`

| Tier | Members | Rail | Meaning |
|---|---|---|---|
| `save` | bucket `returning`; act-now with a cancel-like remark (`customer_cancelled`, `not_needed`, `refused`, `not_serious`, `no_cash`, `payment_method`, `wrong_item`); act-now `proactive` | red | money about to leave |
| `act` | act-now: `due`, `no_answer`, `wrong_address`, `out_of_coverage`, `delayed`, `stalled` | amber | reach someone today |
| `wait` | `waiting_customer` | blue | the customer promised; countdown |
| `carrier` | `waiting_carrier` (incl. at_warehouse) | **none** | nothing to do |
| `done` | delivered → green rail; returned → no rail, muted | | |

Bucket colours in the strip stay (bucket = where it sits; rail = how loud). `moveTone()` is
deleted — buttons stop carrying urgency.

### 3.2 Situation (icon + label) — precedence and names

Precedence inside act-now: **proactive → remark (no_answer / address / out_of_coverage /
cancel) → delayed → due → stalled**. Stalled moves last (today it beats a remark): a fresh
remark or a broken promise is the reason to call, the stall is its consequence.

| key | lucide icon | FR | AR |
|---|---|---|---|
| proactive | ShieldAlert | Colis à risque | شحنة حساسة |
| cancel | Ban | Veut annuler | يريد الإلغاء |
| due | AlarmClock | Rappel dépassé | فات موعد المتابعة |
| no_answer | PhoneOff | Non joignable | لا يجيب |
| address | MapPinOff | Adresse à confirmer | العنوان غير مؤكد |
| out_of_coverage | SignalZero | Hors réseau | خارج التغطية |
| delayed | Hourglass | Livraison retardée | تأخر التوصيل |
| stalled | CirclePause | Sans mouvement | بلا حركة |
| waiting_customer | CalendarClock | Rappel prévu | موعد متابعة |
| at_warehouse | Warehouse | À l'entrepôt | في المخزن |
| waiting_carrier | Truck | Chez le transporteur | لدى الناقل |
| returning | Undo2 | Retour en cours | مرتجع |
| to_be_returned | PackageX | Retour confirmé | إرجاع مؤكد |
| delivered | CircleCheck | Livrée | تم التسليم |
| returned | Archive | Retournée | إرجاع مغلق |

Icon 18 px in a **24 px fixed slot**, label 14 px semibold in the tier ink, no pill, no
duration in the label. All names exist in the installed lucide-react 0.474.

### 3.3 Time — one column ("Délai" / "الوقت"), one definition per situation — `ageOf(row, now)`

| situation | source | display |
|---|---|---|
| due | now − `next_action_at` | `+21 h` (plus = overdue) |
| no_answer, address, out_of_coverage, cancel | now − `latest_remark_at` (fallback `hours_on_status`) | `4 h` |
| delayed | `delayed_until` when present (40 of 44 today) | `→ demain` / `→ 18 sept.` |
| stalled, proactive, at_warehouse, waiting_carrier, returning, to_be_returned | `hours_on_status` | `4 h` / `2 j` |
| waiting_customer | `next_action_at` − now | `dans 2 h` / `بعد 2 س` |
| delivered / returned | `terminal_at` | `10:05` / `hier` |

Tabular, end-aligned, ink-2. In `save`/`act` tiers, ≥ 24 h → ink-1 semibold (weight, no extra
hue — position already carries urgency). The "Aujourd'hui 00:55" line leaves the row.

### 3.4 Trace — the second line — `traceOf(row)`

**The newer of** the agent's last human action and the courier's remark wins (a remark that
arrived after the last call is exactly what put the row back in act-now, so the older action
must not hide it); else the canned `subs.*` sentence, so every row keeps two lines.

- Action: `[Phone|WhatsApp|NotebookPen] Ne répond pas · note · Hier`
- Remark: `[Truck] « الزبون لم يرد » · Hier` — the quote truncates, the time never does.

### 3.5 Client cell

- Line 1: name, 15 px semibold, then at most two **tags** (11 px, 1 px border in their ink, no
  fill): `risque` (red) when `customer_risk_class === "risk"` or `risk_reasons` has
  `repeat_risk`; `2ᵉ envoi` (neutral) when `resend_count ≥ 1`; `zone difficile` (neutral) for
  `low_zone`. High value bolds the amount instead.
- Line 2: `city · address`, 13 px ink-2, truncate. Line 3: `#ref · product ×qty (+n)`, 12.5 px
  ink-3, truncate.
- **No thumbnail on the desktop row** (v4 decision: it is the same cover on nearly every row
  and cost 46 px of the tightest column; it stays in the panel and on the mobile detail).
  Phone lines leave this cell (3.6).

### 3.6 Action cell — fixed width, two fixed slots

- **Primary** (outlined, `--border-strong`, 40 px, **214 px wide**, 13 px): icon + short label +
  the number to dial at 12.5 px: `Appeler · 091 356 5775`, `2ᵉ numéro · …`, `Livreur · …`,
  `Agence · …`, `WhatsApp · …`. Short labels live under a new `moves_short.*` key; the panel
  keeps the long ones. The label truncates before the number ever does. The click still
  opens the action sheet.
- **Secondary** (40 px square): the *other* channel (WhatsApp ↔ Phone), so both slots always
  exist and the primary never moves.
- `carrier` tier: primary is a quiet borderless "Suivre"; secondary slot empty (kept in the
  grid). `done`: quiet "—".
- WhatsApp glyph keeps brand green. Everything else on the buttons is ink-1.

### 3.7 Amount

14 px tabular regular, ink-1; semibold only when `risk_reasons` includes `high_value`.

### 3.8 Sort — `urgencyRank(row)`, replaces the bucket-only "priority"

bucket order (decision 7, so the strip filter matches the list) → situation rank inside
act-now (`proactive` → `cancel` → `due` → remark → `delayed` → `stalled`) → oldest first.
`partitionStalled` unchanged.

### 3.9 Bucket strip

- "Tout" becomes **"En cours" = all − done** (the subtitle's number); opening "En cours" no
  longer triggers `onNeedDone`. *Terminées* stays its own segment.
- Counts only for `role === "agent"`; money sums stay for managers (`showAgent`).
- One bordered bar, segments separated by 1 px; active = 2 px brand-green underline +
  semibold + `--bg-hover`; zero-count segments in ink-4. Dot per bucket stays.
- Mobile: pills with dot + count; active = brand-green border on `#F0FDF4`.

### 3.10 Selection and states

Selected row: `--bg-selected` (#F2F2F2) + `--border-strong`; the rail stays; no green.
Keyboard focus keeps the brand-green ring. Hover: `--bg-hover`.

## 4. Palette — scoped tokens `--dlv-*` in `src/app/globals.css`

Mapped onto tokens that already pass `lib/orders/status-contrast.test.ts`, replacing the
Tailwind hexes `ui.tsx` uses today.

| token | value | used for |
|---|---|---|
| `--dlv-save` / `-ink` | `--oms-bad` #B23A32 / same | red rail, label, tag ink |
| `--dlv-act` / `-ink` | `--oms-warn` #A9670C / `--oms-warn-ink` #8F5608 | amber rail / label |
| `--dlv-wait` / `-ink` | `--action` #2C6ECB / `--action-hover` #1F5199 | blue rail / label |
| `--dlv-done` | `--oms-ok` #2F7A4A | green rail on *livrée* |
| ink-1 / ink-2 / ink-3 | `--oms-ink-1/2/3` | name+amount / address, time, trace / ref, product, column heads |
| `--dlv-tint-save/act/wait/done` | `--oms-bad-bg` #FBECEA / `--oms-warn-bg` #FBF1E2 / #EAF1FB / `--oms-ok-bg` #E8F4EC | **mobile only**: the situation line's strip on a card |
| ground | page #F5F6F8, white cards, `--border` #E1E3E5, `--border-strong` #C9CCCF, selected #F2F2F2 | |

Every `-ink` on white ≥ 4.5:1. Add the `--dlv-*` pairs to the contrast test's token list.

## 5. Shapes and grid (as rendered in v4)

- Rail 4 px, inline-start, only on save/act/wait/delivered. Situation = 24 px icon slot +
  label. Tags 19 px, radius 5. Buttons radius 8, 40 px desktop / 44 px mobile, outlined.
- Desktop grid: `210px minmax(0,1fr) 58px 262px 80px`, gap 12, row padding 9/16/9/20, min
  height 66 (three lines of client ≈ 80 px in practice → ~10 rows per 1080p). Detail panel
  440 px (it was 494).
- `?order=client` swaps the first two columns (`order:` on the cells) for comparison.
- Mobile card: radius 12, rail inside, a tinted situation line (icon, label, time at the end),
  then name + tags / amount, address, trace, then a full-width primary + 44 px square.

## 6. Implementation

### Phase A — prototype v4 ✅ (2026-09-17)

`prototypes/suivi-livraison-v4.html`, built as a patch over v3 (same data, sheets, timeline,
undo). Adds three demo parcels (cancel intent, overdue callback, Darb retry date). Rendered
and checked with headless Chrome in FR + AR, desktop + mobile. Awaiting the owner's review.

### Phase B — React, TDD (write the failing test first, every step)

1. `src/lib/delivery/presentation.ts` — add `tierOf`, `ageOf`, `traceOf`, `tagsOf`;
   `situationOf` returns the tier's tone, the new precedence (stalled last), no `hours`; delete
   `moveTone`; `moveFor` gains `secondary: "wa" | "call" | null`. Tests in
   `__tests__/presentation.test.ts`: update "one hue per bucket" and the `moveTone` case; add a
   `no_answer` row with `latest_remark_at` 4 h ago and `hours_on_status` 15 → shows 4 h; a
   remark newer than the last action wins the trace; `delayed_until` → the retry date.
2. `src/lib/delivery/worklist.ts` — `urgencyRank`; `countBuckets` gains `in_flight`. Tests in
   `__tests__/worklist.test.ts`.
3. `src/app/globals.css` — `--dlv-*`; `src/lib/orders/status-contrast.test.ts` reads them.
4. `src/components/delivery/ui.tsx` — `TONE` keyed by tier on tokens; `Chip` → `Situation`
   (icon slot + label); `Tag`, `Age`, `Trace`; the new `SIT_ICON` map.
5. `src/components/delivery/DeliveryRow.tsx` — the grid above, rail by tier, no thumbnail, no
   phone lines, number inside the primary, fixed secondary slot, amount demoted, selection
   colour. Shared by the manager board (`DeliveryBoardView.tsx` L306); `showAgent` keeps the
   agent name on line 3.
6. `src/components/delivery/DeliveryWorklistView.tsx` — strip ("En cours", counts only for
   agents, underline active), column heads (`Situation · Client · Délai · Action · Montant`),
   sort through `urgencyRank`, `onNeedDone` only from *Terminées*. Tests in
   `__tests__/DeliveryWorklistView.test.tsx`: "show what it is worth" becomes manager-only;
   "each row shows its situation and the one move" gains the number-in-button and the trace.
7. `src/components/delivery/DeliveryDetail.tsx` — header and mobile status line use
   `Situation` + time; the client card shows the tags.
8. `src/messages/fr.json` + `ar.json` — `sit.*` relabels, `age.*` (`overdue`, `in`, `retry`,
   `tomorrow`), `trace.*`, `tags.*`, `moves_short.*`, `cols.*`, `buckets.in_flight`. Run the
   `i18n-reviewer` agent after.
9. `npm run typecheck`, `npm run lint`, `npm run test:run`.

### Phase C — docs

- `docs/design-system.md` → §4.22 "Suivi livraison — scoped extension" (tiers, the retired
  pill, the `--dlv-*` table, the two-slot action rule, the time-column definitions).
- `docs/delivery-worklist.md` → "Screen v4 (row anatomy)" note pointing at §4.22.

## 7. Out of scope (deliberately)

The RPC and buckets — except the queued follow-up: `delay_unanswered` must ignore
`coordinated` / `office_pickup` remarks while `delayed_until > now()` (decided 2026-09-17);
the sheets; the panel body; the manager cockpit; the `lost`
status and the commission rule; the two definitions of customer risk (open discrepancy 1 —
the tag uses the DB's `customer_risk_class` until the owner settles it).

## 8. Verification

- Prototype: `?lang=ar&view=desktop`, `?lang=fr&view=mobile`, `?order=client`; every tier
  visible; the primary button sits at one x on every row; no pill on the list.
- Unit: `npm run test:run -- src/lib/delivery src/components/delivery` green, including the
  time-source cases and the contrast test with `--dlv-*`.
- Live: `npm run dev`, log in as `agent1.ly@oms.local`, open `/ar/delivery` and `/fr/delivery`
  at 1440 px and 390 px: ≥ 10 rows visible at 1080p; "En cours" equals the subtitle number; a
  `no_answer` row's time matches its remark in the detail timeline; a `delivery_delayed` row
  shows Darb's retry date; keyboard focus ring visible; RTL mirrors the rail to the right edge.
- Manager: `manager.ly@oms.local` → `/ar/delivery` board still renders rows with the agent name
  and money sums in the strip.
