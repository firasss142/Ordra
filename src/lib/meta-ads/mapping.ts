import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { toMillimes, fromMillimes } from "@/lib/calculations/math";
import {
  versionInForce,
  withDraft,
  type AdSpendProjectionRow,
  type MappingVersion,
} from "@/lib/ad-spend/allocation";
import type {
  AdsetNodeDTO,
  CampaignNodeDTO,
  CoverageDTO,
  MappingAccountDTO,
  MappingDraftBody,
  MappingPreviewDTO,
  MappingProductDTO,
  MappingTreeDTO,
  MappingVersionDTO,
  NodeSpend,
  SpendBucket,
} from "@/lib/ad-spend/mapping-types";
import { clampToHistory, computeProjection, loadLiveVersions, loadOrderCounts } from "./rebuild";
import { accountTimezone, loadFxRate } from "./sync";

/**
 * Everything behind the mapping drawer: the tree it lists, the validation of a
 * change, and the preview that says what a change will move before it is made.
 *
 * SERVER-SIDE ONLY (service role). The preview runs the very projection code the
 * save will run (`computeProjection` with the draft applied by `withDraft`), so
 * "what the screen promised" and "what the ledger did" cannot drift apart.
 */

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Today's date where Meta cuts its days for this account. */
export function todayIn(timezone: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/* ─────────────────────────── validation ─────────────────────────── */

/**
 * `requireUuids`: the routes turn it on so a malformed product id is a 400 here,
 * not a cast error (a 500) inside the RPC.
 */
export function parseDraft(
  body: unknown,
  opts: { requireUuids?: boolean } = {},
): { ok: true; draft: MappingDraftBody } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

  const market_id = str(b.market_id);
  const ad_account_id = str(b.ad_account_id);
  const campaign_id = str(b.campaign_id);
  const adset_id = str(b.adset_id);
  if (!market_id || !ad_account_id || !campaign_id) {
    return { ok: false, error: "market_id, ad_account_id and campaign_id are required" };
  }

  const kind = b.kind;
  if (kind !== "products" && kind !== "market_level" && kind !== "inherit") {
    return { ok: false, error: "kind must be products, market_level or inherit" };
  }
  if (kind === "inherit" && !adset_id) {
    return { ok: false, error: "only an ad set can follow its campaign" };
  }

  const effective_from = b.effective_from === null || b.effective_from === undefined ? null : str(b.effective_from);
  if (effective_from !== null && !ISO_DAY.test(effective_from)) {
    return { ok: false, error: "effective_from must be YYYY-MM-DD or null" };
  }

  const rawLines = Array.isArray(b.lines) ? b.lines : [];
  const lines = rawLines.map((l) => {
    const line = (l ?? {}) as Record<string, unknown>;
    const pct = line.share_pct;
    return {
      product_id: str(line.product_id) ?? "",
      share_pct: pct === null || pct === undefined || pct === "" ? null : Number(pct),
    };
  });

  let split_mode: MappingDraftBody["split_mode"] = null;
  if (kind === "products") {
    if (lines.length === 0 || lines.some((l) => !l.product_id)) {
      return { ok: false, error: "a products mapping needs at least one product" };
    }
    if (opts.requireUuids && lines.some((l) => !UUID.test(l.product_id))) {
      return { ok: false, error: "product_id must be a UUID" };
    }
    if (new Set(lines.map((l) => l.product_id)).size !== lines.length) {
      return { ok: false, error: "a product appears twice" };
    }
    if (lines.length > 1) {
      if (b.split_mode !== "auto_orders" && b.split_mode !== "manual") {
        return { ok: false, error: "several products need split_mode auto_orders or manual" };
      }
      split_mode = b.split_mode;
      if (split_mode === "manual") {
        if (lines.some((l) => l.share_pct === null || !Number.isFinite(l.share_pct) || l.share_pct < 0)) {
          return { ok: false, error: "every manual share must be a number" };
        }
        const total = lines.reduce((s, l) => s + Math.round((l.share_pct as number) * 100), 0);
        if (total !== 10_000) return { ok: false, error: "manual shares must sum to 100" };
      }
    }
  } else if (lines.length > 0) {
    return { ok: false, error: `${kind} takes no products` };
  }

  return {
    ok: true,
    draft: {
      market_id,
      ad_account_id,
      campaign_id,
      adset_id,
      kind,
      split_mode,
      lines: kind === "products" ? lines.map((l) => ({ product_id: l.product_id, share_pct: split_mode === "manual" ? l.share_pct : null })) : [],
      effective_from,
    },
  };
}

/* ─────────────────────────── account ─────────────────────────── */

export interface AccountRow {
  ad_account_id: string;
  market_id: string;
  account_name: string | null;
  account_currency: string;
  account_timezone: string | null;
  last_synced_at: string | null;
  adset_history_from: string | null;
  is_active?: boolean;
  markets?: { code: string } | null;
}

const ACCOUNT_COLUMNS =
  "ad_account_id, market_id, account_name, account_currency, account_timezone, last_synced_at, adset_history_from, is_active, markets(code)";

export async function loadAccount(admin: SupabaseClient, adAccountId: string): Promise<AccountRow | null> {
  const { data } = await admin.from("meta_ad_accounts").select(ACCOUNT_COLUMNS).eq("ad_account_id", adAccountId).maybeSingle();
  return (data as AccountRow | null) ?? null;
}

/**
 * An ad set target must belong to the campaign it is named with — otherwise
 * the version would never resolve for anything. Known from the catalogue, or
 * failing that from its facts.
 */
export async function adsetBelongs(
  admin: SupabaseClient,
  q: { adAccountId: string; campaignId: string; adsetId: string },
): Promise<boolean> {
  const { data } = await admin
    .from("meta_ad_sets")
    .select("external_campaign_id")
    .eq("ad_account_id", q.adAccountId)
    .eq("external_adset_id", q.adsetId)
    .maybeSingle();
  if (data) return (data as { external_campaign_id: string }).external_campaign_id === q.campaignId;
  const { data: fact } = await admin
    .from("meta_adset_daily")
    .select("external_campaign_id")
    .eq("ad_account_id", q.adAccountId)
    .eq("external_adset_id", q.adsetId)
    .limit(1);
  const first = ((fact ?? []) as { external_campaign_id: string }[])[0];
  return !!first && first.external_campaign_id === q.campaignId;
}

/* ─────────────────────────── tree ─────────────────────────── */

interface SpendRow {
  external_campaign_id: string | null;
  external_adset_id: string | null;
  campaign_name: string | null;
  adset_name: string | null;
  ad_account_id: string | null;
  period_start: string;
  amount: number | string;
  platform_results: number | null;
  product_id: string | null;
  allocation_basis: string | null;
}

interface VersionRow {
  id: string;
  ad_account_id: string;
  external_campaign_id: string;
  external_adset_id: string | null;
  effective_from: string | null;
  kind: MappingVersion["kind"];
  split_mode: MappingVersion["split_mode"];
  created_by: string | null;
  created_at: string;
  superseded_at: string | null;
}

const emptyCoverage = (): CoverageDTO => ({ total: 0, attributed: 0, market_level: 0, unmapped: 0 });

function addCoverage(c: CoverageDTO, row: SpendRow, amount: number) {
  c.total += amount;
  if (row.product_id) c.attributed += amount;
  else if (row.allocation_basis === "market_level") c.market_level += amount;
  else c.unmapped += amount;
}

function roundCoverage(c: CoverageDTO): CoverageDTO {
  const r = (x: number) => fromMillimes(toMillimes(x));
  return { total: r(c.total), attributed: r(c.attributed), market_level: r(c.market_level), unmapped: r(c.unmapped) };
}

function newSpend(): NodeSpend & { byDay: Map<string, number>; byProduct: Map<string, number> } {
  return {
    spend_window: 0,
    spend_life: 0,
    spend_unattributed: 0,
    results_window: 0,
    first_day: null,
    last_day: null,
    daily: [],
    byDay: new Map(),
    byProduct: new Map(),
  };
}

function addSpend(n: ReturnType<typeof newSpend>, row: SpendRow, amount: number, inWindow: boolean) {
  n.spend_life += amount;
  if (row.product_id) n.byProduct.set(row.product_id, (n.byProduct.get(row.product_id) ?? 0) + amount);
  else if (row.allocation_basis !== "market_level") n.spend_unattributed += amount;
  if (amount > 0) {
    if (!n.first_day || row.period_start < n.first_day) n.first_day = row.period_start;
    if (!n.last_day || row.period_start > n.last_day) n.last_day = row.period_start;
  }
  if (inWindow) {
    n.spend_window += amount;
    n.results_window += Number(row.platform_results) || 0;
    n.byDay.set(row.period_start, (n.byDay.get(row.period_start) ?? 0) + amount);
  }
}

function finishSpend(n: ReturnType<typeof newSpend>): NodeSpend {
  const r = (x: number) => fromMillimes(toMillimes(x));
  return {
    spend_window: r(n.spend_window),
    spend_life: r(n.spend_life),
    spend_unattributed: r(n.spend_unattributed),
    results_window: n.results_window,
    first_day: n.first_day,
    last_day: n.last_day,
    daily: [...n.byDay.entries()]
      .filter(([, v]) => v > 0)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([d, v]) => [d, r(v)]),
  };
}

/**
 * `from`/`to` bound the "window" figures (spend_window, results_window, daily).
 * Without them the window is the whole history — from the first recorded
 * spend (or the account's ad-set history) to today — which is what the drawer
 * shows: a mapping holds for all of it, so a page period has no place there.
 */
export async function loadMappingTree(
  admin: SupabaseClient,
  q: { marketId: string; from?: string; to?: string; now?: Date },
): Promise<MappingTreeDTO> {
  const { data: accountData } = await admin
    .from("meta_ad_accounts")
    .select(ACCOUNT_COLUMNS)
    .eq("market_id", q.marketId);
  // `markets(code)` is typed as an array by inference; PostgREST returns one object for a to-one embed.
  const accountRows = ((accountData ?? []) as unknown as AccountRow[]).filter((a) => a.is_active !== false);

  const tz = accountRows[0] ? accountTimezone(accountRows[0]) : "UTC";
  const today = todayIn(tz, q.now);

  const [campaignCat, adsetCat, spendRows, versionRows, productRows] = await Promise.all([
    admin.from("meta_ad_campaigns").select("ad_account_id, external_campaign_id, name, objective, effective_status, created_time").eq("market_id", q.marketId),
    admin.from("meta_ad_sets").select("ad_account_id, external_adset_id, external_campaign_id, name, effective_status, created_time").eq("market_id", q.marketId),
    fetchAllRows<SpendRow>(
      admin
        .from("ad_spend")
        .select("external_campaign_id, external_adset_id, campaign_name, adset_name, ad_account_id, period_start, amount, platform_results, product_id, allocation_basis")
        .eq("market_id", q.marketId)
        .eq("source", "meta")
        .eq("is_active", true)
        .order("period_start", { ascending: true }),
    ),
    admin
      .from("ad_spend_mappings")
      .select("id, ad_account_id, external_campaign_id, external_adset_id, effective_from, kind, split_mode, created_by, created_at, superseded_at")
      .eq("market_id", q.marketId),
    admin.from("products").select("id, name, sku, image_url, is_active").eq("market_id", q.marketId),
  ]);

  // ── versions, with lines and author names ──
  const versions = (versionRows.data ?? []) as VersionRow[];
  const versionIds = versions.map((v) => v.id);
  const authorIds = [...new Set(versions.map((v) => v.created_by).filter((x): x is string => !!x))];
  const [linesRes, usersRes] = await Promise.all([
    versionIds.length
      ? admin.from("ad_spend_mapping_lines").select("mapping_id, product_id, share_pct").in("mapping_id", versionIds)
      : Promise.resolve({ data: [] }),
    authorIds.length ? admin.from("users").select("id, full_name").in("id", authorIds) : Promise.resolve({ data: [] }),
  ]);
  const linesBy = new Map<string, { product_id: string; share_pct: number | null }[]>();
  for (const l of (linesRes.data ?? []) as { mapping_id: string; product_id: string; share_pct: number | string | null }[]) {
    const list = linesBy.get(l.mapping_id) ?? [];
    list.push({ product_id: l.product_id, share_pct: l.share_pct == null ? null : Number(l.share_pct) });
    linesBy.set(l.mapping_id, list);
  }
  const nameBy = new Map(((usersRes.data ?? []) as { id: string; full_name: string | null }[]).map((u) => [u.id, u.full_name]));

  const toDTO = (v: VersionRow): MappingVersionDTO => ({
    id: v.id,
    external_adset_id: v.external_adset_id,
    effective_from: v.effective_from,
    kind: v.kind,
    split_mode: v.split_mode,
    lines: (linesBy.get(v.id) ?? []).sort((a, b) => a.product_id.localeCompare(b.product_id)),
    created_by_name: v.created_by ? (nameBy.get(v.created_by) ?? null) : null,
    created_at: v.created_at,
    superseded_at: v.superseded_at,
  });
  const newestFirst = (a: MappingVersionDTO, b: MappingVersionDTO) => b.created_at.localeCompare(a.created_at);
  const liveAsVersion = (v: VersionRow): MappingVersion => ({ ...toDTO(v), external_campaign_id: v.external_campaign_id });
  const live = versions.filter((v) => v.superseded_at === null).map(liveAsVersion);

  // ── nodes ──
  type CampaignAcc = {
    id: string;
    ad_account_id: string;
    name: string | null;
    objective: string | null;
    status: string | null;
    created_time: string | null;
    spend: ReturnType<typeof newSpend>;
    adsets: Map<string, { id: string; name: string | null; status: string | null; created_time: string | null; spend: ReturnType<typeof newSpend> }>;
  };
  const campaigns = new Map<string, CampaignAcc>();
  const campaignOf = (id: string, account: string): CampaignAcc => {
    let c = campaigns.get(id);
    if (!c) {
      c = { id, ad_account_id: account, name: null, objective: null, status: null, created_time: null, spend: newSpend(), adsets: new Map() };
      campaigns.set(id, c);
    }
    return c;
  };
  const adsetOf = (c: CampaignAcc, id: string) => {
    let s = c.adsets.get(id);
    if (!s) {
      s = { id, name: null, status: null, created_time: null, spend: newSpend() };
      c.adsets.set(id, s);
    }
    return s;
  };

  for (const row of (campaignCat.data ?? []) as { ad_account_id: string; external_campaign_id: string; name: string | null; objective: string | null; effective_status: string | null; created_time: string | null }[]) {
    const c = campaignOf(row.external_campaign_id, row.ad_account_id);
    Object.assign(c, { name: row.name, objective: row.objective, status: row.effective_status, created_time: row.created_time });
  }
  for (const row of (adsetCat.data ?? []) as { ad_account_id: string; external_adset_id: string; external_campaign_id: string; name: string | null; effective_status: string | null; created_time: string | null }[]) {
    const s = adsetOf(campaignOf(row.external_campaign_id, row.ad_account_id), row.external_adset_id);
    Object.assign(s, { name: row.name, status: row.effective_status, created_time: row.created_time });
  }

  let lifeFrom: string | null = null;
  for (const row of spendRows) {
    if (row.external_campaign_id && (!lifeFrom || row.period_start < lifeFrom)) lifeFrom = row.period_start;
  }
  const historyFrom = accountRows.map((a) => a.adset_history_from).filter((d): d is string => !!d).sort()[0] ?? null;
  const windowTo = q.to ?? today;
  const windowFrom = q.from ?? [lifeFrom, historyFrom, windowTo].filter((d): d is string => !!d).sort()[0];

  const coverageWindow = emptyCoverage();
  const coverageLife = emptyCoverage();
  for (const row of spendRows) {
    if (!row.external_campaign_id) continue;
    const amount = Number(row.amount) || 0;
    const inWindow = row.period_start >= windowFrom && row.period_start <= windowTo;
    addCoverage(coverageLife, row, amount);
    if (inWindow) addCoverage(coverageWindow, row, amount);

    const c = campaignOf(row.external_campaign_id, row.ad_account_id ?? accountRows[0]?.ad_account_id ?? "");
    if (!c.name && row.campaign_name) c.name = row.campaign_name;
    addSpend(c.spend, row, amount, inWindow);
    if (row.external_adset_id) {
      const s = adsetOf(c, row.external_adset_id);
      if (!s.name && row.adset_name) s.name = row.adset_name;
      addSpend(s.spend, row, amount, inWindow);
    }
  }
  for (const v of versions) campaignOf(v.external_campaign_id, v.ad_account_id);

  const campaignNodes: CampaignNodeDTO[] = [...campaigns.values()].map((c) => {
    const own = versions.filter((v) => v.external_campaign_id === c.id && v.external_adset_id === null).map(toDTO).sort(newestFirst);
    const current = versionInForce(live, c.id, null, today);
    const adsets: AdsetNodeDTO[] = [...c.adsets.values()]
      .map((s) => ({
        id: s.id,
        name: s.name,
        status: s.status,
        created_time: s.created_time,
        ...finishSpend(s.spend),
        versions: versions.filter((v) => v.external_campaign_id === c.id && v.external_adset_id === s.id).map(toDTO).sort(newestFirst),
        own_current_id: versionInForce(live, c.id, s.id, today)?.id ?? null,
      }))
      .sort((a, b) => b.spend_window - a.spend_window || b.spend_life - a.spend_life || (a.name ?? "").localeCompare(b.name ?? ""));
    return {
      id: c.id,
      ad_account_id: c.ad_account_id,
      name: c.name,
      objective: c.objective,
      status: c.status,
      created_time: c.created_time,
      ...finishSpend(c.spend),
      versions: own,
      current_id: current?.id ?? null,
      spend_by_product: Object.fromEntries(
        [...c.spend.byProduct.entries()].filter(([, v]) => v !== 0).map(([k, v]) => [k, fromMillimes(toMillimes(v))]),
      ),
      adsets,
    };
  });
  campaignNodes.sort((a, b) => b.spend_window - a.spend_window || b.spend_life - a.spend_life || (a.name ?? "").localeCompare(b.name ?? ""));

  // ── products, with the orders that make the automatic split legible ──
  const products = ((productRows.data ?? []) as { id: string; name: string; sku: string | null; image_url: string | null; is_active: boolean }[]);
  const since30 = new Date(`${today}T00:00:00Z`);
  since30.setUTCDate(since30.getUTCDate() - 29);
  const counts = await loadOrderCounts(admin, {
    marketId: q.marketId,
    since: since30.toISOString().slice(0, 10),
    until: today,
    timezone: tz,
    productIds: products.map((p) => p.id),
  });
  const orders30 = new Map<string, number>();
  for (const byProduct of counts.values()) for (const [p, n] of byProduct) orders30.set(p, (orders30.get(p) ?? 0) + n);
  const productDTOs: MappingProductDTO[] = products
    .map((p) => ({ id: p.id, name: p.name, sku: p.sku, image_url: p.image_url, is_active: p.is_active, orders_30d: orders30.get(p.id) ?? 0 }))
    .sort((a, b) => Number(b.is_active) - Number(a.is_active) || b.orders_30d - a.orders_30d || a.name.localeCompare(b.name));

  const fx = accountRows[0] ? await loadFxRate(admin, q.marketId, accountRows[0].account_currency) : null;
  const accounts: MappingAccountDTO[] = accountRows.map((a) => ({
    ad_account_id: a.ad_account_id,
    account_name: a.account_name,
    currency: a.account_currency,
    fx_rate: a.account_currency === "LYD" || a.account_currency === "TND" ? 1 : fx,
    timezone: accountTimezone(a),
    last_synced_at: a.last_synced_at,
    history_from: a.adset_history_from,
  }));

  return {
    accounts,
    window: { from: windowFrom, to: windowTo },
    campaigns: campaignNodes,
    products: productDTOs,
    coverage: { window: roundCoverage(coverageWindow), life: roundCoverage(coverageLife), life_from: lifeFrom },
  };
}

/* ─────────────────────────── preview ─────────────────────────── */

async function firstFactDay(admin: SupabaseClient, adAccountId: string, campaignId: string, adsetId: string | null) {
  let query = admin
    .from("meta_adset_daily")
    .select("day")
    .eq("ad_account_id", adAccountId)
    .eq("external_campaign_id", campaignId);
  if (adsetId) query = query.eq("external_adset_id", adsetId);
  const { data } = await query.order("day", { ascending: true }).limit(1);
  return ((data ?? [])[0] as { day?: string } | undefined)?.day ?? null;
}

const sumBy = (rows: AdSpendProjectionRow[], pick: (r: AdSpendProjectionRow) => boolean) =>
  rows.reduce((s, r) => (pick(r) ? s + toMillimes(r.amount) : s), 0);

/**
 * What saving `draft` would move, computed by the save's own code path. Also
 * returns the rewrite range the save must use.
 */
export async function previewDraft(
  admin: SupabaseClient,
  draft: MappingDraftBody,
  account: AccountRow,
  now = new Date(),
): Promise<MappingPreviewDTO> {
  const tz = accountTimezone(account);
  const today = todayIn(tz, now);
  const start =
    draft.effective_from ?? (await firstFactDay(admin, draft.ad_account_id, draft.campaign_id, draft.adset_id)) ?? today;
  const range = clampToHistory(start, today, account.adset_history_from);

  const empty: MappingPreviewDTO = {
    range: null,
    clamped: false,
    history_from: account.adset_history_from,
    days: 0,
    moved: 0,
    products: [],
    shares: [],
    statements: [],
  };
  if (!range) return empty;

  const live = await loadLiveVersions(admin, draft.ad_account_id);
  const next = withDraft(live, {
    external_campaign_id: draft.campaign_id,
    external_adset_id: draft.adset_id,
    effective_from: draft.effective_from,
    kind: draft.kind,
    split_mode: draft.split_mode,
    lines: draft.lines,
  });

  const scope = {
    adAccountId: draft.ad_account_id,
    marketId: account.market_id,
    timezone: tz,
    since: range.since,
    until: range.until,
    campaignIds: [draft.campaign_id],
  };
  const [before, after] = await Promise.all([
    computeProjection(admin, { ...scope, versions: live }),
    computeProjection(admin, { ...scope, versions: next }),
  ]);

  // ── money moved, per product — and, with no product, general vs waiting ──
  const bucketOf = (r: AdSpendProjectionRow): SpendBucket =>
    r.product_id ? "product" : r.allocation_basis === "market_level" ? "general" : "none";
  const keyOf = (r: AdSpendProjectionRow) => r.product_id ?? `#${bucketOf(r)}`;
  const keys = new Map<string, { product_id: string | null; bucket: SpendBucket }>();
  for (const r of [...before, ...after]) keys.set(keyOf(r), { product_id: r.product_id, bucket: bucketOf(r) });
  const products = [...keys.entries()]
    .map(([k, id]) => ({
      ...id,
      before: fromMillimes(sumBy(before, (r) => keyOf(r) === k)),
      after: fromMillimes(sumBy(after, (r) => keyOf(r) === k)),
    }))
    .filter((p) => p.before !== 0 || p.after !== 0)
    .sort((a, b) => b.after - b.before - (a.after - a.before));
  const moved = fromMillimes(
    products.reduce((s, p) => s + Math.max(0, toMillimes(p.after) - toMillimes(p.before)), 0),
  );

  // ── the target's own split after the change ──
  const own = after.filter((r) => r.mapping_id === "draft");
  const ownTotal = sumBy(own, () => true);
  const ownDays = [...new Set(own.map((r) => r.period_start))];
  const auto = draft.kind === "products" && draft.lines.length > 1 && draft.split_mode === "auto_orders";
  const orderCounts = auto
    ? await loadOrderCounts(admin, {
        marketId: account.market_id,
        since: range.since,
        until: range.until,
        timezone: tz,
        productIds: draft.lines.map((l) => l.product_id),
      })
    : null;
  const shares = draft.kind === "products"
    ? draft.lines.map((l) => {
        const amount = sumBy(own, (r) => r.product_id === l.product_id);
        return {
          product_id: l.product_id,
          amount: fromMillimes(amount),
          pct: ownTotal > 0 ? (amount / ownTotal) * 100 : draft.lines.length === 1 ? 100 : (l.share_pct ?? 0),
          orders: orderCounts ? ownDays.reduce((s, d) => s + (orderCounts.get(d)?.get(l.product_id) ?? 0), 0) : null,
        };
      })
    : [];

  // ── issued investor statements whose period this rewrites ──
  const changed = products.filter((p) => p.product_id && p.before !== p.after).map((p) => p.product_id as string);
  let statements: MappingPreviewDTO["statements"] = [];
  if (changed.length > 0) {
    const { data } = await admin
      .from("investor_deal_statements")
      .select("product_id, sequence_no, period_start, period_end, settled_at")
      .in("product_id", changed)
      .lte("period_start", range.until)
      .gte("period_end", range.since);
    statements = ((data ?? []) as { product_id: string; sequence_no: number; period_start: string; period_end: string; settled_at: string | null }[])
      .map((s) => {
        const inPeriod = (r: AdSpendProjectionRow) =>
          r.product_id === s.product_id && r.period_start >= s.period_start && r.period_start <= s.period_end;
        return {
          product_id: s.product_id,
          sequence_no: s.sequence_no,
          period_start: s.period_start,
          period_end: s.period_end,
          settled: s.settled_at !== null,
          delta: fromMillimes(sumBy(after, inPeriod) - sumBy(before, inPeriod)),
        };
      })
      .filter((s) => s.delta !== 0)
      .sort((a, b) => a.period_start.localeCompare(b.period_start));
  }

  return {
    range,
    clamped: range.since > start,
    history_from: account.adset_history_from,
    days: new Set(after.filter((r) => r.amount > 0).map((r) => r.period_start)).size,
    moved,
    products,
    shares,
    statements,
  };
}
