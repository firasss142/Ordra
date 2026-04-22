import type { Role } from "@/types";

export function canUpdateFulfillment(role: Role): boolean {
  return role === "super_admin" || role === "market_manager";
}
