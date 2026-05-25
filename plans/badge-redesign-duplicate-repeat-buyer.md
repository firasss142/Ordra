# Badge Redesign — Duplicate & Repeat-Buyer

## Context

Two signal badges appear inline after the customer name in both the orders table (`OrderRow.tsx`) and the agent queue card (`OrderCard.tsx`). As of today:

- **RepeatBuyerBadge** — a text pill ("★ 3 orders", "⚠ 2 rejected") using the `Badge` component with `action`, `neutral`, or `critical` tone.
- **DuplicateOrderBadge** — an icon-only 20×20 button (Layers icon) with a tiny count overlay.

**The problems this redesign solves:**

1. The two badges are visually inconsistent — one is a text pill, the other is a square icon button. They look like they belong to two different design systems.
2. The DuplicateOrderBadge's count overlay (`text-[9px]`, `-top-1.5`) is illegible, especially on retina displays and for users with poor eyesight.
3. Together they have no visual grouping — the customer name, city, repeat badge, and duplicate badge are all in a flat `gap-1.5` flex row with no hierarchy.
4. There is zero "responsive" strategy: on narrower viewports (or when a name is long + city + 2 badges all appear), they silently overflow or truncate.
5. The `DuplicateOrderBadge` is an awkward square (not matching the pill shape of `RepeatBuyerBadge`), so the row reads as visually noisy.

---

## Recommended Design Approach

### Principle: Icon-anchored pills, semantic color, shared container

Both badges become **icon + label pills** sharing the exact same visual language as `RepeatBuyerBadge` already has — the `Badge` component shape (`rounded-pill`, `px-2 py-0.5`, `text-[12px]`).

**DuplicateOrderBadge** is redesigned from an icon-only square button to a proper pill, matching `RepeatBuyerBadge`:

```
Before:  [▤]²   ← square icon, tiny count overlay
After:   [▤ 2×]  ← pill with Layers icon + count text ("2×" or "3 dupes")
```

When count is 1 (just one other sibling), the label is omitted and it reads as an icon-only pill — same size as the text pills, no weird counter overlay.

### Icon choices (Lucide, available in the codebase)

| Badge | Current icon | Recommended icon | Why |
|---|---|---|---|
| DuplicateOrderBadge | `Layers` (12px) | `Copy` or `GitFork` | `Layers` is the stack metaphor but `Copy` is immediately understood as "duplicate". `GitFork` evokes "branching orders" for the tech-savvy team. |
| RepeatBuyerBadge — repeat | `Star` (11px) | **Keep `Star`** or upgrade to `Repeat2` | `Repeat2` is more semantically precise (repeat buyer = returning), but `Star` already has good recognition in the existing codebase. |
| RepeatBuyerBadge — likely | `Star` (11px) | `UserCheck` or `RefreshCw` | The "likely" case means "we think this is a repeat" — `UserCheck` reads as "recognized customer". |
| RepeatBuyerBadge — risk | `AlertTriangle` (11px) | **Keep `AlertTriangle`** | Perfect for "rejected history risk". No change needed. |

**Recommended final icons:**
- Duplicate → `Copy` (clearest universal signal for "this is a copy of something")
- Repeat → `Repeat2` (or keep `Star` — both work)
- Likely → keep `Star` with dashed border (established pattern)
- Risk → keep `AlertTriangle`

### Responsive strategy: `shrink-0` + name truncation

The current layout has no overflow protection. The fix is structural:

```tsx
// BEFORE — flat flex row, everything competes
<div className="flex min-w-0 items-center gap-1.5">
  [dot] [name] [city] [RepeatBadge] [DupBadge]
</div>

// AFTER — name truncates, city and badges are shrink-0
<div className="flex min-w-0 items-center gap-1.5">
  [dot]
  <span className="truncate min-w-0">name</span>       ← shrinks first
  <span className="shrink-0 text-ink-secondary">city</span>  ← holds
  <span className="shrink-0 inline-flex gap-1">         ← badge group
    [RepeatBadge shrink-0]
    [DupBadge shrink-0]
  </span>
</div>
```

The badge group wrapper `shrink-0` guarantees both badges are always fully visible — the name truncates before any badge disappears. This is the "no collapse, no overlay" requirement.

In the **queue card** context (narrower, mobile-aware), the existing `flex-col gap-1` container already isolates the name row. No change needed there beyond badge styling.

### Visual unification

Both badges get `shrink-0` on their outer `<span>`. The `DuplicateOrderBadge` trigger becomes a `<span>` styled as a pill (matching `Badge`), not a square `<button>`. It remains keyboard-accessible (`tabIndex={0}`, `onKeyDown` enter/space).

---

## Files to Modify

| File | Change |
|---|---|
| `src/components/shared/DuplicateOrderBadge.tsx` | Restyle trigger from square button → pill. Replace `Layers` with `Copy`. Count rendered as inline text "2×" not overlay. `shrink-0` on outer span. |
| `src/components/shared/RepeatBuyerBadge.tsx` | Optionally swap `Star` → `Repeat2` for `repeat` kind. `Star` → `UserCheck` for `likely` kind. Add `shrink-0` to outer span. No breaking changes to popover logic. |
| `src/components/orders/OrderRow.tsx:204–262` | Wrap the badge group in a `shrink-0 inline-flex gap-1` span. Move customer name to `truncate min-w-0`. |
| `src/components/queue/OrderCard.tsx:311–358` | Same badge group wrapper inside the `flex items-center gap-2 min-w-0` customer name row. |

**NOT changing:** Popover internals, i18n keys, prop interfaces, test fixtures. Pure visual layer.

---

## TDD Checkpoints

Before touching any component file, run: `npm test -- --run` to get a green baseline.

Tests to write first (for visual/structural assertions):
1. `DuplicateOrderBadge` — assert trigger renders as a `span` (not a button) with `role="button"`, contains `Copy` icon aria-hidden, and the count text is a sibling text node (not an overlay).
2. `DuplicateOrderBadge` — when `count > 1`, label text "2×" is visible (queryByText).
3. `OrderRow` customer block — when both badges present, both are still in the DOM when customer name is very long (overflow test using `resize` or container width mock).

---

## Verification

1. `npm test -- --run` — all tests green.
2. `npm run typecheck` — zero errors.
3. Visually: open the orders table in the browser, find a row with both badges. Shrink the browser window to ~900px. Both badges must remain fully visible without truncation.
4. Queue card: confirm `RepeatBuyerBadge` and `DuplicateOrderBadge` render as matching pills side by side.
5. RTL (Arabic market): confirm badges render on the correct side with `shrink-0` preventing layout break.
