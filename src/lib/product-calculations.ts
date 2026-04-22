export function calculateVariantCogs(
  unitCogs: number,
  variantQuantity: number
): number {
  if (unitCogs < 0) throw new Error("unitCogs cannot be negative");
  if (variantQuantity < 1) throw new Error("quantity must be at least 1");
  return unitCogs * variantQuantity;
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
