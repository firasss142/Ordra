# Warehouse agent interface (Libya, Darb Sabil): UX critique and prototype

> Prototype: `prototypes/warehouse-agent-v2.html` (single source: the same file is published as an artifact for phone viewing).

## Context

The agent shell was built to match four generic mockups ("Data-Driven Agent Dashboard", "Critical Tasks" with deadlines, "Accuracy 99.5 %") that never modelled the actual job in Libya: pick the right coloured Darb Sabil roll for the destination, peel a pre-printed QR sticker, stick it, scan it, and let that number become the order's reference. Four production screenshots taken as adel show ten figures above the fold on Home, nine of them zero or a dash, while the only actionable fact (two parcels waiting, the oldest for 13 days) sits in a 12 px caption under a 0 % bar. The sticker colour, the one thing that routes the parcel onto the right truck, is absent from Home and from the bottom bar; the screen that shows it (Preparation) has no tab.

Decisions taken with the user for this design:

| Question | Decision |
|---|---|
| Device | Phone, camera scan, one hand on the phone and one on a parcel |
| Rolls | Darb Sabil supplies several colour rolls; the agent picks the colour by destination area; after the scan the sticker code becomes the order's code |
| Stock scope | Our own Libya shelf only; orders Darb Sabil ships from its own warehouse must not reserve our units |
| Returns screen | The placeholder state stays forever (defect, not a capture artefact) |
| Home | Bench-first: Home becomes the parcel queue grouped by roll colour |
| Early returns | Strict: the bench cannot receive a parcel Darb Sabil has not yet marked returned; the screen must say so |
| Handover | Ad hoc pickup; a "scanned, waiting for pickup" count is enough |
| Old orders | The 407 bench-cleared orders stop reserving stock |

Intended outcome: a bench-first shell whose Home is the queue by roll colour, a scan sheet that carries the parcel and its roll into the camera, a scan-first Returns screen, a truthful Stock page, and a unified visual system. This phase delivers a design document and a click-through HTML prototype. No product code is written or modified in this phase.

---

## 1. Critical analysis

### 1.1 The finding that matters

The shell answers "how is the warehouse doing" and never "what do I do now". Every screen is a manager's console shrunk to a phone, and three of the five screens are literally the desk console (`max-w-[1460px]` containers, KPI grids, icon holders) rendered inside the phone shell. For a bench that shipped 6 parcels in 21 days while Darb Sabil shipped 200 from its own warehouse, "Today's scans 0, goal 40" is a fabricated failure every morning, and the three 0 % bars are an invitation to stop opening the app.

The job is a loop: see what waits, fetch the box, pick the roll, stick, scan, confirm, next. The current shell breaks the loop at every joint: the queue is two taps away, the roll colour is only on the queue screen, the scanner forgets which parcel was taken, and the result tile has no "next".

### 1.2 Home (لوحة القيادة)

| # | Issue | Evidence | Severity |
|---|---|---|---|
| H1 | Hierarchy inverted | "2 طرد · الأقدم 13 ي" is the smallest text on the page; four zero KPIs are 27 px extrabold | Blocking |
| H2 | Goal 40 is fiction | `DEFAULT_DAILY_GOAL = 40` in `warehouse/page.tsx:11` whenever `goal_daily_scanned` is unset; Libya never set it. The same constant in `preparation/page.tsx:15` unwraps the setting differently, so the two screens can disagree | Major |
| H3 | Three bars, three meanings, one look | `TaskCard` pct = done ÷ (done + pending). Preparation divides today's scans by an all-time backlog (reads 0 % for months); Count divides "ever counted" by "never counted"; Returns divides today's decisions by the standing queue. Identical bars, incomparable numbers, no label saying what is measured | Major |
| H4 | Summary strip is for a manager | Rhythm per hour, count accuracy, last hour: none is actionable by the agent, all null today, shown as dashes | Major |
| H5 | No colour anywhere | The roll colour exists only inside `PrepCard` on the Preparation screen | Blocking |
| H6 | No tab for the job | Bottom bar = Home, Stock, Returns, Settings. Preparation is reachable only through a task card; `warehouse.nav.preparation` and `nav.scan` keys exist but are orphaned | Blocking |
| H7 | Idle band is prose | The "Darb ships from its own warehouse" explainer is a paragraph; the agent needs the next action, not an explanation | Minor |
| H8 | Card edge lost in the lattice | 40 px grid in `#E3E6DD` under `#BFD6C7` hairlines on `#FAFAF6` cards: the decoration is louder than the container | Minor |
| H9 | Undefined token | `border-wm-line` on the idle band (`AgentDashboard.tsx:203`) does not exist in `tailwind.config.ts`; the card renders with a default border colour | Minor |

### 1.3 Preparation and Scan (the job itself)

| # | Issue | Evidence | Severity |
|---|---|---|---|
| P1 | Desk console on a phone | `PreparationConsole`: title, subtitle, then four KPI cards stacked single-column at 390 px (queue, scanned with goal bar, late, gone). Roughly four screens of figures before the first parcel | Blocking |
| P2 | Scanner below the whole list | `ScanStation` is the second grid child; on a phone it renders after every card | Blocking |
| P3 | The hand is lost between screens | `hand` is local state in `PreparationConsole`; `ScanModeClient` (the FAB's destination) has its own empty `hand` and its own search. Take a parcel, tap the FAB, the parcel is gone | Blocking |
| P4 | Batching key hidden in a menu | The nine colours are the natural way to work (one roll in hand, all its parcels, next roll); they are offered as a dropdown pill | Major |
| P5 | Desk affordances on glass | `⌘K` chip in the search field, Escape to go back, hover states, `FilterPill` dismisses on mousedown only | Minor |
| P6 | Wrong palette, no held label | `PrepCard` is built from `--wh-*` desk tokens inside the `--wm-*` paper shell; the "in hand" state on mobile is a border only, the button keeps saying "خذ" | Minor |
| P7 | Keep | The roll strip: 44 px swatch in the exact Darb hex, branch code on a solid white plate, colour name in ink on the card, zone name below. This is the right rule; the redesign extends it to every surface | Keep |

### 1.4 Returns (المرتجعات)

| # | Issue | Evidence | Severity |
|---|---|---|---|
| R1 | Permanent placeholder | Both fetches use a fetcher that throws on non-2xx, and the component reads only `data`, never `error` (`ReturnsConsole.tsx:251-258`). Supabase edge logs show every `get_to_be_returned_orders` and `get_warehouse_returns_stats` call today answered 200 and both RPCs run for the LY market, so the failure is between the route and the browser; the screen has no way to say so. Stock handles `error` and `isLoading` correctly (`WarehouseStockClient.tsx:31,106`); Returns does not. First implementation step: reproduce with the network tab as adel | Blocking |
| R2 | Manager KPIs on a phone | Queue value in money, 28-day return rate with sparkline, depreciated value: nothing the agent decides with | Major |
| R3 | Disabled UI as content | Three ghosted decision cards, a disabled confirm button and a lock hint, all before any scan | Major |
| R4 | Dangling reference | The hint says press «معالجة»; that button exists only on the desk row (`md:block`), never on the phone | Minor |
| R5 | Sync-lag scan gives no rule | Scanning a parcel Darb Sabil has not reported answers "wrong status" with the raw status. The bench rule is "do not receive it"; the screen never says it | Major |
| R6 | Duplicated stepper, two scan inputs | The 1-2-3 stepper is in the card and in the panel; two `ScanField`s are mounted and focused as a set | Minor |
| R7 | Wording | "تالف / مُهلك" is two words for one decision; each decision needs one verb | Minor |

### 1.5 Stock (المخزون)

| # | Issue | Evidence | Severity |
|---|---|---|---|
| S1 | Reserved is fiction | `ENGAGED_STATUSES = confirmed, dispatch_scheduled, uploaded` (`stock/route.ts:58`) includes the 77 orders Darb Sabil fulfils from its own stock and the 407 bench-cleared historical orders. "دميه ملاكمه حجم صغير: 216 on record, 214 reserved, 2 available" describes 214 parcels that will never touch this shelf | Blocking (data) |
| S2 | Two tiles, two questions | "تحت الحد" uses `current_stock <= threshold`; "عجز" uses `free < 0`. Adjacent, same styling, different semantics | Major |
| S3 | KPIs ignore the search | Documented in code (`WarehouseStockClient.tsx:41-46`), invisible on screen | Minor |
| S4 | Seven primary buttons | "جرد" is a solid green primary on every row; counting is a rare act | Minor |
| S5 | Movements lead nowhere | Links to History, a screen the agent's bottom bar cannot return from | Major |
| S6 | Same string seven times | "لم يُجرد" per row; belongs once above the list | Minor |
| S7 | Dead branch | `rows.length === 0` is tested twice, so "no match" is unreachable | Minor |

### 1.6 Settings (الإعدادات)

Shows name, email, role, market and a sign-out button. "Libya" is the raw `markets.name`, untranslated. No scanner preferences (sound or vibration on scan outcomes, camera versus keyboard scanner, default screen). Locale is locked to the market by the middleware, which is fine, but nothing says so. Acceptable as a page, empty as a tool.

### 1.7 Cross-cutting

| # | Issue | Evidence |
|---|---|---|
| X1 | Two design systems in one shell | Home, Settings and `ReturnCard` use the paper palette (`--wm-*`: no icons, hairlines, sans figures). Preparation, Returns chrome and Stock use the desk palette (`--wh-*`: white cards, tinted icon holders, KPI grids). The mobile README's own first rule ("the KPI card has no icon; the tinted holder was the first sign of belonging to the other design") is broken on three of five screens |
| X2 | Arabic typography | The stack is `Inter, Noto Sans Arabic` with Noto loaded at 400/500/600 only, while every title, KPI and section heading asks for 800. In the screenshots the Arabic renders in a high-contrast serif system fallback, not in Noto Sans Arabic at all. Either way the hierarchy the mockups rely on does not exist in Arabic. Cairo (400 to 700) is loaded by the layout and unused by the shell |
| X3 | Decoration | The lattice ground is decoration in a system whose rule is zero decoration; it lowers the contrast of every card edge and every hairline divider |
| X4 | Number theatre | 27 px extrabold zeros are the loudest objects on the screen |
| X5 | Latent defects | `border-wm-line` undefined; goal-setting unwrap differs between Home and Preparation; `avg_cycle_seconds` is label-print based and always 0 in Libya; the FAB's destination redirects a Tunisian agent away silently |
| X6 | Contrast of roll colours | Against white the nine Darb hexes span 1.1:1 (yellow `#f9fc01`) to 12.9:1 (navy `#091d96`); green `#339307` clears AA against neither black nor white. The white-plate rule is the only reason the branch code is readable; it must stay the law |

---

## 2. Improvement suggestions

### 2.1 Information architecture

Bottom bar, four tabs plus the FAB:

| Tab | Route | Content |
|---|---|---|
| المكتب (Bench), Home | `/warehouse` | The queue grouped by roll colour, roll rail with counts, pickup count |
| المرتجعات | `/warehouse/returns` | Scan-first returns |
| المخزون | `/warehouse/stock` | Shelf rows, truthful figures |
| الإعدادات | `/warehouse/settings` | Profile, scanner preferences, "my day", sign out |
| FAB مسح | opens the scan sheet | Context-aware (see 2.2) |

Removed from the agent shell: the KPI wall (stays in the manager console), the Preparation route as a separate page (it is Home), the History page (its content moves into a product's row sheet and a "my log" block in Settings).

### 2.2 The bench loop (workflow)

1. Open the app. Home says in one line how many parcels wait and how old the oldest is, then shows the roll rail: nine swatches, each with the number of parcels waiting for that colour, zeros dimmed.
2. Tap a colour. The list filters to that roll. Pick up that physical roll once.
3. Tap "خذ" on a card. The parcel is in hand; the scan sheet slides up over the list carrying the parcel (customer, city, product × qty) and a full-width band in the roll colour with the branch code on its white plate.
4. Peel, stick, scan with the camera, or type the number on a numeric keypad (digits only, left-to-right field).
5. Binding at Darb Sabil: a visible in-progress state (it can take up to 15 s). Success: the sticker number large, the stock effect ("12 ← 11"), and one button: next parcel of the same roll. Failure: one specific message per cause (Darb Sabil refused, with their wording; already used; gone at the carrier; not a sticker number; stock would go negative but the sticker is bound), with retry or put back.
6. When the rail is all zeros the bench is clear: Home shows "N scanned, waiting for Darb Sabil pickup" and nothing else demands attention.

The FAB is one scanner for the whole shell: with a parcel in hand it binds; with nothing in hand it looks the number up and shows what the system knows (bound today, returned, unknown) with the matching next action. The hand survives navigation.

### 2.3 Visual system

- One palette for all five screens: the paper set (`--wm-*`), hairline cards, no icon holders, no KPI grids, bold sans figures with tabular numerals. The desk console keeps its own.
- Remove the lattice ground. If identity is wanted, keep it on Home only at a quarter of its current contrast; nowhere near cards.
- Arabic type: Cairo 400/600/700 for the shell (already loaded) or add Noto Sans Arabic 700; stop asking for 800. Body 15 px, captions 13 px minimum, numerals tabular. Verify on the actual phone that the web font is the one rendering.
- Colour carries exactly one meaning: a Darb Sabil roll. Semantic states (success, refusal, warning) use icon + text + hairline, never a filled colour that could be confused with a roll. Red roll and red error must not look alike: the roll is a band or swatch; an error is an icon with text.
- Numbers only where a decision follows. Home shows two figures above the fold (waiting, oldest). Everything else is a chip.

### 2.4 Components

| Component | Status | What it does |
|---|---|---|
| RollRail | new | Nine swatches in `DARB_ZONE_ORDER`, count badge each, dim at zero, one tap filters, "all" chip first |
| BenchCard | evolve `PrepCard` | Leading colour bar 8 px on the start edge, swatch + white plate, customer · city · age, product × qty, stock chip, "خذ" 48 px; when held: label "في يدك", card pinned under the sheet |
| ScanSheet | new, replaces the `/warehouse/scan` page on the phone | Bottom sheet: parcel header, roll band, camera viewfinder framed in the roll colour, numeric field, states: idle, binding, bound, refused (Darb), duplicate, gone, not a number, bound-not-committed |
| ResultTile | evolve | Adds "next of the same roll" and "put back" |
| ReturnsHome | evolve `ReturnsConsole` phone branch | Scan field with camera first, two chips (in queue, done today), queue oldest-first, decision sheet after a found scan |
| DecisionSheet | evolve | Parcel summary, three 56 px stacked buttons (إعادة للمخزون / تالف / إعادة الشحن), reason chips for تالف, confirm, result with stock effect |
| StockRow | evolve `StockCard` | Shelf and free, low pill, tap expands: reserved, last count, movements, count action |
| ErrorState | new | Every SWR consumer renders failure + retry; a placeholder never outlives a failed request |

### 2.5 Data flow

- The hand: one store shared by Home and the sheet (URL `?hand=<order id>` or a shell-level context), so the FAB opens the sheet with the same parcel and a reload restores it.
- Roll counts: derive from the `get_to_label_orders` rows already loaded (`zone.colorHex` per row, 200-row page). If a market ever exceeds the page, add `get_roll_counts(p_market_id)` returning colour → count.
- Reserved: keep statuses `confirmed, dispatch_scheduled, uploaded`, exclude `fulfil_from_carrier_warehouse = true` and `bench_cleared_at IS NOT NULL`. Free = on shelf minus that. The manager console consumes the same route, so managers see the same truth.
- Goal: nullable; when unset, nothing about a goal is rendered anywhere; the constant 40 is deleted from both pages.
- Returns: read `error` from SWR; sync-lag copy: "هذا الطرد ما زال «في الطريق» لدى درب السبيل. لا تستلمه قبل أن تُحدَّث حالته عندهم." Strict, per decision.
- Pickup count: `queue.toHandOver` already exists (`get_warehouse_queue_stats.to_hand_over`).
- Scan states already exist in `ScanStation` (`bound`, `refused_here`, `refused_darb`, `bound_not_committed`, `binding`); the sheet reuses them and the `isDarbStickerPayload` guard.
- Stock row detail: `current_stock`, `free`, `engaged`, `last_counted_at`, movements via the existing history route filtered by product.

Defects to fix regardless of the redesign: R1 (Returns silent failure), S1 (reserved), H2 (goal 40), H9 (`border-wm-line`), X2 (Arabic weights).

---

## 3. Prototype outline

### 3.1 Frame and system

390 × 844, RTL, Arabic copy, paper ground `#F4F3ED`, ink `#111311`, secondary ink `#4C524D`, accent `#147A47`, hairline `#BFD6C7`, cards `#FAFAF6` at radius 12, no shadows, no gradients, no lattice. Bottom bar 56 px plus safe area; FAB 52 px pill above it on the end side. Type: Cairo, 15 px body, 17 px card titles, 22 px screen titles, 34 px for the one hero figure. Every target 48 px. Wireframes below are drawn left-to-right for legibility; the prototype mirrors them.

### 3.2 Screen A: Bench (Home)

```
┌─────────────────────────────────────────┐
│ المكتب                        [مُسحت اليوم 0] │  title + chip
│ 2 طرود بانتظار المسح                       │  hero, 34 px, the only big number
│ الأقدم منذ 13 يوماً                          │  15 px secondary
├─────────────────────────────────────────┤
│ الرولات المطلوبة الآن                        │  section label
│ [الكل 2] [■ أحمر 1] [■ أخضر 1] [□ برتقالي 0] →│  RollRail, horizontal, counts
├─────────────────────────────────────────┤
│ ▌■ أحمر · طرابلس وضواحيها          [TR] │  group header: band + name + plate
│ ┌───────────────────────────────────┐   │
│ │▐ محمد علي · طرابلس          13 يوم│   │  leading colour bar 8 px
│ │▐ دمية ملاكمة كبير × 1              │   │
│ │▐ في المخزون 2        [   خذ الطرد   ]│   │  stock chip + 48 px button
│ └───────────────────────────────────┘   │
│ ▌■ أخضر · المنطقة الشرقية           [BN] │
│ ┌───────────────────────────────────┐   │
│ │▐ سعاد المبروك · بنغازي        3 أيام│   │
│ │▐ كتاب الحفظ الميسر × 1             │   │
│ │▐ في المخزون 238      [   خذ الطرد   ]│   │
│ └───────────────────────────────────┘   │
├─────────────────────────────────────────┤
│ جاهزة لاستلام درب السبيل: 3 طرود      ⌄  │  pickup count, expandable list
├─────────────────────────────────────────┤
│                              ( مسح )    │  FAB
│ [الإعدادات] [المخزون] [المرتجعات] [المكتب●] │
└─────────────────────────────────────────┘
```

Empty state (rail all zeros): hero becomes "لا طرود للمسح", one line "درب السبيل يشحن {n} طلباً من مستودعه اليوم" only when that count is non-zero, the pickup line stays.

Held state: the taken card gets the label "في يدك" in place of the button, the sheet opens over it.

### 3.3 Screen B: Scan sheet (parcel in hand)

```
┌─────────────────────────────────────────┐
│ ─── (grab handle)                        │
│ في يدك: محمد علي · طرابلس · دمية × 1     │  parcel header, 15 px
│ ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ │
│ ┃ ■■■■■■■■  الرولة الحمراء       [TR] ┃ │  56 px band in #d80a0a, plate white
│ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ │
│ طرابلس وضواحيها                          │  zone name in ink, under the band
│ ┌───────────────────────────────────┐   │
│ │                                   │   │  camera, 4:3, corners stroked in
│ │        ⌜               ⌝          │   │  the roll colour (plus 2 px white
│ │        امسح رمز الملصق             │   │  inner stroke for yellow and lime)
│ │        ⌞               ⌟          │   │
│ └───────────────────────────────────┘   │
│ أو اكتب رقم الملصق                       │
│ [ 1213123                        ] LTR  │  inputmode numeric, digits only
│ [            ربط الملصق            ]     │  48 px primary
│ إرجاع الطرد إلى القائمة                   │  text button
└─────────────────────────────────────────┘
```

States, each replacing the camera block:

| State | Content |
|---|---|
| binding | Spinner, "جارٍ الربط لدى درب السبيل… قد يستغرق 15 ثانية", button disabled |
| bound | Check, sticker number 28 px, "المخزون 12 ← 11", "التالي من نفس الرولة: سعاد، بنغازي" button, "إغلاق" |
| refused by Darb Sabil | "رفض درب السبيل هذا الملصق" + their message verbatim, "أعد المحاولة" / "إرجاع الطرد" |
| duplicate | "هذا الرقم مربوط بطلب آخر: {ref}" |
| gone at carrier | "غادر هذا الطلب درب السبيل بالفعل، لا يُمسح هنا" |
| not a number | "هذا ليس ملصق درب السبيل، امسح رمز الملصق فقط" |
| bound, not committed | Amber hairline: "الملصق مربوط لدى درب السبيل لكن المخزون لا يكفي ({qty}). أبلغ المدير." |

### 3.4 Screen C: Returns

```
┌─────────────────────────────────────────┐
│ المرتجعات        [في القائمة 3] [اليوم 1] │
│ ┌───────────────────────────────────┐   │
│ │ [📷]  امسح ملصق الطرد العائد        │   │  field + camera, first object
│ └───────────────────────────────────┘   │
│ بانتظار الوصول · الأقدم أولاً              │
│ ┌ 7700888 · سعاد المبروك · بنغازي  4 أيام┐│
│ │ كتاب الحفظ الميسر × 1                  ││
│ └────────────────────────────────────────┘│
│ ┌ 000000990103 · … ┐                      │
│ (error) تعذّر تحميل القائمة  [إعادة المحاولة]│  never a permanent placeholder
└─────────────────────────────────────────┘
```

After a found scan, the decision sheet: parcel summary, three stacked 56 px buttons (إعادة إلى المخزون · تالف · إعادة الشحن للزبون), reason chips and note when تالف, confirm, result with the stock effect ("+1 ← 239"). Sync-lag scan: a sheet with the current status in words and the strict rule: "لا تستلم هذا الطرد قبل أن يُحدَّث لدى درب السبيل". Unknown number: "غير موجود في النظام".

### 3.5 Screen D: Stock

Search on top, two chips (تحت الحد N, عجز N) that follow the search, then rows: product name, "على الرف 924", "متاح 848" secondary, low pill when applicable. Tap expands the row: reserved (truthful), last count, movements (inline list of the last five), and a secondary "جرد" button. One line above the list: "لم يُجرد أي منتج بعد" when nothing was ever counted.

### 3.6 Screen E: Settings

Profile card; role and market translated ("ليبيا"); a "يومي" block (scanned today, last scan time, returns handled); scanner preferences (sound, vibration, camera or keyboard scanner, open on Bench); sign out. A line noting the language follows the market.

### 3.7 Roll colour indication rules

| Rule | Detail |
|---|---|
| Exact hex | Bands and swatches use Darb's published hex unmodified; no tint, no opacity, no gradient. The agent matches the screen against a physical roll |
| Name never on colour | The colour name and zone name are ink on the card; the band carries only the branch code on a solid white plate (16.97:1 on every colour) |
| Two channels | Colour + name + code on every surface; colour is never the only channel |
| Faint colours | Yellow `#f9fc01` and lime `#8fff00` get a 1 px `#111311` outline on swatches and a white inner stroke on the viewfinder frame |
| Order | Rail and groups follow `DARB_ZONE_ORDER` (Tripoli outward, then clockwise) |
| Unknown zone | Dashed grey swatch, "المنطقة غير معروفة، تأكّد من الوجهة"; scanning stays allowed, as today |
| Sticky colour | Group headers repeat the band so the colour stays visible while scrolling |
| Semantic colours | Success, warning, refusal never use a filled colour; icon + text + hairline only |

Nine rolls, as the agent reads them: أحمر (طرابلس وضواحيها), برتقالي (غرب طرابلس), أصفر (شرق طرابلس), بني (جنوب طرابلس), أزرق داكن (الجبل الغربي), أرجواني (المنطقة الوسطى), أخضر (المنطقة الشرقية), سماوي (المنطقة الجنوبية), أخضر فاتح (الجنوب الشرقي).

---

## 4. Clarifying questions (remaining, none blocks the prototype)

1. Before the sticker exists, what identifies the physical box? A packing slip with the customer name, the product only, or nothing? The card must show the same identifier the box carries.
2. Should the low-stock pill on the bench follow on-shelf stock (manager rule today) or free stock after commitments?
3. Is History needed by the agent at all, or is "movements inside the product row" enough?
4. Sound or vibration on scan outcomes on the phone: wanted?
5. Which hand holds the phone? It decides the FAB side (mirrored to the left today in Arabic).
6. Should the count of orders Darb Sabil ships from its own warehouse appear on the Bench at all, or only in the manager console?
7. Once the 407 bench-cleared orders stop reserving stock, should they also stop counting as "late" anywhere in the manager console?

---

## 5. Deliverables of this phase and verification

Deliverables (no product code):

1. `plans/warehouse-agent-ux-critique.md`: this document, durable copy.
2. `prototypes/warehouse-agent-v2.html`: a click-through prototype at 390 px, RTL, Arabic, the nine real hexes from `src/lib/carriers/darb-zones.ts`, screens A to E, the scan sheet with all eight states reachable, the returns decision sheet and the sync-lag message, the stock row expansion. Plain HTML and CSS with a few lines of script for navigation; no framework. Published as an artifact so it can be opened on the phone.
3. A short README note in `docs/design/entrepot/mobile/README.md` pointing to the prototype is deferred to the implementation phase (docs are code here).

Verification:

- Open the artifact on a phone at 100 %: the hero, the rail and the first card fit above the fold at 390 × 844.
- Walk the loop: tap a colour, take a parcel, open the sheet, trigger each of the eight states, "next of the same roll" lands on the next card of that colour.
- Check the nine bands and plates side by side in bright light; the code on the plate stays readable on yellow and lime.
- RTL check: bars on the start edge, numbers in LTR fields, chips in reading order.
- Returns: found, sync-lag, unknown, list-failed states all reachable.
- Copy read by an Arabic reader (adel), one screen at a time.

Implementation phase (separate approval, TDD): R1 and S1 first (truth before beauty), then tabs and Bench home, the shared hand and scan sheet, returns scan-first, stock rows, palette and type unification, settings.
