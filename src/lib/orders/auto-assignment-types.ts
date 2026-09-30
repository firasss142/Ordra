import type { AssignmentAlgorithm } from "@/types/settings";

/** Minimal order data needed by the assignment engine */
export interface AssignableOrder {
  id: string;
  market_id: string;
  product_id: string | null;
  customer_city: string | null;
  /**
   * Resolved OMS city id, when the webhook payload mapped to one. Region-based
   * assignment still matches on `customer_city` (string) today; this is carried
   * so a future migration of region_rules to city ids has the data available.
   */
  city_id?: string | null;
}

/** Minimal agent data needed by the assignment engine */
export interface AvailableAgent {
  id: string;
  queue_size: number;
  last_action_at: string | null;
  /**
   * Orders assigned to this agent today, market-local — manual assignments
   * included. The percentage engine's whole state: it is derived from `orders`
   * rather than stored, so a race costs at most one order instead of drifting
   * the way round_robin's `last_assigned_index` does.
   */
  assigned_today: number;
  /** Declared by the agent: "I am taking orders". Never sufficient alone. */
  is_available: boolean;
  is_active: boolean;
  deleted_at: string | null;
  /** Heartbeat. Readiness needs a fresh one as well as the declaration. */
  last_seen_at: string | null;
}

/** Round-robin config stored in assignment_rules.config */
export interface RoundRobinConfig {
  last_assigned_index: number;
}

/** Product-based config stored in assignment_rules.config */
export interface ProductBasedConfig {
  product_rules: Array<{
    product_id: string;
    agent_ids: string[];
    last_assigned_index: number;
  }>;
}

/** Region-based config stored in assignment_rules.config */
export interface RegionBasedConfig {
  region_rules: Array<{
    cities: string[];
    agent_ids: string[];
    last_assigned_index: number;
  }>;
}

/**
 * Percentage config. Unlike the other three this carries NO cursor — the
 * engine reads today's counts off each agent, so there is nothing to persist
 * and `updated_config` is always null. Shares live in
 * `agent_distribution_shares`, not here, so `auto-assign-bulk` overwriting
 * `assignment_rules.config` cannot destroy them.
 */
export interface PercentageConfig {
  shares: Record<string, number>;
}

export type AssignmentConfig =
  | RoundRobinConfig
  | ProductBasedConfig
  | RegionBasedConfig
  | PercentageConfig
  | Record<string, unknown>
  | null;

/**
 * Runtime inputs the percentage engine needs that are not stored config.
 *
 * Kept out of `AssignmentConfig` on purpose: config is the cursor an algorithm
 * persists between calls, while these are read fresh every time. Shares come
 * from `agent_distribution_shares`; the denominator is a grouped count over
 * `orders`.
 */
export interface AssignmentContext {
  /** agent_id -> share_pct (0-100). Absent or 0 means "never assign". */
  shares?: Record<string, number>;
  /**
   * Orders assigned today across the WHOLE market, including agents who are
   * not ready. This is what makes the quota strict rather than renormalised:
   * an absent agent's morning still counts toward everyone's target.
   */
  totalAssignedToday?: number;
}

/** Result from the pure engine */
export interface AssignmentDecision {
  agent_id: string;
  updated_config: AssignmentConfig;
}

/** Full assignment rule row from DB */
export interface AssignmentRule {
  id: string;
  market_id: string;
  algorithm: AssignmentAlgorithm;
  config: AssignmentConfig;
  is_active: boolean;
}
