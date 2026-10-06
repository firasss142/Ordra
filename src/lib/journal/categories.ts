import type { Family, FeedRow, Issue, IssueRule, SystemTile, TileFamily } from "./types";

/**
 * The one categorisation of Journaux (2026-10-06): six areas of the business,
 * used by the overview's tiles, its problem list, its systems and the history
 * filter alike. An area is WHAT PART OF THE BUSINESS is affected — not who
 * wrote the row — so « Livraison » means the same thing on every part of the page.
 */
export type Category = TileFamily;
export const CATEGORIES: readonly Category[] = ["intake", "carrier", "ads", "msg", "auto", "app"];

/** The history adds one more: what people did by hand. */
export type HistoryCategory = "all" | "team" | Category;
export const HISTORY_CATEGORIES: readonly HistoryCategory[] = ["all", "team", ...CATEGORIES];

/** Rules whose area is not the system they are filed under. */
const RULE_AREA: Partial<Record<IssueRule, Category>> = {
  ads_no_orders: "ads",
  job_failing: "auto",
  job_hanging: "auto",
  server_error: "app",
  browser_error: "app",
  login_failures: "app",
  large_export: "app",
  whatsapp_down: "msg",
  import_rows: "intake",
};

function areaOfSystem(system: string): Category | null {
  if (system === "jobs") return "auto";
  if (system === "app") return "app";
  if (system === "meta") return "ads";
  if (system === "whatsapp") return "msg";
  if (system === "shops" || system.startsWith("shop:")) return "intake";
  if (system.startsWith("carrier:")) return "carrier";
  return null;
}

export function categoryOfIssue(issue: Pick<Issue, "rule" | "system">): Category {
  return RULE_AREA[issue.rule] ?? areaOfSystem(issue.system) ?? "app";
}

export interface AreaSummary {
  urgent: number;
  watch: number;
  systems: number;
  healthy: number;
}

export function summarise(issues: Issue[], systems: SystemTile[]): Record<Category, AreaSummary> {
  const out = Object.fromEntries(CATEGORIES.map((c) => [c, { urgent: 0, watch: 0, systems: 0, healthy: 0 }])) as Record<Category, AreaSummary>;
  for (const i of issues) {
    if (i.status !== "open") continue;
    const s = out[categoryOfIssue(i)];
    if (i.severity === "critical") s.urgent += 1;
    else s.watch += 1;
  }
  for (const t of systems) {
    if (t.state === "off") continue; // not connected: neither a system to watch nor a healthy one
    const s = out[t.family] ?? out.app;
    s.systems += 1;
    if (t.state !== "fail" && t.state !== "warn") s.healthy += 1;
  }
  return out;
}

/** A history row's area. People's own actions are « Équipe », whatever they touched. */
export function categoryOfRow(row: Pick<FeedRow, "family" | "kind" | "params">): Exclude<HistoryCategory, "all"> {
  if (row.family === "team") return "team";
  if (row.family === "sec") return "app";
  if (row.family === "auto") return "auto";
  const [domain] = row.kind.split(".");
  if (domain === "intake") return "intake";
  if (domain === "whatsapp") return "msg";
  if (domain === "sync" && row.params?.system === "Meta") return "ads";
  if (domain === "issue") {
    const rule = String(row.params?.rule ?? "") as IssueRule;
    return categoryOfIssue({ rule, system: String(row.params?.system ?? "") });
  }
  return "carrier";
}

/**
 * The feed is filtered server-side by FAMILY (who wrote the row). An area maps
 * onto the narrowest family; the four outside areas share « ext » and are
 * narrowed on screen.
 */
export function feedQueryFor(c: HistoryCategory): { family: Family | null; local: boolean } {
  switch (c) {
    case "all":
      return { family: null, local: false };
    case "team":
      return { family: "team", local: false };
    case "auto":
      return { family: "auto", local: false };
    case "app":
      return { family: "sec", local: false };
    default:
      return { family: "ext", local: true };
  }
}
