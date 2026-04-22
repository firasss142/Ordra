import type { Role } from "@/types";

export function canViewProfitability(role: Role): boolean {
  return role === "market_manager" || role === "super_admin";
}
