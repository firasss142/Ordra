"use client";

/**
 * The manager's Prospects page — « récupérer les ventes perdues ».
 * prototypes/prospects-manager-v5.html, one page, no tabs:
 *   header → the band (answer + À faire) → sources → team today → the list.
 * Pure view: data and every mutation arrive as props.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronLeft, ChevronRight, Plus, SlidersHorizontal } from "lucide-react";
import type { Condition } from "@/lib/prospects/audience";
import type { DeskView as DeskModel } from "@/lib/prospects/desk/model";
import type { DeskRow } from "@/lib/prospects/desk/list";
import type { DeskSource, RecoverySettings } from "@/lib/prospects/desk/types";
import type { Draft } from "@/lib/prospects/desk/wizard";
import { TopBand } from "./TopBand";
import { Sources } from "./Sources";
import { Team } from "./Team";
import { ProspectList, type ListFilters } from "./ProspectList";
import { CloseDialog, ExportDialog, ProspectDrawer, ReassignDialog, Scrim } from "./Overlays";
import { RulesSheet } from "./RulesSheet";
import { Wizard, type AudienceCount } from "./Wizard";
import { monthLabel, monthName, shiftMonth, fmtTime } from "./format";
import { useDeskTip, type ProductOption } from "./parts";
import "./desk.css";

type Sheet = null | "drawer" | "rules" | "wizard" | "export" | "reassign" | "close";

export interface DeskViewProps {
  view: DeskModel | null;
  settings: RecoverySettings | null;
  month: string;
  currentMonth: string;
  onMonth: (ym: string) => void;
  rows: DeskRow[];
  total: number;
  listLoading: boolean;
  error: boolean;
  onRetry: () => void;
  filters: ListFilters;
  onFilters: (f: Partial<ListFilters>) => void;
  products: ProductOption[];
  cities: string[];
  subreasons: { key: string; label: string; count?: number }[];
  reasonLabel: (k: string) => string;
  waActive: boolean;
  waLang: "ar" | "fr";
  locale: string;
  tz: string;
  marketId: string;
  toast: string | null;
  onDistribute: () => Promise<void>;
  onAssign: (ids: string[], agentId: string) => Promise<void>;
  onCloseLeads: (ids: string[], reason: string, note: string) => Promise<void>;
  onSaveRules: (s: RecoverySettings) => Promise<string | null>;
  onExport: (o: { scope: "filtered" | "ids" | "month"; format: "excel" | "csv"; cols: string[]; ids: string[] }) => Promise<string>;
  onPreview: (c: Condition[]) => Promise<AudienceCount>;
  onCreateList: (d: Draft, c: Condition[], name: string) => Promise<string>;
  /** A prospect named in the URL (`?open=`): its drawer opens on arrival. */
  initialOpen?: DeskRow | null;
}

export function DeskView(p: DeskViewProps) {
  const t = useTranslations("prospects.desk");
  const tipRef = useDeskTip();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const [distributing, setDistributing] = useState(false);
  const openRow = useMemo(
    () => p.rows.find((r) => r.id === openId) ?? (p.initialOpen?.id === openId ? p.initialOpen : null) ?? null,
    [p.rows, openId, p.initialOpen],
  );
  const initialId = p.initialOpen?.id ?? null;
  useEffect(() => { if (initialId) { setOpenId(initialId); setSheet("drawer"); } }, [initialId]);
  const targets = sheet === "reassign" || sheet === "close" ? (sel.size ? [...sel] : openId ? [openId] : []) : [];

  const sourceNames = useMemo(() => ({
    rej: t("sources.names.rej"), ret: t("sources.names.ret"), old: t("sources.names.old"), camp: t("sources.names.camp"),
  }) as Record<DeskSource, string>, [t]);

  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const scrollToList = () => requestAnimationFrame(() => document.getElementById("pdk-list")?.scrollIntoView?.({ behavior: "smooth", block: "start" }));

  const chip = !p.view ? null : p.view.engineOff
    ? <span className="chip"><span className="dot" style={{ background: "var(--ink-q)", boxShadow: "none" }} />{t("chipOff")}</span>
    : p.view.lastTickAt
      ? <span className="chip"><span className="dot" />{t("chipDist", { time: fmtTime(p.view.lastTickAt, p.locale, p.tz) })}</span>
      : <span className="chip"><span className="dot" style={{ background: "var(--ink-q)", boxShadow: "none" }} />{t("chipNever")}</span>;

  return (
    <div className="pdk">
      <div className="page">
        <header className="ph">
          <div>
            <div className="crumb">{t("crumb")} <ChevronRight className="ic flip" /> {t("title")}</div>
            <h1>{t("title")}</h1>
            <div className="sub"><span>{t("sub")}</span>{chip}</div>
          </div>
          <div className="acts">
            <span className="month">
              <button type="button" aria-label={t("prevMonth")} onClick={() => p.onMonth(shiftMonth(p.month, -1))}><ChevronLeft className="ic flip" /></button>
              <span>{monthLabel(p.month, p.locale)}</span>
              <button type="button" aria-label={t("nextMonth")} disabled={p.month >= p.currentMonth} onClick={() => p.onMonth(shiftMonth(p.month, 1))}><ChevronRight className="ic flip" /></button>
            </span>
            <button type="button" className="btn sec" onClick={() => setSheet("rules")}><SlidersHorizontal className="ic" />{t("rules")}</button>
            <button type="button" className="btn pri" onClick={() => setSheet("wizard")}><Plus className="ic" />{t("newList")}</button>
          </div>
        </header>

        {p.error && !p.view ? (
          <section className="card empty">{t("loadError")} <button type="button" className="lnk" onClick={p.onRetry}>{t("retry")}</button></section>
        ) : !p.view || !p.settings ? (
          <>
            <div className="skel" style={{ height: 88 }} />
            <div className="srcs">{[0, 1, 2, 3].map((i) => <div key={i} className="skel" style={{ height: 230 }} />)}</div>
            <div className="ags">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skel" style={{ height: 250 }} />)}</div>
          </>
        ) : (
          <>
            <TopBand view={p.view} month={p.month} locale={p.locale} marketId={p.marketId} distributing={distributing}
              onDistribute={async () => { setDistributing(true); try { await p.onDistribute(); } finally { setDistributing(false); } }}
              onSeeAgent={(id) => { p.onFilters({ agents: [id], sources: [], state: "open", page: 1 }); scrollToList(); }}
              onSeeLate={() => { p.onFilters({ agents: [], sources: [], state: "open", page: 1 }); scrollToList(); }}
              onOpenRules={() => setSheet("rules")} />
            <Sources view={p.view} settings={p.settings} selected={p.filters.sources} locale={p.locale} marketId={p.marketId}
              onToggle={(s) => { p.onFilters({ sources: toggle(p.filters.sources, s), page: 1 }); scrollToList(); }} />
            <Team agents={p.view.agents} selected={p.filters.agents} locale={p.locale} marketId={p.marketId} fileCap={p.view.fileCap}
              onToggle={(id) => { p.onFilters({ agents: toggle(p.filters.agents, id), state: "open", page: 1 }); scrollToList(); }} />
          </>
        )}

        <ProspectList rows={p.rows} total={p.total} loading={p.listLoading} filters={p.filters} onFilters={p.onFilters}
            agents={p.view?.agents ?? []} sourceNames={sourceNames} sel={sel} onSel={setSel}
            openId={openId} onOpen={(id) => { setOpenId(id); setSheet("drawer"); }}
            onExport={() => setSheet("export")} onReassign={() => setSheet("reassign")} onClose={() => setSheet("close")}
            locale={p.locale} tz={p.tz} marketId={p.marketId} reasonLabel={p.reasonLabel}
            emptyHint={{ days: p.settings?.rej.delay_days ?? 3, after: p.settings?.old.after_days ?? 30 }} engineEmpty={(p.view?.openTotal ?? 0) === 0} />
      </div>

      <Scrim on={sheet !== null} onClick={() => setSheet(null)} />
      <ProspectDrawer row={openRow} open={sheet === "drawer"} onClose={() => setSheet(null)} locale={p.locale} tz={p.tz} marketId={p.marketId}
        reasonLabel={p.reasonLabel} onReassign={() => setSheet("reassign")} onCloseLead={() => setSheet("close")} />
      <RulesSheet open={sheet === "rules"} settings={p.settings} agents={p.view?.agents ?? []} reasonLabel={p.reasonLabel}
        counts={Object.fromEntries(p.subreasons.filter((s) => s.count !== undefined).map((s) => [s.key, s.count!]))}
        onClose={() => setSheet(null)} onSave={async (s) => { const e = await p.onSaveRules(s); if (!e) setSheet(null); return e; }} />
      <Wizard open={sheet === "wizard"} onClose={() => setSheet(null)} products={p.products} locale={p.locale} marketId={p.marketId}
        waLang={p.waLang} waActive={p.waActive} subreasons={p.subreasons} cities={p.cities} onPreview={p.onPreview} onCreate={p.onCreateList} />
      <ExportDialog key={sheet === "export" ? "open" : "closed"} open={sheet === "export"} onClose={() => setSheet(null)} filteredCount={p.total} selection={[...sel]}
        monthLabel={monthName(p.month, p.locale)} onRun={(o) => p.onExport({ ...o, ids: [...sel] })} />
      <ReassignDialog key={`r-${sheet === "reassign"}`} open={sheet === "reassign"} count={targets.length} agents={p.view?.agents ?? []} fileCap={p.view?.fileCap ?? 15}
        onClose={() => setSheet(null)} onGo={async (agentId) => { await p.onAssign(targets, agentId); setSel(new Set()); setSheet(null); }} />
      <CloseDialog key={`c-${sheet === "close"}`} open={sheet === "close"} count={targets.length}
        onClose={() => setSheet(null)} onGo={async (reason, note) => { await p.onCloseLeads(targets, reason, note); setSel(new Set()); setSheet(null); }} />

      <div ref={tipRef} className="pdk-tip" style={{ opacity: 0 }} />
      {p.toast ? <div className="pdk-toast" role="status"><Check className="ic" style={{ width: 16, height: 16 }} />{p.toast}</div> : null}
    </div>
  );
}
