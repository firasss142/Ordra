import type { AlertSeverity, AlertType } from "./catalogue";

export type { AlertSeverity, AlertType };

/**
 * One thing wanting attention.
 *
 * `age_minutes` replaced the old `meta: { key, value }` pair, which carried a
 * different unit per type — hours for a blocked dispatch, days for a silent
 * carrier, minutes for everything else. Three units meant three format paths and
 * the panel ended up printing "bloquée 1176 h" next to "en retard de 1 h 35 min",
 * as if those were readings on the same scale. One unit in, one formatter out.
 *
 * `meta` is now only for the handful of types that carry something *other* than
 * a duration — the attempt count, the stock level — and is null for the rest.
 */
export interface Alert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  entity_id: string;
  entity_kind: "order" | "product" | "agent";
  href: string;
  primary: string;
  secondary: string | null;
  /** Minutes since this rule's own anchor: the thing that drives both the
   *  displayed reading and the severity escalation, so they cannot disagree. */
  age_minutes: number;
  meta: Record<string, number | string> | null;
  created_at: string;
  market_id: string | null;
}

export interface AlertsSummary {
  total: number;
  by_severity: Record<AlertSeverity, number>;
  by_type: Partial<Record<AlertType, number>>;
  alerts: Alert[];
}
