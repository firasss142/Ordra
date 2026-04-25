export type ProductSortKey =
  | "default"
  | "revenueDesc"
  | "marginAsc"
  | "stockAsc"
  | "name";

export interface SortableProduct {
  id: string;
  name: string;
  current_stock: number;
}

export interface SortableMetric {
  revenue: number;
  margin_pct: number;
}

export function sortProducts<T extends SortableProduct>(
  products: T[],
  metricsMap: Map<string, SortableMetric>,
  key: ProductSortKey,
): T[] {
  if (key === "default") return products;
  const sorted = [...products];

  switch (key) {
    case "revenueDesc":
      sorted.sort((a, b) => {
        const ra = metricsMap.get(a.id)?.revenue ?? -Infinity;
        const rb = metricsMap.get(b.id)?.revenue ?? -Infinity;
        return rb - ra;
      });
      break;
    case "marginAsc":
      sorted.sort((a, b) => {
        const ma = metricsMap.get(a.id)?.margin_pct ?? Infinity;
        const mb = metricsMap.get(b.id)?.margin_pct ?? Infinity;
        return ma - mb;
      });
      break;
    case "stockAsc":
      sorted.sort((a, b) => a.current_stock - b.current_stock);
      break;
    case "name":
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
  }

  return sorted;
}
