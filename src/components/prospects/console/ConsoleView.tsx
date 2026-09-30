"use client";

/**
 * The manager console: one page, four views, and the sheets that act on them.
 *
 * Pure. Data, the clock and every mutation arrive as props, so each state of
 * this page can be rendered in a test without a network or a database.
 *
 * Design: prototypes/prospects-manager-v1.html.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, FileUp, Grid2x2, Megaphone, List, Users, X } from "lucide-react";
import type {
  AgentLoadRanked, CampaignResult, CampaignWhatsApp, ConsoleMetrics, Funnel, LossByReason,
} from "@/lib/prospects/console";
import type { AudiencePreview, Condition, ConditionError } from "@/lib/prospects/audience";
import { conditionsOf, fromFilterJson, validateConditions } from "@/lib/prospects/audience";
import type { DistributionRule } from "@/lib/prospects/distribution";
import type { ProspectRow } from "@/lib/prospects/types";
import type { LeadLostReason } from "@/types/lead";
import { OverviewTab } from "./OverviewTab";
import { PipelineTab, type PipelineFilter } from "./PipelineTab";
import { CampaignsTab } from "./CampaignsTab";
import { TeamTab } from "./TeamTab";
import { DistributeSheet, type DistributePlan } from "./DistributeSheet";
import { AssignSheet, CloseSheet } from "./Sheets";
import { CampaignSheet, type CampaignDraft, type CampaignProduct } from "./CampaignSheet";
import { fmt, PRIMARY, OUTLINE, Tabs } from "./ui";

export type ConsoleTab = "overview" | "pipeline" | "campaigns" | "team";

/** Which sheet is open, and what it is acting on. */
type SheetState =
  | { kind: "distribute"; leadIds: string[] | null; pool: number; label: string | null; agentIds: string[] | null }
  | { kind: "assign"; leadIds: string[] }
  | { kind: "close"; leadIds: string[] }
  // `campaignId` set: the sheet follows a business-number campaign's template
  // (after « Soumettre », « Modifier et resoumettre », or « Lancer » from a card).
  // `override` is what the last submission told us, shown until the console's
  // own data catches up with that template.
  | { kind: "campaign"; campaignId?: string; override?: Partial<CampaignWhatsApp> }
  | null;

/** What « Modifier et resoumettre » sends: the corrected template and the pacing. */
export interface ResubmitPatch {
  wa_message: string;
  wa_language: "ar" | "fr";
  wa_image_url: string | null;
  wa_window: string;
  wa_rate: number;
}

export interface ConsoleViewProps {
  metrics: ConsoleMetrics;
  funnel: Funnel;
  loss: LossByReason;
  campaigns: CampaignResult[];
  agents: AgentLoadRanked[];

  rows: ProspectRow[] | null;
  total: number;
  truncated: boolean;
  isLoading: boolean;
  error: boolean;
  onRetry: () => void;

  /** Server-side filters. The parent turns these into a request. */
  filter: PipelineFilter;
  onFilter: (f: PipelineFilter) => void;
  agentId: string | null;
  onAgentFilter: (id: string | null) => void;
  campaignId: string | null;
  onCampaignFilter: (id: string | null) => void;
  query: string;
  onQuery: (q: string) => void;

  products: CampaignProduct[];
  cities: string[];
  cap: number;

  /** Mutations. Each throws on failure; the sheet shows the message. */
  onPreviewDistribution: (input: {
    leadIds: string[] | null; agentIds: string[]; rule: DistributionRule; cap: number;
  }) => Promise<DistributePlan>;
  onDistribute: (input: {
    leadIds: string[] | null; agentIds: string[]; rule: DistributionRule; cap: number;
  }) => Promise<{ assigned: number }>;
  onAssign: (leadIds: string[], agentId: string) => Promise<void>;
  onCloseLeads: (leadIds: string[], reason: LeadLostReason, note: string) => Promise<void>;
  onReopen: (leadId: string) => Promise<void>;
  onSaveLead: (id: string, patch: Partial<ProspectRow>) => Promise<void>;
  onPreviewAudience: (conditions: Condition[]) => Promise<AudiencePreview>;
  onCreateCampaign: (draft: CampaignDraft) => Promise<{
    id?: string; inserted: number; wa_launch_status?: string; template_name?: string | null; template_status?: string | null;
  }>;
  onImportCsv: () => void;
  /** Business-number campaigns. */
  whatsappActive?: boolean;
  /** super_admin: « not connected » points at Système › Connexions. */
  canConnectWhatsApp?: boolean;
  /** The business number's display name, as the customer sees it. */
  whatsappName?: string | null;
  onLaunchCampaign?: (campaign: CampaignResult) => Promise<{ queued: number }>;
  onCheckCampaignStatus?: (campaign: CampaignResult) => Promise<{ template_status: string }>;
  onResubmitCampaign?: (campaign: CampaignResult, patch: ResubmitPatch) => Promise<{ template_name?: string | null; template_status?: string | null }>;

  marketCode: "ly" | "tn";
  tz: string;
  locale: string;
  now: number;
}

/** A template in the market's language: Arabic in Libya, French in Tunisia. */
const defaultLanguage = (marketCode: "ly" | "tn"): "ar" | "fr" => (marketCode === "ly" ? "ar" : "fr");

const EMPTY_DRAFT = (now: number, marketCode: "ly" | "tn"): CampaignDraft => ({
  step: 1,
  template: "rebuy",
  conditions: conditionsOf("rebuy", now),
  name: "",
  offer: "",
  channel: "wa_call",
  waMessage: "",
  waImage: true,
  waSender: "agent",
  waLanguage: defaultLanguage(marketCode),
  waImageUrl: "",
  waWindow: "10-20",
  waRate: 40,
  waFollowUpHours: 24,
  scriptFr: "",
  scriptAr: "",
  agentIds: [],
  cap: 20,
});

/** Reopen a business-number campaign on Canal, as it was submitted. */
function draftFromCampaign(c: CampaignResult, now: number, marketCode: "ly" | "tn"): CampaignDraft {
  const wa = c.whatsapp;
  return {
    ...EMPTY_DRAFT(now, marketCode),
    step: 2,
    template: "custom",
    conditions: wa?.filter ? fromFilterJson(wa.filter, now) : conditionsOf("rebuy", now),
    name: c.name,
    offer: c.offer ?? "",
    channel: c.channel && c.channel !== "call" ? c.channel : "wa",
    waSender: "api",
    waMessage: wa?.message ?? "",
    waLanguage: wa?.language ?? defaultLanguage(marketCode),
    waImage: Boolean(wa?.image_url),
    waImageUrl: wa?.image_url ?? "",
    waWindow: wa?.window ?? "10-20",
    waRate: wa?.rate ?? 40,
    waFollowUpHours: wa?.follow_up_hours ?? 24,
  };
}

/** The template name a campaign's whatsapp object points at, for matching an override. */
const templateOf = (c: CampaignResult | undefined) => c?.whatsapp?.template_name ?? null;

export function ConsoleView(props: ConsoleViewProps) {
  const {
    metrics, funnel, loss, campaigns, agents, rows, total, truncated, isLoading, error, onRetry,
    filter, onFilter, agentId, onAgentFilter, campaignId, onCampaignFilter, query, onQuery,
    products, cities, cap,
    onPreviewDistribution, onDistribute, onAssign, onCloseLeads, onReopen, onSaveLead,
    onPreviewAudience, onCreateCampaign, onImportCsv,
    whatsappActive = false, canConnectWhatsApp = false, whatsappName = null,
    onLaunchCampaign, onCheckCampaignStatus, onResubmitCampaign,
    marketCode, tz, locale, now,
  } = props;

  const t = useTranslations("prospects.console");

  const [tab, setTab] = useState<ConsoleTab>("overview");
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [busy, setBusy] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Distribution sheet state.
  const [distAgents, setDistAgents] = useState<string[]>([]);
  const [distRule, setDistRule] = useState<DistributionRule>("history_then_round_robin");
  const [distCap, setDistCap] = useState(cap);
  const [plan, setPlan] = useState<DistributePlan | null>(null);

  // Assign and close sheets.
  const [assignTo, setAssignTo] = useState<string | null>(null);
  const [closeReason, setCloseReason] = useState<LeadLostReason | null>(null);
  const [closeNote, setCloseNote] = useState("");

  // Campaign builder.
  const [draft, setDraft] = useState<CampaignDraft>(() => EMPTY_DRAFT(now, marketCode));
  const [preview, setPreview] = useState<AudiencePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const conditionErrors: ConditionError[] = useMemo(
    () => validateConditions(draft.conditions),
    [draft.conditions],
  );

  const activeAgents = useMemo(
    () => agents.map((a) => ({
      id: a.id, name: a.name, open_leads: a.open_leads,
      hot_waiting: a.hot_waiting, calls_today: a.calls_today,
    })),
    [agents],
  );

  /** A toast that clears itself. */
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3600);
    return () => clearTimeout(id);
  }, [toast]);

  // « Vous serez prévenu »: while the page is open the console refreshes
  // (faster while a template is pending — ConsoleClient), and a campaign whose
  // template moves from pending to approved or refused is announced here. The
  // first load only records where things stand; it announces nothing.
  const lastStatus = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    const seen = new Map<string, string>();
    let flip: string | null = null;
    for (const c of campaigns) {
      const status = c.whatsapp?.launch_status;
      if (!status) continue;
      seen.set(c.id, status);
      const before = lastStatus.current?.get(c.id);
      if (before === "pending_template" && status === "ready") flip = t("cb.flipApproved", { name: c.name });
      else if (before === "pending_template" && status === "rejected") flip = t("cb.flipRejected", { name: c.name });
    }
    lastStatus.current = seen;
    if (flip) setToast(flip);
  }, [campaigns, t]);

  /** The campaign the open sheet follows, with what the last submission told us layered on top. */
  const followed: CampaignResult | null = useMemo(() => {
    if (sheet?.kind !== "campaign" || !sheet.campaignId) return null;
    const live = campaigns.find((c) => c.id === sheet.campaignId);
    const o = sheet.override;
    // Once the console's data shows the template we submitted, it is the truth
    // (it may already say approved); until then, the submission's answer is.
    if (live?.whatsapp && (!o || templateOf(live) === (o.template_name ?? null))) return live;
    const zero: CampaignWhatsApp = {
      launch_status: "pending_template", language: draft.waLanguage, template_status: "PENDING", template_name: null,
      template_rejected_reason: null, queued: 0, sent: 0, delivered: 0, read: 0, replied: 0, failed: 0, skipped: 0,
      rate: draft.waRate, window: draft.waWindow,
    };
    return {
      ...(live ?? {
        id: sheet.campaignId, name: draft.name, offer: draft.offer || null, audience: 0, called: 0, converted: 0,
        revenue: 0, created_at: new Date(now).toISOString(), channel: draft.channel, pool: 0,
      }),
      whatsapp: { ...zero, ...(live?.whatsapp ?? {}), template_rejected_reason: null, ...o },
    };
  }, [sheet, campaigns, draft.waLanguage, draft.waRate, draft.waWindow, draft.name, draft.offer, draft.channel, now]);

  const openFollowing = useCallback((c: CampaignResult) => {
    setDraft(draftFromCampaign(c, now, marketCode));
    setPreview(null);
    setSheetError(null);
    setSheet({ kind: "campaign", campaignId: c.id });
  }, [now, marketCode]);

  /** A sheet action that keeps the sheet open: its error shows inside it. */
  const act = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setSheetError(null);
    try {
      await fn();
    } catch (e) {
      setSheetError(e instanceof Error ? e.message : t("toastSaved"));
    } finally {
      setBusy(false);
    }
  }, [t]);

  const checkedMessage = useCallback((status: string) => (
    ["PENDING", "APPROVED", "REJECTED"].includes(status) ? t(`cb.checked.${status}`) : t("cb.checked.other", { status })
  ), [t]);

  // Escape clears the selection first, then the open row — the sheet handles
  // its own Escape, so this only fires behind it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || sheet) return;
      if (selection.size > 0) setSelection(new Set());
      else if (openId) setOpenId(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sheet, selection.size, openId]);

  /** Re-plan whenever the manager changes a knob in the distribution sheet. */
  useEffect(() => {
    if (sheet?.kind !== "distribute" || distAgents.length === 0) { setPlan(null); return; }
    let live = true;
    void onPreviewDistribution({
      leadIds: sheet.leadIds, agentIds: distAgents, rule: distRule, cap: distCap,
    })
      .then((p) => { if (live) setPlan(p); })
      .catch(() => { if (live) setPlan(null); });
    return () => { live = false; };
  }, [sheet, distAgents, distRule, distCap, onPreviewDistribution]);

  /** The audience count follows the conditions, once they are sound. */
  useEffect(() => {
    if (sheet?.kind !== "campaign" || conditionErrors.length > 0) return;
    let live = true;
    setPreviewing(true);
    const id = setTimeout(() => {
      void onPreviewAudience(draft.conditions)
        .then((p) => { if (live) setPreview(p); })
        .catch(() => { if (live) setPreview(null); })
        .finally(() => { if (live) setPreviewing(false); });
    }, 300);
    return () => { live = false; clearTimeout(id); };
  }, [sheet, draft.conditions, conditionErrors.length, onPreviewAudience]);

  const openDistribute = useCallback((leadIds: string[] | null, pool: number, label: string | null, agentIds?: string[]) => {
    setSheetError(null);
    setDistAgents(agentIds ?? agents.map((a) => a.id));
    setDistCap(cap);
    setSheet({ kind: "distribute", leadIds, pool, label, agentIds: agentIds ?? null });
  }, [agents, cap]);

  const run = useCallback(async (fn: () => Promise<string>) => {
    setBusy(true);
    setSheetError(null);
    try {
      const message = await fn();
      setSheet(null);
      setSelection(new Set());
      setToast(message);
    } catch (e) {
      setSheetError(e instanceof Error ? e.message : t("toastSaved"));
    } finally {
      setBusy(false);
    }
  }, [t]);

  const counts: Partial<Record<PipelineFilter, number>> = useMemo(
    () => ({ all: metrics.total, unassigned: metrics.pool, lost: metrics.lost_30d }),
    [metrics],
  );

  const tabs = useMemo(() => [
    { key: "overview" as const, label: t("tabs.overview"), icon: Grid2x2 },
    { key: "pipeline" as const, label: t("tabs.pipeline"), icon: List, badge: metrics.pool || undefined, badgeTone: "red" as const },
    { key: "campaigns" as const, label: t("tabs.campaigns"), icon: Megaphone },
    { key: "team" as const, label: t("tabs.team"), icon: Users, badge: metrics.hot_waiting || undefined, badgeTone: "amber" as const },
  ], [t, metrics.pool, metrics.hot_waiting]);

  return (
    <div className={`mx-auto flex w-full max-w-[1560px] flex-col px-4 pb-10 pt-4 text-start lg:px-5 ${locale === "ar" ? "font-cairo" : ""}`}>
      <header className="mb-3 flex flex-wrap items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] bg-[#E9F6EE] text-[#15803D]">
          <Users size={22} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-[24px] font-bold leading-tight tracking-[-0.02em] text-[#111827] lg:text-[26px]">
            {t("title")}
          </h1>
          <p className="m-0 mt-0.5 text-[14.5px] text-[#6B7280]">
            {metrics.pool > 0
              ? t("subPool", { n: metrics.pool })
              : metrics.hot_waiting > 0
                ? t("subHot", { n: metrics.hot_waiting })
                : t("subCalm")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onImportCsv} className={`h-10 px-3.5 text-[14px] ${OUTLINE}`}>
            <FileUp size={16} aria-hidden />
            <span className="hidden sm:inline">{t("importCsv")}</span>
            <span className="sm:hidden">CSV</span>
          </button>
          <button
            type="button"
            onClick={() => { setDraft(EMPTY_DRAFT(now, marketCode)); setPreview(null); setSheetError(null); setSheet({ kind: "campaign" }); }}
            className={`h-10 px-3.5 text-[14px] ${PRIMARY}`}
          >
            <Megaphone size={16} aria-hidden />
            {t("newCampaign")}
          </button>
        </div>
      </header>

      <Tabs tabs={tabs} value={tab} onChange={setTab} label={t("title")} />

      {tab === "overview" ? (
        <OverviewTab
          metrics={metrics} funnel={funnel} loss={loss} campaigns={campaigns} agents={agents}
          marketCode={marketCode} locale={locale}
          onGo={(next, f) => { setTab(next); if (f) onFilter(f as PipelineFilter); }}
          onDistribute={() => openDistribute(null, metrics.pool, null)}
          onOpenAgent={(id) => { onAgentFilter(id); setTab("pipeline"); }}
        />
      ) : null}

      {tab === "pipeline" ? (
        <PipelineTab
          rows={rows} total={total} truncated={truncated} isLoading={isLoading} error={error} onRetry={onRetry}
          filter={filter} onFilter={onFilter} counts={counts}
          agents={activeAgents} agentId={agentId} onAgent={onAgentFilter}
          campaigns={campaigns} campaignId={campaignId} onCampaign={onCampaignFilter}
          query={query} onQuery={onQuery}
          selection={selection}
          onToggle={(id) => setSelection((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
          })}
          onClearSelection={() => setSelection(new Set())}
          openId={openId} onOpen={setOpenId}
          onAssign={(ids) => { setAssignTo(null); setSheetError(null); setSheet({ kind: "assign", leadIds: ids }); }}
          onDistribute={(ids) => openDistribute(ids, ids.length, null)}
          onClose={(ids) => { setCloseReason(null); setCloseNote(""); setSheetError(null); setSheet({ kind: "close", leadIds: ids }); }}
          onReopen={(id) => void run(async () => { await onReopen(id); return t("l.reopened"); })}
          onSave={onSaveLead}
          marketCode={marketCode} tz={tz} locale={locale} now={now}
        />
      ) : null}

      {tab === "campaigns" ? (
        <CampaignsTab
          campaigns={campaigns} loss={loss} marketCode={marketCode} locale={locale} now={now} tz={tz}
          onDistribute={(c) => openDistribute(null, c.pool ?? 0, c.name)}
          onSee={(c) => { onCampaignFilter(c.id); setTab("pipeline"); }}
          // Launching sends hundreds of messages: the sheet shows the plan
          // (audience, cadence, window, estimated end) before the button that does it.
          onLaunch={onLaunchCampaign ? openFollowing : undefined}
          onCheckStatus={onCheckCampaignStatus ? (c) => void run(async () => { const r = await onCheckCampaignStatus(c); return checkedMessage(r.template_status); }) : undefined}
          onResubmit={onResubmitCampaign ? openFollowing : undefined}
        />
      ) : null}

      {tab === "team" ? (
        <TeamTab
          agents={agents} cap={cap} locale={locale}
          onSeeQueue={(id) => { onAgentFilter(id); setTab("pipeline"); }}
          onGive={(id) => openDistribute(null, metrics.pool, null, [id])}
          onRebalance={(fromId, toId, n) => openDistribute(null, n, null, [toId])}
        />
      ) : null}

      {sheet?.kind === "distribute" ? (
        <DistributeSheet
          pool={sheet.pool}
          scopeLabel={sheet.label}
          agents={activeAgents}
          picked={distAgents}
          onPick={setDistAgents}
          rule={distRule}
          onRule={setDistRule}
          cap={distCap}
          onCap={setDistCap}
          plan={plan}
          busy={busy}
          error={sheetError}
          onConfirm={() => void run(async () => {
            const r = await onDistribute({
              leadIds: sheet.leadIds, agentIds: distAgents, rule: distRule, cap: distCap,
            });
            return t("d.ok", { n: r.assigned, agents: distAgents.length });
          })}
          onClose={() => setSheet(null)}
          locale={locale}
        />
      ) : null}

      {sheet?.kind === "assign" ? (
        <AssignSheet
          count={sheet.leadIds.length}
          agents={activeAgents}
          cap={cap}
          value={assignTo}
          onValue={setAssignTo}
          busy={busy}
          error={sheetError}
          onConfirm={() => void run(async () => {
            await onAssign(sheet.leadIds, assignTo!);
            const name = agents.find((a) => a.id === assignTo)?.name ?? "—";
            return t("a.ok", { n: sheet.leadIds.length, agent: name });
          })}
          onClose={() => setSheet(null)}
          locale={locale}
        />
      ) : null}

      {sheet?.kind === "close" ? (
        <CloseSheet
          count={sheet.leadIds.length}
          reason={closeReason}
          onReason={setCloseReason}
          note={closeNote}
          onNote={setCloseNote}
          busy={busy}
          error={sheetError}
          onConfirm={() => void run(async () => {
            await onCloseLeads(sheet.leadIds, closeReason!, closeNote);
            return t("l.ok", { n: sheet.leadIds.length });
          })}
          onClose={() => setSheet(null)}
        />
      ) : null}

      {sheet?.kind === "campaign" ? (
        <CampaignSheet
          draft={draft}
          onDraft={(patch) => setDraft((d) => ({ ...d, ...patch }))}
          preview={preview}
          previewing={previewing}
          errors={conditionErrors}
          agents={activeAgents}
          products={products}
          cities={cities}
          busy={busy}
          error={sheetError}
          onConfirm={() => {
            if (draft.channel !== "call" && draft.waSender === "api") {
              // The template went to Meta: stay, back on Canal, and show what
              // happens next instead of a toast that vanishes.
              void act(async () => {
                const r = await onCreateCampaign(draft);
                if (!r.id) throw new Error(t("toastSaved"));
                setDraft((d) => ({ ...d, step: 2 }));
                setSheet({
                  kind: "campaign", campaignId: r.id,
                  override: {
                    launch_status: "pending_template", template_name: r.template_name ?? null,
                    template_status: r.template_status ?? "PENDING", status_at: new Date().toISOString(),
                  },
                });
              });
              return;
            }
            void run(async () => {
              const r = await onCreateCampaign(draft);
              return draft.channel === "call"
                ? t("cb.ok", { n: fmt(r.inserted, locale) })
                : t("cb.waOk", { n: fmt(r.inserted, locale) });
            });
          }}
          onClose={() => setSheet(null)}
          locale={locale}
          now={now}
          whatsappActive={whatsappActive}
          canConnectWhatsApp={canConnectWhatsApp}
          whatsappName={whatsappName}
          marketCode={marketCode}
          tz={tz}
          campaign={followed}
          onCheckStatus={followed && onCheckCampaignStatus ? () => void act(async () => {
            const r = await onCheckCampaignStatus(followed);
            setToast(checkedMessage(r.template_status));
          }) : undefined}
          onLaunch={followed && onLaunchCampaign ? () => void run(async () => {
            const r = await onLaunchCampaign(followed);
            return t("cb.launched", { n: fmt(r.queued, locale) });
          }) : undefined}
          onResubmit={followed && onResubmitCampaign ? () => void act(async () => {
            const r = await onResubmitCampaign(followed, {
              wa_message: draft.waMessage.trim(),
              wa_language: draft.waLanguage,
              wa_image_url: draft.waImage && draft.waImageUrl.trim() ? draft.waImageUrl.trim() : null,
              wa_window: draft.waWindow,
              wa_rate: draft.waRate,
            });
            setSheet({
              kind: "campaign", campaignId: followed.id,
              override: {
                launch_status: "pending_template", template_name: r.template_name ?? null,
                template_status: r.template_status ?? "PENDING", status_at: new Date().toISOString(),
              },
            });
            setToast(t("cb.resubmitted"));
          }) : undefined}
        />
      ) : null}

      {toast ? (
        <div role="status" aria-live="polite"
          className="fixed bottom-5 end-5 z-[80] flex min-w-[320px] items-center gap-3 rounded-[10px] bg-[#111111] px-4 py-3 text-white shadow-[0_10px_30px_rgba(17,24,39,0.14)]">
          <Check size={18} aria-hidden className="text-[#22C55E]" />
          <span className="flex-1 text-[14px]">{toast}</span>
          <button type="button" onClick={() => setToast(null)} aria-label={t("sel.clear")}
            className="grid h-7 w-7 place-items-center rounded-lg text-[#9CA3AF] hover:bg-white/10">
            <X size={16} aria-hidden />
          </button>
        </div>
      ) : null}
    </div>
  );
}
