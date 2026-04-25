export type ProductHealth = "green" | "yellow" | "red" | "grey";

export interface HealthInput {
  totalLeads: number;
  marginPct: number;
  deliveryRate: number;
  returnRate: number;
}

export function classifyProductHealth({
  totalLeads,
  marginPct,
  deliveryRate,
  returnRate,
}: HealthInput): ProductHealth {
  if (totalLeads === 0) return "grey";
  if (marginPct < 0) return "red";
  if (marginPct <= 10 || deliveryRate <= 60 || returnRate >= 20) return "yellow";
  return "green";
}
