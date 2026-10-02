import type { Role } from "@/types";

/**
 * Réglages — the one settings page, organised by topic in the order an order
 * travels: where it comes from (Boutiques), how it is confirmed (Commandes,
 * Motifs de rejet, Équipe), how it leaves (Entrepôts, Livraison), how the
 * customer is told (WhatsApp), what it cost to get (Publicité).
 *
 * plans/reglages-redesign.md · prototypes/reglages-v2.html
 */
export const TOPIC_IDS = [
  "markets",
  "shops",
  "orders",
  "rejections",
  "team",
  "warehouses",
  "delivery",
  "whatsapp",
  "ads",
] as const;

export type TopicId = (typeof TOPIC_IDS)[number];

/** Topics only the super_admin sees: cross-market identity and ad accounts. */
const SUPER_ADMIN_ONLY: ReadonlySet<TopicId> = new Set(["markets", "ads"]);

export function topicsFor(role: Role): TopicId[] {
  if (role === "super_admin") return [...TOPIC_IDS];
  if (role === "market_manager") return TOPIC_IDS.filter((t) => !SUPER_ADMIN_ONLY.has(t));
  return [];
}

export function isTopicFor(role: Role, id: string): id is TopicId {
  return (topicsFor(role) as string[]).includes(id);
}

export function defaultTopic(role: Role): TopicId {
  return topicsFor(role)[0] ?? "shops";
}

/** Marchés is the one topic about every market at once. */
export function isMarketScoped(id: TopicId): boolean {
  return id !== "markets";
}

/**
 * What a card edits. A market_manager runs the day-to-day rules of their own
 * market; shops, carriers, warehouses, WhatsApp, money and ad accounts are set
 * by an administrator (owner's decision, 2026-10-02).
 */
export type EditArea =
  | "markets"
  | "shops"
  | "matching"
  | "orders"
  | "rejections"
  | "team"
  | "commissions"
  | "warehouses"
  | "carriers"
  | "risk"
  | "board"
  | "whatsapp"
  | "ads";

const MANAGER_AREAS: ReadonlySet<EditArea> = new Set([
  "orders",
  "rejections",
  "team",
  "risk",
  "board",
  "matching",
]);

export function canEditArea(role: Role, area: EditArea): boolean {
  if (role === "super_admin") return true;
  if (role === "market_manager") return MANAGER_AREAS.has(area);
  return false;
}

/**
 * The `settings` keys a market_manager may write. Enforced by
 * PATCH /api/settings/[marketId] — RLS cannot restrict keys, so the route must.
 * Fees, stock planning, the FX rate and WhatsApp automation stay with the
 * administrator.
 */
export const MANAGER_EDITABLE_SETTING_KEYS: ReadonlySet<string> = new Set([
  // Commandes
  "max_call_attempts",
  "attempt_retry_times",
  "sla_minutes",
  "duplicate_window_hours",
  "duplicate_autoselect_window_hours",
  "merge_window_hours",
  "auto_archive_after_days",
  // Équipe
  "assignment_algorithm",
  "goal_daily_treated",
  "goal_min_rate",
  "goal_conf_per_hour",
  "goal_team_weekly_conf",
  // Livraison › Colis à risque + Tableau de suivi
  "high_value_threshold",
  "risk_min_prior_failures",
  "zone_low_delivery_rate_pct",
  "zone_min_sample",
  "carrier_stall_days",
  "delivery_first_action_hours",
  "delivery_done_window_hours",
]);

/** Old Système › Connexions tabs, for bookmarks and deep links. */
export function legacyConnectionsTab(tab: string | null | undefined, role: Role): TopicId {
  switch (tab) {
    case "storefronts":
    case "mappings":
      return "shops";
    case "carriers":
      return "delivery";
    case "services":
      return "whatsapp";
    default:
      return role === "super_admin" ? "markets" : "shops";
  }
}

/** Old Système › Paramètres tabs (also /settings/general?tab=…). */
export function legacySettingsTab(tab: string | null | undefined, role: Role): TopicId {
  switch (tab) {
    case "livraison":
    case "alertes":
      return "delivery";
    case "team":
    case "objectifs":
    case "commissions":
      return "team";
    case "rejets":
      return "rejections";
    case "whatsapp":
      return "whatsapp";
    default:
      return isTopicFor(role, "orders") ? "orders" : defaultTopic(role);
  }
}
