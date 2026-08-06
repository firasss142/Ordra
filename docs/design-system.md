# Design System — OMS Admin Interface

> Shopify admin-inspired operational dashboard. Dark sidebar, light content, white cards. Maximum contrast, zero decoration.

---

## 1. Philosophy

Three rules govern every decision:

1. **Restraint.** Every element earns its place. No gradient or decorative color. Resting surfaces are flat; **hover and floating surfaces use a calibrated elevation scale** (`shadow-hover-row`, `shadow-panel`, `shadow-floating`) — never as decoration, only to signal interactivity or layering.
2. **Light content, dark sidebar.** The sidebar (`#1A1A1A`) is the only dark surface. Content areas are always light (`#F6F6F7`) with white cards.
3. **Functional color only on status — and one accent.** Status badges carry semantic color (success/warning/critical/action). A single brand accent (`#10B981`) appears in **exactly two places**: (a) the focused-row inline-start bar in agent lists, (b) the active-tab underline. Nowhere else. Everything else is black, white, or gray.

---

## 2. Color Tokens

All tokens are CSS custom properties defined in `src/app/globals.css`.

### Surfaces

| Token | Hex | Role |
|---|---|---|
| `--bg-page` | `#F6F6F7` | Page background (light gray) |
| `--bg-card` | `#FFFFFF` | Cards, panels, modals |
| `--bg-hover` | `#F7F7F7` | Row/item hover state |
| `--bg-selected` | `#F2F2F2` | Selected/active item background |
| `--surface-sunken` / `bg-surface-sunken` | `#FAFAFB` | Skeleton blocks, empty-state wells |

### Charts (neutral, non-status)

| Token | Hex | Role |
|---|---|---|
| `--chart-line` / `text-chart-line` | `#8C9196` | Sparkline strokes, axis ticks — never a status color |

### Text

| Token | Hex | Role |
|---|---|---|
| `--text-primary` | `#1A1A1A` | All headings, body, labels |
| `--text-secondary` | `#6D7175` | Muted labels, metadata, timestamps |

### Borders

| Token | Hex | Role |
|---|---|---|
| `--line-subtle` / `line-subtle` | `#ECEEF0` | Whisper-thin border for cards and list rows (default for new components) |
| `--border` / `line.DEFAULT` | `#E1E3E5` | Standard border (legacy, inputs, dividers) |
| `--border-strong` / `line-strong` | `#DADCE0` | Emphasized dividers, hover state on subtle borders |

### Accent

| Token | Hex | Role |
|---|---|---|
| `accent.DEFAULT` | `#10B981` | Brand accent — used **only** for focused-row bar and active-tab underline |
| `accent.soft` | `rgba(16,185,129,0.10)` | Reserved for accent-soft fill if ever needed; do not use decoratively |

### Elevation

Resting cards remain flat. Three calibrated shadow tokens are available:

| Token | Value | Use |
|---|---|---|
| `shadow-hover-row` | `0 1px 2px rgba(16,24,40,0.04)` | Interactive list rows on hover |
| `shadow-panel` | `0 4px 16px rgba(16,24,40,0.06)` | Side drawers (e.g. OrderDetailPanel) |
| `shadow-floating` | `0 8px 24px rgba(16,24,40,0.10)` | Modals, bulk-action bars, dropdowns |

### Sidebar (dark surface)

| Token | Hex | Role |
|---|---|---|
| `--sidebar-bg` | `#1A1A1A` | Sidebar background |
| `--sidebar-text` | `#E3E5E7` | Sidebar primary text |
| `--sidebar-text-muted` | `#8C9196` | Sidebar secondary text |
| `--sidebar-hover` | `#2A2A2A` | Nav item hover |
| `--sidebar-active` | `#333333` | Nav item active background |

### Status Colors (badges only — never decorative)

| Token | Hex | Background Token | Role |
|---|---|---|---|
| `--action` | `#2C6ECB` | — | Blue — action, info, assigned |
| `--action-hover` | `#1F5199` | — | Blue hover state |
| `--success` | `#008060` | `--success-bg: #F1F8F5` | Green — confirmed, delivered |
| `--warning` | `#B98900` | `--warning-bg: #FFF8E6` | Amber — attempts, callbacks |
| `--critical` | `#D72C0D` | `--critical-bg: #FFF4F4` | Red — rejected, cancelled |
| `--neutral` | `#6D7175` | `--neutral-bg: #F6F6F7` | Gray — new, neutral |

### Focus Ring

```css
:focus-visible {
  outline: 2px solid #36F4A4; /* Neon Green */
  outline-offset: 2px;
}
```

`#36F4A4` appears **only** as the keyboard focus ring. Never used as a fill, background, or decorative color.

---

## 3. Typography

**Font stack:** `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`

**Base:** `14px` / `400` / `#1A1A1A`

All UI strings use `next-intl useTranslations()` — no hardcoded text in components.

### Size Scale

| Role | Size | Weight | Color | Notes |
|---|---|---|---|---|
| Page title | 20px | 600 | `--text-primary` | H1 equivalent |
| Section heading | 16px | 600 | `--text-primary` | Card/panel headers |
| Body | 14px | 400 | `--text-primary` | Default |
| Label | 13px | 500 | `--text-secondary` | Uppercase, 0.05em tracking |
| Caption | 12px | 500 | `--text-secondary` | Metadata, timestamps |
| Badge | 13px | 500 | (semantic) | Status badge text |
| KPI value | 24px | 700 | `--text-primary` | Dashboard stats |

### Number Formatting

Use `font-variant-numeric: tabular-nums` on all numeric data (prices, counts, stats). Proportional figures everywhere else.

---

## 4. Component Patterns

### Buttons

**Primary**
- Background: `#1A1A1A`
- Text: `#FFFFFF`
- Border-radius: `4px`
- Padding: `10px 16px`
- Hover: `background: #2A2A2A`
- Disabled: `background: #F3F4F6`, `color: #9CA3AF`, `cursor: not-allowed`

**Secondary / Outline**
- Background: `#FFFFFF`
- Border: `1px solid #D1D5DB`
- Text: `#1A1A1A`
- Border-radius: `4px`
- Hover: `background: #F7F7F7`

**Destructive**
- Background: `#D72C0D`
- Text: `#FFFFFF`
- Use only for irreversible actions

### Cards

- Background: `#FFFFFF`
- Border: `1px solid #E1E3E5`
- Border-radius: `6px` standard, `8px` large panels
- Padding: `16px`
- **No shadow at rest.** No box-shadow unless element is floating (modal, dropdown).
- Hover (interactive cards): `background: #FAFBFB`

### Inputs & Forms

- Height: `32px`–`36px`
- Padding: `0 8px`–`0 10px`
- Background: `#FFFFFF`
- Border: `1px solid #D1D5DB`
- Border-radius: `6px`
- Color: `#1A1A1A`
- Placeholder: `#6D7175`
- Focus: neon green outline via global `:focus-visible` rule — do not override
- Error: border `#D72C0D`

**Labels:** sit above at `13px`/`500`/`#6D7175`, `margin-bottom: 4px`.

### Status Badges

Two sizes:
- **Inline dot:** 8×8px SVG colored circle + `13px`/`500` text, `gap: 6px`
- **Pill badge:** `background: --*-bg`, `color: --*`, `border-radius: 9999px`, `padding: 2px 8px`, `font-size: 13px`/`500`

Badge colors come exclusively from the status token pairs — see §2 Status Colors.

### Tables

- Header `<th>`: `13px`/`500`/`#6D7175`, uppercase, `letter-spacing: 0.05em`, `padding: 12px 16px`, `border-bottom: 1px solid #D1D5DB`
- Data `<td>`: `14px`/`400`/`#1A1A1A`, `padding: 12px 16px`, `border-bottom: 1px solid #E1E3E5`
- Row background: `#FFFFFF`; hover: `#F7F7F7`
- Numeric columns: right-aligned, `font-variant-numeric: tabular-nums`

### Modals / Dialogs

- Overlay: `rgba(26, 26, 26, 0.5)`
- Panel: `background: #FFFFFF`, `border-radius: 8px`, `width: 480px`, `max-width: 90vw`
- Header: `padding: 16px 20px`, `border-bottom: 1px solid #E5E7EB`
- Body: `padding: 20px`
- Shadow: `0 8px 32px rgba(0,0,0,0.18)` — **only floating surfaces get shadow**
- Focus trap required; `Escape` closes

### 4.9 Panel variant — side-drawer composition

For long-form right-edge panels (e.g. `OrderDetailPanel`), surfaces follow the same flat-white grammar as cards, but the **hero card** at the top of the panel uses a subtle elevation to anchor the customer's identity:

- Drawer: `fixed top-0 end-0 h-full w-full sm:w-[480px] bg-surface-card border-s border-line-subtle shadow-panel`
- Sticky header band: `h-[56px] bg-surface-card border-b border-line-subtle px-4`
- Hero card: `mx-4 mt-3 rounded-card bg-surface-card border border-line-subtle px-4 py-4 shadow-panel-elevated`
- Body: `flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3` — **12px gap** between cards, no internal dividers
- Footer: `flex-shrink-0 bg-surface-card border-t border-line-subtle px-4 py-3`

The `shadow-panel-elevated` token (`0 6px 20px rgba(16,24,40,0.08)`) is the **only** rest-state shadow allowed in the system, and it appears **only** on the panel hero card to telegraph identity. Body section cards remain flat (`shadow-none`).

### 4.10 Section label + icon

Section identity inside a panel is communicated through a tiny uppercase label paired with a single 12px lucide icon — **never** through tinted backgrounds. All section cards are pure white:

- Card: `rounded-card bg-surface-card border border-line-subtle p-4`
- Label row: `flex items-center gap-1.5 mb-3`
- Icon: `<Icon size={12} strokeWidth={2} className="text-ink-muted" />`
- Label: `text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted`

Examples: Customer = `User`, Address = `MapPin`, Order = `ShoppingBag`, Note = `StickyNote`, History = `Clock`, Fulfillment = `Truck`. Never tint a section background to signal "kind of content" — the label + icon does that job.

### 4.11 Tabs (underline)

The accent green's reserved "active-tab underline" slot is implemented by underline tabs (see `OrdersPresetPills`). Pills-as-tabs are deprecated.

- Container: `role="tablist"`, `flex items-end gap-1`, sits on a row with `border-b border-line` as the shared baseline
- Tab: `px-3 pt-1.5 pb-2 text-[13px]`, inactive `font-medium text-ink-secondary hover:text-ink-primary`, active `font-semibold text-ink-primary`
- Active indicator: absolutely-positioned `inset-x-2 bottom-0 h-[2px] bg-accent rounded-pill` — the **only** place the accent underline appears
- Count badge inside a tab: neutral pill `bg-surface-selected text-ink-secondary text-[11px] tabular-nums`
- Keep `role="tab"` / `aria-selected`

### 4.12 Skeleton loading

Use `src/components/ui/Skeleton.tsx` — `bg-surface-sunken rounded-[6px] animate-pulse`, `aria-hidden`. Size with `h-* w-*` utilities. Wrap a group of skeleton rows in a container with `role="status"`. Never ship text-only "loading…" placeholders in cards or tables.

### 4.13 Slide-over panel (generalized from §4.9)

Right-edge overlay surface for tool panels that aren't order details (e.g. `AlertsPanel`):

- Backdrop: `fixed inset-0` `rgba(26,26,26,0.5)`, click closes
- Panel: `fixed top-0 end-0 h-full w-full sm:w-[440px] bg-surface-card border-s border-line-subtle shadow-panel` (440px for tool panels; 480px stays for the order drawer)
- `role="dialog"` + `aria-modal="true"`; Escape closes — register the key handler in the **capture** phase so a drawer underneath doesn't also close (topmost surface wins)
- Header band `h-[56px] border-b border-line-subtle px-4`; body `flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3`
- Focus the close button on open

### 4.14 Bell + count badge (dark surface)

Sidebar-header notification affordance (`AlertsBell`):

- Button: 28×28, `border: 1px solid var(--sidebar-border-strong)`, transparent background, `var(--sidebar-text)` icon
- Count badge: absolute top-end, `min-width 15px`, `border-radius: 9999px`, `background: var(--critical)`, white 9.5px text, `tabular-nums`, caps at "99+"
- The badge is a live count, not decoration — it uses the critical status token because it demands action

---

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
a date — stays `ink-primary`. This is §1 rule 3 ("functional color only on status")
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

`hover:shadow-hover-row transition-shadow duration-fast` on cards that navigate. This is
already sanctioned by §2 for interactive rows; it is listed here only to confirm that a
product card counts as one. **Resting non-interactive cards stay flat** — no change.

A tappable card must be a real `<Link>` or `<button>`, never a `<div onClick>`, so it
receives the global `:focus-visible` ring and works from a keyboard.

### Hero type scale

**One** figure per screen may use the `KpiCard` scale (`text-[28px] font-bold tabular-nums
leading-[1.1]`) — the single number that screen exists to answer. Portfolio: available
balance. Withdrawals: withdrawable amount. A second hero on the same screen means neither
is one.

### Still forbidden here

Gradients · accent green `#10B981` outside its two reserved slots · colour as decoration ·
shadows on resting non-interactive cards · hardcoded strings · physical CSS properties.
The portal is the OMS's only mobile-first *and* RTL-load-bearing surface, so logical
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

Body sections use `gap-5` (20px) instead of the §4.13 drawer default of `gap-3`, and prose
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
not section backgrounds and remain allowed) · gradients · accent green outside its two
reserved slots · shadows on resting cards · hardcoded strings · physical CSS properties.

---

## 4.17 Orders console — scoped extension

The orders list is the one screen an ops dispatcher stares at all day while triaging a
multi-thousand-row backlog. Applied unchanged, the admin grammar rendered every field at the
same weight: a 24-character Mongo ObjectId won the visual hierarchy, the price lost, and an
absolute timestamp gave no sense of how long an order had been rotting.

The console inherits the whole system **except** the allowances below, which apply **only**
under `src/components/orders/**` and the orders route. Nothing here relaxes the rules elsewhere.

### A. Warm ground

The console runs on a warmer, lower-contrast ground than `--bg-page`, so white row bands read
as objects sitting on a surface rather than as the surface itself.

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

| Token | Hex | Role |
|---|---|---|
| `--oms-accent` | `#6E56CF` | Active KPI tile, funnel bars, focus ring |
| `--oms-accent-ink` | `#513FA8` | Accent text on `--oms-accent-bg` |
| `--oms-accent-bg` | `#F1EEFC` | Active tile fill |

> **Open question.** The global brand accent is emerald `#10B981` (sidebar active bar, brand
> tokens). Violet was carried over from the approved prototype and currently sits beside an
> emerald sidebar. Either reconcile the two or accept the console as a deliberately distinct
> surface — this is a live decision, not a settled rule.

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

Consistent with §1: resting surfaces are flat. Row bands and tiles take `shadow-hover-row`
**on hover only**. Twenty-five resting shadows in a list is decoration; one under the cursor
is feedback.

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

---

## 5. Layout

### Shell Structure

```
┌──────────────────────────────────────────────┐
│ Sidebar (240px, #1A1A1A, 100vh, fixed)       │
│  Logo                                         │
│  Nav items                                    │
│  User menu                                    │
├──────────────────────────────────────────────┤
│ Content (flex: 1, marginInlineStart: 240px)  │
│  Topbar (56px, #FFFFFF, border-bottom)        │
│  Page content (#F6F6F7 background)            │
└──────────────────────────────────────────────┘
```

### Sidebar

- Width: `240px`, fixed
- Background: `#1A1A1A`
- Nav item: `padding: 8px 16px`, `font-size: 14px`
- Active: `background: #333333`, `border-inline-start: 2px solid #FFFFFF`, `font-weight: 500`
- Hover (inactive): `background: #2A2A2A`
- User menu at bottom: `padding: 16px`, `border-top: 1px solid #2A2A2A`

### Topbar (agent shell only)

Manager/admin pages have **no global topbar** — `DashboardChrome` renders only the sidebar and the content area; the alerts bell and user menu live in the sidebar. The topbar spec below applies to the agent shell (`AgentDashboardShell`) only:

- Height: `56px`
- Background: `#FFFFFF`
- Border-bottom: `1px solid #E1E3E5`
- Padding: `0 24px`

### Page Content Area

- Background: `var(--bg-page)` / `#F6F6F7`
- Padding: `24px` standard
- Cards sit on `#F6F6F7` background

### RTL Support

Use **logical CSS properties** everywhere — never physical (`left`/`right`):

| Physical | Logical |
|---|---|
| `margin-left` | `margin-inline-start` |
| `padding-right` | `padding-inline-end` |
| `border-left` | `border-inline-start` |
| `left: 0` | `inset-inline-start: 0` |

Set `direction: rtl` on the root element for Arabic locale. All layout flips automatically with logical properties.

---

## 6. Spacing & Radius

### Spacing (8px base)

| Value | Use |
|---|---|
| `4px` | Tight icon gaps, badge padding |
| `8px` | Base unit — gaps between inline elements |
| `12px` | Card gaps, compact padding |
| `16px` | Standard padding — cards, form fields |
| `20px` | Modal body padding |
| `24px` | Page padding, section gaps |
| `32px` | Between major sections |
| `48px` | Between page-level sections |

### Border Radius

| Value | Use |
|---|---|
| `4px` | Buttons, inputs, small controls |
| `6px` | Cards, dropdowns, standard containers |
| `8px` | Modals, large panels |
| `9999px` | Pill badges only |

**Sharp corners (0px) are forbidden on interactive elements.**

---

## 7. Styling Conventions

### Tailwind utility classes (default for new components)

New components use **Tailwind utility classes** referencing the semantic tokens defined in `tailwind.config.ts` (`bg-surface-card`, `border-line-subtle`, `text-ink-primary`, `rounded-card`, `shadow-hover-row`, etc.). Inline `style={}` is reserved for **dynamic computed values only** (avatar bg color, sparkline width, focused-bar accent toggle).

```tsx
// correct — semantic tokens, not raw colors
<div className="bg-surface-card border border-line-subtle rounded-card p-4 hover:shadow-hover-row transition-shadow duration-fast">

// wrong — raw Tailwind colors bypass the design tokens
<div className="bg-white border border-gray-200 rounded-md">

// acceptable — inline style for a value that must be computed at runtime
<div style={{ backgroundColor: getProductAvatarColor(name) }}>
```

Legacy components (built before this convention) may still use inline `style={{ ... }}` with CSS custom properties — they should be migrated to Tailwind opportunistically when otherwise modified.

### Interaction States

Handle hover/focus via JavaScript event handlers with `useState`:

```tsx
const [hovered, setHovered] = useState(false);

<button
  style={{ background: hovered ? '#2A2A2A' : '#1A1A1A' }}
  onMouseEnter={() => setHovered(true)}
  onMouseLeave={() => setHovered(false)}
>
```

Do **not** override `:focus-visible` — the global Neon Green ring from `globals.css` applies automatically.

### Motion

Minimal. Only two transitions are used:
- Hover state: `transition: background-color 120ms ease, border-color 120ms ease`
- Drag feedback: `transition: border-color 120ms ease`

No entrance animations, page transitions, or transforms.

---

## 8. Do's and Don'ts

### Do

- Keep background of all content areas `#F6F6F7` (page) or `#FFFFFF` (cards)
- Use `#1A1A1A` for all primary text — near-black, never pure black or gray
- Use `border-line-subtle` (`#ECEEF0`) for new cards and list rows; reserve `border-line` (`#E1E3E5`) for inputs and legacy surfaces
- Apply status badge colors only to convey order status — never decoratively
- Use `shadow-hover-row` on interactive list items on hover; `shadow-floating` on bulk bars and modals
- The accent green (`#10B981`) appears in exactly **two** places: the focused-row inline-start bar and the active-tab underline
- Use logical CSS properties (`ps-`, `pe-`, `start-`, `end-`, `margin-inline-start`, `inset-inline-end`) for RTL safety
- Use `font-variant-numeric: tabular-nums` (Tailwind: `tabular-nums`) for all numeric data
- Keep the sidebar the **only** dark surface; never add dark backgrounds to content
- Focus ring is automatic — never manually style `:focus`

### Don't

- Don't add shadows to resting cards — flat surfaces by default; elevation appears only on hover/floating
- Don't use gradients anywhere
- Don't add color for decoration — color only where it communicates status
- Don't sprinkle the accent green (`#10B981`) anywhere except the focused-row bar and active-tab underline
- Don't use physical CSS properties (`left`, `right`, `margin-left`) — use logical equivalents
- Don't put Neon Green (`#36F4A4`) anywhere except the keyboard focus ring
- Don't hardcode UI strings — all text through `useTranslations()`
- Don't bypass the semantic Tailwind tokens — use `bg-surface-card`, not `bg-white`; `border-line-subtle`, not `border-gray-200`
- Don't animate more than background-color, border-color, opacity, transform, and box-shadow

---

## 9. Quick Reference

Copy-paste values for common use:

```css
/* Surfaces */
--bg-page: #F6F6F7;
--bg-card: #FFFFFF;
--bg-hover: #F7F7F7;
--bg-selected: #F2F2F2;
--sidebar-bg: #1A1A1A;
--sidebar-hover: #2A2A2A;
--sidebar-active: #333333;

/* Text */
--text-primary: #1A1A1A;
--text-secondary: #6D7175;
--sidebar-text: #E3E5E7;
--sidebar-text-muted: #8C9196;

/* Borders */
--border: #E1E3E5;
--border-strong: #C9CCCF;

/* Status (badges only) */
--action: #2C6ECB;
--success: #008060;       --success-bg: #F1F8F5;
--warning: #B98900;       --warning-bg: #FFF8E6;
--critical: #D72C0D;      --critical-bg: #FFF4F4;
--neutral: #6D7175;       --neutral-bg: #F6F6F7;

/* Focus (global, do not override) */
/* :focus-visible { outline: 2px solid #36F4A4; outline-offset: 2px; } */
```

### Example Prompts

- *"Create a card on `#F6F6F7` with `background: #FFFFFF`, `border: 1px solid #E1E3E5`, `border-radius: 6px`, `padding: 16px`. Heading `16px/600/#1A1A1A`, body `14px/400/#1A1A1A`, label `13px/500/#6D7175`. No shadow."*

- *"Design a status badge for 'confirmed': `background: #F1F8F5`, `color: #008060`, `border-radius: 9999px`, `padding: 2px 8px`, `font-size: 13px`, `font-weight: 500`."*

- *"Build a sidebar nav item: `padding: 8px 16px`, `font-size: 14px`, `color: #E3E5E7`. Active state: `background: #333333`, `border-inline-start: 2px solid #FFFFFF`, `font-weight: 500`. Hover: `background: #2A2A2A`."*

- *"Create a data table. `<th>`: `13px/500/#6D7175`, uppercase, `letter-spacing: 0.05em`, `padding: 12px 16px`. `<td>`: `14px/400/#1A1A1A`, `padding: 12px 16px`. Row hover: `background: #F7F7F7`."*
