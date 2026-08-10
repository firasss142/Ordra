# Orders console — green restyle to match target aesthetic

## Context

The current Orders console (screenshot 1) and the target aesthetic (screenshot 2) render the *same* screen with the same data, controls and information architecture. Every difference is presentational. The gap is four things:

1. **Two accents fight.** The dark sidebar is emerald (`--brand-primary #10B981`), the content is violet (`--oms-accent #6E56CF`). The target unifies on green.
2. **Status badges under-assert.** 20px pills, 11.5px text, an abstract 8×8 `StatusGlyph`, tint-only, no border. The target uses larger outlined pills with a recognisable lucide mark per status.
3. **KPI and pipeline tiles are unadorned.** The target leads each tile with a tinted icon holder, which is what makes the row scannable peripherally.
4. **Rhythm is tight.** Rows, buttons and the search field are ~20% shorter than the target; the pipeline carries `›` separators the target drops.

Two findings make this cheaper than it looks:

- **`docs/design-system.md` §4.17 F-bis has already been rewritten** (uncommitted) to specify exactly the target badge: *"a lucide mark per status, from the single map in `lib/orders/status-presentation`"*, *"every pill now carries a 1px border in its own hue"*, and *"Shape was retired with `StatusGlyph`"*. **None of it is implemented.** `status-presentation.ts` still returns `glyph: StatusGlyphShape` and `OrderStatusBadge` still renders `StatusGlyph`. Much of this work is executing written spec, not inventing one.
- **§4.19 "Tinted icon holder" already sanctions** the 40px `rounded-lg` holder at 10% hue with a 20px lucide icon — again unimplemented in `OrdersKpiStrip`.

Outcome: the Orders console reads as one product with its sidebar, status is legible at a glance and in greyscale, and the codebase ends with *fewer* competing palettes than it started with.

**Non-goals.** No behaviour, data, routing, filter, permission or i18n change. No new fonts. No dark mode. No migration of the ~2,277 inline hexes outside the files listed here.

**Step 0 (per user CLAUDE.md):** copy this plan to `Ordra/plans/orders-console-green-restyle.md` before starting.

---

## 1. Color palette

### 1a. Promote the existing green to a shared brand family

`--prod-brand #15803D` already exists, already documents itself as the accessible grass green, and is already used by the Products console for exactly this job. **Promote it rather than inventing a parallel green** — the codebase's stated rule is one source of truth per token (`globals.css` L93–108).

In `src/app/globals.css`, rename the `--prod-*` block to `--brand-*` and keep `--prod-*` as one-line aliases so the Products console needs zero edits:

| New token | Hex | Role | Contrast |
|---|---|---|---|
| `--brand` | `#15803D` | CTA fill, active tile ring, funnel bars, active nav pill, focus ring | **5.0:1** white-on-fill |
| `--brand-hover` | `#12692F` | CTA hover; text on `--brand-bg` | **6.1:1** on `--brand-bg` |
| `--brand-bg` | `#E9F6EE` | active tile fill, selected row band, icon-holder tint | — |
| `--brand-tint` | `#F1FAF4` | hover wash | — |

- Keep `--brand-primary #10B981` **for the dark sidebar surface only.** On white it is **2.5:1** — it must never be text, nor a fill behind white text, on a light ground. This two-tier split is the single most important accessibility constraint in this plan.
- In `tailwind.config.ts`, add a `brand: { DEFAULT, hover, bg, tint }` family aliasing the vars, and repoint `prod: {...}` at the same vars.

### 1b. Split chrome from status — do **not** repoint `--oms-accent`

`--oms-accent` currently does two unrelated jobs: page chrome *and* the phase-1 status hue (`--hue-violet-*` aliases it; `confirmed` / `callback_scheduled` / `dispatch_scheduled` render from it). Flipping it green would turn `confirmed` green and collide it with `delivered`, and would break the semantics §4.17 C calls out.

- **Chrome → `--brand`.** Active KPI tile, funnel bars, facet-bar active pill, selected row band, primary CTA, focus ring.
- **`--oms-accent` stays violet, demoted to a status hue only.** No token value changes, so `status-contrast.test.ts` keeps passing untouched.

### 1c. Focus ring — fix a real WCAG failure while here

`:focus-visible { outline: 2px solid #36F4A4 }` (globals.css L251) is **1.44:1 against white** — it fails WCAG 2.4.11 (3:1 minimum for focus indicators). Replace with `--brand`:

- `#15803D` on white/`--oms-bg` → **5.0:1** ✓
- `#15803D` on `--sidebar-bg #0E1013` → **3.8:1** ✓

One ring works on both grounds. Add a named `--focus-ring: var(--brand)` so it is greppable. Retire `#36F4A4`.

### 1d. Deliberate deviations from the target (constraints win)

- **Alerts bell badge stays red** (`--critical #D72C0D`), not green. It counts alerts; green would read as "all clear" and contradicts §1's "functional colour only".
- **`confirmed` tile icon holder stays violet, `uploaded` stays teal** (target shows green/blue). §4.19 requires a tile's hue to match the status pill of the rows it opens — a tile and its list must not disagree. The row still reads as colourful: green · amber · red · violet · teal.
- **Source logos untouched.** `/converty.svg` etc. are third-party brand assets.
- **Brand mark is an "O" monogram**, not the target's "D" — an inspiration, not a copied asset.

---

## 2. Typography

Keep Inter / Noto Sans Arabic / Cairo exactly as configured in `src/app/[locale]/layout.tsx`. No new font loading. Adjust the ladder only:

- Page title `22px` → `24px`, `font-semibold`, `tracking-[-0.017em]`.
- KPI value `22px` → `26px`; pipeline value `19px` → `22px`. Both keep `font-[650] tabular-nums`.
- Table column headers `13px` → `11px` uppercase `tracking-[0.06em]`, `text-oms-ink-3`. At 13px the uppercase headers currently out-weigh the row data.
- Status badge text `11.5px` → `12px`.
- Row secondary line `12px` → `12.5px`, `text-oms-ink-3`.
- Tile labels unchanged (`10.5px` uppercase `tracking-[0.075em]`).
- **RTL caution:** apply `tracking-[-0.022em]` only to `.tabular-nums` numeric spans, never to Arabic label text — negative letter-spacing visually breaks cursive joining in Noto Sans Arabic. Audit the tracking utilities added in `OrdersKpiStrip` and `OrderRow` for this.

---

## 3. Component styles

### 3a. Status badges — implement §4.17 F-bis (highest visual impact)

- **`src/lib/orders/status-presentation.ts`** — replace `glyph: StatusGlyphShape` with `icon: StatusIconName` (a string union) on `Base`/`StatusPresentation`. Keep `hue`, `weight`, `counter` and every existing assignment untouched. `OPEN_GLYPHS` is exported — check its consumers before removing.
- **New `src/lib/orders/status-icons.ts`** — `Record<StatusIconName, LucideIcon>`, keeping `lucide-react` out of the lib module the tests import. Proposed map:

  | Status | Icon | | Status | Icon |
  |---|---|---|---|---|
  | `pending`/`new`/`assigned` | `Circle` | | `uploaded` | `UploadCloud` |
  | `attempt_1..3` | `PhoneOutgoing` | | `scanned` | `ScanLine` |
  | `callback_scheduled` | `CalendarClock` | | `dispatched` | `Truck` |
  | `unverified` | `ShieldAlert` | | `deposit` | `PackageCheck` |
  | `confirmed` | `BadgeCheck` | | `in_transit` | `Route` |
  | `dispatch_scheduled` | `CalendarCheck` | | `received` | `PackageOpen` |
  | `delivered` | `CheckCircle2` | | `returned` | `Undo2` |
  | `rejected` | `XCircle` | | `to_be_returned` | `CornerUpLeft` |
  | `cancelled` | `Ban` | | `deleted` | `Trash2` |

  Note `uploaded` reads "Téléchargé" in French but means *uploaded to carrier* — `UploadCloud` is semantically correct; the target's download glyph would be wrong.

- **`src/components/orders/OrderStatusBadge.tsx`** — shell becomes `h-[26px] px-2.5 text-[12px] gap-1.5 rounded-pill border`; icon at `size={13} strokeWidth={2}` in a fixed `w-[13px]` slot (preserves the label-alignment rule). Extend `HUE` with a per-weight `border` step: `quiet` → `/35`, `medium` → `/55`, `loud` → full. Keep `data-weight` / `data-hue` / `aria-label`.
- **`src/components/queue/QueueStatusPill.tsx`** — same treatment against the `hue-*` aliases, so the agent queue cannot drift.
- **Keep `StatusGlyph.tsx`.** `LeadStatusBadge` and `FollowUpStatusBadge` still consume it; migrating CRM/follow-ups is out of scope.

### 3b. `OrdersKpiStrip.tsx` — icon holders, green bars, no chevrons

- Add the §4.19 holder to all seven tiles: `grid h-10 w-10 shrink-0 place-items-center rounded-lg`, background = hue at 10%, icon `size={20} strokeWidth={2}` in the full hue, `aria-hidden`. Tile becomes `flex items-center gap-3`.
  `unassigned` → `UserRoundX` amber · `confirmationRate` → `PieChart` brand · `today` → `CalendarDays` brand · `waiting` → `Hourglass` amber · `toRecall` → `PhoneCall` red · `confirmed` → `BadgeCheck` **violet** · `uploaded` → `UploadCloud` **teal**.
- `tileClass()` — swap `oms-accent` → `brand` for active border / fill / inset ring / focus outline.
- Funnel bars: `var(--oms-accent)` → `var(--brand)` in both the filled and outlined branches, and in the two legend swatches.
- **Delete the `›` separator span** (L192–199); replace the wrapper with `gap-2`.
- Confirmation-rate card: drop `border-dashed bg-oms-sunken` → `border-oms-border bg-oms-surface` with a holder. It stays a `<div>` with **no hover styles at all** — the absence of hover feedback is now the cue that it is a readout, not a control (previously carried by the dashed border). Rate figure and positive delta in `text-brand`.
- Update the loading skeleton block heights to match the taller tiles.

### 3c. `Sidebar.tsx` — filled active pill + brand mark

- Active `SubNavItem`: replace the 2px `borderInlineStart` + 10% tint with a filled pill — `backgroundColor: var(--brand)`, `color: #FFFFFF`, icon `#FFFFFF`, `borderRadius: 8px`, no bar. White on `#15803D` = 5.0:1 ✓.
- Add `--sidebar-active-fill: var(--brand)` rather than hardcoding.
- Brand row: prepend a 28px `rounded-[8px]` `--brand` square holding a white bold "O" before the "Ordra" wordmark.
- `MarketScopeSwitcher`: swap the coloured dot for a flag emoji (🇹🇳 / 🇱🇾), `Globe2` for "all". **Keep the market name text** — the flag is never the sole signal, and emoji flags do not render on Windows.
- Bell badge stays `--critical` (§1d).

### 3d. Table — `OrdersTable.tsx` / `OrderRow.tsx` / `globals.css`

- Replace the inline `headerStyle` object (L207–217) with Tailwind on `oms-*` tokens. Its `background: "#FFFFFF"` currently fights the sticky `<tr>`'s `var(--oms-bg)` — set both to `--oms-bg`. Border → `--oms-border`.
- `.oms-rows` `border-spacing: 0 6px` → `0 4px`; raise cell padding so rows land ~56px. Leave every `[data-selected]` / `[data-highlighted]` / `[data-breach]` rule alone.
- `.oms-row[data-selected]` → `--brand-bg` / `--brand` (was `--oms-accent-bg` / `--oms-accent`).
- `RowKebab`: `opacity-0 group-hover/row:opacity-100` → always visible; keep `aria-haspopup="menu"`.
- Widen the actions column `48` → `56` for a ≥24px hit target (WCAG 2.5.8).
- Fix `TableSkeleton` and `orders/loading.tsx` to the new heights and `--oms-bg` ground.

### 3e. Header, search, chips — `OrdersPageClient.tsx` / `OrdersFilterBar.tsx` / `OrdersFacetBar.tsx`

- "Nouvelle commande": `bg-oms-accent hover:bg-oms-accent-ink` → `bg-brand hover:bg-brand-hover`; both header buttons `h-[34px]` → `h-[38px]`, `rounded-lg`.
- Market status dot under the title → `bg-brand`.
- Search field `h-30` → `h-[38px]`, `rounded-lg`. **Fix the `⌘K` hint — the bound key is actually `/`** (`OrdersFilterBar` L63–76). Replace the kbd label, do not change the binding.
- `OrdersFacetBar` active pill: `border-oms-accent bg-oms-accent-bg text-oms-accent-ink` → the `brand` equivalents; count badge `bg-oms-accent` → `bg-brand`; checkbox `accent-oms-accent` → `accent-brand`.

### 3f. Shared primitives

- **`ui/Button.tsx`** — `primary` variant `bg-ink-primary` → `bg-brand hover:bg-brand-hover`.
  ⚠️ **Required companion edit:** `globals.css` `.agent-theme` re-skins `.bg-ink-primary` with `!important` to produce the agent-queue green. Once `primary` no longer emits `bg-ink-primary`, that rule silently stops applying. Update the `.agent-theme` selector to target the new brand class (or rely on `[data-agent-cta="primary"]`, already in the same rule) and verify `/fr/queue` before and after.
  `OrdersBulkBar` composes `bg-ink-primary` on its own `<div>` and correctly stays dark — do not touch.
- **`ui/Badge.tsx`** — replace the arbitrary `bg-[#EAF2FB]` on the `action` tone with the existing `--prod-info-bg` token (which was added for exactly this). Add the 1px in-hue border so it matches the new status pills.
- **`ui/Toast.tsx`** — `bg-surface-ink` is undefined in `tailwind.config.ts`, so toasts currently render with no background. Point it at `ink.primary`. Pre-existing bug, cheap to fix in this pass.

### 3g. Documentation (required — spec and code must not diverge)

`docs/design-system.md`: amend §4.17 C (violet is now status-only; chrome is `--brand`), §2 Accent (add the `--brand-*` family and the two-tier green rule), §Focus Ring (`#36F4A4` retired), and §9 Quick Reference (its sidebar hexes are already stale — `#1A1A1A` vs the actual `#0E1013`).

---

## 4. Accessibility checklist

- [ ] Focus ring ≥3:1 on both grounds — white 5.0:1, sidebar 3.8:1 (was 1.44:1). WCAG 2.4.11.
- [ ] `#10B981` never used as text, nor as a fill behind white text, on a light ground (2.5:1).
- [ ] White on `--brand` CTA and active nav pill = 5.0:1. WCAG 1.4.3.
- [ ] Status pills keep **icon + text + hue** — colour is never the only signal. Verify each new lucide mark is distinguishable in greyscale.
- [ ] `aria-label` with the attempts counter preserved on `OrderStatusBadge` ("Tentative 2, 2/8" as one phrase).
- [ ] Icon holders and their glyphs `aria-hidden="true"`.
- [ ] Checkbox and always-on kebab hit targets ≥24×24 after the row-height change. WCAG 2.5.8.
- [ ] All new spacing uses logical properties (`ps/pe/ms/me`, `border-inline-*`) — verified in the `ar` locale.
- [ ] Market flag emoji never the sole identifier; the market name stays.
- [ ] Extend `src/lib/orders/status-contrast.test.ts` `PAIRS` with `["brand", "brand-hover", "brand-bg"]`. **Keep every token a literal `#RRGGBB`** — the test `throw`s on `hsl()`/`oklch()`/triplets.
- [ ] No new motion; nothing added outside a `prefers-reduced-motion` guard.

---

## 5. Files to modify

**Tokens** · `src/app/globals.css` · `tailwind.config.ts`
**Status** · `src/lib/orders/status-presentation.ts` · `src/lib/orders/status-icons.ts` *(new)* · `src/components/orders/OrderStatusBadge.tsx` · `src/components/queue/QueueStatusPill.tsx`
**Orders page** · `src/components/orders/OrdersKpiStrip.tsx` · `OrdersTable.tsx` · `OrderRow.tsx` · `OrdersFacetBar.tsx` · `OrdersFilterBar.tsx` · `src/app/[locale]/(dashboard)/orders/OrdersPageClient.tsx` · `orders/loading.tsx`
**Shell** · `src/components/layout/Sidebar.tsx` · `MarketScopeSwitcher.tsx`
**Primitives** · `src/components/ui/Button.tsx` · `Badge.tsx` · `Toast.tsx`
**Docs** · `docs/design-system.md`

Reuse rather than rebuild: `presentStatus()`, `AGE_TONE` (`lib/orders/order-age.ts`), `AgentAvatar`, `SourceLogo`, `ProductAvatar`, `Pagination`, `StatusHistoryPopover`, `MetricTile`'s icon-holder classes, and the whole `--prod-*` green — all stay as-is or are aliased.

---

## 6. Execution order (TDD — `Ordra/CLAUDE.md` marks this non-negotiable)

1. Extend `status-contrast.test.ts` with the brand pair → watch it fail → add the `--brand-*` tokens.
2. Extend `OrderStatusBadge.test.tsx` to assert a lucide icon renders and that border opacity steps with `weight` → watch it fail → migrate `status-presentation` + the two badge components.
3. Tokens and Tailwind aliases; focus ring.
4. `OrdersKpiStrip` (icon holders, green bars, chevrons removed) — `OrdersKpiStrip.test.tsx` must stay green.
5. Table, rows, `.oms-rows` metrics, skeletons.
6. Header, search, facet bar.
7. `Sidebar` + `MarketScopeSwitcher` — `sidebar.test.tsx` and `market-scope-switcher.test.tsx` pin this markup; expect edits.
8. `Button` / `Badge` / `Toast` **plus the `.agent-theme` companion rule.**
9. `docs/design-system.md`.

---

## 7. Verification

- `npm run test:run` — full suite. Watch specifically: `status-contrast.test.ts`, `OrderStatusBadge.test.tsx`, `OrdersKpiStrip.test.tsx`, `OrderRow.test.tsx`, `sidebar.test.tsx`, `market-scope-switcher.test.tsx`, `OrdersFacetBar.test.tsx`, `Button.test.tsx`, `Badge.test.tsx`, `Toast.test.tsx`.
- `npm run typecheck` → `npm run lint` → `npm run build`.
- `npm run dev`, then via Playwright MCP as `admin@oms.local / testpass123`:
  - `/fr/orders` — screenshot, compare against the target image side by side.
  - `/ar/orders` — confirm the full RTL mirror: icon holders, pill icons, active nav pill, row bands.
  - `/fr/queue` — **the `.agent-theme` regression check** for the `Button` change.
  - `/fr/products` — confirm the `--prod-*` → `--brand-*` aliasing changed nothing.
  - `/fr/dashboard` — confirm no unintended accent bleed.
- Manual: tab through `/fr/orders` and confirm the ring is visible on the white ground, on a green button, and in the sidebar. Select a row (brand band). Find a `>24h` unconfirmed order and confirm the SLA breach stripe survives the `border-spacing` change. Toggle a KPI tile and a facet pill for the brand active state.
