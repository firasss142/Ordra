# Agent Queue Card — Redesign (Quantity · Product Name · Carrier Logo · Polish)

## Context

The agent confirmation-queue card (`OrderCard`) is the row an agent scans dozens of times a
day while phoning customers. The user wants a refresh inspired by a clean, flat table-row
design (checkbox · ref · product thumbnail with `×N` · customer · date · **carrier logo** ·
status · price). The user chose to **keep the existing bordered-card style** (per-bucket color
borders + bold price) and apply a **light-touch** polish — not a flat-table rewrite. Three
substantive additions plus minor polish:

1. **Quantity `×N`** overlaid on the product thumbnail corner — agents can't currently see if
   an order is multi-unit (changes the call + the total quoted). Always shown, incl. `×1`.
2. **Product name** as a muted secondary line under the bold customer name — today the card
   shows a thumbnail and (desktop-only) variant, but never the product name.
3. **Carrier (delivery company) logo** shown whenever an order is tied to a carrier — so once
   an order is uploaded/dispatched/etc. the agent sees which delivery company has it. **Logo
   only, no name.**

## Decisions locked with the user

- **Quantity**: add to data + show `×N`; **always shown, including `×1`**; **overlaid on the
  product-thumbnail corner**.
- **Product name**: show as a **muted secondary line under the customer name** (customer name
  stays the bold primary anchor). Fold the existing variant label into this line.
- **Carrier logo**: show **logo only (no name)**, **whenever a carrier is assigned**
  (`carrier_id` set → uploaded, dispatched, deposit, in_transit, delivered, returned).
  Logos come from a **static `code → asset` map** (the existing repo convention); user will
  provide logo files for carriers that lack one. Carriers with no asset get a neutral fallback.
- **Carrier API join**: **yes**, add a carriers join to the agent-queue API (it isn't fetched
  today) and add carrier fields to `QueueOrder`.
- **Layout**: keep card style; **light-touch** typography/spacing polish only (bold price,
  borders unchanged).

## Findings from exploration (verified against live DB + code)

- `orders.quantity` is `INTEGER`; the queue API already selects `*`
  (`src/app/api/agent/queue/route.ts:47,52`), so **quantity already reaches the client** — only
  a type declaration is missing. No migration/query change for qty.
- `product_name` is already on `QueueOrder` and already fetched — just never rendered.
- **Carriers have NO logo column** (confirmed on live DB `vshynigvgrlihngozuwb`). Columns:
  `id, market_id, name, code, api_endpoint, api_credentials, delivery_fee, return_fee,
  is_active, created_at, updated_at, carrier_type, sender_name, sender_location, api_base_url,
  api_key_encrypted`. Four carriers exist: Navex (`navex`), TestCarrier3 (`TC3`),
  Cosmos (`cosmos`), Dexpress (`dexpress`).
- **Existing logo convention**: `src/components/settings/carriers/CarrierHealthBadge.tsx:5`
  uses a static `Record<string,string>` map (`navex: "/navex-logo.png"`) rendered via
  `next/image`. Only `public/navex-logo.png` exists today — cosmos/dexpress/TC3 have no asset.
- The agent queue does **not** expose carrier identity: `QueueOrder` has no `carrier_id` or
  carrier `code`, and the queue select has no carriers join. `orders.carrier_id` (UUID FK)
  exists but isn't selected as a usable code.
- Queue flatten pattern to mirror: `flattenImage` at `route.ts:83-87` strips the joined
  `product` and sets `product_image_url`.

## Files to modify

### 1. `src/lib/carriers/carrier-logos.ts`  (NEW — shared logo map + resolver)
Create a single source of truth for carrier `code → logo asset`. Mirror the existing map:
```ts
export const CARRIER_LOGOS: Record<string, string> = {
  navex: "/navex-logo.png",
  // cosmos: "/cosmos-logo.png",   // add when asset provided
  // dexpress: "/dexpress-logo.png",
};
export function getCarrierLogo(code: string | null | undefined): string | null {
  if (!code) return null;
  return CARRIER_LOGOS[code] ?? null;
}
```

### 2. `src/app/api/agent/queue/route.ts`  (carriers join + flatten)
- Extend **both** select strings (lines 47 and 52):
  `"*, product:products(image_url), carrier:carriers(code,name)"`.
- Extend `RawRow`/`FlatRow` and the flatten mapper so each row gets `carrier_code` +
  `carrier_name` (same pattern as `product_image_url`).

### 3. `src/types/queue.ts`  (3 new fields)
```ts
quantity: number;
carrier_code: string | null;
carrier_name: string | null;   // a11y alt text even though we show logo-only
```

### 4. `src/components/queue/OrderCard.tsx`  (the UI)
- (a) `×N` qty badge overlaid on the thumbnail corner (both image + initials branches; always
  shown). Logical `-end-1` for RTL; `tabular-nums` + `Intl.NumberFormat(locale)`.
- (b) Product name as a muted secondary line under the customer name; fold variant into it and
  remove the standalone desktop variant span (lines 406–414) to avoid duplication.
- (c) Carrier logo trailing column (before the status sign), logo-only via `getCarrierLogo`,
  neutral 3-letter fallback chip when no asset, hidden when no carrier. `next/image`.
- (d) Light polish only: `leading-tight` on stacked lines; keep bold price/borders/colors.

## RTL / i18n / design-system notes
- Logical properties only (`-end-1`, `ps/pe/ms`).
- **No new translation keys** (`×N` numeric; product/carrier name are data). `alt`/`title` on
  logo; `aria-label` on qty badge.
- Neutral design tokens only — no gradients/shadows/decoration.

## Assets the user must provide (optional per carrier)
- `public/cosmos-logo.png` and `public/dexpress-logo.png`. Until then those carriers show the
  neutral 3-letter fallback; Navex shows its existing logo. Nothing breaks without the assets.

## Out of scope
- No flat-table rewrite, no price/border restyle, no `logo_url` DB column/migration, no removal
  of existing fields/behaviors.

## Verification
1. `npm run typecheck`, `npm run lint`, `npm run build`.
2. `npm test` — update the queue-order test factory (`src/test/helpers/`) with the 3 new
   fields; extend `OrderCard.test.tsx` (qty badge via `getByLabelText("×2")`, product-name
   line, carrier logo via `getByAltText("Navex")`, no-carrier shows none).
3. Manual golden path (`agent1.tn@oms.local / testpass123`): qty badge, product line (no dup
   variant), carrier logo on uploaded/dispatched orders, all existing affordances intact.
4. RTL (`agent1.ly@oms.local`): badge mirrors, logo/product align right.
5. Responsive: mobile / tablet / desktop (carrier logo is sm+).
