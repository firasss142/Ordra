"use client";

/**
 * The data side of the manager console: what it fetches, and what its buttons
 * actually do. Everything visual is ConsoleView.
 *
 * The two reads are independent, so SWR issues them together — the database is
 * ~130 ms away and the page shows nothing until both land. They refresh at
 * different rates on purpose: the pipeline moves minute to minute, the KPIs
 * are 7- and 30-day figures that do not.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import { useMarketScope } from "@/context/market-scope";
import { useWhatsAppAvailability } from "@/hooks/useWhatsAppAvailability";
import { marketIdToCode, marketTimezone } from "@/lib/markets";
import { toFilterJson, type AudiencePreview, type Condition } from "@/lib/prospects/audience";
import type { DistributionRule } from "@/lib/prospects/distribution";
import {
  consoleRefreshInterval,
  type AgentLoadRanked, type CampaignResult, type ConsoleMetrics, type Funnel, type LossByReason,
} from "@/lib/prospects/console";
import type { ProspectRow, ProspectsResponse } from "@/lib/prospects/types";
import type { LeadLostReason } from "@/types/lead";
import type { Role } from "@/types";
import { ConsoleView, type ResubmitPatch } from "./ConsoleView";
import type { PipelineFilter } from "./PipelineTab";
import type { CampaignDraft, CampaignProduct } from "./CampaignSheet";
import type { DistributePlan } from "./DistributeSheet";

interface ConsoleResponse {
  metrics: ConsoleMetrics;
  funnel: Funnel;
  loss: LossByReason;
  campaigns: CampaignResult[];
  agents: AgentLoadRanked[];
  generated_at: string;
}

const EMPTY_METRICS: ConsoleMetrics = {
  new_7d: 0, new_prev_7d: 0, hot_waiting: 0, oldest_hot_minutes: null,
  median_first_contact_minutes: null, median_first_contact_prev: null,
  converted_30d: 0, delivered_30d: 0, delivered_revenue_30d: 0,
  pool: 0, pool_campaigns: 0, pool_oldest_days: null, never_called: 0,
  total: 0, late_callbacks: 0, lost_30d: 0, calls_today: 0, reached_today: 0,
  oldest_hot_agent: null,
};

const EMPTY_FUNNEL: Funnel = {
  created: 0, pool: 0, assigned: 0, called: 0, reached: 0, conv: 0, deliv: 0,
};

/** Calls an agent is asked to make in a day. Matches the prototype's default. */
const DEFAULT_CAP = 20;

function NoMarket() {
  const t = useTranslations("prospects");
  return (
    <div className="mx-auto w-full max-w-[1560px] px-4 py-16 text-center text-[15px] text-[#6B7280]">
      {t("selectMarket")}
    </div>
  );
}

/** Read the body of a failed response, so the sheet can say what went wrong. */
async function fail(res: Response, fallback: string): Promise<never> {
  const body = await res.json().catch(() => null);
  throw new Error(typeof body?.error === "string" ? body.error : fallback);
}

export function ConsoleClient({
  role, marketId, locale,
}: { role: Role; marketId: string | null; locale: string }) {
  const router = useRouter();
  const scope = useMarketScope();
  const t = useTranslations("prospects");
  const market = role === "super_admin" ? scope.marketId : marketId;
  // An availability endpoint that errors (or a market with no WhatsApp tables
  // yet) reads as "not connected": the hook leaves `active` false, and the
  // sheet keeps « Depuis le numéro Ordra » visible but disabled, with why.
  const { active: whatsappActive, availability } = useWhatsAppAvailability(market);

  const [filter, setFilter] = useState<PipelineFilter>("all");
  const [agentId, setAgentId] = useState<string | null>(null);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  // A keystroke is not a request. The worklist is a server-side search over
  // ~1 700 rows; firing on every letter would queue five needless queries.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(id);
  }, [query]);

  const worklistKey = useMemo(() => {
    if (!market) return null;
    const qs = new URLSearchParams({ locale });
    if (role === "super_admin") qs.set("market_id", market);
    if (filter === "unassigned") qs.set("unassigned", "1");
    if (agentId) qs.set("agent_id", agentId);
    if (campaignId) qs.set("campaign_id", campaignId);
    if (debounced) qs.set("q", debounced);
    return `/api/prospects/worklist?${qs.toString()}`;
  }, [market, role, locale, filter, agentId, campaignId, debounced]);

  const consoleKey = market
    ? `/api/prospects/console${role === "super_admin" ? `?market_id=${market}` : ""}`
    : null;

  const { data: work, error: workError, mutate: mutateWork } = useSWR<ProspectsResponse>(
    worklistKey, fetcher,
    { refreshInterval: 60_000, revalidateOnFocus: true, keepPreviousData: true },
  );
  // Every 5 minutes — every 30 s while a business-number template waits for
  // Meta, so its approval or refusal shows (and is announced) within the minute.
  const { data: console_, error: consoleError, mutate: mutateConsole } = useSWR<ConsoleResponse>(
    consoleKey, fetcher,
    { refreshInterval: consoleRefreshInterval, revalidateOnFocus: false, keepPreviousData: true },
  );

  // Durations only; a minute's resolution is enough.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([mutateWork(), mutateConsole()]);
  }, [mutateWork, mutateConsole]);

  const post = useCallback(async (url: string, body: unknown, fallbackMessage: string) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) await fail(res, fallbackMessage);
    return res.json();
  }, []);

  const marketBody = useCallback(
    (extra: Record<string, unknown>) =>
      role === "super_admin" && market ? { market_id: market, ...extra } : extra,
    [role, market],
  );

  const onPreviewDistribution = useCallback(
    async (input: { leadIds: string[] | null; agentIds: string[]; rule: DistributionRule; cap: number }): Promise<DistributePlan> =>
      post("/api/prospects/distribute?preview=1", marketBody({
        lead_ids: input.leadIds ?? undefined,
        agent_ids: input.agentIds,
        rule: input.rule,
        cap: input.cap,
      }), t("loadError")),
    [post, marketBody, t],
  );

  const onDistribute = useCallback(
    async (input: { leadIds: string[] | null; agentIds: string[]; rule: DistributionRule; cap: number }) => {
      const r = await post("/api/prospects/distribute", marketBody({
        lead_ids: input.leadIds ?? undefined,
        agent_ids: input.agentIds,
        rule: input.rule,
        cap: input.cap,
      }), t("toast.failed"));
      await refresh();
      return r as { assigned: number };
    },
    [post, marketBody, refresh, t],
  );

  const onAssign = useCallback(async (leadIds: string[], targetId: string) => {
    // One prospect or a hundred, the same path: the bulk RPC with every lead
    // pointed at one agent.
    await post("/api/prospects/distribute", marketBody({
      lead_ids: leadIds,
      agent_ids: [targetId],
      rule: "round_robin",
      cap: Math.max(leadIds.length, 1),
    }), t("toast.failed"));
    await refresh();
  }, [post, marketBody, refresh, t]);

  const onCloseLeads = useCallback(async (leadIds: string[], reason: LeadLostReason, note: string) => {
    // `lost` is per-lead in the existing API; a handful at a time is the shape
    // a manager actually closes them in.
    for (const id of leadIds) {
      const res = await fetch(`/api/prospects/${id}/outcome`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "lost", reason, note: note || undefined }),
      });
      if (!res.ok) await fail(res, t("toast.failed"));
    }
    await refresh();
  }, [refresh, t]);

  const onReopen = useCallback(async (leadId: string) => {
    const res = await fetch(`/api/leads/${leadId}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ new_status: "assigned" }),
    });
    if (!res.ok) await fail(res, t("toast.failed"));
    await refresh();
  }, [refresh, t]);

  const onSaveLead = useCallback(async (id: string, patch: Partial<ProspectRow>) => {
    const res = await fetch(`/api/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer_name: patch.customer_name,
        customer_phone: patch.customer_phone,
        customer_city: patch.customer_city,
        customer_address: patch.customer_address,
        notes: patch.notes,
      }),
    });
    if (!res.ok) await fail(res, t("toast.failed"));
    await refresh();
  }, [refresh, t]);

  const onPreviewAudience = useCallback(
    async (conditions: Condition[]): Promise<AudiencePreview> =>
      post("/api/prospects/campaigns?preview=1", marketBody({ conditions }), t("loadError")),
    [post, marketBody, t],
  );

  const onCreateCampaign = useCallback(async (draft: CampaignDraft) => {
    const r = await post("/api/prospects/campaigns", marketBody({
      name: draft.name,
      offer: draft.offer || null,
      conditions: draft.conditions,
      channel: draft.channel,
      wa_message: draft.waMessage || null,
      wa_image: draft.waImage,
      wa_sender: draft.waSender,
      wa_window: draft.waWindow,
      wa_rate: draft.waRate,
      wa_follow_up_hours: draft.waFollowUpHours,
      script_fr: draft.scriptFr || null,
      script_ar: draft.scriptAr || null,
      wa_language: draft.waLanguage,
      // The header image exists only while « Image en en-tête » is on.
      wa_image_url: draft.waImage ? draft.waImageUrl.trim() || null : null,
    }), t("toast.failed"));
    await refresh();
    return r as { id?: string; inserted: number; wa_launch_status?: string; template_name?: string | null; template_status?: string | null };
  }, [post, marketBody, refresh, t]);

  const onResubmitCampaign = useCallback(async (c: { id: string }, patch: ResubmitPatch) => {
    const r = await post(`/api/prospects/campaigns/${c.id}/resubmit`, patch, t("toast.failed"));
    await refresh();
    return r as { template_name?: string | null; template_status?: string | null };
  }, [post, refresh, t]);

  const onLaunchCampaign = useCallback(async (c: { id: string }) => {
    const r = await post(`/api/prospects/campaigns/${c.id}/launch`, {}, t("toast.failed"));
    await refresh();
    return r as { queued: number };
  }, [post, refresh, t]);

  const onCheckCampaignStatus = useCallback(async (c: { id: string }) => {
    const r = await post(`/api/prospects/campaigns/${c.id}/template-status`, {}, t("toast.failed"));
    await refresh();
    return r as { template_status: string };
  }, [post, refresh, t]);

  /**
   * Products and cities the composer offers, taken from what is on screen —
   * with each product's photo, which the header-image picker offers.
   */
  const products = useMemo<CampaignProduct[]>(() => {
    const seen = new Map<string, CampaignProduct>();
    for (const r of work?.rows ?? []) {
      if (!r.product_id || !r.product_name) continue;
      const prev = seen.get(r.product_id);
      seen.set(r.product_id, { id: r.product_id, name: r.product_name, image_url: prev?.image_url || r.product_image_url || null });
    }
    return [...seen.values()];
  }, [work?.rows]);

  const cities = useMemo(() => {
    const seen = new Set<string>();
    for (const r of work?.rows ?? []) if (r.customer_city) seen.add(r.customer_city);
    return [...seen].sort();
  }, [work?.rows]);

  // A super_admin on scope "all" has not named a market, and this console is
  // per-market: a merged roster would imply agents work across both.
  if (!market) return <NoMarket />;

  return (
    <ConsoleView
      metrics={console_?.metrics ?? EMPTY_METRICS}
      funnel={console_?.funnel ?? EMPTY_FUNNEL}
      loss={console_?.loss ?? {}}
      campaigns={console_?.campaigns ?? []}
      agents={console_?.agents ?? []}
      rows={work?.rows ?? null}
      total={work?.total ?? 0}
      truncated={work?.truncated ?? false}
      isLoading={!work && !workError}
      error={Boolean(workError || consoleError)}
      onRetry={() => void refresh()}
      filter={filter}
      onFilter={setFilter}
      agentId={agentId}
      onAgentFilter={setAgentId}
      campaignId={campaignId}
      onCampaignFilter={setCampaignId}
      query={query}
      onQuery={setQuery}
      products={products}
      cities={cities}
      cap={DEFAULT_CAP}
      onPreviewDistribution={onPreviewDistribution}
      onDistribute={onDistribute}
      onAssign={onAssign}
      onCloseLeads={onCloseLeads}
      onReopen={onReopen}
      onSaveLead={onSaveLead}
      onPreviewAudience={onPreviewAudience}
      onCreateCampaign={onCreateCampaign}
      whatsappActive={whatsappActive}
      canConnectWhatsApp={role === "super_admin"}
      whatsappName={availability?.verified_name ?? null}
      onLaunchCampaign={onLaunchCampaign}
      onCheckCampaignStatus={onCheckCampaignStatus}
      onResubmitCampaign={onResubmitCampaign}
      onImportCsv={() => router.push(`/${locale}/leads?import=1`)}
      marketCode={marketIdToCode(market) ?? "tn"}
      tz={marketTimezone(market)}
      locale={locale}
      now={now}
    />
  );
}
