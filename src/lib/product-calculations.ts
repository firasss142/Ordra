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
