"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Calendar, ChevronDown, Store, Target, Trash2, User, X } from "lucide-react";
import { Menu } from "@/components/ui/Menu";
import { useMarketScope } from "@/context/market-scope";
import {
  discardFeedback, restoreFeedback, setComplaintStatus, setFeedbackTopic, setTopicResponse,
  useFeedbackOverview, useFeedbackRow, useFeedbackRows,
} from "@/hooks/useFeedback";
import { activePreset, presetRange, type PresetKey } from "@/lib/feedback/date-range";
import { COURIER_AGENT } from "@/lib/feedback/voice";
import { isFeedbackCategory, type ComplaintStatus } from "@/lib/feedback/taxonomy";
import { marketTimezone } from "@/lib/markets";
import type { Role } from "@/types";
import { ReasonsView } from "./ReasonsView";
import { SheetView, type SheetGroup, type SheetView as View } from "./SheetView";
import { VoiceDrawer } from "./VoiceDrawer";
import "./voice.css";

type Tab = "sheet" | "reasons";

interface State {
  tab: Tab;
  prod: string | null;
  agent: string | null;
  from: string | null;
  to: string | null;
  view: View;
  group: SheetGroup;
  /** « Voir les n dans la feuille »: only this reason's group starts open. */
  only: string | null;
  peek: string | null;
}

const PERIOD_PRESETS: PresetKey[] = ["d7", "d30", "month", "last", "all"];
const TOAST_MS = 6000;

function readState(p: URLSearchParams): State {
  const view = p.get("view");
  const group = p.get("group");
  return {
    tab: p.get("tab") === "raisons" ? "reasons" : "sheet",
    prod: p.get("prod"),
    agent: p.get("agent"),
    from: p.get("from"),
    to: p.get("to"),
    view: view === "check" || isFeedbackCategory(view) ? view : "all",
    group: group === "product" || group === "none" ? group : "reason",
    only: p.get("only"),
    peek: p.get("peek"),
  };
}

/**
 * Clients › Voix du client for a market manager or super_admin — prototype
 * voix-du-client-et-messages-v2 (owner's picks of 2026-10-06: two pages, the sheet first,
 * Raisons v2). Every filter lives in the URL.
 */
export function VoiceWorkspace({ role, marketId }: { role: Role; marketId: string | null }) {
  const t = useTranslations("feedback.voice");
  const tf = useTranslations("feedback");
  const activeLocale = useLocale();
  const pathname = usePathname();
  const params = useSearchParams();
  const scope = useMarketScope();
  const market = role === "super_admin" ? scope.marketId : marketId;
  const marketParam = role === "super_admin" ? scope.marketId : null;
  const timeZone = marketTimezone(market);

  const [s, setS] = useState<State>(() => readState(new URLSearchParams(params?.toString() ?? "")));
  const [openReason, setOpenReason] = useState<string | null | undefined>(undefined);
  const [closed, setClosed] = useState<Set<string> | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ text: string; undo: string[] | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const query = { from: s.from, to: s.to, family: s.prod, agent: s.agent };
  const { overview, error, stale, mutate: mutateOverview } = useFeedbackOverview(query, marketParam, Boolean(market));
  const { rows, total, mutate: mutateRows } = useFeedbackRows(query, marketParam, Boolean(market));
  const loadedPeek = s.peek ? rows?.find((r) => r.id === s.peek) ?? null : null;
  const { row: fetchedPeek, mutate: mutatePeek } = useFeedbackRow(s.peek && !loadedPeek ? s.peek : null, marketParam);
  const peekRow = loadedPeek ?? fetchedPeek;

  const set = useCallback((patch: Partial<State>) => {
    setS((prev) => {
      const next: State = { ...prev, ...patch };
      const q = new URLSearchParams();
      if (next.tab === "reasons") q.set("tab", "raisons");
      if (next.prod) q.set("prod", next.prod);
      if (next.agent) q.set("agent", next.agent);
      if (next.from && next.to) { q.set("from", next.from); q.set("to", next.to); }
      if (next.view !== "all") q.set("view", next.view);
      if (next.group !== "reason") q.set("group", next.group);
      if (next.only) q.set("only", next.only);
      if (next.peek) q.set("peek", next.peek);
      const qs = q.toString();
      // Not router.replace: this page is force-dynamic, so a router navigation re-renders it on
      // the server and the dashboard's loading skeleton flashes in between.
      window.history.replaceState(window.history.state, "", `${pathname}${qs ? `?${qs}` : ""}`);
      return next;
    });
  }, [pathname]);

  const refresh = useCallback(() => { void mutateOverview(); void mutateRows(); void mutatePeek(); }, [mutateOverview, mutateRows, mutatePeek]);

  const showToast = useCallback((text: string, undo: string[] | null) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, undo });
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setFailed(false);
    try { await fn(); refresh(); return true; } catch { setFailed(true); return false; } finally { setBusy(false); }
  }

  const discard = async (ids: string[]) => {
    let n = 0;
    const ok = await act(async () => { n = (await discardFeedback(ids)).count; });
    if (ok) {
      setSelected(new Set());
      if (s.peek && ids.includes(s.peek)) set({ peek: null });
      showToast(t("bulk.discarded", { n: n || ids.length }), ids);
    }
  };
  const undo = async (ids: string[]) => {
    setToast(null);
    await act(() => restoreFeedback(ids));
  };
  const moveTo = async (ids: string[], topicId: string | null) => {
    let n = 0;
    const ok = await act(async () => { n = (await setFeedbackTopic(ids, topicId)).count; });
    if (ok && ids.length > 1) showToast(t("bulk.moved", { n }), null);
    if (ok) setSelected(new Set());
  };

  // The groups that start closed: none, or all but one after « Voir les n dans la feuille ».
  const closedGroups = useMemo(() => {
    if (closed) return closed;
    if (!s.only || !rows) return new Set<string>();
    return new Set(rows.map((r) => r.topic_id ?? "_none").filter((k) => k !== s.only));
  }, [closed, s.only, rows]);

  if (!market) return <div className="vdc"><div className="state">{t("selectMarket")}</div></div>;
  if (error && !overview) {
    return (
      <div className="vdc"><div className="state">{t("error")} <button type="button" onClick={refresh}>{t("retry")}</button></div></div>
    );
  }

  const dir = activeLocale.startsWith("ar") ? "rtl" : "ltr";
  const preset = overview ? activePreset(overview.from, overview.to, overview.today, overview.first) : "d30";
  const periodLabel = preset ? t(`filters.presets.${preset}`) : overview ? t("filters.custom", { from: overview.from, to: overview.to }) : "";
  const family = overview?.families.find((f) => f.id === s.prod) ?? null;
  const agentName = s.agent === COURIER_AGENT ? t("filters.darb") : overview?.agents.find((a) => a.id === s.agent)?.name ?? null;
  const reasonOpen = openReason === undefined ? overview?.reasons[0]?.topicId ?? null : openReason;
  const choices = (overview?.topics ?? []).filter((x) => x.category !== "reclamation");
  const label = (x: { label_fr: string; label_ar: string }) => (activeLocale.startsWith("ar") ? x.label_ar : x.label_fr);

  return (
    <div className="vdc" dir={dir}>
      <div className="vdc-page">
        <div className="ph">
          <div>
            <div className="crumb">{t("crumb")}<i>/</i>{tf("title")}</div>
            <h1>{tf("title")}</h1>
            <div className="subl">{t("sub")}</div>
          </div>
          <div className="segc" role="tablist">
            {(["sheet", "reasons"] as const).map((k) => (
              <button key={k} type="button" role="tab" aria-selected={s.tab === k} onClick={() => set({ tab: k, peek: null })}>{t(`tabs.${k}`)}</button>
            ))}
          </div>
        </div>

        <div className="fbar">
          <Menu
            align="start"
            ariaLabel={t("filters.period")}
            trigger={
              <button type="button" className={`fb${preset !== "d30" ? " set" : ""}`}>
                <Calendar className="ic" aria-hidden /><span className="l">{t("filters.period")}</span><span className="v">{periodLabel}</span><ChevronDown className="ic chev" aria-hidden />
              </button>
            }
            items={PERIOD_PRESETS.map((k) => ({
              id: k,
              label: t(`filters.presets.${k}`),
              onSelect: () => {
                if (!overview || k === "d30") return set({ from: null, to: null });
                const [from, to] = presetRange(k, overview.today, overview.first);
                set({ from, to });
              },
            }))}
          />
          <Menu
            align="start"
            ariaLabel={t("filters.product")}
            trigger={
              <button type="button" className={`fb${family ? " set" : ""}`}>
                <Store className="ic" aria-hidden /><span className="l">{t("filters.product")}</span>
                <span className="v ar">{family?.label ?? t("filters.all")}</span><ChevronDown className="ic chev" aria-hidden />
              </button>
            }
            items={[
              { id: "_all", label: t("filters.all"), onSelect: () => set({ prod: null }) },
              ...(overview?.families ?? []).map((f) => ({ id: f.id, label: f.label, onSelect: () => set({ prod: f.id }) })),
            ]}
          />
          <Menu
            align="start"
            ariaLabel={t("filters.by")}
            trigger={
              <button type="button" className={`fb${agentName ? " set" : ""}`}>
                <User className="ic" aria-hidden /><span className="l">{t("filters.by")}</span>
                <span className="v">{agentName ?? t("filters.all")}</span><ChevronDown className="ic chev" aria-hidden />
              </button>
            }
            items={[
              { id: "_all", label: t("filters.all"), onSelect: () => set({ agent: null }) },
              ...(overview?.agents ?? []).map((a) => ({ id: a.id, label: a.name, onSelect: () => set({ agent: a.id }) })),
              { id: COURIER_AGENT, label: t("filters.darb"), onSelect: () => set({ agent: COURIER_AGENT }) },
            ]}
          />
          {(family || agentName || preset !== "d30") && (
            <button type="button" className="btn ghost" onClick={() => set({ prod: null, agent: null, from: null, to: null })}>
              <X className="ic" aria-hidden />{t("filters.clear")}
            </button>
          )}
        </div>

        {failed && <p role="alert" className="err">{t("actionFailed")}</p>}

        {overview && (
          <div aria-busy={stale} style={{ display: "contents" }}>
            {s.tab === "reasons" ? (
              <ReasonsView
                overview={overview}
                periodLabel={periodLabel}
                openId={reasonOpen}
                onOpen={setOpenReason}
                onOpenComplaint={() => {
                  if (overview.complaints.open === 1 && overview.complaints.firstOpenId) set({ tab: "sheet", peek: overview.complaints.firstOpenId });
                  else { setClosed(null); set({ tab: "sheet", view: "reclamation", only: null }); }
                }}
                onCheck={() => { setClosed(null); set({ tab: "sheet", view: "check", only: null }); }}
                onSeeAll={(topicId) => { setClosed(null); set({ tab: "sheet", view: "all", group: "reason", only: topicId }); }}
                onSaveAnswer={async (topicId, text) => {
                  await setTopicResponse(topicId, text);
                  void mutateOverview();
                }}
              />
            ) : (
              <SheetView
                overview={overview}
                rows={rows ?? []}
                total={total}
                view={s.view}
                group={s.group}
                closed={closedGroups}
                selected={selected}
                peek={s.peek}
                timeZone={timeZone}
                onView={(view) => set({ view })}
                onGroup={(group) => { setClosed(null); set({ group, only: null }); }}
                onToggleGroup={(k) => {
                  const next = new Set(closedGroups);
                  if (next.has(k)) next.delete(k); else next.add(k);
                  setClosed(next);
                  set({ only: null });
                }}
                onSelect={(id) => setSelected((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id); else next.add(id);
                  return next;
                })}
                onPeek={(id) => set({ peek: id })}
              />
            )}
          </div>
        )}
      </div>

      {selected.size > 0 && s.tab === "sheet" && (
        <div className="bulk" role="toolbar">
          <span>{t("bulk.selected", { n: selected.size })}</span>
          <button type="button" className="btn sec" disabled={busy} onClick={() => void discard([...selected])}>
            <Trash2 className="ic" aria-hidden />{t("bulk.discard")}
          </button>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Target className="ic" aria-hidden />
            <select aria-label={t("bulk.changeReason")} value="_" disabled={busy || [...selected].every((id) => rows?.find((r) => r.id === id)?.category === "reclamation")}
              onChange={(e) => void moveTo([...selected], e.target.value || null)}>
              <option value="_" disabled hidden>{t("bulk.changeReason")}</option>
              {choices.map((x) => <option key={x.id} value={x.id}>{label(x)}</option>)}
              <option value="">{t("noReason")}</option>
            </select>
          </label>
          <button type="button" className="btn ghost" onClick={() => setSelected(new Set())}>{t("bulk.cancel")}</button>
        </div>
      )}
      {toast && (
        <div className="bulk" role="status" style={selected.size > 0 ? { bottom: 78 } : undefined}>
          <span>{toast.text}</span>
          {toast.undo && <button type="button" className="btn sec" onClick={() => void undo(toast.undo!)}>{t("bulk.undo")}</button>}
        </div>
      )}

      {peekRow && (
        <VoiceDrawer
          row={peekRow}
          topics={overview?.topics ?? []}
          timeZone={timeZone}
          busy={busy}
          onClose={() => set({ peek: null })}
          onStatus={(status: ComplaintStatus) => void act(() => setComplaintStatus(peekRow.id, status))}
          onTopic={(topicId) => void moveTo([peekRow.id], topicId)}
          onDiscard={() => void discard([peekRow.id])}
        />
      )}
    </div>
  );
}

