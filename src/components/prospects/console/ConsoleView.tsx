"use client";

/**
 * The manager console: one page, four views, and the sheets that act on them.
 *
 * Pure. Data, the clock and every mutation arrive as props, so each state of
 * this page can be rendered in a test without a network or a database.
 *
 * Design: prototypes/prospects-manager-v1.html.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, FileUp, Grid2x2, Megaphone, List, Users, X } from "lucide-react";
import type {
  AgentLoadRanked, CampaignResult, ConsoleMetrics, Funnel, LossByReason,
} from "@/lib/prospects/console";
import type { AudiencePreview, Condition, ConditionError } from "@/lib/prospects/audience";
import { conditionsOf, validateConditions } from "@/lib/prospects/audience";
import type { DistributionRule } from "@/lib/prospects/distribution";
import type { ProspectRow } from "@/lib/prospects/types";
import type { LeadLostReason } from "@/types/lead";
import { OverviewTab } from "./OverviewTab";
import { PipelineTab, type PipelineFilter } from "./PipelineTab";
import { CampaignsTab } from "./CampaignsTab";
import { TeamTab } from "./TeamTab";
import { DistributeSheet, type DistributePlan } from "./DistributeSheet";
import { AssignSheet, CloseSheet } from "./Sheets";
import { CampaignSheet, type CampaignDraft } from "./CampaignSheet";
import { fmt, PRIMARY, OUTLINE, Tabs } from "./ui";

export type ConsoleTab = "overview" | "pipeline" | "campaigns" | "team";

/** Which sheet is open, and what it is acting on. */
type SheetState =
  | { kind: "distribute"; leadIds: string[] | null; pool: number; label: string | null; agentIds: string[] | null }
  | { kind: "assign"; leadIds: string[] }
  | { kind: "close"; leadIds: string[] }
  | { kind: "campaign" }
  | null;

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

  products: { id: string; name: string }[];
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
  onCreateCampaign: (draft: CampaignDraft) => Promise<{ inserted: number }>;
  onImportCsv: () => void;

  marketCode: "ly" | "tn";
  tz: string;
  locale: string;
  now: number;
}

const EMPTY_DRAFT = (now: number): CampaignDraft => ({
  step: 1,
  template: "rebuy",
  conditions: conditionsOf("rebuy", now),
  name: "",
  offer: "",
  channel: "wa_call",
  waMessage: "",
  waImage: true,
  waSender: "agent",
  waWindow: "10-20",
  waRate: 40,
  waFollowUpHours: 24,
  scriptFr: "",
  scriptAr: "",
  agentIds: [],
  cap: 20,
});

export function ConsoleView(props: ConsoleViewProps) {
  const {
    metrics, funnel, loss, campaigns, agents, rows, total, truncated, isLoading, error, onRetry,
    filter, onFilter, agentId, onAgentFilter, campaignId, onCampaignFilter, query, onQuery,
    products, cities, cap,
    onPreviewDistribution, onDistribute, onAssign, onCloseLeads, onReopen, onSaveLead,
    onPreviewAudience, onCreateCampaign, onImportCsv,
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
  const [draft, setDraft] = useState<CampaignDraft>(() => EMPTY_DRAFT(now));
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
            onClick={() => { setDraft(EMPTY_DRAFT(now)); setPreview(null); setSheetError(null); setSheet({ kind: "campaign" }); }}
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
          campaigns={campaigns} loss={loss} marketCode={marketCode} locale={locale}
          onDistribute={(c) => openDistribute(null, c.pool ?? 0, c.name)}
          onSee={(c) => { onCampaignFilter(c.id); setTab("pipeline"); }}
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
          onConfirm={() => void run(async () => {
            const r = await onCreateCampaign(draft);
            return draft.channel === "call"
              ? t("cb.ok", { n: fmt(r.inserted, locale) })
              : t("cb.waOk", { n: fmt(r.inserted, locale) });
          })}
          onClose={() => setSheet(null)}
          locale={locale}
          now={now}
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
