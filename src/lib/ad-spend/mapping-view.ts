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
  MappingTreeDTO,
  MappingVersionDTO,
} from "./mapping-types";

/* ─────────────────────────── resolution ─────────────────────────── */

/** The campaign's version in force today, if any. */
export function campaignVersion(c: CampaignNodeDTO): MappingVersionDTO | null {
  return c.current_id ? (c.versions.find((v) => v.id === c.current_id) ?? null) : null;
}

/** An ad set's OWN version in force today, unless it is "follow the campaign". */
export function adsetOwnVersion(s: AdsetNodeDTO): MappingVersionDTO | null {
  const own = s.own_current_id ? s.versions.find((v) => v.id === s.own_current_id) : undefined;
  return own && own.kind !== "inherit" ? own : null;
}

/** What an ad set sells today: its own version, or — inherited — its campaign's. */
export function adsetResolution(
  c: CampaignNodeDTO,
  s: AdsetNodeDTO,
): { version: MappingVersionDTO | null; inherited: boolean } {
  const own = adsetOwnVersion(s);
  return own ? { version: own, inherited: false } : { version: campaignVersion(c), inherited: true };
}

/** The ad sets attributed on their own rather than following their campaign. */
export function ownAdsets(c: CampaignNodeDTO): AdsetNodeDTO[] {
  return c.adsets.filter((s) => adsetOwnVersion(s) !== null);
}

export function isRunning(status: string | null | undefined): boolean {
  return status === "ACTIVE";
}

export function campaignIsActive(c: CampaignNodeDTO): boolean {
  return isRunning(c.status) || c.adsets.some((s) => isRunning(s.status));
}

/**
 * The one count of work, on the page's button and in the drawer: money is
 * waiting for a product, or the campaign runs with nothing saying what it
 * sells. A paused campaign that never spent a dinar is not work — v1 counted
 * it, and showed 6 where 2 campaigns (542 LYD) actually needed a decision.
 */
export function needsAttribution(c: CampaignNodeDTO): boolean {
  if (c.spend_unattributed > 0) return true;
  if (!campaignIsActive(c) || campaignVersion(c)) return false;
  return c.adsets.length === 0 || c.adsets.some((s) => adsetOwnVersion(s) === null);
}

/* ─────────────────────────── list ─────────────────────────── */

export type CampaignGroup = "todo" | "live" | "paused" | "never";

/** The status lives in the group, so a row does not have to repeat it. */
export function campaignGroup(c: CampaignNodeDTO): CampaignGroup {
  if (needsAttribution(c)) return "todo";
  if (campaignIsActive(c)) return "live";
  return c.spend_life > 0 ? "paused" : "never";
}

const bySpend = (a: CampaignNodeDTO, b: CampaignNodeDTO) =>
  b.spend_life - a.spend_life || (a.name ?? a.id).localeCompare(b.name ?? b.id);

function matches(c: CampaignNodeDTO, q: string, productNames: Record<string, string>): boolean {
  if (!q) return true;
  const haystack = [
    c.name ?? c.id,
    ...c.adsets.map((s) => s.name ?? s.id),
    ...(campaignVersion(c)?.lines ?? []).map((l) => productNames[l.product_id] ?? ""),
  ]
    .join("\n")
    .toLocaleLowerCase();
  return haystack.includes(q);
}

/** Search, then group; each group by what it spent, largest first. */
export function groupCampaigns(
  campaigns: CampaignNodeDTO[],
  opts: { query: string; productNames: Record<string, string> },
): Record<CampaignGroup, CampaignNodeDTO[]> {
  const q = opts.query.trim().toLocaleLowerCase();
  const out: Record<CampaignGroup, CampaignNodeDTO[]> = { todo: [], live: [], paused: [], never: [] };
  for (const c of [...campaigns].sort(bySpend)) {
    if (matches(c, q, opts.productNames)) out[campaignGroup(c)].push(c);
  }
  return out;
}

/** Where the drawer opens: the campaign with the most money waiting. */
export function firstToAttribute(campaigns: CampaignNodeDTO[]): CampaignNodeDTO | null {
  return [...campaigns].sort(bySpend).find(needsAttribution) ?? null;
}

/** The sentence at the top of the drawer, over the whole history. */
export function attributionStatus(tree: Pick<MappingTreeDTO, "coverage" | "campaigns">): {
  waiting: number;
  waitingCampaigns: number;
  general: number;
  /** Floored to 0.1 — 99.97 % must never read as 100 %. */
  onProductsPct: number;
  toAttribute: number;
} {
  const life = tree.coverage.life;
  return {
    waiting: life.unmapped,
    waitingCampaigns: tree.campaigns.filter((c) => c.spend_unattributed > 0).length,
    general: life.market_level,
    onProductsPct: life.total > 0 ? Math.floor((life.attributed / life.total) * 1000) / 10 : 0,
    toAttribute: tree.campaigns.filter(needsAttribution).length,
  };
}

/* ─────────────────────────── drafts ─────────────────────────── */

export interface EditorDraft {
  /** Ad set only: it sells what its campaign sells. The products stay in the draft, so switching back loses nothing. */
  follow: boolean;
  kind: "products" | "market_level";
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

/**
 * Fixed shares seeded from the orders' split, in whole percents that make
 * exactly 100 (largest remainder). Whole, because a person edits them next.
 */
export function wholeShares(pcts: number[]): number[] {
  return splitInteger(100, pcts);
}

/** The manual total, to the cent — never float noise like 99.99999. */
export function manualSum<T extends { share_pct: number | null }>(lines: T[]): number {
  return lines.reduce((s, l) => s + Math.round((l.share_pct ?? 0) * 100), 0) / 100;
}

export type DraftProblem = "no_products" | "manual_sum" | "no_date";

export function draftProblems(d: EditorDraft): DraftProblem[] {
  const out: DraftProblem[] = [];
  if (!d.follow && d.kind === "products") {
    if (d.lines.length === 0) out.push("no_products");
    else if (d.lines.length > 1 && d.split_mode === "manual" && manualSum(d.lines) !== 100) out.push("manual_sum");
  }
  if (d.scope === "from" && !/^\d{4}-\d{2}-\d{2}$/.test(d.from)) out.push("no_date");
  return out;
}

/**
 * The editor's starting point: what the target sells today, over all history.
 * An ad set with nothing of its own starts from a copy of its campaign's
 * products — the real case is "this ad set ALSO sells X", so the person adds a
 * product rather than rebuilding the list.
 */
export function draftFor(
  target: { own: MappingVersionDTO | null; campaign: MappingVersionDTO | null; isAdset: boolean },
  today: string,
): EditorDraft {
  const base = target.own ?? (target.isAdset ? target.campaign : null);
  const products = base?.kind === "products";
  return {
    follow: false,
    kind: base?.kind === "market_level" ? "market_level" : "products",
    split_mode: (products && base?.split_mode) || "auto_orders",
    lines: products && base ? base.lines.map((l) => ({ ...l })) : [],
    scope: "all",
    from: today,
  };
}

const sameProducts = (a: { product_id: string }[], b: { product_id: string }[]) =>
  a.length === b.length && a.every((x) => b.some((y) => y.product_id === x.product_id));

/**
 * Would saving this draft change nothing? `versions` are the target's OWN
 * versions, superseded ones included. "All history" over anything but one live
 * version starting at the beginning rewrites something, so only that case can
 * be unchanged; a dated start is always a decision.
 */
export function isUnchanged(d: EditorDraft, versions: MappingVersionDTO[]): boolean {
  if (d.scope === "from") return false;
  const live = versions.filter((v) => v.superseded_at === null);
  if (d.follow) return live.length === 0 || (live.length === 1 && live[0].kind === "inherit" && live[0].effective_from === null);
  if (live.length !== 1) return false;
  const v = live[0];
  if (v.effective_from !== null || v.kind !== d.kind) return false;
  if (d.kind === "market_level") return true;
  if (!sameProducts(v.lines, d.lines)) return false;
  if (d.lines.length < 2) return true;
  if ((v.split_mode ?? "auto_orders") !== d.split_mode) return false;
  if (d.split_mode !== "manual") return true;
  return d.lines.every((l) => Math.round((l.share_pct ?? 0) * 100) === Math.round((v.lines.find((x) => x.product_id === l.product_id)?.share_pct ?? 0) * 100));
}

export function toDraftBody(
  d: EditorDraft,
  target: { marketId: string; adAccountId: string; campaignId: string; adsetId: string | null },
): MappingDraftBody {
  const kind = d.follow ? "inherit" : d.kind;
  const products = kind === "products";
  const several = products && d.lines.length > 1;
  const manual = several && d.split_mode === "manual";
  return {
    market_id: target.marketId,
    ad_account_id: target.adAccountId,
    campaign_id: target.campaignId,
    adset_id: target.adsetId,
    kind,
    split_mode: several ? d.split_mode : null,
    lines: products ? d.lines.map((l) => ({ product_id: l.product_id, share_pct: manual ? l.share_pct : null })) : [],
    effective_from: d.scope === "all" ? null : d.from,
  };
}
