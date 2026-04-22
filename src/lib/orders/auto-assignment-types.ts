import type { AssignmentAlgorithm } from "@/types/settings";

/** Minimal order data needed by the assignment engine */
export interface AssignableOrder {
  id: string;
  market_id: string;
  product_id: string | null;
  customer_city: string | null;
}

/** Minimal agent data needed by the assignment engine */
export interface AvailableAgent {
  id: string;
  queue_size: number;
  last_action_at: string | null;
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

export type AssignmentConfig =
  | RoundRobinConfig
  | ProductBasedConfig
  | RegionBasedConfig
  | Record<string, unknown>
  | null;

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
