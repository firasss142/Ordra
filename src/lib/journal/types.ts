/**
 * Shapes returned by the Journaux read functions (supabase/migrations/
 * 20261003160300_journal_read.sql, 20261003160400_journal_overview.sql).
 * Rows carry keys and params, never sentences: the screen words them.
 */

/** The chip a feed row belongs to. */
export type Family = "ext" | "team" | "auto" | "sec";
/** Only failures and warnings carry colour. */
export type Severity = "fail" | "warn" | null;

export interface FeedRow {
  at: string;
  id: string;
  family: Family;
  kind: string;
  severity: Severity;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  market_id: string | null;
  order_id: string | null;
  order_ref: string | null;
  params: Record<string, unknown>;
  ref: string | null;
}

/** A feed row after series merging: `count` rows of the same thing in a row. */
export interface FeedItem extends FeedRow {
  count: number;
  /** Oldest member's time (equals `at` for a single row). */
  since: string;
  members: FeedRow[];
}

export interface FeedPage {
  rows: FeedRow[];
  next: { before: string; beforeId: string } | null;
  /** Routine passes per local day (YYYY-MM-DD), counted not listed. */
  routine: Record<string, number>;
}

export type IssueRule =
  | "job_failing"
  | "connection_silent"
  | "carrier_inactive"
  | "carrier_stuck"
  | "import_rows"
  | "upload_failing"
  | "whatsapp_down"
  | "ads_no_orders"
  | "server_error"
  | "login_failures"
  | "large_export";

export interface Issue {
  id: string;
  rule: IssueRule;
  severity: "critical" | "warning";
  system: string;
  params: Record<string, unknown>;
  first_seen: string;
  last_seen: string;
  affected: number | null;
  amount: number | null;
  currency: string | null;
  status: "open" | "muted";
  muted_until: string | null;
  market: string | null;
}

export type TileState = "ok" | "warn" | "fail" | "mute" | "off";
export type TileFamily = "carrier" | "intake" | "ads" | "msg" | "auto" | "app";

export interface SystemTile {
  id: string;
  family: TileFamily;
  kind: string;
  name: string | null;
  market: string | null;
  state: TileState;
  reason: string;
  last_at: string | null;
  detail: Record<string, unknown>;
  issue_ids: string[];
  /** 48 chars, one per hour, oldest first: o worked · i nothing new · f failed · m expected, absent · - not expected */
  bars: string | null;
}

export interface JobRow {
  job: string;
  schedule: string;
  last_at: string | null;
  cron_status: string | null;
  state: "ok" | "warn" | "fail" | "mute";
  issue_id: string | null;
  result: Record<string, unknown> | null;
}

export interface Security {
  errors: number;
  logins: number;
  login_failures: number;
  exports: number;
  role_changes: number;
  repeated: { id: string; params: Record<string, unknown>; affected: number | null }[];
}

export interface Overview {
  issues: Issue[];
  systems: SystemTile[];
  jobs: JobRow[];
  security: Security;
  generated_at: string;
}

export interface TraceEvent {
  at: string;
  seq: number;
  kind: string;
  actor: string | null;
  actor_type: string | null;
  params: Record<string, unknown>;
}

export interface Trace {
  order: {
    id: string;
    ref: string | null;
    status: string;
    amount: number | null;
    currency: string;
    market: string;
    city: string | null;
    shop: string | null;
    platform: string | null;
    carrier: string | null;
    tracking: string | null;
    created_at: string;
  };
  events: TraceEvent[];
}

export interface OrderMatch {
  id: string;
  ref: string | null;
  status: string;
  market: string;
  created_at: string;
}
