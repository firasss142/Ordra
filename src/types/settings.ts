export type AssignmentAlgorithm =
  | "manual"
  | "round_robin"
  | "workload"
  | "product_based"
  | "region_based";

export const AssignmentAlgorithm = {
  manual: "manual" as const,
  round_robin: "round_robin" as const,
  workload: "workload" as const,
  product_based: "product_based" as const,
  region_based: "region_based" as const,
};

export interface ShiftConfig {
  start: string; // "HH:MM"
  end: string;   // "HH:MM"
  days: number[]; // 0=Sun..6=Sat
  timezone: string;
}

export interface MarketSettings {
  delivery_fee: number;
  return_fee: number;
  packing_cost: number;
  max_call_attempts: number;
  assignment_algorithm: AssignmentAlgorithm;
  active_agents_only?: boolean;
  agent_inactivity_minutes?: number;
  attempt_retry_times?: string[];
  shift_config?: ShiftConfig;
  /**
   * Days between placing a supplier order and the goods being sellable.
   *
   * The stock console subtracts it from a product's projected stock-out to get
   * the date an order must actually be placed. There is no purchase-order table,
   * so this answers "when must an order be placed IF NONE HAS BEEN" — it cannot
   * account for stock already inbound.
   */
  supplier_lead_time_days?: number;
}

/** Applied per market until someone sets a real one in Réglages. */
export const DEFAULT_SUPPLIER_LEAD_TIME_DAYS = 14;

export const DEFAULT_SHIFT_CONFIG: ShiftConfig = {
  start: "08:00",
  end: "18:00",
  days: [1, 2, 3, 4, 5],
  timezone: "Africa/Tunis",
};

export const DEFAULT_MARKET_SETTINGS: MarketSettings = {
  delivery_fee: 0,
  return_fee: 0,
  packing_cost: 0,
  max_call_attempts: 3,
  assignment_algorithm: "manual",
  active_agents_only: false,
  attempt_retry_times: [],
  shift_config: DEFAULT_SHIFT_CONFIG,
  supplier_lead_time_days: DEFAULT_SUPPLIER_LEAD_TIME_DAYS,
};

export interface CarrierConfig {
  id: string;
  market_id: string;
  name: string;
  api_endpoint: string;
  api_key_encrypted: string;
  delivery_fee: number;
  return_fee: number;
  active: boolean;
}

const VALID_ALGORITHMS = new Set<string>([
  "manual",
  "round_robin",
  "workload",
  "product_based",
  "region_based",
]);

export function isValidMarketSettings(obj: unknown): obj is MarketSettings {
  if (obj === null || typeof obj !== "object") return false;
  const s = obj as Record<string, unknown>;
  if (typeof s.delivery_fee !== "number" || s.delivery_fee < 0) return false;
  if (typeof s.return_fee !== "number" || s.return_fee < 0) return false;
  if (typeof s.packing_cost !== "number" || s.packing_cost < 0) return false;
  if (
    typeof s.max_call_attempts !== "number" ||
    s.max_call_attempts < 1 ||
    s.max_call_attempts > 10
  )
    return false;
  if (
    typeof s.assignment_algorithm !== "string" ||
    !VALID_ALGORITHMS.has(s.assignment_algorithm)
  )
    return false;
  if (s.active_agents_only !== undefined && typeof s.active_agents_only !== "boolean") return false;
  if (s.agent_inactivity_minutes !== undefined && (typeof s.agent_inactivity_minutes !== "number" || s.agent_inactivity_minutes < 1)) return false;
  if (s.attempt_retry_times !== undefined) {
    if (!Array.isArray(s.attempt_retry_times)) return false;
    if (s.attempt_retry_times.length > 3) return false;
    const timeRe = /^([0-1]\d|2[0-3]):([0-5]\d)$/;
    let prevMinutes = -1;
    for (const entry of s.attempt_retry_times) {
      if (typeof entry !== "string") return false;
      const match = timeRe.exec(entry);
      if (!match) return false;
      const mins = Number(match[1]) * 60 + Number(match[2]);
      if (mins <= prevMinutes) return false;
      prevMinutes = mins;
    }
  }
  if (s.supplier_lead_time_days !== undefined) {
    // Whole days only: the value is subtracted from a date, and a fractional
    // lead time would produce a reorder deadline nobody can act on.
    if (
      typeof s.supplier_lead_time_days !== "number" ||
      !Number.isInteger(s.supplier_lead_time_days) ||
      s.supplier_lead_time_days < 0 ||
      s.supplier_lead_time_days > 365
    )
      return false;
  }
  if (s.shift_config !== undefined) {
    if (!isValidShiftConfig(s.shift_config)) return false;
  }
  return true;
}

export function isValidShiftConfig(obj: unknown): obj is ShiftConfig {
  if (obj === null || typeof obj !== "object") return false;
  const s = obj as Record<string, unknown>;
  const timeRe = /^([0-1]\d|2[0-3]):([0-5]\d)$/;
  if (typeof s.start !== "string" || !timeRe.test(s.start)) return false;
  if (typeof s.end !== "string" || !timeRe.test(s.end)) return false;
  const [sh, sm] = s.start.split(":").map(Number);
  const [eh, em] = s.end.split(":").map(Number);
  if (sh * 60 + sm >= eh * 60 + em) return false;
  if (!Array.isArray(s.days)) return false;
  for (const d of s.days) {
    if (typeof d !== "number" || !Number.isInteger(d) || d < 0 || d > 6) return false;
  }
  if (typeof s.timezone !== "string" || s.timezone.length === 0) return false;
  return true;
}