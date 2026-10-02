"use client";

import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { useMarketScope } from "@/context/market-scope";
import { reviewFeedback, setComplaintStatus, useFeedbackOverview, useFeedbackRows } from "@/hooks/useFeedback";
import { isFeedbackCategory, type ComplaintStatus, type FeedbackCategory } from "@/lib/feedback/taxonomy";
import { COURIER_AGENT } from "@/lib/feedback/overview";
import { activePreset } from "@/lib/feedback/date-range";
import type { Role } from "@/types";
import { DateRangeControl } from "./DateRangeControl";
import { AgentsBox, AlertStrip, KpiCards, ProductPills, TopTopics } from "./OverviewBlocks";
import { FeedbackDrawer, FeedbackTable, FilterChips, type Chip } from "./FeedbackTable";

interface State {
  prod: string | null;
  from: string | null;
  to: string | null;
  agent: string | null;
  cat: FeedbackCategory | null;
  /** A topic id, or "none" for « Sans sujet ». */
  topic: string | null;
  peek: string | null;
  review: boolean;
  late: boolean;
  limit: number;
}

const PAGE = 20;

function readState(p: URLSearchParams): State {
  const cat = p.get("cat");
  return {
    prod: p.get("prod"),
    from: p.get("from"),
    to: p.get("to"),
    agent: p.get("agent"),
    cat: isFeedbackCategory(cat) ? cat : null,
    topic: p.get("topic"),
    peek: p.get("peek"),
    review: p.get("review") === "1",
    late: p.get("late") === "1",
    limit: PAGE,
  };
}

/**
 * « Voix du client » for a market manager or super_admin — prototype voix-du-client-manager-v6.
 *
 * Product pills, the period (quick buttons + a custom range, compared with the period of the
 * same length before it), the to-do strip, the three category cards with their trend, the top
 * topics, the entries per agent, the sheet and its drawer. « À valider » is the queue of
 * courier remarks and imported notes waiting for a manager. Every filter lives in the URL.
 */
export function FeedbackWorkspace({ role, marketId, locale }: { role: Role; marketId: string | null; locale: string }) {
  const t = useTranslations("feedback.manager");
  const tf = useTranslations("feedback");
  const activeLocale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const scope = useMarketScope();
  const market = role === "super_admin" ? scope.marketId : marketId;
  const marketParam = role === "super_admin" ? scope.marketId : null;

  const [s, setS] = useState<State>(() => readState(new URLSearchParams(params?.toString() ?? "")));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const { overview, error, mutate: mutateOverview } = useFeedbackOverview(
    { from: s.from, to: s.to, family: s.prod, agent: s.agent, cat: s.cat }, marketParam, Boolean(market),
  );
  const mode = s.review ? "review" : s.late ? "late" : "period";
  const { rows, total, mutate: mutateRows } = useFeedbackRows(
    { from: s.from, to: s.to, family: s.prod, agent: s.agent, cat: s.cat, topic: s.topic, mode, limit: s.limit }, marketParam, Boolean(market),
  );

  const set = useCallback((patch: Partial<State>) => {
    setS((prev) => {
      const next: State = { ...prev, ...patch, limit: "limit" in patch ? patch.limit! : PAGE };
      const q = new URLSearchParams();
      if (next.prod) q.set("prod", next.prod);
      if (next.from && next.to && overview && activePreset(next.from, next.to, overview.today, overview.first) !== "d30") {
        q.set("from", next.from);
        q.set("to", next.to);
      }
      if (next.agent) q.set("agent", next.agent);
      if (next.cat) q.set("cat", next.cat);
      if (next.topic) q.set("topic", next.topic);
      if (next.peek) q.set("peek", next.peek);
      if (next.review) q.set("review", "1");
      if (next.late) q.set("late", "1");
      const qs = q.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
      return next;
    });
  }, [router, pathname, overview]);

  const refresh = useCallback(() => { void mutateOverview(); void mutateRows(); }, [mutateOverview, mutateRows]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setFailed(false);
    try { await fn(); refresh(); } catch { setFailed(true); } finally { setBusy(false); }
  }

  const agentName = (id: string) => (id === COURIER_AGENT ? t("darb") : overview?.agents.find((a) => a.id === id)?.name ?? id);
  const topicName = (id: string) => {
    if (id === "none") return tf("noTopic");
    const x = overview?.topics.find((y) => y.id === id);
    return x ? (activeLocale.startsWith("ar") ? x.label_ar : x.label_fr) : id;
  };

  const chips: Chip[] = useMemo(() => {
    const c: Chip[] = [];
    if (s.review) return c;
    if (s.cat) c.push({ label: tf(`catPlural.${s.cat}`), clear: () => set({ cat: null, topic: null }) });
    if (s.topic) c.push({ label: topicName(s.topic), clear: () => set({ topic: null }) });
    if (s.agent) c.push({ label: agentName(s.agent), clear: () => set({ agent: null }) });
    if (s.late) c.push({ label: t("lateChip"), clear: () => set({ late: false }) });
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, overview, set]);

  if (!market) {
    return <div className="mx-auto max-w-[1480px] px-5 py-16 text-center text-[15px] text-[#6B7280]">{t("selectMarket")}</div>;
  }
  if (error && !overview) {
    return (
      <div className="mx-auto max-w-[1480px] px-5 py-16 text-center text-[15px] text-[#6B7280]">
        {t("error")} <button type="button" onClick={refresh} className="font-semibold text-[#15803D] underline">{t("retry")}</button>
      </div>
    );
  }

  const peekRow = s.peek ? rows?.find((r) => r.id === s.peek) ?? null : null;
  const now = Date.now();

  return (
    <main className="min-w-0 px-7 pb-[60px] pt-[22px] text-start text-[14px] text-[#1A1A1A] max-md:px-4">
      <div className="mb-3.5 flex flex-wrap items-center gap-3">
        <h1 className="m-0 flex items-center gap-2 text-[20px] font-[650]">
          {s.review && (
            <button type="button" aria-label={t("back")} onClick={() => set({ review: false, peek: null })} className="text-[14px] text-[#8A9096]">
              <ArrowLeft size={16} className="rtl:rotate-180" aria-hidden />
            </button>
          )}
          {s.review ? t("reviewing") : tf("title")}
        </h1>
        <span className="flex-1" />
        {overview && (
          <DateRangeControl
            from={s.from ?? overview.from} to={s.to ?? overview.to} today={overview.today} first={overview.first}
            family={s.prod} market={marketParam}
            onChange={(from, to) => set({ from, to })}
          />
        )}
        <select
          aria-label={t("allAgents")}
          value={s.agent ?? ""}
          onChange={(e) => set({ agent: e.target.value || null })}
          className="h-8 rounded-lg border border-[#E1E3E5] bg-white px-2.5 text-[13px]"
        >
          <option value="">{t("allAgents")}</option>
          {overview?.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          <option value={COURIER_AGENT}>{t("darb")}</option>
        </select>
      </div>

      {overview && <ProductPills overview={overview} value={s.prod} onChange={(prod) => set({ prod, topic: null })} />}

      {!s.review && overview && (
        <>
          <AlertStrip
            late={overview.complaints.late} review={overview.review}
            onLate={() => set({ late: true, cat: null, topic: null, review: false })}
            onReview={() => set({ review: true, late: false, peek: null })}
          />
          <KpiCards overview={overview} value={s.cat} onChange={(cat) => set({ cat, topic: null, late: false })} />
          <div className="mb-3 grid grid-cols-[1.25fr_1fr] gap-3 max-lg:grid-cols-1">
            <TopTopics
              overview={overview} category={s.cat} topicId={s.topic}
              onPick={(cat, topicId) => {
                const topic = topicId ?? "none";
                if (s.cat === cat && s.topic === topic) set({ topic: null });
                else set({ cat, topic, late: false });
              }}
            />
            <AgentsBox overview={overview} value={s.agent} onPick={(id) => set({ agent: s.agent === id ? null : id })} />
          </div>
        </>
      )}

      <FilterChips chips={chips} onClear={() => set({ cat: null, topic: null, agent: null, late: false })} />
      {failed && <p role="alert" className="mb-2 text-[13px] font-semibold text-[#B91C1C]">{t("actionFailed")}</p>}
      <FeedbackTable
        rows={rows} total={total} review={s.review} topics={overview?.topics ?? []} agents={overview?.agents ?? []}
        peek={s.peek} now={now}
        onPeek={(id) => set({ peek: id, limit: s.limit })}
        onMore={() => set({ limit: s.limit + PAGE })}
        onKeep={(id) => void act(() => reviewFeedback("keep", [id]))}
        onIgnore={(id) => void act(() => reviewFeedback("ignore", [id]))}
      />

      {peekRow && !s.review && (
        <FeedbackDrawer
          row={peekRow} topics={overview?.topics ?? []} agents={overview?.agents ?? []} locale={locale} busy={busy}
          onClose={() => set({ peek: null, limit: s.limit })}
          onStatus={(status: ComplaintStatus) => void act(() => setComplaintStatus(peekRow.id, status))}
        />
      )}
    </main>
  );
}
