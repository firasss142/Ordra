import type { Role } from "../types";

export function canReadSettings(
  role: Role,
  targetMarketId: string,
  actorMarketId: string
): boolean {
  if (role === "super_admin") return true;
  if (role === "market_manager") return targetMarketId === actorMarketId;
  return false;
}

export function canWriteSettings(
  role: Role,
  targetMarketId: string,
  actorMarketId: string
): boolean {
  if (role === "super_admin") return true;
  if (role === "market_manager") return targetMarketId === actorMarketId;
  return false;
}

export function canManageCarriers(role: Role): boolean {
  return role === "super_admin";
}

export function canManageStorefronts(role: Role): boolean {
  return role === "super_admin";
}

export function canManageAgents(
  role: Role,
  targetMarketId: string,
  actorMarketId: string
): boolean {
  if (role === "super_admin") return true;
  if (role === "market_manager") return targetMarketId === actorMarketId;
  return false;
}
