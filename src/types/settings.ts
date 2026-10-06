export type AssignmentAlgorithm =
  | "manual"
  | "round_robin"
  | "workload"
  | "product_based"
  | "region_based"
  | "percentage";

export const AssignmentAlgorithm = {
  manual: "manual" as const,
  round_robin: "round_robin" as const,
  workload: "workload" as const,
  product_based: "product_based" as const,
  region_based: "region_based" as const,
  percentage: "percentage" as const,
};

export interface ShiftConfig {
  start: string; // "HH:MM"
  end: string;   // "HH:MM"
  days: number[]; // 0=Sun..6=Sat
  timezone: string;
}

/**
 * What happens to an order that exhausts its confirmation attempts without an
 * answer. `reject` = auto-reject (motif injoignable); `flag` = keep in the queue
 * with a manager badge; `none` = leave it to the agent. UI+storage today; the
 * cron that acts on it is a follow-up.
 */
export type AfterMaxAttemptsAction = "reject" | "flag" | "none";

export const AfterMaxAttemptsAction = {
  reject: "reject" as const,
  flag: "flag" as const,
  none: "none" as const,
};

/** How an order whose city we don't recognise is handled at intake. */
export type UnknownCityPolicy = "queue" | "fuzzy";

export const UnknownCityPolicy = {
  queue: "queue" as const,
  fuzzy: "fuzzy" as const,
};

/** What to do with orders that arrive outside working hours. */
export type OutsideHoursPolicy = "hold" | "assign";

export const OutsideHoursPolicy = {
  hold: "hold" as const,
  assign: "assign" as const,
};

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
  /**
   * La validation d'une réception met-elle à jour le coût de revient catalogue ?
   *
   * `products.unit_cogs` est lu EN DIRECT par un P&L fenêtré sur événements et
   * par `investor_order_facts` : l'écrire recalcule la marge de commandes DÉJÀ
   * LIVRÉES. Ce n'est donc pas une décision de document — c'était une case à
   * cocher dans la modale de validation, ce qui faisait de la base de coût de
   * l'entreprise une fonction de l'attention de celui qui validait, à 23 h, sur
   * un quai. C'est une politique comptable, posée une fois par marché.
   *
   * Allumée, chaque validation recalcule la moyenne pondérée sur le COÛT DE
   * REVIENT (prix fournisseur + frais d'approche répartis), jamais sur le seul
   * prix fournisseur, qui serait systématiquement trop bas.
   *
   * Défaut FAUX : on n'allume pas une réécriture du P&L sans qu'on le demande.
   */
  costing_update_on_settle?: boolean;
  /**
   * Minutes an order may wait between intake and phone confirmation.
   *
   * Read by the order panel's SLA chip. It measures the confirmation phase
   * only — the carrier's own delivery time is the carrier's problem and is
   * tracked separately.
   */
  sla_minutes?: number;

  // ── Redesign (Système › Paramètres). UI + storage + validation now;
  //    enforcement (crons / order-engine acting on these) is a follow-up. ──

  // Opérations › Confirmation
  /** What happens after the last unanswered attempt. */
  after_max_attempts_action?: AfterMaxAttemptsAction;
  /** Hours to wait after the last attempt before acting. 0 = immediately. */
  after_max_attempts_delay_hours?: number;
  /** How many days ahead an agent may schedule a callback. */
  callback_max_days?: number;
  /** Minutes of tolerance past a scheduled callback before it reads as late. */
  callback_grace_minutes?: number;
  /** Local cutoff (HH:MM) after which dispatch-scheduled uploads roll to next day. */
  dispatch_cutoff_time?: string;

  // Opérations › Réception
  /** Window (hours) in which a same-phone+product order is a likely duplicate. */
  duplicate_window_hours?: number;
  /**
   * Narrower window inside which a duplicate is confident enough to arrive
   * PRE-TICKED on the review screen. 1h by default: same-product pairs in Libya
   * have a median gap of 0.2h (a double-submit) while Tunisia's is 118h (a real
   * re-order of a consumable). 0 disables pre-selection entirely.
   */
  duplicate_autoselect_window_hours?: number;
  /**
   * Window (hours) in which two same-phone, DIFFERENT-product orders may be
   * merged into one parcel. 0 = merging disabled for this market, which is the
   * default: it is worth having where a basket split is common (Libya, 297
   * pairs at a 5.3h median) and a foot-gun where it is not (Tunisia, 8 pairs).
   */
  merge_window_hours?: number;
  /** Auto-assign new orders on intake via the team algorithm. */
  auto_assign_on_intake?: boolean;
  /** Order-amount sanity bounds (flag, never drop, when outside). */
  order_amount_min?: number;
  order_amount_max?: number;
  /** How an unrecognised city is handled. */
  unknown_city_policy?: UnknownCityPolicy;

  // Opérations › Expédition & suivi
  /** Upload to the carrier automatically on confirmation. */
  auto_upload_on_confirm?: boolean;
  /** Days without a carrier event before a parcel is marked `unverified`. */
  unverified_after_days?: number;
  /** Restock automatically when a return is scanned in. */
  auto_restock_on_return_scan?: boolean;

  // Opérations › Cycle de vie
  /** Days after a terminal status before an order is auto-archived. */
  auto_archive_after_days?: number;

  // Équipe
  /** Max open orders an agent can hold before dropping out of rotation. */
  max_open_orders_per_agent?: number;
  /** Minutes an offline agent's orders wait before reassignment. */
  orphan_reassign_after_minutes?: number;
  /** Whether orphan-queue reassignment is active. */
  orphan_reassign_enabled?: boolean;
  /** What to do with orders arriving outside working hours. */
  outside_hours_policy?: OutsideHoursPolicy;

  // Alertes (thresholds that feed the KPI tiles + alerts summary)
  /** Carrier error-rate % over 24h that trips an alert. */
  carrier_error_rate_threshold?: number;
  /** Consecutive webhook failures before an alert. */
  webhook_failure_threshold?: number;
  /** Hours a sync may be stale before an alert. */
  sync_staleness_hours?: number;
  /** Days a parcel may sit without a carrier event before an alert. */
  carrier_stall_days?: number;
  /** Days-of-cover under which a product is a stock-out risk. */
  stockout_days_of_cover?: number;
  /** Notify the manager when an order breaches the confirmation SLA. */
  sla_breach_alert?: boolean;

  // ── Suivi livraison (the post-upload delivery worklist) ──
  // Every threshold the page ranks on lives here. Nothing in lib/delivery may
  // hardcode one: markets differ, and a manager cannot tune what is compiled in.
  /**
   * Order value at or above which a parcel counts as high-value for the
   * proactive-call task. 0 = off, which is the default: a market must opt in,
   * or every order over some arbitrary number raises a task on day one.
   */
  high_value_threshold?: number;
  /** Delivery rate (%) under which a destination counts as a weak zone. */
  zone_low_delivery_rate_pct?: number;
  /** Minimum finished orders before a zone's rate is trusted at all. */
  zone_min_sample?: number;
  /** Transporteurs: delivery rate (%) a carrier must reach to be « on target ». */
  carrier_delivery_target_pct?: number;
  /** Transporteurs: days on the road after pickup before a parcel counts as late. */
  carrier_late_days?: number;
  /** Prior returns + rejections that make a customer a repeat risk. */
  risk_min_prior_failures?: number;
  /** Hours a proactive call task stays open before it expires unanswered. */
  proactive_call_window_hours?: number;
  /** Hours a finished parcel stays visible in the "terminées" bucket. */
  delivery_done_window_hours?: number;
  /**
   * Hours a parcel needing an action may wait before the manager board calls
   * its agent late. Counted on shift hours, and the only target the verdicts
   * on /delivery are measured against.
   */
  delivery_first_action_hours?: number;

  // Objectifs (team targets; read by the team dashboard + agent sheet)
  goal_daily_treated?: number;
  goal_min_rate?: number;
  goal_conf_per_hour?: number;
  goal_team_weekly_conf?: number;

  // ── Salle de contrôle (prototypes/team-v5.html) — super_admin only ──
  // The team planning itself is `shift_config` (start, end, days).
  /** An order not called by its holder this many hours after assignment counts as « non appelée ». */
  team_call_delay_hours?: number;
  /** An agent online but silent this many minutes reads « sans appel » and rings the bell. */
  team_idle_minutes?: number;
  /** A first call later than the planned start + this many minutes reads « en retard ». */
  team_late_minutes?: number;
  /**
   * Online-card surcharge on the product subtotal, in % (order-total.ts). Was
   * `* 1.1` in code until 2026-10-06. Money: super_admin only.
   */
  card_surcharge_pct?: number;
  /** Calls to a prospect before it is closed as unreachable (api/leads/[id]/attempt). */
  max_lead_attempts?: number;
  /** A prospect younger than this is « chaud » in the worklist and the console. */
  lead_hot_window_minutes?: number;
  /** Agents whose hours differ from the team's: agent id → { start, end } ("HH:MM"). */
  team_shift_overrides?: Record<string, { start: string; end: string }>;

  // ── WhatsApp — automatic lifecycle notifications ──
  // Read by the `whatsapp_enqueue_lifecycle` trigger (SQL) and the outbox
  // drain. Every key defaults OFF: a market sends nothing until a manager
  // turns the master switch and at least one event on.
  /** Master switch. Off = no event enqueues, whatever the toggles below say. */
  whatsapp_lifecycle_enabled?: boolean;
  whatsapp_event_could_not_reach?: boolean;
  whatsapp_event_shipped?: boolean;
  whatsapp_event_out_for_delivery?: boolean;
  whatsapp_event_last_chance?: boolean;
  whatsapp_event_delivered?: boolean;
  /** Language for a customer no agent has chosen one for. Unset = the market's language. */
  whatsapp_default_language?: "ar" | "fr";
  /** "HH-HH" in the market's local time ("10-20"). Outside it a send waits. Empty = always. */
  whatsapp_send_window?: string;
}

export const WHATSAPP_EVENT_SETTING_KEYS = [
  "whatsapp_event_could_not_reach",
  "whatsapp_event_shipped",
  "whatsapp_event_out_for_delivery",
  "whatsapp_event_last_chance",
  "whatsapp_event_delivered",
] as const;

/** "HH-HH", 0 ≤ start < end ≤ 24 — the same shape as a campaign's wa_window. */
export function isValidSendWindow(value: unknown): boolean {
  if (value === undefined || value === "") return true;
  if (typeof value !== "string") return false;
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(value.trim());
  if (!m) return false;
  const start = Number(m[1]);
  const end = Number(m[2]);
  return start >= 0 && start <= 23 && end >= 1 && end <= 24 && start < end;
}

/** Applied per market until someone sets a real one in Réglages. */
export const DEFAULT_SUPPLIER_LEAD_TIME_DAYS = 14;

/** Two hours. Applied per market until someone sets a real one in Réglages. */
export const DEFAULT_SLA_MINUTES = 120;

/** A week. Past this a target stops being a service level. */
const MAX_SLA_MINUTES = 10_080;

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
  costing_update_on_settle: false,
  sla_minutes: DEFAULT_SLA_MINUTES,
  // Redesign keys — conservative defaults so a market that never touches them
  // keeps today's behaviour (no auto-action, no auto-assign, no reassignment).
  after_max_attempts_action: "none",
  after_max_attempts_delay_hours: 24,
  callback_max_days: 3,
  callback_grace_minutes: 15,
  duplicate_window_hours: 24,
  duplicate_autoselect_window_hours: 1,
  merge_window_hours: 0,
  auto_assign_on_intake: false,
  unknown_city_policy: "queue",
  auto_upload_on_confirm: false,
  unverified_after_days: 5,
  auto_restock_on_return_scan: true,
  auto_archive_after_days: 30,
  max_open_orders_per_agent: 25,
  orphan_reassign_after_minutes: 60,
  orphan_reassign_enabled: false,
  outside_hours_policy: "hold",
  carrier_error_rate_threshold: 5,
  webhook_failure_threshold: 3,
  sync_staleness_hours: 2,
  carrier_stall_days: 5,
  stockout_days_of_cover: 7,
  sla_breach_alert: true,
  // Suivi livraison. high_value_threshold stays 0 (off) on purpose — see the
  // interface comment; the others are the values the prototype was tuned on.
  high_value_threshold: 0,
  zone_low_delivery_rate_pct: 60,
  zone_min_sample: 20,
  carrier_delivery_target_pct: 60,
  carrier_late_days: 3,
  risk_min_prior_failures: 1,
  proactive_call_window_hours: 4,
  delivery_done_window_hours: 24,
  delivery_first_action_hours: 4,
  goal_daily_treated: 12,
  goal_min_rate: 40,
  goal_conf_per_hour: 3,
  goal_team_weekly_conf: 150,
  // Salle de contrôle — the defaults the owner agreed on (2026-10-03).
  team_call_delay_hours: 2,
  team_idle_minutes: 30,
  team_late_minutes: 15,
  // Business rules that lived in code until 2026-10-06 — same values.
  card_surcharge_pct: 10,
  max_lead_attempts: 3,
  lead_hot_window_minutes: 60,
  // WhatsApp: everything off until a manager decides otherwise.
  whatsapp_lifecycle_enabled: false,
  whatsapp_event_could_not_reach: false,
  whatsapp_event_shipped: false,
  whatsapp_event_out_for_delivery: false,
  whatsapp_event_last_chance: false,
  whatsapp_event_delivered: false,
};

/**
 * The authoritative set of keys `MarketSettings` owns. Kept in sync with the
 * interface by hand (TS can't enumerate interface keys at runtime). Used by
 * `assembleMarketSettings` to decide which stored rows to apply — including
 * the optional keys that have no entry in `DEFAULT_MARKET_SETTINGS`
 * (`dispatch_cutoff_time`, `order_amount_min`, `order_amount_max`).
 */
export const MARKET_SETTINGS_KEYS: ReadonlyArray<keyof MarketSettings> = [
  "delivery_fee",
  "return_fee",
  "packing_cost",
  "max_call_attempts",
  "assignment_algorithm",
  "active_agents_only",
  "agent_inactivity_minutes",
  "attempt_retry_times",
  "shift_config",
  "supplier_lead_time_days",
  "costing_update_on_settle",
  "sla_minutes",
  "after_max_attempts_action",
  "after_max_attempts_delay_hours",
  "callback_max_days",
  "callback_grace_minutes",
  "dispatch_cutoff_time",
  "duplicate_window_hours",
  "duplicate_autoselect_window_hours",
  "merge_window_hours",
  "auto_assign_on_intake",
  "order_amount_min",
  "order_amount_max",
  "unknown_city_policy",
  "auto_upload_on_confirm",
  "unverified_after_days",
  "auto_restock_on_return_scan",
  "auto_archive_after_days",
  "max_open_orders_per_agent",
  "orphan_reassign_after_minutes",
  "orphan_reassign_enabled",
  "outside_hours_policy",
  "carrier_error_rate_threshold",
  "webhook_failure_threshold",
  "sync_staleness_hours",
  "carrier_stall_days",
  "stockout_days_of_cover",
  "sla_breach_alert",
  "high_value_threshold",
  "zone_low_delivery_rate_pct",
  "zone_min_sample",
  "carrier_delivery_target_pct",
  "carrier_late_days",
  "risk_min_prior_failures",
  "proactive_call_window_hours",
  "delivery_done_window_hours",
  "delivery_first_action_hours",
  "goal_daily_treated",
  "goal_min_rate",
  "goal_conf_per_hour",
  "goal_team_weekly_conf",
  "team_call_delay_hours",
  "team_idle_minutes",
  "team_late_minutes",
  "card_surcharge_pct",
  "max_lead_attempts",
  "lead_hot_window_minutes",
  "team_shift_overrides",
  "whatsapp_lifecycle_enabled",
  "whatsapp_event_could_not_reach",
  "whatsapp_event_shipped",
  "whatsapp_event_out_for_delivery",
  "whatsapp_event_last_chance",
  "whatsapp_event_delivered",
  "whatsapp_default_language",
  "whatsapp_send_window",
];

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
  "percentage",
]);

const VALID_AFTER_MAX_ATTEMPTS = new Set<string>(["reject", "flag", "none"]);
const VALID_UNKNOWN_CITY_POLICY = new Set<string>(["queue", "fuzzy"]);
const VALID_OUTSIDE_HOURS_POLICY = new Set<string>(["hold", "assign"]);
const TIME_RE = /^([0-1]\d|2[0-3]):([0-5]\d)$/;

/**
 * Optional whole-number field in an inclusive [min,max] range. Rejects
 * non-numbers, non-integers, and out-of-range. `undefined` passes (optional).
 */
function isValidOptionalInt(
  value: unknown,
  min: number,
  max: number,
): boolean {
  if (value === undefined) return true;
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  );
}

/** Optional real number in an inclusive [min,max] range. `undefined` passes. */
function isValidOptionalNumber(
  value: unknown,
  min: number,
  max: number,
): boolean {
  if (value === undefined) return true;
  return typeof value === "number" && value >= min && value <= max;
}

/** Optional boolean. `undefined` passes. */
function isValidOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

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
  if (s.costing_update_on_settle !== undefined) {
    if (typeof s.costing_update_on_settle !== "boolean") return false;
  }
  if (s.sla_minutes !== undefined) {
    // Whole minutes only, and never zero: a zero target would report every
    // order as breached the instant it arrived.
    if (
      typeof s.sla_minutes !== "number" ||
      !Number.isInteger(s.sla_minutes) ||
      s.sla_minutes < 1 ||
      s.sla_minutes > MAX_SLA_MINUTES
    )
      return false;
  }
  if (s.shift_config !== undefined) {
    if (!isValidShiftConfig(s.shift_config)) return false;
  }

  // ── Redesign keys (Système › Paramètres) ──
  // Opérations › Confirmation
  if (
    s.after_max_attempts_action !== undefined &&
    (typeof s.after_max_attempts_action !== "string" ||
      !VALID_AFTER_MAX_ATTEMPTS.has(s.after_max_attempts_action))
  )
    return false;
  if (!isValidOptionalInt(s.after_max_attempts_delay_hours, 0, 720)) return false;
  if (!isValidOptionalInt(s.callback_max_days, 1, 30)) return false;
  if (!isValidOptionalInt(s.callback_grace_minutes, 0, 1440)) return false;
  if (
    s.dispatch_cutoff_time !== undefined &&
    (typeof s.dispatch_cutoff_time !== "string" ||
      !TIME_RE.test(s.dispatch_cutoff_time))
  )
    return false;

  // Opérations › Réception
  if (!isValidOptionalInt(s.duplicate_window_hours, 0, 168)) return false;
  if (!isValidOptionalInt(s.duplicate_autoselect_window_hours, 0, 168)) return false;
  if (!isValidOptionalInt(s.merge_window_hours, 0, 168)) return false;
  if (!isValidOptionalBoolean(s.auto_assign_on_intake)) return false;
  if (!isValidOptionalNumber(s.order_amount_min, 0, Number.MAX_SAFE_INTEGER))
    return false;
  if (!isValidOptionalNumber(s.order_amount_max, 0, Number.MAX_SAFE_INTEGER))
    return false;
  if (
    typeof s.order_amount_min === "number" &&
    typeof s.order_amount_max === "number" &&
    s.order_amount_max < s.order_amount_min
  )
    return false;
  if (
    s.unknown_city_policy !== undefined &&
    (typeof s.unknown_city_policy !== "string" ||
      !VALID_UNKNOWN_CITY_POLICY.has(s.unknown_city_policy))
  )
    return false;

  // Opérations › Expédition & suivi
  if (!isValidOptionalBoolean(s.auto_upload_on_confirm)) return false;
  if (!isValidOptionalInt(s.unverified_after_days, 1, 90)) return false;
  if (!isValidOptionalBoolean(s.auto_restock_on_return_scan)) return false;

  // Opérations › Cycle de vie
  if (!isValidOptionalInt(s.auto_archive_after_days, 0, 365)) return false;

  // Équipe
  if (!isValidOptionalInt(s.max_open_orders_per_agent, 1, 10_000)) return false;
  if (!isValidOptionalInt(s.orphan_reassign_after_minutes, 1, 10_080)) return false;
  if (!isValidOptionalBoolean(s.orphan_reassign_enabled)) return false;
  if (
    s.outside_hours_policy !== undefined &&
    (typeof s.outside_hours_policy !== "string" ||
      !VALID_OUTSIDE_HOURS_POLICY.has(s.outside_hours_policy))
  )
    return false;

  // Alertes
  if (!isValidOptionalNumber(s.carrier_error_rate_threshold, 0, 100)) return false;
  if (!isValidOptionalInt(s.webhook_failure_threshold, 1, 100)) return false;
  if (!isValidOptionalInt(s.sync_staleness_hours, 1, 168)) return false;
  if (!isValidOptionalInt(s.carrier_stall_days, 1, 90)) return false;
  if (!isValidOptionalInt(s.stockout_days_of_cover, 0, 365)) return false;
  if (!isValidOptionalBoolean(s.sla_breach_alert)) return false;

  // Suivi livraison
  // high_value_threshold is an amount, not a count, so it may be fractional;
  // 0 means the high-value risk input is switched off.
  if (!isValidOptionalNumber(s.high_value_threshold, 0, Number.MAX_SAFE_INTEGER))
    return false;
  if (!isValidOptionalNumber(s.zone_low_delivery_rate_pct, 0, 100)) return false;
  // A zone needs a real sample before its rate may condemn it: 1 would let a
  // single failed delivery mark a whole destination as weak.
  if (!isValidOptionalInt(s.zone_min_sample, 1, 100_000)) return false;
  if (!isValidOptionalInt(s.carrier_delivery_target_pct, 1, 100)) return false;
  if (!isValidOptionalInt(s.carrier_late_days, 1, 30)) return false;
  if (!isValidOptionalInt(s.risk_min_prior_failures, 1, 100)) return false;
  if (!isValidOptionalInt(s.proactive_call_window_hours, 1, 72)) return false;
  if (!isValidOptionalInt(s.delivery_done_window_hours, 1, 168)) return false;
  // A target under an hour would mark every parcel late the moment it arrives;
  // over a working week it would never mark anything.
  if (!isValidOptionalInt(s.delivery_first_action_hours, 1, 72)) return false;

  // Objectifs
  if (!isValidOptionalInt(s.goal_daily_treated, 0, 100_000)) return false;
  if (!isValidOptionalNumber(s.goal_min_rate, 0, 100)) return false;
  if (!isValidOptionalNumber(s.goal_conf_per_hour, 0, 10_000)) return false;
  if (!isValidOptionalInt(s.goal_team_weekly_conf, 0, 1_000_000)) return false;

  // Salle de contrôle
  if (!isValidOptionalInt(s.team_call_delay_hours, 1, 72)) return false;
  if (!isValidOptionalInt(s.team_idle_minutes, 5, 240)) return false;
  if (!isValidOptionalInt(s.team_late_minutes, 0, 120)) return false;
  if (s.team_shift_overrides !== undefined && !isValidShiftOverrides(s.team_shift_overrides)) return false;

  // Règles métier (2026-10-06)
  if (!isValidOptionalNumber(s.card_surcharge_pct, 0, 50)) return false;
  if (!isValidOptionalInt(s.max_lead_attempts, 1, 10)) return false;
  if (!isValidOptionalInt(s.lead_hot_window_minutes, 5, 10_080)) return false;

  // WhatsApp
  for (const key of [
    "whatsapp_lifecycle_enabled",
    "whatsapp_event_could_not_reach",
    "whatsapp_event_shipped",
    "whatsapp_event_out_for_delivery",
    "whatsapp_event_last_chance",
    "whatsapp_event_delivered",
  ]) {
    if (!isValidOptionalBoolean(s[key])) return false;
  }
  if (s.whatsapp_default_language !== undefined && s.whatsapp_default_language !== "ar" && s.whatsapp_default_language !== "fr") return false;
  if (!isValidSendWindow(s.whatsapp_send_window)) return false;

  return true;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HHMM_RE = /^([0-1]\d|2[0-3]):([0-5]\d)$/;

/** agent id → { start, end }, each "HH:MM", start before end. */
export function isValidShiftOverrides(obj: unknown): obj is Record<string, { start: string; end: string }> {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return false;
  for (const [agentId, v] of Object.entries(obj as Record<string, unknown>)) {
    if (!UUID_RE.test(agentId) || v === null || typeof v !== "object") return false;
    const { start, end } = v as Record<string, unknown>;
    if (typeof start !== "string" || typeof end !== "string" || !HHMM_RE.test(start) || !HHMM_RE.test(end)) return false;
    if (start >= end) return false;
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