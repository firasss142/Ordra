/**
 * Wire types for the Transporteurs page — the exact JSON returned by
 * `get_carrier_scorecard` and the rows of `get_carrier_scorecard_parcels`
 * (supabase/migrations/20261004090100_carrier_scorecard.sql). Keep in step with
 * the SQL; nothing else may guess at these payloads.
 */

export interface ScorecardSettings {
  /** Delivery rate (%) a carrier must reach — `carrier_delivery_target_pct`. */
  target_pct: number;
  /** Days on the road after pickup before a parcel is late — `carrier_late_days`. */
  late_days: number;
  /** Days without a carrier movement before a parcel is stuck — `carrier_stall_days`. */
  stuck_days: number;
}

/** Parcels SENT in the period (and the period before), by outcome. */
export interface ScorecardPeriod {
  sent: number;
  delivered: number;
  failed: number;
  in_flight: number;
  prev_delivered: number;
  prev_failed: number;
  picked: number;
  /** Picked up < 6 h after upload (Darb) or dropped < 24 h (Tunisia). */
  picked_fast: number;
  /** Delivered with no postponement — Darb only, null where unknown. */
  first_attempt: number | null;
  /** Median days pickup → delivered. */
  median_days: number | null;
  /** Delivered less than 3 days after pickup. */
  fast3: number;
}

export interface ScorecardWeek {
  /** Monday of the upload week, market-local, YYYY-MM-DD. */
  week: string;
  delivered: number;
  failed: number;
  in_flight: number;
}

/** Parcels at the carrier NOW. Buckets are days since pickup. */
export interface ScorecardOpen {
  total: number;
  not_picked: number;
  b0_2: number;
  b3_4: number;
  b5_9: number;
  b10p: number;
  late: number;
  stuck: number;
}

/** Failures after pickup over 90 days, and where the goods are. */
export interface ScorecardReturns {
  failed: number;
  handed_back: number;
  scanned: number;
  /** Not handed back yet — still with the carrier. */
  out: number;
  out_late: number;
  /** Handed back, not scanned, by days since hand-back. */
  age_lt7: number;
  age_7_30: number;
  age_30p: number;
  within7: number;
  median_days: number | null;
}

export interface ScorecardReason {
  class: string;
  n: number;
}

export interface ScorecardCity {
  /** As the carrier wrote it — Arabic for Darb, free text for Tunisia. */
  city: string;
  delivered: number;
  failed: number;
  median_days: number | null;
}

export interface ScorecardCarrier {
  id: string;
  name: string;
  code: string;
  accent_color: string | null;
  /** Uploaded logo, merged by the API route (not the RPC); null = brand file. */
  logo_url?: string | null;
  /** The warehouse city when one carrier runs several accounts (Darb). */
  account_label: { fr: string; ar: string | null } | null;
  first_upload_at: string | null;
  last_upload_at: string | null;
  has_reasons: boolean;
  has_attempts: boolean;
  period: ScorecardPeriod;
  weeks: ScorecardWeek[];
  open: ScorecardOpen;
  returns: ScorecardReturns;
  reasons: ScorecardReason[];
  cities: ScorecardCity[];
}

export interface ScorecardDormant {
  id: string;
  name: string;
  code: string;
  accent_color: string | null;
  logo_url?: string | null;
  last_upload_at: string | null;
  open: number;
}

export interface Scorecard {
  market_id: string;
  days: number;
  generated_at: string;
  settings: ScorecardSettings;
  last_sync_at: string | null;
  carriers: ScorecardCarrier[];
  dormant: ScorecardDormant[];
}

export type ParcelKind = "late" | "returns" | "dormant";

export interface ScorecardParcel {
  order_id: string;
  tracking_number: string | null;
  city: string | null;
  since: string | null;
  days: number | null;
  picked: boolean;
  stuck: boolean;
  darb_status: string | null;
  order_status: string;
  remark: string | null;
}

export const SCORECARD_PERIODS = [7, 30, 90] as const;
export type ScorecardPeriodDays = (typeof SCORECARD_PERIODS)[number];
