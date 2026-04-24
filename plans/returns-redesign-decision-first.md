# RETOURS Redesign — Decision-First Workflow

## Goal
Replace the current scan-into-inbox flow with a decision-first UX where every
returned order explicitly gets classified as restock OR damaged with a reason.
Capture optional photo evidence for carrier claims. Support bulk processing.

## Status model (unchanged)
`to_be_returned → returned`. Dual path:
- restock: `products.current_stock += qty`, inventory_log.reason='returned'
- damaged: `products.damaged_return_count += qty`, inventory_log.reason='damaged_writeoff'

## Data model changes

### Migration `20260424_returns_reason_and_photo.sql`
1. Add enum `return_reason`:
   - `packaging` | `product_defect` | `customer_damage` | `carrier_damage` | `other`
2. Extend `inventory_log` with (nullable) columns:
   - `return_reason return_reason NULL`
   - `return_photo_url TEXT NULL`
   - `return_reason_note TEXT NULL` (free text when reason=other)
3. Replace `scan_return_in(p_order_id, p_actor_id, p_is_damaged, p_return_reason, p_return_photo_url, p_return_reason_note)` signature
   - Validation: if `p_is_damaged = true`, `p_return_reason` REQUIRED
   - Validation: if reason=other, `p_return_reason_note` REQUIRED
   - Writes reason/photo/note into inventory_log row
4. NEW view `product_return_rate_view`:
   - product_id, market_id, total_delivered, total_returned, total_damaged,
     return_rate = (returned + damaged) / (delivered + returned + damaged)
   - Only counts orders with created_at < now() - 14d? → keep simple: all-time

### Migration `20260424_return_photos_bucket.sql`
- Create `return-photos` bucket (private, signed URLs only)
- RLS:
  - service role: full write
  - authenticated warehouse roles (warehouse_agent/market_manager/super_admin)
    can SELECT their market's photos (path prefix = market_id/)

## Server layer

### `/api/warehouse/returns/photo` (POST)
- multipart/form-data upload, max 4 MB, jpeg/png/webp only
- Path: `${market_id}/${order_id}/${uuid}.${ext}`
- Returns `{ path, signedUrl, expiresIn }` — signed URL valid 7d for claim packets
- Uses admin client for upload; issues signed URL back to caller

### `/api/warehouse/scan-return` (POST) — extended body
```
{
  order_id: string,
  is_damaged: boolean,
  return_reason?: 'packaging' | 'product_defect' | 'customer_damage' | 'carrier_damage' | 'other',
  return_photo_path?: string,   // path in bucket
  return_reason_note?: string,
}
```
Validation:
- is_damaged=true → return_reason REQUIRED
- return_reason='other' → return_reason_note REQUIRED
- !is_damaged → reason/photo/note optional and stored as NULL

### `/api/warehouse/scan-return/batch` (POST) — NEW
```
{ items: [ { order_id, is_damaged, return_reason?, return_photo_path?, return_reason_note? } ] }
```
Sequentially calls the RPC. Returns per-item result array
`{ order_id, ok, error?, balance_after? }`.
No transaction wrapping — each return is independent; a failed item doesn't
roll back the batch. This matches carrier dispatch behavior (per-order atomic).

### `/api/warehouse/returns/rate?product_id=...` (GET) — NEW
- Reads `product_return_rate_view`
- Cached 60s

## UI

### Page: `/[locale]/warehouse/returns`
Three zones:
1. **Scan / select**: existing scan input + QR scanner. On scan → opens decision card
2. **Decision card (center of UX)**:
   - Order summary (customer, product, qty)
   - Return-rate badge for this product ("this product: 12% return rate, 3/25 returned")
   - Two big radios: [Restock ✓] [Mark Damaged ✗]
   - If damaged: reason picker (4 options + "Autre" with free text)
   - Optional photo: capture or upload; preview thumbnail
   - Actions: [Add to batch] / [Commit now]
3. **Batch tray**:
   - Sticky pill showing "3 retours prêts · Commit batch"
   - Commit: per-item progress, errors surfaced
   - Success: clear tray, refresh queue

### Integration with stock dashboard
Existing `/dashboard/stock` already reads current_stock + damaged_return_count.
Damaged writeoff via this flow will be visible there immediately (same table).
No changes needed in stock page beyond verifying return_reason is not shown
there (belongs in warehouse/history/inventory_log).

## Tests (TDD order)
1. RPC signature test — new params accepted, validation rules firing
2. API route `scan-return` extended body + validation (damaged-without-reason → 400, other-without-note → 400)
3. API route `scan-return/batch` — mixed success/fail, market isolation
4. API route `returns/photo` — validates mime, size, path shape
5. API route `returns/rate` — returns product stats
6. Component `ReturnsDecisionCard` — renders reasons, photo capture, commit/add flows
7. Component `ReturnsBatchTray` — count, commit triggers batch endpoint, errors displayed

## Out of scope (future)
- Carrier claim packet generation (uses `return_photo_url` + inventory_log rows)
- Bulk photo upload in one shot (current spec: per-item)
- Offline queue (warehouse WiFi assumption: always connected)
