# Design System — Ordra « Aurore »

> Since 2026-10-04 Ordra has one house language, « Aurore »: a soft pastel aurora behind
> everything, frosted-glass cards that float on it, heavy confident numbers, and **colour
> that always means one thing**. The dark sidebar and the brand green stay exactly as they
> were. Every screen under `src/` follows this document.
>
> **Reference implementation:** Salle de contrôle (`/team`, `src/components/team/room/`,
> the `.r6` block in `src/app/globals.css`), built line for line from
> `prototypes/team-v6.html`, which the owner approved after picking « Aurore » from a
> four-look board (Performance v3). The prototypes are not committed (real agent names,
> public repo); the live `/team` page is the tracked reference.
>
> **Superseded.** Until 2026-10-04 this file opened: *"Shopify admin-inspired operational
> dashboard. Dark sidebar, light content, white cards. Maximum contrast, zero decoration"*,
> with "no gradient", "no shadow at rest" and "colour only on status" as its three rules.
> The owner rejected that look for every surface he reviewed after it ("no colourful, no
> modern visuals, no elegant components" — Performance v1, 2026-10-04; the grey
> Transporteurs v1 the day before) and chose Aurore. What the old rules *protected* —
> contrast, colour that carries meaning, one chrome green, RTL — is kept below; what they
> *forbade* — gradients, resting shadows, colour beyond status — is now the language.
>
> **Status (2026-10-04): the doctrine is adopted; the code is not migrated yet.** Only `/team`
> (and the agent colours) are built in Aurore. The `--au-*` tokens, the `.au-*` classes and the
> repointed Tailwind values below are the **target spec** — they do not exist in
> `globals.css` / `tailwind.config.ts` until the migration is approved and done. §10 lists what
> the code still says. New screens are designed and prototyped in Aurore now; existing screens
> move only when the owner says so.

> **« Aurore calme » (2026-10-05) — the current register.** The owner found the first Aurore
> pages "very heavy on visuals, lots of colours, not easy to read". Same ground, same type,
> same vocabularies — but **quieter marks**: the validated calm outcome palette (§2.4), cards
> near-opaque with a hairline, one weight lighter (700 not 800), no medal
> gradients, no entrance motion, and **every figure written once, count first, its share
> small**. The waffle is retired; the page overview chart is **one bar per outcome on one
> scale** (`OutcomeRows`, §4.7) and entity cards keep a **thin ring** with the count in its
> centre — both chosen by the owner from `prototypes/performance-calm-board-v1.html`. Live on
> Salle de contrôle, Performance › Équipe, Performance › Commandes. Where a rule below says
> otherwise, this note wins.
>
> **Second pass, same evening — "the card feel on the rest".** Quiet outcome marks do not
> mean quiet identity: entity cards carry her hue with presence (§4.2), and the rest of the
> page follows — **the page's answer in bold deep green `#2C7F57`** (the delivered part of
> the headline sentence; on Commandes also the money delivered; on Salle de contrôle the done
> count in deep teal `#1E7F77`); outcome bars with a soft sheen of their hue and the share as
> a tinted pill; every avatar as on the cards (gradient, white ring, glow); the selected table
> row tinted with a 3px edge in her hue; « À regarder » cards wear their tone as a top
> accent; on Débit × taux the goal quadrant is washed green and the losing one faint rose;
> section cards get a white top highlight. Figures that answer are 800, the rest 700.

---

## 1. Principles

Ten rules. When two collide, the earlier one wins.

1. **One question per page, answered by a number.** A page opens on the number it exists
   for — on analytics pages as a one-line sentence that carries the counts (« Sur 1 441
   commandes attribuées, 275 ont été livrées. », 24 / 700). **Counts first, the share small
   after it; never « /100 » or « sur 100 »** (owner, 2026-10-05). Under a big number: a
   status of 2–4 words with a coloured dot or tag. Each figure is written once.
2. **Colour always means exactly one thing.** There are four vocabularies and they never
   borrow from one another (§2.4): **chrome** (brand green — where you are, what you press),
   **status / outcome** (what an order is or became), **identity** (who — an agent, a role,
   a carrier account), **severity** (good / warn / bad). Colour is never decoration and never
   the only signal: the word or the figure is always written beside it.
3. **Colourful, not loud.** Colour lives on **small, thin marks** — 10px bars, 9px rings,
   8px dots, avatars — in the calm validated steps (§2.4), never in big blocks (a waffle of
   100 saturated squares, a 15px ring, a dark heat tile). Surfaces stay white; no identity
   halos. Text stays near-black and never wears a data colour. A full hue behind white text
   is reserved for one thing per area (the primary button, an avatar).
4. **The ground is light and alive; the sidebar is the only dark surface.** Content sits on
   the aurora (§2.1). Cards float on it as frosted glass. Nothing in the content area is dark
   except the tooltip.
5. **One entity, one card.** Overview (3–6 numbers) → one card per entity (agent, carrier,
   product) → click for the drawer → a separate table for comparison. Never mix entities in
   one chart.
6. **Every chart answers a named question** and draws only that: **one bar per outcome**
   for "what did they become / what is today made of", a thin ring for "how far is she", a
   pill bar for "where did they go" in a row, a soft heat tile for "which is weak". Every
   mark has a tooltip with its exact figure. Hovering a row highlights it and dims the rest.
   The waffle is retired (2026-10-05): it made you count squares to read a number already
   printed beside it.
7. **Hierarchy by weight and size, never by greying below AA.** Text clears 4.5:1 on white
   (the quiet grey `#8A94A6` is for icons, axes and disabled only — §2.3).
8. **Calm motion.** No entrance choreography on analytics pages (no rising cards, popping
   squares, sweeping rings) — figures are simply there. Hover changes a border or a wash,
   never lifts. Drawers and menus still slide; the live dot still pulses. Nothing else loops.
9. **Two densities, one language** (§1.1). Showcase pages (monitoring, analytics) use the
   full scale; workbench pages (orders, the agent queue, the warehouse bench) keep the same
   ground, glass, type, radii and colours at working density.
10. **Everything mirrors.** Logical properties only; Arabic is a first-class reading (§5.6).

### 1.1 Showcase and workbench

| | Showcase | Workbench |
|---|---|---|
| Pages | Accueil, Salle de contrôle, Performance, Transporteurs, finances, Produits, Accès, Journaux, investor portal | Commandes, Archivées, the agent queue, Suivi livraison, Entrepôt bench / scan / returns, settings forms |
| H1 | 32 / 800 | 24 / 800 |
| Hero figure | 34–46 / 800 | 22–28 / 800 |
| Body | 14 / 500 | 13–14 / 500 |
| Entrance motion | rise / pop / sweep / grow | none on rows (a 1 000-row list must not dance); drawers and menus still slide |
| Glass | every card | the page's containers — **never per row**: rows inside a glass card are plain, separated by `--au-line` hairlines (`backdrop-filter` on hundreds of rows kills scrolling) |
| Hover | lift −2/−4 px + deeper shadow | row wash `rgba(255,255,255,.55)`, no lift |

The phone warehouse shell (§4.20) is a workbench used in sunlight: it keeps an **opaque**
ground and bars — glass over a moving list blurs the labels.

---

## 2. Tokens

**Target.** The house tokens will be `--au-*` in a `:root` block « Aurore » of
`src/app/globals.css`, aliased in `tailwind.config.ts` as an `au` colour family. The migration
plan is to **repoint the older semantic Tailwind tokens** (`surface-*`, `ink-*`, `line-*`,
`rounded-card`, `shadow-*`) to these values, so every screen built on them moves with one
change. Until then the values that exist are listed in §10; on `/team` the same values live
under `.r6` with the prototype's names (`--ink`, `--card`, `--card-sh`…).

### 2.1 Ground

| Token | Value | Role |
|---|---|---|
| `--au-ground` | `#F6F7FB` | The page colour under the aurora; also the solid fallback (phone bars, print) |
| `.au-ground` | 5 radial gradients over `--au-ground`, `background-attachment: fixed` | The content area of every shell |

The aurora: indigo `#D3DBFF` top-start, pink `#FAD3EC` top-end, mint `#C6F2DA` bottom-end,
amber `#FFE6B3` bottom-start, lavender `#EDE7FF` centre, each fading to transparent at
~72 %. It is painted **once**, by the shell (`DashboardChrome`, the warehouse desk, the
investor layout) — a page never paints its own opaque background over it.

> **Superseded.** `--bg-page` `#F6F6F7` flat grey, and the scoped warm grounds
> `--oms-bg` `#FAFAF8` / `--agent-bg` `#FAFAF9`. In the migration those tokens resolve to
> `--au-ground` (so sticky bars that paint them stay opaque and match), and page roots stop
> painting `min-h-screen bg-…` over the shell's aurora (~23 roots today, §10).

### 2.2 Surfaces — glass

| Token | Value | Role |
|---|---|---|
| `--au-card` | `rgba(255,255,255,.62)` | Top-level card fill |
| `--au-card-edge` | `rgba(255,255,255,.9)` | Its 1px border — a highlight, not an outline |
| `--au-glass-in` | `rgba(255,255,255,.66)` | Inner surfaces: tiles, drawer sections, mini-stats |
| `--au-glass-in-edge` | `rgba(255,255,255,.95)` | Their border |
| `--au-solid` | `#FFFFFF` | Inputs, dropdown panels, table rows that must not show through |
| `--au-blur` | `blur(20px) saturate(170%)` | `backdrop-filter` of a card; drawers use 24px |
| `--au-scrim` | `rgba(15,23,40,.22)` + `blur(3px)` | Behind drawers; modals `.32` + `blur(4px)` |

Planned utilities (component layer of `globals.css`): `.au-card` (fill + edge + blur +
resting shadow + 24px radius), `.au-glass` (inner, 16px), `.au-float` (drawers/popovers). On
`/team` today: `.r6-card`, `.r6-tile`, `.r6-sec`, `.r6-drawer`.

### 2.3 Ink — near-black, one ramp

| Token | Hex | On white | Role |
|---|---|---|---|
| `--au-ink-1` | `#0F1728` | 17.9:1 | Headings, figures, body |
| `--au-ink-2` | `#475467` | 7.7:1 | Labels, secondary text, legend |
| `--au-ink-3` | `#667085` | 5.0:1 | Meta, captions, eyebrows, column heads |
| `--au-ink-quiet` | `#8A94A6` | 3.1:1 | **Not text.** Icons, axis ticks, placeholder, disabled |
| `--au-ink-4` | `#C9CED7` | 1.6:1 | Zero values ("0" drawn faint), empty-state dashes |
| `--au-line` | `rgba(15,23,40,.07)` | — | Hairlines between rows, inside cards |
| `--au-track` | `rgba(15,23,40,.06)` | — | Empty ring / bar track |

> **Deviation from the reference, deliberate.** `prototypes/team-v6.html` sets meta text in
> `#8A94A6`, which is 3.1:1 on white and ~2.7:1 on the aurora — below AA for 12px type.
> The house ramp uses `#667085` (same grey family, 5.0:1). `/team` keeps the prototype
> value inside `.r6` until the owner re-approves it.

Tailwind: `ink-primary` → `#0F1728`, `ink-secondary` → `#475467`, `ink-muted` → `#667085`.

### 2.4 The four colour vocabularies

**Chrome — brand green (unchanged).**

| Token | Hex | Role |
|---|---|---|
| `--brand` | `#15803D` | Primary button, active nav pill, active segment badge, focus ring, selected row bar. 5.0:1 white-on-fill |
| `--brand-hover` | `#12692F` | Hover; text on `--brand-bg` (6.1:1) |
| `--brand-bg` / `--brand-tint` | `#E9F6EE` / `#F1FAF4` | Selected fill / hover wash |
| `--brand-on-dark` | `#10B981` | **Dark sidebar only** — 2.5:1 on white |

**Severity — good / warn / bad / live** (trend pills, tags, alert surfaces):

| Token | Ink | Tint | Dot / fill |
|---|---|---|---|
| good | `--au-good` `#067647` | `--au-good-bg` `#DCFAE6` | `--au-live` `#12B76A` |
| warn | `--au-warn` `#B54708` | `--au-warn-bg` `#FFF4E0` | `--au-warn-dot` `#F79009` |
| bad | `--au-bad` `#C01048` | `--au-bad-bg` `#FFE4E8` | `#E8385A` |
| flat | `--au-ink-2` | `rgba(15,23,40,.05)` | — |

All ink/tint pairs ≥ 4.98:1.

**Status / outcome.** Order status pills keep their map (`lib/orders/status-presentation`,
§4.17 F-bis, contrast-tested). Outcome hues for charts are fixed and never borrowed:

**Calm steps (2026-10-05), validated with the dataviz `validate_palette.js`** — adjacent
order delivered · returned · rejected · never real passes every gate (CVD ΔE 8.2, normal-vision
ΔE 17.0). Fills sit below 3:1 on white, so every row writes its figure beside the mark.

| Outcome | Fill | Note |
|---|---|---|
| delivered | `#4DAE7E` | |
| en route | `#6FC29A` | the delivered hue one step lighter (ordinal ramp, light end 2.07:1) |
| returned | `#E9A23B` | |
| rejected | `#E46A7B` | |
| never real (jamais réelle) | `#9D8FEF` | |
| in progress (en cours) / pending | `#B4BDCC` / `#D0D5DD` | neutral greys |
| to call | `#E4E7EC` | |
| uploaded (Salle de contrôle) | `#2FA39B` | |
| overdue | hatch `#F6C7CF` / `#DE5A72` | hatching, not another hue; its row's count is red |
| not yet uploaded | `#E4E7EC` | |

> **Rejected, and why.** The pastels shipped on Accueil the same day (`#5CB88A #F2B661
> #EC8E98 #ABA0F2`) FAIL the validator: returned and rejected sit at ΔE 13.8 (< 15 — hard to
> tell apart even with full colour vision) and the amber is out of the lightness band. Accueil
> should move to the steps above. The saturated Aurore steps (`#079455 #F79009 #E8385A
> #7A5AF8`, `#0E9384`, `#38C0AE`) are superseded.

Fills only: an outcome hue never carries text; its number is written in `--au-ink-1` beside it.

**Identity — who.** Each person or account has a hue used *everywhere* that person appears
(avatar, card halo, selected ring, her bars). Agents: six ramps `--agent-<key>-{0,1,2,5,7,9}`
(wash · soft · line · identity · deep · ink), keyed by `users.color`, handed to an element as
`--a0…--a9` by `lib/team/agent-color.ts`. Roles: §4.23. Carrier accounts:
`carriers.accent_color` (§4.18). An identity hue never marks a status, and a status hue
never marks a person.

| Key | `-5` identity |
|---|---|
| indigo | `#444CE7` |
| pink | `#DD2590` |
| cyan | `#088AB2` |
| gold | `#CA8504` |
| lime | `#4CA30D` |
| orange | `#E04F16` |

New palettes are validated with the dataviz skill's `validate_palette.js` before they ship
(lightness band, chroma floor, CVD ΔE between neighbours).

### 2.5 Elevation — soft, blue-tinted, resting

| Token | Value | Use |
|---|---|---|
| `shadow-card` / `--au-sh` | `0 10px 36px rgba(42,52,110,.07)` | **Every card at rest** |
| `shadow-card-hover` / `--au-sh-hover` | `0 20px 52px rgba(42,52,110,.14)` | Clickable card on hover (with lift) |
| `shadow-hover-row` | `0 4px 14px rgba(42,52,110,.10)` | Buttons, segments, rows on hover |
| `shadow-panel` | `0 30px 80px rgba(42,52,110,.24)` | Drawers |
| `shadow-floating` | `0 20px 52px rgba(42,52,110,.18)` | Popovers, menus, bulk bars, modals |
| glow | `0 8px 22px color-mix(in srgb, var(--a5) 42%, transparent)` | Under an identity avatar / an alert icon holder, in its own hue |

Shadows are tinted indigo (`42,52,110`), never black: on a pastel ground a black shadow reads
as dirt.

> **Superseded.** "Resting cards remain flat", and the grey `rgba(16,24,40,…)` scale.

### 2.6 Focus ring

```css
:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; border-radius: 8px; }
```

`--focus-ring` = `--brand`: 5.0:1 on white, 4.7:1 on the aurora, 3.8:1 on the sidebar. The
offset lands the ring on the ground, so it stays visible against a green button.

---

## 3. Typography

**Faces:** Plus Jakarta Sans (`--font-sans`, 400–800) and IBM Plex Sans Arabic
(`--font-sans-arabic`, 400–700), loaded with `next/font/google` in
`src/app/[locale]/layout.tsx`. An Arabic page puts Plex Arabic first (`:root[dir="rtl"]`), so
figures read in the face around them; Plex Arabic stops at 700, so `800` renders as 700 in RTL.
Cairo stays where `.agent-theme` names it.

**Root font is 14px.** Tailwind rem utilities render at 0.875× — write sizes in px
(`text-[13px] h-[32px] rounded-[10px]`) when matching a prototype.

| Role | Size / weight / tracking | Colour | Notes |
|---|---|---|---|
| Breadcrumb | 12.5 / 600 | ink-3 | `Équipe / Salle de contrôle`, separator in ink-4 |
| H1 page title | 32 / 800 / −0.03em, lh 1.1 | ink-1 | workbench 24 |
| H2 section | 22 / 800 / −0.025em | ink-1 | sits on the ground, above its cards |
| Card title | 17–19 / 800 / −0.015em | ink-1 | |
| Eyebrow | 10.5 / 800 / +0.1em, UPPERCASE | ink-3 | section labels, column heads (+0.08em); RTL drops caps and tracking |
| Hero figure | 34–46 / 800 / −0.045em, lh 1 | ink-1 | the page's one number; ring centre 46 |
| Tile figure | 26–34 / 800 / −0.04em | ink-1 | unit beside it 15 / 700 ink-3 (`/ 6`, `/100`) |
| Row figure | 15 / 800 | ink-1 | sub-figure 11.5 / 600 ink-3 under it |
| Body | 14 / 500 | ink-1 | |
| Label | 12.5–13 / 700 | ink-2 | tile labels, buttons |
| Meta | 12–13 / 500 | ink-3 | |
| Chip / tag | 11.5–12.5 / 700–800 | per vocabulary | pills |

- `tabular-nums` on every number. Zero is drawn faint (`ink-4`, 600) so the eye skips it.
- Arabic percent is written `56%` with **no space** — with a space Chrome flips the sign
  even inside `<bdi dir="ltr">`.
- All strings through `next-intl`; no hardcoded text.

---

## 4. Components

Primitives live in `src/components/ui/`. Sizes below are px.

### 4.1 Page header

Crumb → H1 → a sub line (market · date, then chips) on the start side; controls (day
stepper, glass buttons) on the end side, bottom-aligned. A **live chip** (`●` pulsing
`--au-live` + « En direct · 14:32 ») says the page is current; a past day gets a plain chip.

### 4.2 Cards

- **Card** (`.au-card`, `Card`): `--au-card` fill, `--au-card-edge` border, 24px radius,
  `shadow-card`, `--au-blur`. Padding 20–30px.
- **Inner surface** (`.au-glass`): tiles, drawer sections, mini-stat cells — `--au-glass-in`,
  16px radius (14 / 11 for smaller cells), no shadow.
- **Calm card (2026-10-05)** — analytics pages: fill `rgba(255,255,255,.86)`, 1px
  `rgba(16,24,40,.06)` hairline, 20px radius, shadow `0 1px 2px rgba(16,24,40,.04), 0 8px 24px
  rgba(42,52,110,.05)`, blur 16px. Inner tiles become **figures separated by hairlines**, not
  boxes inside boxes.
- **Entity card** (an agent, a carrier) — **her colour has presence** (owner, 2026-10-05,
  after the first calm pass made the cards too plain): a 3px gradient accent along the top
  (`--a5` → 25 %), a wash fading down the card (`--a5` 9 % → white at 150px), a 240px halo at
  24 % behind the top-start corner, border `--a5` 20 %, a shadow tinted in her hue; avatar 40px
  `linear-gradient(140deg,--a5,--a7)` with a 3px white ring and glow; her name and the ring's
  count in `--a9`; rank chip and ring track tinted in her hue. Outcome colours inside stay fixed.
  The whole card is the button (`role="button"`, `tabIndex=0`, Enter/Space). Hover lifts −2px
  with a deeper tinted shadow; selected = 1px `--a5` ring. (`.tpf .ag`, `.r6-ag`.)
- **Alert / problem line**: on calm pages a problem is **one line** — red icon + red count +
  its detail in meta — not a tinted box with a filled icon holder. The healthy line is the
  same with a green check. (`.r6-unc`, the « Non appelées > 2 h » row.)
- **Empty state**: a 1.5px dashed `--au-ink-4` box, 18px radius, ink-3 centred text that says
  what is empty and why ("Aucune commande ce jour-là").

### 4.3 Buttons

| Variant | Look |
|---|---|
| primary | `--brand` fill, white, 10px radius, 700; hover `--brand-hover` |
| secondary | `rgba(255,255,255,.85)` + `1px rgba(15,23,40,.08)`, ink-1, 10px radius, 700; hover white + `shadow-hover-row` |
| glass (toolbar) | 40px tall, 13px radius, `rgba(255,255,255,.6)` + glass edge + blur, ink-2 700; hover white, ink-1 |
| ghost | transparent, ink-2; hover `rgba(255,255,255,.7)` |
| destructive | `--au-bad` fill, white |
| icon | square (34–36px), 12px radius, glass |

Sizes: `sm` 30–32px / 12.5–13px, `md` 40px / 14px. Disabled: opacity .45, no shadow.
A WhatsApp / call action is an icon button whose hover turns the icon WhatsApp green.

### 4.4 Chips, tags, trend pills

All pills (`9999px`). **Chip** 26px, `rgba(255,255,255,.7)` + glass edge, 12.5 / 700.
**Warn tag** 22px, `--au-warn-bg` / `--au-warn`, 11.5 / 700. **Trend pill** 22px, arrow
icon + delta, good / bad / flat tints, tooltip "30 jours avant : 19". **Rank**: a 26px
neutral circle (`rgba(16,24,40,.05)`, ink-2, 700) for every place — the gold / silver / bronze
medal gradients are retired (2026-10-05).

### 4.5 Status badges

Unchanged in substance — hue + icon + weight, one map (§4.17 F-bis), contrast-tested. In
Aurore they are pills with a 1px edge in their own hue; the rejected badge is red with its
group's icon (CLAUDE.md, rejection reasons).

### 4.6 Avatars

Circle, initial in white 800, fill `linear-gradient(140deg, var(--a5), var(--a7))`, glow in
its hue. Sizes 24 (stacks, overlap −6px with a 2px white ring) · 28 (chips) · 36 (rows) ·
44 (cards) · 48 (drawer head). A **presence dot** sits bottom-end: 13px, 2.5px white ring;
live = `--au-live` with a pulsing halo, idle / late = `--au-warn-dot`, off = ink-4. A total
row uses `Σ` on a slate gradient.

### 4.7 Data marks

- **Outcome rows** (`src/components/shared/charts/OutcomeRows.tsx`, 2026-10-05) — THE overview
  chart. A labelled `<ul>`, one row per outcome in reading order (delivered first, pending
  last): dot + label + one-line hint · a 10px pill bar on a `--au-track` track whose length is
  the row's **share of the total** (every bar on the same scale, so the longest bar is the
  biggest leak) · the count (17 / 700) · its share (13 / 600 ink-3, optional) · the page's
  trend pill. Rows with an action are buttons (open the orders). A zero count is drawn
  `#D0D5DD`; an alert row writes its count and hint red. Hovering a row dims the others to .4.
  Owner's pick over a single stacked bar (2026-10-05).
- **Waffle** — **retired** 2026-10-05 on every page (counting squares to read a printed number;
  100 saturated squares were the loudest thing on screen; at 1 441 orders a square was 14).
- **Ring** — segmented donut, **9px stroke**, 2.5px gaps, track `--au-track`, the **count** in
  its centre (32–34 / 700) with « livrées · 45 % » / « faites » under it in 12 / 600. No sweep.
  Used on entity cards only (owner's pick, 2026-10-05).
- **Pill bar** — a flex row of rounded segments with 2px gaps, 12px tall (7–8px inside a
  drawer), `min-width: 3px`, width proportional to the row's volume; a caption line under it
  writes each figure. Grows in from the start edge.
- **Column bars** — 74 % width, max 20px, `6px 6px 2px 2px` radius, vertical gradient of the
  hue; a marker dot under a day for an event (a payout).
- **Timeline lane** — planned shift as a dashed pill in the identity hue at 6 %, worked
  segments as solid identity pills with glow, breaks dotted, idle dashed amber with a label,
  the "now" line in ink-1 with a dot, future hatched faint.
- **Heat tiles** — a soft ramp of the delivered hue (`#F1F9F4 → #2C7F57`, white text from
  `#4DAE7E`), 38px tall; the weak gap is a quiet `#FEF3F2`/`#B42318` tag, not a filled red badge.
- **Tooltip** on every mark: `#101828`, white 12.5 / 600, 10px radius, max 320px, follows the
  pointer, never the only place a figure lives.
- Legend swatches: 11px, 4px radius.

### 4.7b Filter bar (2026-10-05 — reference: Performance › Commandes, `FilterBar.tsx`)

The owner found the old bar "not easy to use at all" (a dead « Tous les produits » pill beside
a « Choisir » button per filter, an « A » tag with no B, a four-way « Non / … » switch for
comparing). The house pattern for analytics filters is now:

- **One button per filter that SAYS its value** — icon · label (ink-3) · value (700) · chevron,
  40px, 12px radius, white with a hairline. Set = tinted (`--accent` 7 %, border 32 %) and an
  inline × (`aria-label` « Retirer ce filtre : … ») instead of the chevron. Open = accent ring.
  Its accessible name is « Label · valeur ».
- **Comparing is a menu, not a mode switch**: « Comparer » opens three choices, each with a
  one-line hint; choosing opens B's picker at once.
- **« A contre B » gets its own line, only while comparing**: A's tag + summary + order count,
  « CONTRE », B's tag + B's own filter button + count (+ the "too small" warning), « Arrêter ».
  A/B tags never appear outside that line.
- « Tout effacer » sits at the row's end, quiet, only when something is set.
- **Responsive**: desktop one wrapping row; ≤ 760px a 2-column grid, labels hidden (the icon
  says it), the A/B line stacked, every picker and menu a bottom sheet (fixed, 72vh, safe-area
  padding — and the bar drops its `backdrop-filter`, which would otherwise trap fixed
  children); ≤ 480px one filter per row so no value is truncated.

### 4.8 Tables

A table is a card (`.au-card`, overflow hidden) with a title row (17 / 800 + legend at the
end). Head: eyebrow style, `--au-line` above and below, `9px 10px` cells. Rows: `13px 10px`
cells, `--au-line` between, hover `rgba(255,255,255,.55)`, the selected row a start-edge wash
in its identity hue (`linear-gradient(90deg, a5 12 %, transparent 60 %)`). A total row (Σ)
sits first on `rgba(255,255,255,.35)`. Numbers right-aligned (`text-end`), figure 15 / 800
over its percentage 11.5 / 600. A footer line in meta explains the window. Rows that do not
qualify are dimmed to .55, not hidden.

### 4.9 Drawers

Floating, not docked: `top/bottom/inset-inline-end: 12px`, 26px radius, width 580 (detail) /
440 (tools), fill `rgba(250,251,255,.84)`, white edge, `shadow-panel`, `blur(24px)`, a 620px
halo of the entity's hue behind the head. Slides in 320ms `cubic-bezier(.2,.8,.2,1)`.
Head: avatar 48 + name 19 / 800 + status line, actions at the end, a 36px glass close button
that takes focus on open. Body: sections as `.au-glass` (16px radius, `15px 16px`), 12px apart,
each led by an eyebrow label with a 13px icon and, at the end, its window in meta. The page
stays visible behind the blurred scrim and the selected entity's card stays lit.
`role="dialog"`, `aria-modal`, Escape closes the topmost surface (capture phase).

### 4.10 Section label + icon

Inside a drawer or a card, a section is named by an **eyebrow** (10.5 / 800, uppercase,
+0.1em, ink-3) led by a 13px lucide icon, with its window or count in meta at the end
(« 7 jours », « 12 commandes »). Identity of a *kind of content* comes from the label and
icon, never from tinting the section — every section is the same `.au-glass`. Tints are
spent on meaning (a problem surface, an identity halo), not on telling sections apart.

### 4.11 Tabs and segmented controls

- **Segmented control** (the default for switching a view or a period): track
  `rgba(255,255,255,.55)` + glass edge, 12px radius, 3px padding; segments 30px, 9px radius,
  12.5 / 700 ink-2; active = white fill, ink-1, `shadow-hover-row`. `role="tablist"` /
  `aria-selected`.
- **Underline tabs** (one level of navigation inside a panel): 13px, active 700 ink-1 with a
  2px `--brand` underline, `--au-line` baseline.
- **Nested navigation** (the agent queue's bucket → sub-filter → attempt): `SegmentedTabs`,
  bordered segments with the brand count badge (§4.18).

### 4.12 Skeletons

The shape of the page, never a spinner or "loading…": `--au-track` blocks with the real
radii (24 card, 16 tile, 99 pill), `animate-pulse`, `aria-hidden`, the group in
`role="status"`. One skeleton per page, shaped like that page (`PageSkeleton`).

### 4.13 Inputs, modals, toasts, popovers

- **Inputs**: 36–40px, white (`--au-solid`), `1px rgba(15,23,40,.12)`, 10–11px radius,
  14px / 600. Labels above in 12.5 / 700 ink-2. Error: border `--au-bad`, message under it.
  Toggle-day buttons 38×32, active = ink-1 fill, white text.
- **Modal**: scrim `.32` + blur 4, panel 440px, 22px radius, `rgba(255,255,255,.92)` + blur
  20, `shadow-floating`; header 16 / 800 with a meta sub; actions end-aligned.
- **Toast**: `#101828`, white 13 / 600, 12px radius, bottom-centre, a 4px start strip in its
  severity hue.
- **Popover / menu**: white at 96 %, white edge, 14px radius, `shadow-floating`, blur 20.
- Tool drawers (alerts, settings) are §4.9 drawers at 440px.

### 4.14 Bell + count badge (dark surface)

Unchanged: 28–30px outlined button on the sidebar, count badge `--critical` with a 2px
sidebar-coloured ring, caps at 99+.

---

## 5. Layout

### 5.1 Shell

```
┌────────────┬──────────────────────────────────────────────┐
│ Sidebar    │  .au-ground — the aurora, painted once        │
│ #0E1013    │   ┌ page: max-width 1200, centred ─────────┐  │
│ 240 / 64   │   │ header (crumb · H1 · sub · controls)    │  │
│ rail       │   │ ↓ 26px                                  │  │
│            │   │ overview card (viz + tiles)             │  │
│            │   │ section: H2 + legend → entity cards     │  │
│            │   │ section: H2 → table card                │  │
│            │   └─────────────────────────────────────────┘  │
└────────────┴──────────────────────────────────────────────┘
```

- Content padding `30px 40px 80px` desktop, `16px 14px 40px` phone; page `max-width: 1200px`
  (workbench lists may run full width); sections 26px apart; a section's H2 sits 16px above
  its cards.
- Entity cards: a grid of up to 4 equal columns (`repeat(n, minmax(0,1fr))`), 18px gap.
- Overview card: `grid-template-columns: auto minmax(0,1fr)`, 40px gap, `26px 30px` padding —
  the visual on the start side, the tiles (3 columns, 12px gap) on the end side; one column
  under 1180px.
- Manager / admin pages have no global topbar: bell, user and market live in the sidebar
  (`docs/sidebar.md`, `prototypes/sidebar-v2.html`). The agent shell keeps its topbar and
  bottom tabs.

### 5.2 Sidebar

Unchanged and still the only dark surface: `#0E1013`, 240px or a 64px rail, active item a
filled `--brand` pill, one count chip style, drawn SVG flags. Spec in `docs/sidebar.md`.

### 5.3 Phone

Desktop-first, phone-optimised. Under 640px: cards stack, tiles go 2-up, drawers become
full-height sheets with 12px inset kept at the top only, text fields are 16px (iOS zoom).
Phone layer z-order (agent shell): 30 bulk bar · 40 bottom tabs + sticky topbar · 50 order
panel · 60 action sheets · 70 popovers · 200 toasts. Equal z-index means DOM order decides —
anything that must cover the tab bar goes above 40. Full-screen layers lock body scroll
(`useBodyScrollLock`) and pin to `useVisibleViewport`.

### 5.4 RTL

Logical properties only (`ps`/`pe`/`ms`/`me`/`start`/`end`/`text-start`/`border-s`,
`inset-inline-*`) — never `left`/`right`. Halos, gradients that have a direction, the
selected-row wash and bars that grow from the start all mirror under `dir="rtl"`. Per-node
`dir="auto"` on customer names, cities and product names; eyebrows drop caps and tracking in
Arabic. Libya (the RTL market) is the load-bearing reader of every screen.

---

## 6. Spacing & radius

### Spacing

4 · 6 · 8 · 10 · 12 · 14 · 16 · 18 · 20 · 24 · 26 · 30 · 40 px. Inside a card 12–16px between
blocks; cards 18px apart in a grid; sections 26px apart.

### Radius — soft and nested

| Value | Use |
|---|---|
| 26px | Drawers |
| 24px | Cards (`rounded-panel`, `.au-card`) |
| 22px | Modals |
| 16px | Inner surfaces, tiles, drawer sections (`rounded-card`) |
| 13–14px | Glass toolbar buttons, stepper, popovers |
| 10–12px | Buttons, inputs, icon buttons, mini cells |
| 9px | Segments, small buttons |
| 4px | Legend swatches |
| 9999px | Chips, tags, badges, bars, avatars |

Nested radii step down (24 → 16 → 11) so the gap between an inner and an outer corner stays
even. Sharp corners are forbidden on anything interactive.

> **Superseded.** 4px buttons, 6px cards, 8px modals; `rounded-card` was 10px.

---

## 7. Styling conventions

### Where styles live

- **Tailwind with tokens** for new components: `bg-au-card`, `text-ink-primary`,
  `rounded-panel`, `shadow-card`… never raw palette classes (`bg-white`, `gray-200`).
- **`.au-*` component classes** in `globals.css` for what Tailwind cannot say briefly: glass
  (`backdrop-filter`), the aurora, halos, keyframes.
- **A prototype ported verbatim** (the `/team` way): the prototype's stylesheet copied rule for
  rule into a block of `globals.css` under a page prefix (`.r6` / `r6-`), its tokens set on the
  page root, element resets wrapped in `:where()` so they never outrank a prototype rule. Use it
  when the owner asked for a prototype to be followed exactly.
- Inline `style={}` only for runtime values — an identity hue (`--a5`), a bar's width, a
  stagger index (`--i`, `--n`).

### Never put a `/opacity` modifier on a var-backed token

Tailwind v3 cannot compute alpha for a `var()` colour; `bg-hue-amber-bg/70` or
`bg-ink-primary/40` is **silently dropped** from the stylesheet. Derive steps in `globals.css`
with `color-mix()` and alias them. Keep token inputs plain `#RRGGBB`:
`status-contrast.test.ts` and `role-tones.test.ts` parse `globals.css` and throw on anything
else.

### Interaction states

CSS `:hover` / `:focus-visible` / `[aria-selected]`, not JS hover state. Clickable card:
lift + `shadow-card-hover`. Button: white + `shadow-hover-row`. Row: white wash. Never
override `:focus-visible`.

### Motion

| Name | What | Timing |
|---|---|---|
| rise | cards enter from +14px | 600ms `cubic-bezier(.2,.8,.2,1)`, stagger 70ms |
| pop | squares / dots enter from scale .3 | 550ms `cubic-bezier(.3,1.5,.5,1)`, stagger 6ms |
| sweep | a ring draws itself | 1.1s, after its card |
| growx / growy | bars grow from the start / bottom | 800–900ms |
| slide | drawers enter from the end | 320ms |
| lift | hover | 200–250ms transform + shadow |
| pulse | the live dot only | 1.8s loop |

Entrance motion plays once per mount, on showcase pages only (§1.1). Menus keep `menuDrop`.
`@media (prefers-reduced-motion: reduce)` disables every animation and transition; a ring
then renders fully drawn.

---

## 8. Do and don't

### Do

- Put the page on the aurora once, in the shell; float glass cards on it.
- Open on the page's one number, huge; write a 2–4-word status under every number.
- Give each person or account their identity hue everywhere they appear.
- Use the fixed outcome hues for outcomes, and write the figure beside every mark.
- Give every chart mark a tooltip, and let legends highlight.
- Rest cards on `shadow-card`; lift what you can click.
- Keep text ≥ 4.5:1 — `#667085` is the lightest text grey.
- Use brand green for chrome only: active nav, primary button, focus, selected.
- Use logical properties and px sizes (root font 14px).
- Validate any new palette with the dataviz checker.

### Don't

- Don't paint an opaque page background over the aurora, or use a dark content surface.
- Don't let one colour mean two things — identity ≠ status ≠ severity ≠ chrome.
- Don't use colour alone, or put type in a fill hue below 4.5:1.
- Don't write sentences where a number and a tag would do.
- Don't put `backdrop-filter` on list rows, or animate rows on a workbench.
- Don't use black shadows, sharp corners, or the 2.5:1 sidebar green on light.
- Don't hardcode strings or use physical CSS properties.
- Don't put `/opacity` on a var-backed token.

---

## 9. Quick reference

```css
/* Ground */
--au-ground: #F6F7FB;              /* + .au-ground: the 5-stop aurora, fixed */
/* Glass */
--au-card: rgba(255,255,255,.62);  --au-card-edge: rgba(255,255,255,.9);
--au-glass-in: rgba(255,255,255,.66); --au-glass-in-edge: rgba(255,255,255,.95);
--au-blur: blur(20px) saturate(170%);
/* Ink */
--au-ink-1: #0F1728; --au-ink-2: #475467; --au-ink-3: #667085;
--au-ink-quiet: #8A94A6; /* not text */  --au-ink-4: #C9CED7;
--au-line: rgba(15,23,40,.07);     --au-track: rgba(15,23,40,.06);
/* Elevation (indigo-tinted) */
--au-sh: 0 10px 36px rgba(42,52,110,.07);
--au-sh-hover: 0 20px 52px rgba(42,52,110,.14);
/* Severity */
--au-good: #067647; --au-good-bg: #DCFAE6; --au-live: #12B76A;
--au-warn: #B54708; --au-warn-bg: #FFF4E0; --au-warn-dot: #F79009;
--au-bad:  #C01048; --au-bad-bg:  #FFE4E8;
/* Chrome */
--brand: #15803D; --brand-hover: #12692F; --brand-bg: #E9F6EE;
--brand-on-dark: #10B981; /* sidebar ONLY */
/* Radii */ 26 drawer · 24 card · 22 modal · 16 inner · 10–12 control · 9999 pill
```

**Card:** `<div className="au-card p-[24px]">` · **Inner tile:** `au-glass` ·
**Eyebrow:** `text-[10.5px] font-[800] uppercase tracking-[0.1em] text-ink-muted` ·
**Hero figure:** `text-[34px] font-[800] tracking-[-0.045em] leading-none tabular-nums` ·
**H1:** `text-[32px] font-[800] tracking-[-0.03em] leading-[1.1]`.

---

## 10. Migration status — what the code still says (2026-10-04)

The doctrine above is the target. Nothing outside `/team` has been migrated; the owner
decides when. This table is the checklist for that migration and must shrink, not grow.

**« Aurore calme » status (2026-10-05).** In the calm register: `/team` (`.r6` block of
`globals.css`, « Aurore calme » sub-block), `/team/performance` (`team-performance.css`, last
block), `/performance/orders` (`performance-orders.css`, last block), and the shared
`OutcomeRows`, and Accès (`/users`, `src/components/admin/access/acces.css`, 2026-10-05), and Performance ›
Livraison (`/carriers`, `src/components/carriers/scorecard/carriers.css` under `.tsc`, 2026-10-06 —
restyle only: same screens and numbers; the `--tr-*` names are repointed to the house values inside
`.tsc`, the full colour band per account stays and gains a sheen, the card under it a wash in its
hue). Not yet calm: Accueil (`store-dashboard.css` still ships the pastels that fail
the validator — move it to §2.4's steps), Produits, Entrepôt, the agent shell.
On the two Performance pages the lower blocks were restyled, not redesigned: « Les plus
grosses fuites », « Par produit » and « Par agent » still print « /100 » figures — convert them
to counts first when they are next touched.

| Area | Code today | Aurore target |
|---|---|---|
| Page ground | `--bg-page` `#F6F6F7` flat, set in `DashboardChrome` (inline style); `--oms-bg` `#FAFAF8`, `--agent-bg` `#FAFAF9`, `--wh-bg` / `--wm-ground` `#F6F6F7`, investor `bg-oms-bg` | `.au-ground` painted once on the shell's `<main>` (`SidebarFrame`), the agent shell, the investor shell; phone warehouse stays opaque `#F6F7FB` |
| Page roots | ~23 roots paint `min-h-screen bg-surface-page / bg-oms-bg / bg-fin-bg / bg-agent-bg` over the ground (carriers, dashboard, P&L, stock, ad spend, investors, messages, integrations, performance, réglages, products, queue, leads, purchases…) | no ground on page roots; a test forbids `min-h-screen` + an opaque ground |
| Ink | Tailwind `ink.primary #1A1A1A`, `secondary #6D7175`, `muted #9CA3AF` (2.5:1 — fails AA as text) | `#0F1728` / `#475467` / `#667085` |
| Lines | `line.subtle #ECEEF0`, `line #E1E3E5`, `line.strong #DADCE0` ≠ `--border-strong #C9CCCF` (open discrepancy) | one value each; strong = `#D0D5DD` in both |
| Radius | `rounded-card` 10px (12px under `.agent-theme`) | `rounded-card` 16px inner, new `rounded-panel` 24px, `drawer` 26, `modal` 22 |
| Elevation | grey `rgba(16,24,40,…)`; resting cards flat | indigo-tinted; `shadow-card` at rest |
| `Card` | `bg-surface-card border border-line-subtle rounded-card` | `.au-card` |
| `Button` | `rounded-lg font-semibold`, `h-8` / `h-10` (rem → 28 / 35px at 14px root) | 10 / 12px radius, 700, `h-[32px]` / `h-[40px]`, glass secondary |
| `Sheet` | docked drawer `bg-surface-card shadow-panel`; scrim `bg-ink-primary/40` | floating glass drawer (12px inset, 26px radius), blurred scrim |
| `Popover`, `Toast`, `Skeleton` | `rounded-lg` white / `rounded-lg bg-ink-primary` / `rounded-[6px] bg-surface-sunken` | §4.12–4.13 |
| `Combobox`, `InlineField`, `StepperField` | inline hex (`#D1D5DB` border, radius 4–6, black shadow) | §4.13 inputs, via tokens |
| Agent topbar | solid `bg-agent-surface` band | glass bar (`--au-card` + blur) |
| `/team` meta grey | `#8A94A6` (3.1:1) inside `.r6`, as the prototype | `#667085` once the owner re-approves |

Tests that pin the old look and must change with the migration: `Card.test.tsx`,
`Button.test.tsx`, `Badge.test.tsx`, `InlineField.test.tsx`,
`HeroTiles.savings.test.tsx` / `HeroTiles.period.test.tsx` (find the card by
`div.rounded-card`), `DexpressStatusTimeline.test.tsx` (`bg-surface-card`).

---

## Scoped extensions

The sections below predate Aurore and were written as exceptions to the flat system. Since
2026-10-04 each **inherits Aurore** (ground, glass, radii, type, elevation, motion) and keeps
only what is specific to it — its own palette, its density, its data rules. Where a section's
« Still forbidden here » list says *gradients* or *shadows on resting cards*, read it as
amended: the Aurore ground, glass and resting card shadow are allowed; **decorative**
gradients (a gradient that carries no meaning and is not the house ground, glass, avatar,
medal or alert wash) remain forbidden everywhere.

## 4.15 Investor portal — scoped extension

Everything above is written for staff at a desk all day: flat, greyscale, zero
decoration, and correct for that job. The investor portal is a different product — an
outsider checking their own money on a phone, with no training and no support channel.
Applied unchanged, the admin grammar renders "money you can withdraw" and "money already
gone" in the same greyscale at nearly the same size.

The portal therefore inherits the whole system **except** the four allowances below,
which apply **only** under `src/components/investor/` and `src/app/[locale]/(investor)/`.
Nothing here relaxes the rules for any other surface.

### Money-direction colour

The one genuine addition. Money has direction, and direction is status:

| Direction | Token | Applies to |
|---|---|---|
| Money in | `status-success` `#008060` | Profit share, revenue, reserve released, capital returned |
| Money out / lost | `status-critical` `#D72C0D` | Costs, negative net profit, paid withdrawals, negative corrections |
| Not yet money | `ink-secondary` `#6D7175` | Estimates, held reserve, anything unsettled |

Colour goes on the **figure**, never on a container. A neutral number — a count, a rate,
a date — stays `ink-primary`. This is §1 rule 2 ("functional color only on status")
extended to a second kind of status, not an exception to it.

### Product imagery

`products.image_url` rendered through `ProductAvatar` (`src/components/orders/ProductAvatar.tsx`).
56px on cards, 72px on a detail hero, 28px in table rows. It is the only imagery permitted,
justified because the funded product *is* the investor's mental model — they think "my
Biovera", not "position 4f2a".

Use the existing component rather than a new `<img>`: it already carries lazy loading,
`object-cover`, and the letter-avatar fallback. Do **not** reach for `next/image` — the
project has no `images.remotePatterns` configured and raw `<img>` is the codebase
convention for every remote image.

### Elevation on tappable cards

A card that navigates lifts on hover (−2px, `shadow-card-hover`), like every clickable
Aurore card (§4.2). Resting cards carry the house `shadow-card`.

> **Amended 2026-10-04.** Was: *"Resting non-interactive cards stay flat."*

A tappable card must be a real `<Link>` or `<button>`, never a `<div onClick>`, so it
receives the global `:focus-visible` ring and works from a keyboard.

### Hero type scale

**One** figure per screen may use the `KpiCard` scale (`text-[28px] font-bold tabular-nums
leading-[1.1]`) — the single number that screen exists to answer. Portfolio: available
balance. Withdrawals: withdrawable amount. A second hero on the same screen means neither
is one.

### Still forbidden here

Decorative gradients (the Aurore ground, glass and avatar gradients are the house look, not
decoration) · `--brand-on-dark` `#10B981` on a light ground · colour as decoration ·
hardcoded strings · physical CSS properties. The portal is the OMS's only mobile-first *and* RTL-load-bearing surface, so logical
properties (`ps`/`pe`/`text-end`/`inset-inline-*`) are not optional.

---

## 4.16 Agent product sheet — scoped extension

Everything above §4.15 is written for someone at a desk who can scan a table at leisure.
The product sheet (`ProductSheetDrawer`) is read by a confirmation agent **mid-call, with a
customer talking at them**, to answer one question in a few seconds. Applied unchanged, the
admin grammar renders the price, the return rate, the pitch and the timestamp at the same
weight and nearly the same size — everything equally scannable means nothing is.

The sheet inherits the whole system **except** the four allowances below, which apply **only**
under `src/components/queue/ProductSheet*.tsx`. Nothing here relaxes the rules elsewhere.

### Hero imagery

§4.15 already justifies product imagery as the mental model. Here it grows from a 72px
avatar to a **full-width 1:1** hero: `rounded-[8px] border border-line-subtle object-cover`,
`loading="lazy"`, with the same letter fallback as `ProductAvatar`. Raw `<img>`, not
`next/image` — the project configures no `images.remotePatterns`.

A thumbnail strip appears **only** when there is more than one asset: 48px squares, the
active one marked by a `border-ink-primary` ring, never a tint.

### One hero figure

The price uses the `KpiCard` scale (`text-[24px] font-bold tabular-nums leading-none`) —
§4.15's "one figure per screen that the screen exists to answer". The currency code rides
alongside at 12px/500 `ink-secondary`. No second figure on the sheet may use this scale;
signal figures cap at 18px.

### Status colour on rate figures

Confirmation rate and return rate take `status-success` / `status-warning` /
`status-critical` **on the number**, never on a container. This is §4.15's money-direction
rule extended to a second kind of status: a rate is a status. Thresholds live in
`src/lib/products/signals.ts`, not in the component.

Contraindications are rendered in the critical tone for the same reason — a warning *is*
status, so it earns colour where a description does not.

### Reading rhythm

Body sections use `gap-5` (20px) instead of the §4.9 drawer default of 12px, and prose
blocks (description, notes, usage, composition) use `leading-relaxed`. This is a reading
surface, not a dense form. Everything else — labels, rows, badges — keeps the standard
tight rhythm.

### Type ladder

| Role | Size / weight | Token |
|---|---|---|
| Price (one only) | 24 / 700, tabular | `ink-primary` |
| Product name | 17 / 600, leading-snug | `ink-primary` |
| Signal figure | 18 / 700, tabular | status colour |
| Section label (§4.10) | 10 / 600, uppercase 0.1em | `ink-muted` |
| Body emphasis | 13 / 500 | `ink-primary` |
| Reading body | 13 / 400, leading-relaxed | `ink-secondary` |
| Meta / caption | 11 / 400 | `ink-muted` |

### Still forbidden here

Tinted section backgrounds (§4.10 — identity comes from icon + label; status *alerts* are
not section backgrounds and remain allowed) · decorative gradients · `--brand-on-dark`
on a light ground · hardcoded strings · physical CSS properties. The sheet is a §4.9 drawer:
glass, resting shadow and radius come from Aurore.

---

## 4.17 Orders console — scoped extension

The orders list is the one screen an ops dispatcher stares at all day while triaging a
multi-thousand-row backlog. Applied unchanged, the admin grammar rendered every field at the
same weight: a 24-character Mongo ObjectId won the visual hierarchy, the price lost, and an
absolute timestamp gave no sense of how long an order had been rotting.

The console inherits the whole system **except** the allowances below, which apply **only**
under `src/components/orders/**` and the orders route. Nothing here relaxes the rules elsewhere.

### A. Warm ground — retired 2026-10-04

> **Superseded.** The console ran on its own warm ground so white row bands read as objects on
> a surface. Under Aurore the console sits on the house aurora like every page, and
> `--oms-bg` is to resolve to `--au-ground` (for sticky bars that must stay opaque) — not
> migrated yet, §10. The row bands
> stay white (`--oms-surface`) — a workbench list is not glass (§1.1). The warm hairlines and
> the three-step ink ramp below remain until the console is redrawn.

| Token | Hex | Role |
|---|---|---|
| `--oms-bg` | `#FAFAF8` | Console page background (replaces `--bg-page` here only) |
| `--oms-surface` | `#FFFFFF` | Row bands, tiles, dropdowns |
| `--oms-surface-sunken` | `#F4F3EF` | Bar tracks, skeletons, the health tile |
| `--oms-border` | `#EAE7E1` | Hairlines |
| `--oms-border-strong` | `#DCD8D0` | Hover borders, chevrons |

### B. Three-step neutral ramp

The global `--text-secondary` / `--text-muted` pair is a two-step ramp, and `#9CA3AF` on white
is **2.9:1** — below AA for the 12px meta text this screen is full of. The console uses three
steps, each verified against `--oms-surface`:

| Token | Hex | Contrast | Role |
|---|---|---|---|
| `--oms-ink-1` | `#1B1917` | 17.5:1 | Customer name, price — the row's two entry points |
| `--oms-ink-2` | `#5C5852` | 7.1:1 | Product name, tile labels |
| `--oms-ink-3` | `#78726A` | 4.8:1 | Meta, period labels, column headers |

Every step clears 4.5:1. Quiet is achieved by weight and size, never by dropping below AA.

### C. Accent — the retired tab slot

§1 reserves the accent for exactly two places, one of which was the active-tab underline. The
orders console **has no tabs**: the KPI strip replaced them, so the tile *is* the navigation and
inherits that slot. The count of sanctioned accent uses is unchanged.

**The tile takes the brand green, like every other control.** `--oms-accent` is no
longer chrome at all — it is now *only* the `confirmed` / `callback_scheduled`
status hue.

| Token | Hex | Role |
|---|---|---|
| `--brand` | `#15803D` | Active KPI tile ring, funnel bars, focus ring, primary CTA |
| `--brand-bg` | `#E9F6EE` | Active tile fill, selected row band |
| `--oms-accent` | `#6E56CF` | **Status hue only** — `confirmed`, `callback_scheduled` |
| `--oms-accent-ink` | `#513FA8` | Violet text on `--oms-accent-bg` |
| `--oms-accent-bg` | `#F1EEFC` | Violet pill tint |

> **Superseded.** This section previously reserved violet for the active KPI tile,
> on the argument that "a tab says which slice of the list, a tile says which
> condition across the whole market — rendering both in the same green would make
> two different instruments look like one control."
>
> The argument was sound but the premise expired: the console has **no tabs left**
> to confuse the tile with. The KPI strip *is* the navigation. So the distinction
> the violet was buying is now carried by shape and position — a tile is a card in
> a row of cards, and nothing else on the page looks like one — and the colour is
> free to do the more valuable job of tying the content to the sidebar.
>
> Violet keeps the meaning it actually earns: the confirmation-phase status hue.
> That is a separate vocabulary from chrome (§1 rule 2), and it is *why* the tile
> could not simply be repointed — `--hue-violet-*` aliases `--oms-accent`, so
> recolouring the token would have turned `confirmed` green and collided it with
> `delivered`. The fix was to split the job, not to repaint the token.

### D. Aging scale

Elapsed time escalates in colour, but **only while an order still needs a human**. Confirmed,
rejected and cancelled orders stay neutral no matter how old — colouring closed orders red
makes the heat map useless.

| Age | Token | Treatment |
|---|---|---|
| < 2 h | `--oms-ink-3` | neutral |
| 2–24 h | `--oms-age-warm` `#A9670C` | amber |
| > 24 h | `--oms-age-late` `#B23A32` | red + `⚠` glyph + row edge stripe |

Never colour alone — the glyph carries the signal in greyscale.

### E. Elevation

The console's containers (the KPI strip, the list card) rest on `shadow-card` like every
Aurore card. **Row bands** still take `shadow-hover-row` on hover only: this is the workbench
rule of §1.1 — twenty-five resting shadows inside a list is noise; one under the cursor is
feedback.

### F. Numerals and bilingual type

- `tabular-nums` on all money, counts, and elapsed time so columns align without a mono face.
- Currency is demoted (`--oms-ink-3`, ~0.7em) so the number wins.
- Arabic content carries `dir="auto"` **per node**, never on a container — the chrome stays LTR
  while customer names, cities and product names resolve individually. This is what keeps the
  `·` separators on the correct side in the Libya market.
- Arabic sets ~6% larger than Latin at the same px; the `.ar` treatment compensates optically
  but must not set `line-height`, or it inflates table row heights.

### G. Counts must not lie

Not styling, but the rule this section exists to protect. A headline number and the view it
opens must be the same set. Concretely:

- Aggregate with exact head-only counts. `.select(col)` then counting the array truncates at
  PostgREST's 1000-row cap — that is how "1000 au total" survived against 2578 real orders.
- Label every figure with the period it measures. A backlog ("maintenant") and a daily count
  ("aujourd'hui") answer different questions and must never share a bar scale.
- Map each tile to the exact filter set its count came from (`lib/orders/kpi-tiles`).
- Measure states, not snapshots. Confirmation is transient; counting `status = confirmed`
  alone reported 7.7% where the true rate was 78.7%.

### F-bis. Status badges — three encodings, none of them alone

Status was carried by hue and nothing else, and the hue was assigned by category
rather than by urgency. Measured over the newest 100 orders, 35% were `uploaded`
and 28% `rejected` — both settled — while `pending` sat in a grey outline. Roughly
two-thirds of the column shouted for states nobody had to act on. **Red on a quarter
of the rows is not a signal; it is the background.**

Three encodings now share the load. Each is independently sufficient to tell two
statuses apart, so losing any one of them degrades rather than blinds.

| Encoding | Carries | Values |
|---|---|---|
| **Hue** | phase + outcome | warm (`neutral` / `amber` / `violet`) through confirmation, cool (`teal` / `green`) once with the carrier, `red` for an unsuccessful end |
| **Icon** | what kind of state | a lucide mark per status, from the single map in `lib/orders/status-presentation` |
| **Weight** | how much it wants you | `quiet` → `medium` → `loud` |

**Amended — the border is no longer the alarm.** This section previously read:
*"loud — full tint plus a coloured border. A border is the only treatment that reads
as an alarm, so it is spent last."* Every pill now carries a `1px` border in its own
hue, which retires that lever deliberately. **Record the cost:** the measurement that
motivated the old rule still holds — over the newest 100 orders 35% were `uploaded`
and 28% `rejected`, both settled — so a uniformly-bordered column asserts itself more
than the content warrants. Two things keep it from flattening completely:

- **quiet** — 70% tint, `font-medium`, border at low alpha. Settled: `uploaded` →
  `delivered`, `rejected`, `cancelled`, `deleted`.
- **medium** — full tint, `font-semibold`, border at mid alpha. Open work: `pending`,
  `attempt_*`, `callback_scheduled`, `to_be_returned`.
- **loud** — full tint, `font-[650]`, border at full opacity. Currently only when call
  attempts are exhausted.

So `weight` still steps fill, face and border *opacity*; what it no longer does is
switch a border on and off. If the column ever reads as noise again, this is the
paragraph to revisit — the `StatusWeight` data is intact and the lever can be taken back.

**Shape was retired with `StatusGlyph`.** The abstract 8×8 vocabulary
(`ring`/`solid`/`half`/`check`/`cross`/`square`) encoded open-vs-closed but was not
legible at a glance and had no round success mark. A per-status lucide icon says more
in the same space. Phase remains unmistakable from hue: nothing before the carrier
upload is teal.

**Rules**

- Colour is never the only signal — the icon carries the state in greyscale.
- The icon sits in a **fixed-width slot** so every label in a column starts at the
  same x. Pills used to run 48px to 82px wide and the eye zigzagged down a thousand
  rows with nothing to anchor on.
- One presentation map, `lib/orders/status-presentation`. A per-surface `STATUS_TONE`
  with a `?? "neutral"` fallback is how a status silently renders as "some grey thing".
- The glyph sits in a fixed-width slot so every label in a column starts at the same x.
- Text on a tint uses the `-ink` step (`--oms-warn-ink`, `--oms-info-ink`,
  `--oms-accent-ink`), not the base hue. Amber shipped at 4.05:1 against its own tint.
  `lib/orders/status-contrast.test.ts` reads the tokens out of `globals.css` and fails
  if any pair drops below 4.5:1.
- A count in a label is a number that should be aligned and compared, not read as a
  word. Derive it from data, never from the status string — `attempt_3` is a cap, not
  a count, and the market's real ceiling lives in `max_call_attempts`.

### G. Order detail panel

The panel opens from three surfaces (list, archive, agent queue) and uses the same layout for
all three. It inherits §A–F; the rules below are what the panel adds.

**A fixed masthead over a single scroller.** Header, hero, facts grid and blockers do not
scroll; the tab body is the only scrolling region. An agent mid-call must be able to read the
customer's number back while scrolling a long receipt. Anything unbounded — carrier status
blocks, product briefs — belongs in a tab, or the masthead grows until the body has no room.

**A tab is a disclosure. Do not nest another one inside it.** Tab panels hold bare rows on the
panel surface: no bordered cards, no collapse. A card inside a tab that also collapsed meant
opening the panel to check a receipt, then clicking again to see it.

**Hide tab panels with the `hidden` attribute on an element that sets no `display`.** The UA
rule `[hidden] { display: none }` loses to any author `display` value, so `hidden` on an
element classed `flex` does nothing. Wrap instead. Keeping panels mounted (rather than
conditionally rendered) means switching tabs cannot remount an inline editor mid-edit, and
`hidden` still removes them from the accessibility tree.

**One money spine per surface.** Every amount in a column shares one right edge, and the
currency slot is reserved on every row even when only one row fills it. Otherwise the row that
names its currency pushes its own digits left and the column reads as ragged. Amounts are
always two decimals with the currency demoted to 10.5px — the same reading as the table's Total
column, so one order never appears as two different figures in two places.

**Editable values declare themselves at rest.** Click-to-edit fields carry a dotted underline
(`decoration-dotted decoration-oms-border-strong`). A pencil that appears on hover is
undiscoverable: you have to already suspect the field is editable to find out that it is.
`InlineField` emits this in display mode for every non-empty editable value, so the rule holds
across the panel without each caller opting in. An *empty* editable field skips the underline —
its italic placeholder ("Ajouter une adresse…") is already the invitation, and a rule under
placeholder text reads as a filled value.

**An empty value must say which kind of empty it is.** A bare `—` cannot distinguish "you have
not filled this in yet" from "the system has not written this yet", and the two need opposite
reactions from the reader. A field the operator can fill states the action
(`Ajouter une adresse…`); a value the system writes later keeps the dash and names the event
that will fill it (`— À l'envoi au transporteur`). Only a value that is genuinely never
applicable is a dash alone.

**Group rows by who owns them.** The Livraison tab answers two questions with different owners:
where the parcel is going (the operator's to fix) and what the carrier did with it (written by
the upload). Undifferentiated rows made the reader derive that split from memory. Rows are
banded under an icon + label heading per §4.10 — no tint, no card, the rows stay on the panel
surface. A blocker's fix sits on the value's own line; pushing it to the far edge with `ms-auto`
separates a problem from its remedy by the full width of the panel.

**Never promote a destructive action beside the primary CTA.** The footer promotes the first
*non-destructive* overflow action to a labelled secondary; the rest stay behind `⋯`, where
opening the menu is itself the confirmation step. Any action that cannot be undone from the
panel — cancelling an order, pulling back a carrier barcode — must carry `destructive: true`
in `resolvePanelActions`, which is what keeps it out of that slot.

**A blocker states its consequence and carries its fix.** Amber for "will block", red for "has
failed", each with a glyph so it survives greyscale. An empty field that blocks a downstream
step reads in the warn colour with the control that resolves it — never as a bare dash, which
is indistinguishable from "not applicable".

**No developer strings reach the timeline.** Notes written by intake or integrations are
translated in `lib/order-history-display` before display, keeping any raw value that a human
has to recognise.

### H. One period per row

Every tile that counts a span counts the **same** span — the date range the table is filtered
by (`lib/orders/kpi-tiles`, `WINDOWED_TILES`). The leading tile used to be a fixed
"Aujourd'hui": selecting "30 derniers jours" moved its four neighbours and left it on the
current day, so one row described two periods at once and the figure that reads as the row's
denominator was the one telling the wrong story. It is now `periodTotal` — every order that
came in during the window, whatever became of it.

Two consequences worth keeping:

- Because the tiles share a period label they share a bar scale (§4.17 G), so `periodTotal`
  sets the scale and each outcome bar draws as its **share of intake**. The funnel reads as
  a funnel rather than as five unrelated bars.
- `periodTotal` is navigation, so it excludes soft-deleted orders even though the standing
  `total` readout beside it does not. The working list hides them; a tile that counted them
  would put a number on screen its own table cannot reproduce.

Only backlogs (`unassigned`, `toRecall`) stay dateless, and they still say "maintenant".

### I. Filter bar

Seven identically-shaped grey pills forced a left-to-right read of every label to find one
control. The facet bar (`components/orders/OrdersFacetBar`) therefore carries:

- A 14px lucide glyph per facet, `strokeWidth={1.9}`, `aria-hidden` — recognition in
  peripheral vision, never the only carrier of meaning. The word stays.
- Three button states, not two: rest, **open** (`border-oms-border-strong` + `shadow-hover-row`,
  so the panel visibly belongs to one of seven controls) and active (`border-brand bg-brand-bg`).
- A hairline (`w-px bg-oms-border`) before "Afficher supprimées". Everything left of it narrows
  which orders *match*; that control changes which rows are *eligible to be shown at all*.
- `Effacer` in each open menu's header. Undoing a value meant hunting for its chip in a row
  that can hold ten of them; the menu that set it can unset it. Status facets drop only their
  own axis — Appel and Livraison write to one enum.
- Menus animate in with `menuDrop` (140ms, `origin-top`). §7 Motion allows this as the
  established dropdown entrance; nothing else on the bar moves.

**A rule and its affordance must agree.** The date menu states "une seule période" and rendered
checkboxes, which promise exactly the opposite. Its presets are radios laid out two-up, and the
custom range states the span it will apply (`12 jours`) — two ISO dates do not state their own
length, and the length is the thing being decided.

---

## 4.18 Segmented navigation

§4.11 says "Pills-as-tabs are deprecated" and reserves the accent for an underline. That was
written for the orders console, which has **one** level of navigation. The agent queue has
**three**: a bucket (`Nouveau` / `En cours` / `Confirmé` / `Fermées`), a sub-filter inside it
(`Rappel` / `Tentative` / `Livraison` / `Planifié`), and an attempt number inside that. An
underline can mark one row as current; it cannot show that a second row is nested inside the
first. Stacking two underlined rows made them read as siblings.

Levels 1 and 2 therefore use **bordered segments**, and the accent moves from the underline to
the **active segment's count badge**.

- Segment: `inline-flex items-center gap-2 rounded-lg border px-3`, `h-[38px]` (level 1) /
  `h-[30px]` (level 2), `text-[13.5px]` / `[12.5px] font-semibold`
- Rest `border-agent-outline-variant bg-agent-surface text-agent-on-surface-variant` ·
  hover `border-agent-outline text-agent-on-surface` ·
  active `border-agent-outline bg-agent-surface text-agent-on-surface`
- Count badge: `h-5 min-w-[21px] rounded-pill px-1.5 text-[11px] font-bold tabular-nums`;
  **active `bg-agent-primary text-agent-on-primary`**, inactive `bg-agent-surface-low text-agent-ink-3`
- The row sits on a `border-b border-agent-outline-variant` baseline and scrolls with
  `overflow-x-auto custom-scrollbar` rather than wrapping
- Logical properties only (`ps`/`pe`/`border-s`) — the row must mirror under `dir="rtl"`

One shared primitive, `components/ui/SegmentedTabs`, serves all of them. §4.11 remains in force
for any surface with a single level of navigation.

### The carrier-account colour — a named exception

Libya runs two Darb Assabil accounts as two `carriers` rows sharing one `code`, so they resolve
to the same logo file. Until 2026-10-03 a thin tinted ring told them apart; the owner could not
read it, and it is gone. Each account now has a colour in the data (`carriers.accent_color`,
`#RRGGBB`) and is **named by its warehouse city in that colour**: a full band on Transporteurs
(`/carriers`), a solid city pill beside the logo in the agent queue. Defaults are the validated
pair `#1F5FBF` / `#C24E17` (CVD ΔE 25.2, white text ≥ 4.7:1); a carrier with one account gets
no pill.

This is colour carrying something that is **not** status, which §1 rule 2 and §4.15 both
forbid. It is allowed here, narrowly, because two identical logos are not separable otherwise.
The condition is unchanged: colour is **never the only signal** — the city is written in the
band and in the pill. See docs/carrier-scorecard.md.

---

## 4.19 Tinted icon holder

KPI tiles lead with a 40px `rounded-lg` square filled with ~10% of the tile's hue, holding a
20px lucide icon in the full hue.

§4.10 forbids tinted backgrounds for **section identity inside a panel** — "identity comes from
icon + label, never a tint" — and that stands. This is a different job: a KPI tile is a
*control* in a row of controls, scanned peripherally for the one number you came for, and the
tint is what makes the row scannable without reading a single label. A panel section is read in
sequence; a tile row is not read at all until one of them is.

- Holder: `grid h-10 w-10 place-items-center rounded-lg`, background = hue at 10%
- Icon: 20px lucide, `strokeWidth={2}`, colour = the full hue
- Hue matches what the tile counts, and comes from the same status map as the pills — a tile
  and the rows it opens must not disagree about what colour that state is
- The tile is an Aurore inner surface (`.au-glass`); it lifts on hover (§4.2)

Do not use this holder outside a KPI tile.

---

## 4.22 Suivi livraison — one hue per situation (2026-09-17)

The `/delivery` row puts the **situation first** (before the client) on desktop and phone, and
the situation chip takes **one hue per situation**, not per bucket — an agent reads what is
wrong from the colour before the label: red returns, rose confirmed return, fuchsia cancel
intent, violet risky parcel, orange overdue callback, amber no answer, teal address, yellow no
coverage, indigo delayed, stone stalled, blue promised callback, slate warehouse, grey carrier,
green delivered. The map is `SIT_TONE` in `src/lib/delivery/presentation.ts`; the classes are
`TONE[..].chip` in `src/components/delivery/ui.tsx`, written out as literals because Tailwind
cannot see an interpolated class. The chip is a gradient (a fade from the tint to near-white, mirrored under `dir="rtl"`),
asked for by the owner as a status signal — the same idea as Aurore's alert wash (§4.2).
*(Until 2026-10-04 it was "the one sanctioned gradient in the product UI".)*

**One parcel, one colour (extended 2026-09-18 to the manager screen).** Everything that
describes *a single parcel* takes the situation tone: the chip, the row's inline-start edge,
the carrier-status dot in the detail panel, the mobile suggested-action tint, and the 4px bar
in the cockpit's blocking list. A bucket tone on any of these contradicts the chip beside it —
a stalled parcel would show a stone chip against an amber edge. What stays on `BUCKET_TONE` is
what describes a *group*: the bucket strip on both screens, the cockpit legend, and the
per-agent load bar, which is a distribution across buckets and nothing else. The one deliberate
exception is the mobile action bar, tinted by `moveTone` (how hard the action pulls), because
the edge and chip already carry what is wrong. Design notes:
`plans/delivery-worklist-row-redesign.md`.

---

## 4.20 Entrepôt mobile — scoped extension

Everything above §4.15 is written for someone at a desk. §4.17 narrowed that to
the orders console; this narrows it to the opposite end of the building. The
warehouse agent works **standing, one hand on the phone, the other on a parcel**,
and has no sidebar at all — `Sidebar` returns null for the role.

Applied unchanged, the admin grammar gave them a 1460px page: six columns in
390px overprinted `PRODUIT` on `COMMANDE` and rendered "PRODUMANDE", and every
customer name truncated to a single letter.

The agent shell therefore inherits the whole system **except** the five
allowances below, which apply **only** under
`src/components/warehouse/shell/` and the `isAgent` branch of
`src/app/[locale]/(warehouse)/layout.tsx`. Nothing here relaxes the rules for
the manager console, which keeps the desk layout.

Visual reference: `docs/design/entrepot/mobile/` — four mockups plus the map
of which figure resolves to which query.

### Bottom navigation (since 2026-10-02 — the day loop)

Aujourd'hui · Sortir · **[Scan]** · Rentrer · Stock — pinned to the bottom edge,
56px per cell plus `env(safe-area-inset-bottom)`. Aujourd'hui is home: the four
jobs of the day (Sortir, Rentrer, Recevoir, Compter), each a link carrying its
backlog. Recevoir and Compter are reached from Aujourd'hui and Stock, not from
the bar; Réglages sits behind the avatar on Aujourd'hui. The whole cell is the
target, never the label. The active cell is marked by a **tinted plate in its
job's hue as well as by colour**: colour alone fails on a loading dock in
sunlight. See plans/entrepot-day-loop-redesign.md.

The bar is **opaque**. At 95% the list scrolling underneath blurred through and
the product names read as smudges under the labels.

The bar disappears during a scan run and a count run: each carries its own exit.

### The scan button

Scanning is the one thing the agent does continuously, so it is not a tab: it
sits in the **centre** of the bar as a 60px green circle, raised out of it by a
ring of the page ground, labelled underneath (`shell/ScanButton.tsx`). It used
to float over the content (ScanFab) and, at 390px, covered the last card of
every list. It opens the bench's scan sheet: with a parcel in hand it binds the
sticker, with nothing in hand it looks the sticker up.

It is the one filled green on the agent's screen. Do not add a second floating
or raised action anywhere.

### Job hues (`--job-*`, `.job-out | .job-returns | .job-receive | .job-count`)

Each job of the day has a hue, drawn from the brand green's family plus one
warm counterpoint — the owner asked for colours that sit with the main green
(no blue, no violet):

| Job | Fill | Tint | Ink (text) |
|---|---|---|---|
| Sortir | `#15803D` (= `--brand`) | `#E9F6EE` | `#12692F` |
| Rentrer | `#0F766E` teal | `#E3F3F1` | `#0B5C56` |
| Recevoir · Stock | `#4D7C0F` moss | `#EEF5E1` | `#3F6212` |
| Compter | `#A16207` gold | `#FBF3DC` | `#854D0E` |

A wrapper names the job with its class; everything inside reads `bg-job`,
`bg-job-bg`, `text-job-ink` (Tailwind `job`). Only the `-ink` carries text, as
in §4.21. Hues mark the step numbers, the job figures, progress bars, the
active tab plate, product tiles and the job's primary button — never a status:
refused stays red, late and never-counted stay amber.

### Palette

Since 2026-10-02 the `--wh-*` and `--wm-*` variables hold **Ordra's values** (today ground
`#F6F6F7`, ink `#1A1A1A`/`#6D7175`, `ok` = the brand green `#15803D`); in the Aurore migration
they follow the house values (ground `#F6F7FB`, ink `#0F1728`/`#475467`). The **desk** console sits on the
aurora; the **phone** shell keeps an opaque ground (§1.1 — sunlight, a list scrolling under
the bars). The names remain so the warehouse's class usages keep working;
retiring them is a later clean-up.

### The graph-paper ground

`.wh-grid-ground` — a 24px lattice in `--wh-grid` under `--wh-bg`. It separates
the working surface from the white cards sitting on it, which matters when the
whole screen is cards. It is the one texture allowed in the system and it lives
only here.

### Touch targets and the camera

Every control is at least 44px; the primary scan control is 52px. On a phone
there is no barcode gun, so the wedge-scanner-first reasoning inverts: the
camera becomes a full-width primary button, while the desk keeps the compact
50px toggle beside the input. Same state, two affordances, one breakpoint.

### KPI strip becomes a carousel

`WhKpiGrid` is a snap-scrolling strip below `md` and the auto-fitting grid at
and above it. The grid alone collapsed to one card per row, pushing the actual
work two screens down under four headline figures. Cards are 158px so the next
one peeks in — the only honest signal that the row scrolls.

### Still forbidden here

Glass or `backdrop-filter` on the phone shell (opaque, §1.1) · decorative gradients ·
colour as the sole channel for a roll colour or a severity ·
inventing a figure the warehouse has not earned (a stock goal nobody set, an
accuracy nobody measured) · physical CSS properties. Libya is RTL and this is
the section's only load-bearing RTL surface, so `ps`/`pe`/`ms`/`me`/`text-start`
are not optional.

---

## 4.21 Finance surfaces — scoped extensions (`--fin-*`, `--ads-*`)

Two token families in `src/app/globals.css` serve the finance section. Both were
built and validated in code before they were written down here; this section is
the reading of them, added 2026-09-13.

Neither is a new theme. Both sit on the light console ground with the same black
type and the same brand green for chrome. What they add is a **measured
categorical palette** — the thing §1's "functional colour only on status" did not
anticipate, because a cost breakdown is not a status and cannot be drawn in grey.

> A stale plan (`plans/ad-spend-campaign-redesign.md`) sanctions a dark cinematic
> palette for Dépenses pub. **That was not built and must not be.** The shipped
> page is light. Treat that plan as superseded by
> `plans/ad-spend-meta-sync-redesign.md`.

### A. `--fin-*` — P&L global and the finance dashboards

| Token | Hex | Role |
|---|---|---|
| `--fin-green` | `#16A34A` | 3.0:1 — fills, glyphs, bars, strokes. **Never type.** |
| `--fin-green-ink` | `#15803D` | The text partner (= `--brand`), 5.0:1 on white |
| `--fin-navy` | `#0F172A` | Headings, 16.9:1 |
| `--fin-mint` | `#E6F7EF` | Icon holders, funnel wells, positive delta pill |
| `--fin-teal` / `-ink` | `#0D9488` / `#0B6A60` | Secondary series |
| `--fin-gold` / `-ink` | `#F59E0B` / `#8F5608` | Accent fill only — 2.1:1, never type |
| `--fin-bg` / `--fin-line` | `#F7F9F8` / `#E8EEEA` | Section ground and hairline |
| `--fin-ink-2` / `-3` | `#475569` / `#64748B` | 7.5:1 labels · 4.8:1 meta and axis |

**The fill/ink split is the rule.** Every hue that can carry a figure has an
`-ink` partner that is safe as type; the raw hue is for fills, bars and glyphs.
Putting `--fin-green` on a number is the mistake this split exists to prevent.

### B. `--ads-*` — Dépenses pub

Dépenses pub needs more than the finance palette: it draws a **cost stack** (where
one delivered order's revenue goes) and a **threshold chart** (cost per lead
against the maximum payable). Twenty-nine tokens, in three groups.

**Neutrals and verdict hues** — `--ads-line`, `--ads-line-2`, `--ads-ink-1`
(16.6:1, figures), `--ads-ink-2` (5.0:1, labels), `--ads-ink-3` (2.6:1 — column
heads and disabled cells **only**), `--ads-muted` (axis ticks, matching
`--chart-line`). Verdicts: `--ads-green` `#16A34A` and `--ads-red` `#DC2626` are
**fills** at 3.0:1 and 4.0:1; their `-ink` partners (`--ads-green-ink` 5.0:1,
`--ads-red-ink` 6.2:1) carry the type.

**`-bg` versus `-band` is load-bearing.** `--ads-red-bg` is a pill fill;
`--ads-red-band` (`#FEF6F6`) is the whole-row wash under a losing product and is
deliberately far lighter. A full table row at pill strength reads as an error
state rather than as a number worth looking at.

**Cost stack — six categorical hues.** `--ads-pub` `#ea6a1f` · `--ads-cogs`
`#2563eb` · `--ads-delivery` `#0d9488` · `--ads-returns` `#6d5ce0` ·
`--ads-packing` `#e87ba4` · `--ads-profit` `#15803d`. Validated against `#FFFFFF`
with the dataviz palette checker: every step inside the lightness band, chroma
above the grey floor, worst adjacent CVD ΔE 15.2, normal-vision ΔE 22.6. They are
**fills only** — each segment carries its label and figure in ink beside it, never
colour alone.

**Hatching** — `--ads-hatch-ok` / `--ads-hatch-bad` (plus `-line` partners) mark
the headroom between what a lead costs and what it may cost. Hatching, not a
fourth hue, because it reads as "not yet spent" rather than as another category.

### Still forbidden here

Decorative gradients · a raw fill hue carrying type · colour as the only channel for a cost
category or a verdict · a dark ground · inventing a figure the data has not
earned. A young cohort must read as unfinished (`maturityPct`), never as a
confident number.

---

## 4.23 Accès — one hue per role (2026-10-03)

`/users` (Équipe › Accès) gives each **role** one hue. Approved by the owner from
`prototypes/acces-v2.html` ("j'aime le design"); the structure and its rationale are
in `prototypes/acces-v1.html`. This is colour carrying a **category**, which §1 rule 2
forbids — allowed here, narrowly, like §4.22 and the carrier-account colour, because a
list of people reads by team first and the hue is what makes the team visible at a glance.

| Role | Hue (fill, dot, icon) | Ink (text) | Tint (fill) | Edge | Ink / tint | Hue / tint |
|---|---|---|---|---|---|---|
| Agents | `--role-agent` `#0284C7` | `#0369A1` | `#EAF6FD` | `#B9E1F7` | 5.4:1 | 3.7:1 |
| Entrepôt | `--role-warehouse` `#EA580C` | `#C2410C` | `#FFF3EB` | `#FDCDB0` | 4.8:1 | 3.3:1 |
| Managers | `--role-manager` `#6366F1` | `#4338CA` | `#EEF0FF` | `#C9CDFB` | 7.0:1 | 3.9:1 |
| Investisseurs | `--role-investor` `#0D9488` | `#0F766E` | `#E8F8F5` | `#A9E5DB` | 5.0:1 | 3.4:1 |
| Super admins | `--role-admin` `#475569` | `#334155` | `#EEF1F5` | `#CBD3DE` | 9.1:1 | 6.7:1 |
| « Tous » (chrome) | `--brand` | `--brand-hover` | `--brand-bg` | `--role-all-edge` | 6.1:1 | 4.5:1 |

A wrapper names the hue — `.tone-agent | .tone-warehouse | .tone-manager |
.tone-investor | .tone-admin | .tone-all` — and everything inside reads the Tailwind
colour `tone` (`bg-tone`, `bg-tone-bg`, `text-tone-ink`, `border-tone-edge`), the same
mechanism as the warehouse `job` hues. `src/lib/users/role-tones.test.ts` reads the
tokens out of `globals.css` and holds ink ≥ 4.5:1 and hue ≥ 3:1 on the tint.

**Conditions.**
1. The colour is never the only signal: the role is always written next to it.
2. These hues never carry an order status, and status hues never mark a role.
3. They may appear elsewhere only to represent a **person** (an avatar, a role chip) —
   never as decoration, never for a non-person category.

**Where they show on Accès:** the role cards, avatars, the role chip in each row, the
warehouse pill (always `tone-warehouse`), the selected row, the creation cards and the
halo of a person's file. Brand green keeps the chrome: the primary button, the « Tous »
card, focus, a pressed filter (« Sans activité »), the step numbers.

**In « Aurore calme » since 2026-10-05** (`src/components/admin/access/acces.css`, scoped
`.acx`; the page paints its own aurora like `/team/performance`). The role hue is an
**identity**, so it gets the entity-card treatment of §4.2: each role card has a 3px top
accent, a wash fading down, the count in `--tone-ink`, gradient faces; the pressed card a
1px ring in its hue. Avatars are `linear-gradient(140deg, --tone, --tone-ink)` with a white
ring and a glow. The selected row is tinted `--tone-bg` with a 3px start edge in `--tone`.
The person's file is the floating drawer of §4.9 with a halo of their hue; its sections are
glass, the three account facts are figures between hairlines. The no-building alert is the
calm problem line (§4.2) with a red top accent and **at most six people** before « +N
autres » — a dozen red chips was a wall. « Affecter » is a soft red tag that fills on hover.
`UsersPageAurore.test.tsx` forbids the old flat hexes and rem sizes in these files.

## 4.24 Journaux — severity only (2026-10-03)

Système › Journaux (`prototypes/journaux-v2.html`, approved by the owner for its
simplicity after v1 felt too dense). The page is calm on purpose: **success carries no
colour**. Only a failure (red) and a « to check » (amber) do, and both are always paired
with a word (« Échec », « À vérifier ») and a shape (the dot, the flag, the hollow bar).

| Token | Fill | Ink (text) | Tint | Line |
|---|---|---|---|---|
| `--jx-ok` | `#008060` (dots, 48 h bars) | `#006E52` | `#EEF7F3` | — |
| `--jx-warn` | `#B98900` | `#7A5A00` | `#FFF6DF` | `#EBCB7A` |
| `--jx-fail` | `#D72C0D` | `#B42309` | `#FFF1EE` | `#F3C2B6` (hover `#FFE9E4`) |
| `--jx-mute` | `#C5CBD3` | `--ink-secondary` | `#F1F2F3` | — |

**Family tints** — the 34 px icon holder of a system tile or a feed row (§4.19), never
text, never a severity: intake `#EEEDFC`/`#3F37C9`, carrier `#E3F3F1`/`#0B5C56`, ads
`#FDEFE6`/`#B4500F`, messaging `#E3F4FC`/`#0369A1`, jobs `#F0F1F3`/`#4B5563`, Ordra
itself `#EEF0F4`/`#2F3A4B`.

**Rules.** Sizes are px (root font is 14 px — `pixel-units.test.ts` scans
`components/journal`). A failed feed row is tinted `--jx-fail-bg`; a warning row
`--jx-warn-bg`; everything else is white. The 48 h bars draw « expected, absent » as a
**hollow** bar (amber inset line), not merely another colour. Brand green stays chrome:
the active tab underline, « Problèmes seulement » on, primary buttons.

## 4.25 Équipe — the reference implementation (2026-10-04)

Salle de contrôle (`/team`) is where Aurore was first built, and it stays the reference: the
owner chose the look from a four-look board (Performance v3), then approved
`prototypes/team-v6.html`. Until 2026-10-04 this section called it *"a scoped exception to
« zero gradients, zero shadows » … must not leak into any other screen"*; the same day the
owner made it the house language, and §1–§9 above are its generalisation.

**How `/team` is built — the verbatim-port pattern (§7).** The prototype's stylesheet is ported
rule for rule into `globals.css` (« Salle de contrôle v6 »): every class keeps the prototype's
name with an `r6-` prefix, the prototype's tokens (`--ink`, `--card`, `--w-*`, `--f-*`…) are set
on `.r6`, not `:root`, and element resets are `:where()` so they never beat a prototype rule.
`.r6` keeps the prototype's meta grey `#8A94A6` (3.1:1); the house ramp does not (§2.3).

**Agent colours** — the identity vocabulary of §2.4, defined globally as
`--agent-<key>-{0,1,2,5,7,9}`, stored per agent in `users.color` (a trigger gives a new agent
the least-worn hue of her market, so a colour never moves), handed to an element as
`--a0…--a9` by `lib/team/agent-color.ts`. Performance (`/team/performance`) wears the same
colours.

**Still forbidden here:** an agent hue on a status, a status hue on an agent.
