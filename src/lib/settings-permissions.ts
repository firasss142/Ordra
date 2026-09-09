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

export function canReadStorefrontHealth(
  role: Role,
  targetMarketId: string,
  actorMarketId: string,
): boolean {
  if (role === "super_admin") return true;
  if (role === "market_manager") return targetMarketId === actorMarketId;
  return false;
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

/**
 * Deliberately narrower than canReadSettings: an agent needs delivery-rate /
 * transit-time stats to see the "meilleur choix" carrier picker in their own
 * queue, but that is not a door into the settings page.
 */
export function canReadCarrierPerformance(
  role: Role,
  targetMarketId: string,
  actorMarketId: string
): boolean {
  if (role === "super_admin") return true;
  return targetMarketId === actorMarketId;
}
