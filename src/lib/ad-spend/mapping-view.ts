/**
 * The mapping drawer's view logic, kept pure so it can be tested without a DOM.
 * Client-safe: types and arithmetic only — no money is computed here (the
 * preview route does that, with the save's own code).
 */

import { splitInteger } from "./allocation";
import type {
  AdsetNodeDTO,
  CampaignNodeDTO,
  MappingDraftBody,
  MappingKind,
  MappingVersionDTO,
} from "./mapping-types";

/* ─────────────────────────── resolution ─────────────────────────── */

/** The campaign's version in force today, if any. */
export function campaignVersion(c: CampaignNodeDTO): MappingVersionDTO | null {
  return c.current_id ? (c.versions.find((v) => v.id === c.current_id) ?? null) : null;
}

/** What an ad set sells today: its own version, or — inherited — its campaign's. */
export function adsetResolution(
  c: CampaignNodeDTO,
  s: AdsetNodeDTO,
): { version: MappingVersionDTO | null; inherited: boolean } {
  const own = s.own_current_id ? s.versions.find((v) => v.id === s.own_current_id) : undefined;
  if (own && own.kind !== "inherit") return { version: own, inherited: false };
  return { version: campaignVersion(c), inherited: true };
}

/** Nobody has ever decided anything live for this campaign. */
export function isUnmapped(c: CampaignNodeDTO): boolean {
  return !c.versions.some((v) => v.superseded_at === null);
}

export function isRunning(status: string | null | undefined): boolean {
  return status === "ACTIVE";
}

export function campaignIsActive(c: CampaignNodeDTO): boolean {
  return isRunning(c.status) || c.adsets.some((s) => isRunning(s.status));
}

/* ─────────────────────────── list ─────────────────────────── */

export type ListFilter = "unmapped" | "active" | "all";

export function filterCampaigns(
  campaigns: CampaignNodeDTO[],
  opts: { filter: ListFilter; query: string; hideNeverSpent: boolean; productNames: Record<string, string> },
): CampaignNodeDTO[] {
  const q = opts.query.trim().toLocaleLowerCase();
  return campaigns.filter((c) => {
    if (opts.filter === "unmapped" && !isUnmapped(c)) return false;
    if (opts.filter === "active" && !campaignIsActive(c)) return false;
    if (opts.hideNeverSpent && c.spend_life <= 0) return false;
    if (!q) return true;
    const version = campaignVersion(c);
    const haystack = [
      c.name ?? c.id,
      ...c.adsets.map((s) => s.name ?? s.id),
      ...(version?.lines ?? []).map((l) => opts.productNames[l.product_id] ?? ""),
    ]
      .join("\n")
      .toLocaleLowerCase();
    return haystack.includes(q);
  });
}

/* ─────────────────────────── drafts ─────────────────────────── */

export interface EditorDraft {
  kind: MappingKind;
  /** Kept even with one product, so adding a second one keeps the user's choice. */
  split_mode: "auto_orders" | "manual";
  lines: { product_id: string; share_pct: number | null }[];
  scope: "all" | "from";
  /** YYYY-MM-DD, used when scope = "from". */
  from: string;
}

/** Even manual shares, to the cent, that always make exactly 100. */
export function evenShares(n: number): number[] {
  if (n <= 0) return [];
  return splitInteger(10_000, Array.from({ length: n }, () => 1)).map((c) => c / 100);
}

/** The manual total, to the cent — never float noise like 99.99999. */
export function manualSum<T extends { share_pct: number | null }>(lines: T[]): number {
  return lines.reduce((s, l) => s + Math.round((l.share_pct ?? 0) * 100), 0) / 100;
}

export type DraftProblem = "no_products" | "manual_sum" | "no_date";

export function draftProblems(d: EditorDraft): DraftProblem[] {
  const out: DraftProblem[] = [];
  if (d.kind === "products") {
    if (d.lines.length === 0) out.push("no_products");
    else if (d.lines.length > 1 && d.split_mode === "manual" && manualSum(d.lines) !== 100) out.push("manual_sum");
  }
  if (d.scope === "from" && !/^\d{4}-\d{2}-\d{2}$/.test(d.from)) out.push("no_date");
  return out;
}

/**
 * The editor's starting point: what is in force, changed from today. An
 * unmapped campaign has no history worth protecting, so it starts on "all
 * history" — its spend is waiting for exactly this decision.
 */
export function draftFromVersion(
  version: MappingVersionDTO | null,
  ctx: { today: string; isAdset: boolean },
): EditorDraft {
  if (!version) {
    return ctx.isAdset
      ? { kind: "inherit", split_mode: "auto_orders", lines: [], scope: "from", from: ctx.today }
      : { kind: "products", split_mode: "auto_orders", lines: [], scope: "all", from: ctx.today };
  }
  return {
    kind: version.kind,
    split_mode: version.split_mode ?? "auto_orders",
    lines: version.lines.map((l) => ({ ...l })),
    scope: "from",
    from: ctx.today,
  };
}

export function toDraftBody(
  d: EditorDraft,
  target: { marketId: string; adAccountId: string; campaignId: string; adsetId: string | null },
): MappingDraftBody {
  const products = d.kind === "products";
  const several = products && d.lines.length > 1;
  const manual = several && d.split_mode === "manual";
  return {
    market_id: target.marketId,
    ad_account_id: target.adAccountId,
    campaign_id: target.campaignId,
    adset_id: target.adsetId,
    kind: d.kind,
    split_mode: several ? d.split_mode : null,
    lines: products ? d.lines.map((l) => ({ product_id: l.product_id, share_pct: manual ? l.share_pct : null })) : [],
    effective_from: d.scope === "all" ? null : d.from,
  };
}
