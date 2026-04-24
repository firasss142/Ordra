export type HealthClass = "out" | "low" | "healthy" | "overstocked";

export const LOW_DAYS_OF_SUPPLY = 14;
export const OVERSTOCK_DAYS_OF_SUPPLY = 90;
export const DAMAGED_OUTLIER_FLOOR = 0.1;
export const DAMAGED_OUTLIER_MULTIPLIER = 2;

export function avgDailySales(scanOutQty: number, windowDays: number): number {
  if (windowDays <= 0 || scanOutQty <= 0) return 0;
  return scanOutQty / windowDays;
}

export function daysOfSupply(currentStock: number, avgSales: number): number | null {
  if (avgSales <= 0) return null;
  if (currentStock <= 0) return 0;
  return Math.floor(currentStock / avgSales);
}

export function turnoverRate(scanOutQty: number, currentStock: number): number {
  if (currentStock <= 0 || scanOutQty <= 0) return 0;
  return scanOutQty / currentStock;
}

export function damagedRate(damagedCount: number, totalReturns: number): number {
  if (totalReturns <= 0) return 0;
  return damagedCount / totalReturns;
}

export function classifyHealth(input: {
  currentStock: number;
  threshold: number;
  daysOfSupplyVal: number | null;
}): HealthClass {
  const { currentStock, threshold, daysOfSupplyVal } = input;
  if (currentStock <= 0) return "out";
  if (threshold > 0 && currentStock <= threshold) return "low";
  if (daysOfSupplyVal !== null && daysOfSupplyVal < LOW_DAYS_OF_SUPPLY) return "low";
  if (daysOfSupplyVal !== null && daysOfSupplyVal > OVERSTOCK_DAYS_OF_SUPPLY) return "overstocked";
  return "healthy";
}

export interface ReorderInput {
  id: string;
  name: string;
  currentStock: number;
  avgDailySales: number;
  daysOfSupplyVal: number | null;
  unit_cost?: number;
}

export function reorderSuggestions(
  products: ReorderInput[],
  opts: { horizonDays: number },
): ReorderInput[] {
  return products
    .filter((p) => p.daysOfSupplyVal !== null && p.daysOfSupplyVal <= opts.horizonDays)
    .sort((a, b) => (a.daysOfSupplyVal ?? 0) - (b.daysOfSupplyVal ?? 0));
}

export function isDamagedOutlier(rate: number, meanRate: number): boolean {
  if (meanRate <= 0) return false;
  if (rate < DAMAGED_OUTLIER_FLOOR) return false;
  return rate >= meanRate * DAMAGED_OUTLIER_MULTIPLIER;
}

export interface MovementRow {
  created_at: string;
  change: number;
}

export interface MovementDayBucket {
  day: string; // YYYY-MM-DD
  net_change: number;
  movement_count: number;
}

export function bucketMovementsByDay(rows: MovementRow[]): MovementDayBucket[] {
  const map = new Map<string, MovementDayBucket>();
  for (const r of rows) {
    const day = r.created_at.slice(0, 10);
    const existing = map.get(day);
    if (existing) {
      existing.net_change += r.change;
      existing.movement_count += 1;
    } else {
      map.set(day, { day, net_change: r.change, movement_count: 1 });
    }
  }
  return Array.from(map.values()).sort((a, b) => (a.day < b.day ? 1 : -1));
}

export const MOVEMENT_WINDOW_DAYS = 30;

export interface ComputeProductInput {
  id: string;
  name: string;
  current_stock: number;
  low_stock_threshold: number;
  unit_cost: number;
  damaged_return_count: number;
  scan_out_qty_30d: number;
  returns_qty_30d: number;
  meanDamagedRate: number;
}

export interface ProductIntelligence {
  id: string;
  name: string;
  current_stock: number;
  low_stock_threshold: number;
  unit_cost: number;
  damaged_return_count: number;
  stock_value: number;
  avg_daily_sales: number;
  days_of_supply: number | null;
  turnover_30d: number;
  damaged_rate: number;
  is_damaged_outlier: boolean;
  health: HealthClass;
}

export function computeProductIntelligence(input: ComputeProductInput): ProductIntelligence {
  const stockValue = input.current_stock * input.unit_cost;
  const avg = avgDailySales(input.scan_out_qty_30d, MOVEMENT_WINDOW_DAYS);
  const dos = daysOfSupply(input.current_stock, avg);
  const turnover = turnoverRate(input.scan_out_qty_30d, input.current_stock);
  const dmgRate = damagedRate(input.damaged_return_count, input.returns_qty_30d);
  const outlier = isDamagedOutlier(dmgRate, input.meanDamagedRate);
  const health = classifyHealth({
    currentStock: input.current_stock,
    threshold: input.low_stock_threshold,
    daysOfSupplyVal: dos,
  });

  return {
    id: input.id,
    name: input.name,
    current_stock: input.current_stock,
    low_stock_threshold: input.low_stock_threshold,
    unit_cost: input.unit_cost,
    damaged_return_count: input.damaged_return_count,
    stock_value: stockValue,
    avg_daily_sales: avg,
    days_of_supply: dos,
    turnover_30d: turnover,
    damaged_rate: dmgRate,
    is_damaged_outlier: outlier,
    health,
  };
}
