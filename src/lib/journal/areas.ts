import type { FeedRow, Issue, IssueRule, SystemTile, TileFamily } from "./types";

/**
 * The six areas of Journaux v3 (prototypes/journaux-v3.html). They are the
 * system tiles' own families, so a problem, a system and a history line all
 * land in the same place: Livraison · Commandes · Publicité · Messages ·
 * Tâches automatiques · Application. Pure — the screen and its tests share it.
 */
export const AREAS: TileFamily[] = ["carrier", "intake", "ads", "msg", "auto", "app"];

const RULE_AREA: Record<IssueRule, TileFamily> = {
  job_failing: "auto",
  job_hanging: "auto",
  connection_silent: "carrier",
  carrier_inactive: "carrier",
  carrier_stuck: "carrier",
  upload_failing: "carrier",
  external_failing: "carrier",
  import_rows: "intake",
  ads_no_orders: "ads",
  whatsapp_down: "msg",
  server_error: "app",
  login_failures: "app",
  large_export: "app",
  browser_error: "app",
};

function systemArea(system: string): TileFamily | null {
  if (system === "jobs") return "auto";
  if (system === "app") return "app";
  if (system.startsWith("carrier")) return "carrier";
  if (system.startsWith("shop")) return "intake";
  if (system.startsWith("meta")) return "ads";
  if (system.startsWith("whatsapp")) return "msg";
  return null;
}

export function issueArea(issue: Pick<Issue, "system" | "rule">, systems: Pick<SystemTile, "id" | "family">[]): TileFamily {
  const tile = systems.find((s) => s.id === issue.system);
  return tile?.family ?? systemArea(issue.system) ?? RULE_AREA[issue.rule] ?? "app";
}

/** Audited tables (audit_events.action = "<table>.<verb>"). */
const TABLE_AREA: Record<string, TileFamily> = {
  carriers: "carrier",
  carrier_order_preferences: "carrier",
  warehouses: "carrier",
  storefronts: "intake",
  products: "intake",
  product_variants: "intake",
  order_items: "intake",
  rejection_reason_configs: "intake",
  status_configs: "intake",
  reception_payments: "intake",
  whatsapp_configs: "msg",
  whatsapp_templates: "msg",
  meta_ad_accounts: "ads",
  ad_spend: "ads",
  markets: "app",
  users: "app",
  agent_distribution_shares: "app",
  assignment_rules: "app",
  agent_commission_rates: "app",
  investors: "app",
};

const DOMAIN_AREA: Record<string, TileFamily> = {
  carrier: "carrier",
  delivery: "carrier",
  darb: "carrier",
  order: "intake",
  intake: "intake",
  stock: "intake",
  lead: "intake",
  feedback: "intake",
  whatsapp: "msg",
  job: "auto",
  commission: "auto",
  investor: "auto",
  auth: "app",
  export: "app",
  user: "app",
  agent: "app",
  settings: "app",
  app: "app",
};

export function rowArea(row: Pick<FeedRow, "family" | "kind" | "params">): TileFamily {
  const domain = row.kind.split(".")[0];
  if (domain === "issue") return RULE_AREA[String(row.params?.rule ?? "") as IssueRule] ?? "app";
  if (row.family === "sec") return "app";
  if (domain === "sync") return row.params?.system === "Meta" ? "ads" : "carrier";
  return TABLE_AREA[domain] ?? DOMAIN_AREA[domain] ?? (row.family === "auto" ? "auto" : row.family === "ext" ? "carrier" : "intake");
}
