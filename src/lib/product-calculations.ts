export function calculateVariantCogs(
  unitCogs: number,
  variantQuantity: number
): number {
  if (unitCogs < 0) throw new Error("unitCogs cannot be negative");
  if (variantQuantity < 1) throw new Error("quantity must be at least 1");
  return unitCogs * variantQuantity;
}

/**
 * Whether a variant's `display_price` is the price of the whole pack or the
 * price of a single physical piece. Governs how line revenue is computed.
 */
export type VariantPriceBasis = "pack" | "unit";

export interface VariantLineInput {
  /** Physical units contained in one unit of this variant (pack size). */
  unitsPerPack: number;
  /** Is displayPrice the whole-pack price or the per-piece price? */
  priceBasis: VariantPriceBasis;
  /** The variant's configured selling price (interpreted via priceBasis). */
  displayPrice: number;
  /** Product-level COGS per physical unit. */
  unitCogs: number;
  /** How many packs of this variant the customer bought (defaults to 1). */
  packsOrdered?: number;
}

export interface VariantLine {
  /** Physical stock units → orders.quantity (drives stock deduction & COGS). */
  physicalUnits: number;
  /** Revenue for this line → total_price. */
  lineRevenue: number;
  /** Cost of goods for this line = unitCogs × physicalUnits. */
  lineCogs: number;
  /** Stored unit price so that physicalUnits × unitPrice === lineRevenue. */
  unitPrice: number;
}

/** Round a monetary amount to the OMS currency precision (3 decimals). */
function roundMoney(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Single source of truth for turning a variant selection into the
 * stock/revenue/COGS numbers an order line must store. Used by every order
 * intake path (manual route, webhook, order_items) so they can never diverge.
 *
 * - `physicalUnits = packsOrdered × unitsPerPack` → the stock-and-COGS truth.
 * - `lineRevenue`  depends on `priceBasis`:
 *     'pack' → displayPrice × packsOrdered   (e.g. "2 pieces for 89" → 89)
 *     'unit' → displayPrice × physicalUnits  (per-piece pricing)
 * - `lineCogs = unitCogs × physicalUnits`.
 * - `unitPrice = lineRevenue / physicalUnits` keeps the display invariant
 *   `quantity × unit_price === total_price`.
 */
export function computeVariantLine(input: VariantLineInput): VariantLine {
  const { unitsPerPack, priceBasis, displayPrice, unitCogs } = input;
  const packsOrdered = input.packsOrdered ?? 1;

  if (unitsPerPack < 1) throw new Error("unitsPerPack must be at least 1");
  if (packsOrdered < 1) throw new Error("packsOrdered must be at least 1");
  if (displayPrice < 0) throw new Error("displayPrice cannot be negative");
  if (unitCogs < 0) throw new Error("unitCogs cannot be negative");

  const physicalUnits = unitsPerPack * packsOrdered;
  const lineRevenue = roundMoney(
    priceBasis === "pack"
      ? displayPrice * packsOrdered
      : displayPrice * physicalUnits
  );
  const lineCogs = calculateVariantCogs(unitCogs, physicalUnits);
  const unitPrice = roundMoney(lineRevenue / physicalUnits);

  return { physicalUnits, lineRevenue, lineCogs, unitPrice };
}

export function isLowStock(currentStock: number, threshold: number): boolean {
  if (threshold === 0) return false;
  return currentStock <= threshold;
}

export function calculateStockAfterMovement(
  currentStock: number,
  change: number
): number {
  const result = currentStock + change;
  if (result < 0) throw new Error("stock cannot go below zero");
  return result;
}

export type ProductHealth = "green" | "amber" | "red";

export interface HealthInputs {
  isActive: boolean;
  currentStock: number;
  lowStockThreshold: number;
  marginPct: number | null;
}

export function getProductHealth(input: HealthInputs): ProductHealth {
  if (!input.isActive) return "red";
  if (input.currentStock <= 0) return "red";
  if (input.marginPct != null && input.marginPct < 0) return "red";
  if (isLowStock(input.currentStock, input.lowStockThreshold)) return "amber";
  if (input.marginPct != null && input.marginPct < 5) return "amber";
  return "green";
}
