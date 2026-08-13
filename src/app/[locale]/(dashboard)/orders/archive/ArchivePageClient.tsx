"use client";

import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Download, AlertCircle } from "lucide-react";
import type { Locale, Role } from "@/types";
import { fetcher } from "@/lib/swr-config";
import { useMarketScope } from "@/context/market-scope";
import { useOrdersList, type OrdersListRow } from "@/hooks/useOrdersList";
import { useOrdersRealtime } from "@/hooks/useOrdersRealtime";
import {
  DEFAULT_FILTERS,
  type OrderListFilters,
} from "@/lib/orders/list-filters";
import {
  ARCHIVE_STATUSES,
  DEFAULT_ARCHIVE_AFTER_DAYS,
  type ArchiveState,
} from "@/lib/orders/archive-scope";
import { todayISO } from "@/lib/date";

interface Props {
  role: Role;
  locale: Locale;
  userMarketId: string;
  userMarketLabel: string;
  userMarketCurrency: string;
  initialMarketId: string;
}

/** One snapshot from get_archive_summary — every figure over the same rows. */
interface Summary {
  total: number;
  shipped: number;
  outcomes: { delivered: number; returned: number; rejected: number; cancelled: number };
  reasons: Record<string, number>;
  winback: {
    total: number;
    never_called: number;
    partial: number;
    exhausted: number;
    second_phone: number;
  };
  cities: Array<{ city: string; shipped: number; returned: number }>;
  speed: Array<{
    status: string;
    n: number;
    median_days: number;
    p90_days: number;
    same_day: number;
  }>;
  cohorts: Array<{ week: string; total: number }>;
  placement: { archived: number; in_list: number };
}

/**
 * Below this many shipped parcels a return rate is noise, so it is withheld
 * rather than ranked. A percentage over 20 orders invites acting on nothing.
 */
const MIN_SAMPLE = 30;

const OUTCOMES = ["delivered", "returned", "rejected", "cancelled"] as const;
type Outcome = (typeof OUTCOMES)[number];

const OUTCOME_STYLE: Record<Outcome, { chip: string; bar: string }> = {
  delivered: { chip: "bg-[#E3F1DF] text-[#116530]", bar: "bg-[#15803D]" },
  returned: { chip: "bg-[#FFF1E6] text-[#8A4B00]", bar: "bg-[#8A4B00]" },
  rejected: { chip: "bg-[#FFF4F4] text-[#D72C0D]", bar: "bg-[#D72C0D]" },
  cancelled: { chip: "bg-[#EEF1F6] text-[#44546F]", bar: "bg-[#44546F]" },
};

/**
 * Presentation for a loss cause. The LIST of causes is derived from the data,
 * never from this table — a hard-coded list silently dropped `autre` (238
 * orders), so the rows added up to less than the "orders lost" figure printed
 * above them. Anything without an entry here still renders, with a neutral tag.
 */
const CAUSE_META: Record<string, { tag: string; tone: string; sub: string }> = {
  injoignable:          { tag: "tagRecoverable",  tone: "bg-brand-bg text-brand border-[#CDE8D8]",        sub: "causeNeverReachedSub" },
  refus_client:         { tag: "tagOffer",        tone: "bg-[#FFF1E6] text-[#8A4B00] border-[#F5DCC5]",   sub: "causeRefusedSub" },
  commande_invalide:    { tag: "tagDataQuality",  tone: "bg-[#EEF1F6] text-[#44546F] border-[#D7DEE9]",   sub: "causeBadDataSub" },
  autre:                { tag: "tagFixProcess",   tone: "bg-[#FFF4F4] text-[#D72C0D] border-[#F6D9D5]",   sub: "causeUntaggedSub" },
  non_renseigne:        { tag: "tagFixProcess",   tone: "bg-[#FFF4F4] text-[#D72C0D] border-[#F6D9D5]",   sub: "causeUntaggedSub" },
  livraison_impossible: { tag: "tagCarrier",      tone: "bg-[#EEF1F6] text-[#44546F] border-[#D7DEE9]",   sub: "causeUndeliverableSub" },
  cancelled:            { tag: "tagCarrier",      tone: "bg-[#EEF1F6] text-[#44546F] border-[#D7DEE9]",   sub: "causeCarrierCancelledSub" },
  returned:             { tag: "tagCarrier",      tone: "bg-[#FFF1E6] text-[#8A4B00] border-[#F5DCC5]",   sub: "causeReturnedSub" },
};
const NEUTRAL_TONE = "bg-surface-selected text-ink-secondary border-line-strong";

/** Deterministic thousands separator — Intl varies by ICU build. */
function num(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}
function pct(part: number, whole: number): string {
  if (whole <= 0) return "0 %";
  return `${(Math.round((part / whole) * 1000) / 10).toFixed(1).replace(".", ",")} %`;
}
function daysAgo(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export function ArchivePageClient({
  role,
  userMarketId,
  userMarketLabel,
  initialMarketId,
}: Props) {
  const t = useTranslations("orders.archive");
  const tStatus = useTranslations("orders.statuses");
  const tReason = useTranslations("orders.rejectionReasons");
  const { marketId: scopedMarketId } = useMarketScope();
  const marketId = scopedMarketId || initialMarketId || userMarketId;

  const [tab, setTab] = useState<Exclude<ArchiveState, "all">>("eligible");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const from = useMemo(() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 89);
    return d.toISOString().slice(0, 10);
  }, []);
  const to = todayISO();

  const summaryKey = marketId
    ? `/api/orders/archive/summary?market_id=${marketId}&from_date=${from}&to_date=${to}`
    : null;
  const { data: summaryRes, mutate: mutateSummary } = useSWR<{ data: Summary }>(
    summaryKey,
    fetcher,
    { revalidateOnFocus: false },
  );
  const s = summaryRes?.data;

  const filters: OrderListFilters = useMemo(
    () => ({
      ...DEFAULT_FILTERS,
      marketId: marketId || null,
      statuses: ARCHIVE_STATUSES,
      scope: "archive",
      dateFrom: from,
      dateTo: to,
    }),
    [marketId, from, to],
  );

  const { rows, mutate: mutateList } = useOrdersList({ filters });
  useOrdersRealtime({ marketId: marketId || null, mutate: mutateList, matchFilter: () => false });

  // Which bucket a finished order sits in. Mirrors resolveArchiveState on the
  // server so the tabs and the API agree.
  const stateOf = useCallback((r: OrdersListRow): Exclude<ArchiveState, "all"> => {
    if (r.archived_at) return "archived";
    const age = daysAgo(r.terminal_at);
    return age !== null && age >= DEFAULT_ARCHIVE_AFTER_DAYS ? "eligible" : "recent";
  }, []);

  const visible = useMemo(() => rows.filter((r) => stateOf(r) === tab), [rows, tab, stateOf]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const run = useCallback(
    async (action: "archive" | "unarchive") => {
      const ids = Array.from(selected);
      if (ids.length === 0) return;
      setPending(true);
      setError(null);
      try {
        const res = await fetch("/api/orders/archive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order_ids: ids, action }),
        });
        if (!res.ok) throw new Error(String(res.status));
        setSelected(new Set());
        setNotice(
          action === "archive"
            ? t("putAwayDone", { count: ids.length })
            : t("broughtBackDone", { count: ids.length }),
        );
        // Rows and tiles refresh together, or the page contradicts itself.
        await Promise.all([mutateList(), mutateSummary()]);
      } catch {
        setError(t("actionError"));
      } finally {
        setPending(false);
      }
    },
    [selected, t, mutateList, mutateSummary],
  );

  const lost = s ? s.total - s.outcomes.delivered : 0;

  /**
   * Every loss, largest first. Rejections come from their own reason
   * breakdown; carrier outcomes come from the status counts. Together they
   * are exactly `lost`, because the RPC computes both from the same rows.
   */
  const causeRows = useMemo(() => {
    if (!s) return [];
    const rows: Array<{ key: string; n: number; kind: "reason" | "status" }> = [
      ...Object.entries(s.reasons).map(([key, n]) => ({ key, n, kind: "reason" as const })),
      { key: "cancelled", n: s.outcomes.cancelled, kind: "status" as const },
      { key: "returned", n: s.outcomes.returned, kind: "status" as const },
    ];
    return rows.filter((r) => r.n > 0).sort((a, b) => b.n - a.n);
  }, [s]);
  const hiddenCities = s ? s.cities.filter((c) => c.shipped < MIN_SAMPLE).length : 0;

  // Rejections land in ~1 day, deliveries in ~4. Stating the gap turns two
  // table rows into the finding they actually are.
  const speedInsight = useMemo(() => {
    const rej = s?.speed.find((r) => r.status === "rejected");
    const del = s?.speed.find((r) => r.status === "delivered");
    if (!rej || !del || del.median_days <= rej.median_days) return null;
    return t("speedInsight", {
      reject: t("days", { n: String(rej.median_days).replace(".", ",") }),
      deliver: t("days", { n: String(del.median_days).replace(".", ",") }),
    });
  }, [s, t]);

  return (
    <div className="mx-auto max-w-[1560px] px-6 pb-16 pt-5">
      {/* ---------- header ---------- */}
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold leading-tight tracking-tight text-ink-primary">
            {t("title")}
          </h1>
          <p className="mt-0.5 text-[12.5px] text-ink-secondary">
            {t("subtitle", { count: num(s?.total ?? 0), market: userMarketLabel })}
          </p>
        </div>
        <a
          href={`/api/orders/export?scope=archive&market_id=${marketId}&date_from=${from}&date_to=${to}`}
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-[12.5px] font-semibold text-white hover:bg-brand-hover"
        >
          <Download size={14} aria-hidden="true" />
          {t("exportCsv")}
        </a>
      </header>

      {/* ---------- the rule, and what it does not do ---------- */}
      <section className="mb-4 grid gap-3 lg:grid-cols-[1.5fr_1fr]">
        <div className="rounded-2xl border border-line-subtle bg-surface-card p-4 shadow-sm">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-ink-primary">
            {t("ruleTitle")}
          </h2>
          <p className="mt-2 text-[12px] leading-relaxed text-ink-secondary">{t("ruleNote")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Stat label={t("ruleArchived")} value={s?.placement.archived ?? 0} tone="brand" />
            <Stat label={t("ruleEligible")} value={visibleCount(rows, stateOf, "eligible")} />
            <Stat label={t("ruleRecent")} value={visibleCount(rows, stateOf, "recent")} />
          </div>
        </div>

        <section aria-label={t("resultSucceeded")} className="flex flex-col justify-center rounded-2xl border border-line-subtle bg-surface-card p-4 shadow-sm">
          <p className="text-[12px] text-ink-muted">{t("resultHint", { count: num(s?.total ?? 0) })}</p>
          <p className="mt-1 text-[32px] font-bold leading-none tracking-tight text-brand tabular-nums">
            {pct(s?.outcomes.delivered ?? 0, s?.total ?? 0)}
          </p>
          <p className="mt-1.5 text-[12px] leading-snug text-ink-secondary">
            {t("resultSucceeded")}
            <br />
            {t("resultSplit", { delivered: num(s?.outcomes.delivered ?? 0), lost: num(lost) })}
          </p>
        </section>
      </section>

      {/* ---------- outcome split ---------- */}
      <section aria-label={t("resultTitle")} className="mb-4 rounded-2xl border border-line-subtle bg-surface-card p-4 shadow-sm">
        <h2 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-ink-primary">
          {t("resultTitle")}
        </h2>
        <div className="flex h-8 overflow-hidden rounded-lg" role="img" aria-label={t("resultTitle")}>
          {OUTCOMES.map((o) => (
            <span
              key={o}
              className={OUTCOME_STYLE[o].bar}
              style={{ width: `${((s?.outcomes[o] ?? 0) / Math.max(1, s?.total ?? 1)) * 100}%` }}
            />
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
          {OUTCOMES.map((o) => (
            <span key={o} className="inline-flex items-center gap-2 text-[12px] text-ink-secondary">
              <i className={`h-2.5 w-2.5 shrink-0 rounded-sm ${OUTCOME_STYLE[o].bar}`} />
              {tStatus(o)}
              <b className="font-bold tabular-nums text-ink-primary">{num(s?.outcomes[o] ?? 0)}</b>
              <span className="tabular-nums">{pct(s?.outcomes[o] ?? 0, s?.total ?? 0)}</span>
            </span>
          ))}
        </div>
        {s && s.shipped > 0 && (
          <p className="mt-3 border-t border-line pt-2.5 text-[12.5px] text-ink-secondary">
            {t("shippedArrived", {
              shipped: num(s.shipped),
              rate: pct(s.outcomes.delivered, s.shipped),
            })}{" "}
            {t("shippedReturned", { rate: pct(s.outcomes.returned, s.shipped) })}
          </p>
        )}
      </section>

      {/* ---------- why we lose ---------- */}
      <section aria-label={t("causesTitle")} className="mb-4 rounded-2xl border border-line-subtle bg-surface-card p-4 shadow-sm">
        <h2 className="mb-1 text-[11px] font-bold uppercase tracking-wider text-ink-primary">
          {t("causesTitle")}
        </h2>
        <p className="mb-3 text-[12px] text-ink-muted">{t("causesHint", { count: num(lost) })}</p>
        <ul className="grid list-none gap-2 p-0 xl:grid-cols-2">
          {causeRows.map((c) => {
            const meta = CAUSE_META[c.key];
            const label = c.kind === "reason" ? tReason(c.key) : tStatus(c.key);
            return (
              <li
                key={`${c.kind}:${c.key}`}
                data-count={c.n}
                className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-lg border border-line px-3 py-2.5 sm:grid-cols-[minmax(120px,1fr)_56px_minmax(70px,1fr)_auto]"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-ink-primary">{label}</p>
                  <p className="truncate text-[11px] text-ink-muted">
                    {meta
                      ? c.key === "injoignable"
                        ? t(meta.sub, { count: s?.winback.never_called ?? 0 })
                        : t(meta.sub)
                      : null}
                  </p>
                </div>
                <div className="text-end">
                  <p className="text-[18px] font-bold leading-none tabular-nums text-ink-primary">
                    {num(c.n)}
                  </p>
                  <p className="mt-0.5 text-[10.5px] tabular-nums text-ink-muted">
                    {t("causeShare", { pct: pct(c.n, lost) })}
                  </p>
                </div>
                <div className="hidden h-1.5 overflow-hidden rounded-full bg-surface-selected sm:block">
                  <i
                    className="block h-full rounded-full bg-ink-muted"
                    style={{ width: `${(c.n / Math.max(1, lost)) * 100}%` }}
                  />
                </div>
                <span
                  className={`rounded-md border px-2 py-0.5 text-[11px] font-bold ${meta?.tone ?? NEUTRAL_TONE}`}
                >
                  {t(meta?.tag ?? "tagFixProcess")}
                </span>
              </li>
            );
          })}
        </ul>

        {s && s.winback.never_called > 0 && (
          <p className="mt-3 flex items-start gap-2.5 rounded-lg border border-[#F6D9D5] bg-[#FFF4F4] px-3.5 py-3 text-[12.5px] leading-relaxed text-[#8C2A18]">
            <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{t("neverCalledAlert", { count: s.winback.never_called })}</span>
          </p>
        )}
      </section>

      {/* ---------- win-back ---------- */}
      {s && s.winback.total > 0 && (
        <section aria-label={t("winbackTitle")} className="mb-4 rounded-2xl border border-line-subtle bg-surface-card p-4 shadow-sm">
          <h2 className="mb-1 text-[11px] font-bold uppercase tracking-wider text-ink-primary">
            {t("winbackTitle")}
          </h2>
          <p className="mb-3 text-[12px] text-ink-muted">
            {t("winbackHint", { count: s.winback.total })}
          </p>
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
            <WinCard title={t("winbackNeverCalled")} sub={t("winbackNeverCalledSub")} n={s.winback.never_called} highlight />
            <WinCard title={t("winbackPartial")} sub={t("winbackPartialSub")} n={s.winback.partial} highlight />
            <WinCard title={t("winbackExhausted")} sub={t("winbackExhaustedSub")} n={s.winback.exhausted} />
            <WinCard title={t("winbackSecondPhone")} sub={t("winbackSecondPhoneSub")} n={s.winback.second_phone} />
          </div>
        </section>
      )}

      {/* ---------- cities + speed ---------- */}
      <section className="mb-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-line-subtle bg-surface-card p-4 shadow-sm">
          <h2 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-ink-primary">
            {t("citiesTitle")}
          </h2>
          <DataTable>
            <thead>
              <tr>
                <Th align="start">{t("cityCol")}</Th>
                <Th>{t("shippedCol")}</Th>
                <Th>{t("returnedCol")}</Th>
                <Th>{t("rateCol")}</Th>
              </tr>
            </thead>
            <tbody>
              {(s?.cities ?? []).map((c) => {
                const weak = c.shipped < MIN_SAMPLE;
                return (
                  <tr key={c.city}>
                    <Td align="start" className="text-ink-primary">{c.city}</Td>
                    <Td className="tabular-nums text-ink-secondary">{c.shipped}</Td>
                    <Td className="tabular-nums text-ink-secondary">{c.returned}</Td>
                    <Td className="tabular-nums">
                      {weak ? (
                        <span className="inline-flex h-6 items-center rounded-lg border border-[#F5DCC5] bg-[#FFF1E6] px-2.5 text-[11.5px] font-semibold text-[#8A4B00]">
                          {t("tooFew")}
                        </span>
                      ) : (
                        <span className="font-semibold text-ink-primary">{pct(c.returned, c.shipped)}</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
          {hiddenCities > 0 && (
            <p className="mt-2.5 text-[12px] text-ink-muted">
              {t("citiesHidden", { count: hiddenCities, threshold: MIN_SAMPLE })}
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-line-subtle bg-surface-card p-4 shadow-sm">
          <h2 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-ink-primary">
            {t("speedTitle")}
          </h2>
          <DataTable>
            <thead>
              <tr>
                <Th align="start">{t("outcomeCol")}</Th>
                <Th>{t("countCol")}</Th>
                <Th>{t("medianCol")}</Th>
                <Th>{t("p90Col")}</Th>
              </tr>
            </thead>
            <tbody>
              {(s?.speed ?? []).map((r) => (
                <tr key={r.status}>
                  <Td align="start">
                    <StatusChip status={r.status} label={tStatus(r.status)} />
                  </Td>
                  <Td className="tabular-nums text-ink-secondary">{num(r.n)}</Td>
                  <Td className="font-semibold tabular-nums text-ink-primary">
                    {t("days", { n: String(r.median_days).replace(".", ",") })}
                  </Td>
                  <Td className="tabular-nums text-ink-secondary">
                    {t("days", { n: String(r.p90_days).replace(".", ",") })}
                  </Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
          {speedInsight && (
            <p className="mt-3 border-t border-line pt-2.5 text-[12.5px] leading-relaxed text-ink-secondary">
              {speedInsight}
            </p>
          )}
        </div>
      </section>

      {/* ---------- the register ---------- */}
      <section className="rounded-2xl border border-line-subtle bg-surface-card p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-ink-primary">
              {t("registerTitle")}
            </h2>
            <p className="mt-0.5 text-[12px] text-ink-muted">
              {tab === "archived"
                ? t("registerHintArchived")
                : tab === "recent"
                  ? t("registerHintRecent")
                  : t("registerHintEligible")}
            </p>
          </div>
          <div role="tablist" className="inline-flex gap-1 rounded-lg border border-line-strong bg-surface-selected p-1">
            {(["eligible", "archived", "recent"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                onClick={() => {
                  setTab(k);
                  setSelected(new Set());
                }}
                className={`rounded-md px-3 py-1.5 text-[12.5px] font-semibold ${
                  tab === k ? "bg-surface-card text-ink-primary shadow-sm" : "text-ink-secondary"
                }`}
              >
                {t(k === "eligible" ? "tabEligible" : k === "archived" ? "tabArchived" : "tabRecent")}
              </button>
            ))}
          </div>
        </div>

        {selected.size > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg bg-ink-primary px-3.5 py-2.5 text-[12.5px] text-white">
            <b className="font-bold">{t("selected", { count: selected.size })}</b>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="rounded-md border border-white/25 px-3 py-1.5 font-semibold text-white/80"
            >
              {t("clearSelection")}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(tab === "archived" ? "unarchive" : "archive")}
              className="rounded-md bg-white px-3 py-1.5 font-semibold text-ink-primary disabled:opacity-50"
            >
              {tab === "archived" ? t("bringBack") : t("putAway")}
            </button>
          </div>
        )}

        {error && (
          <p className="mb-3 rounded-lg border border-[#F6D9D5] bg-[#FFF4F4] px-3 py-2 text-[12.5px] text-[#8C2A18]">
            {error}
          </p>
        )}
        {notice && !error && (
          <p className="mb-3 rounded-lg border border-[#CDE8D8] bg-brand-bg px-3 py-2 text-[12.5px] text-brand">
            {notice}
          </p>
        )}

        <DataTable minWidth={720}>
          <thead>
            <tr>
              <Th align="start" className="w-10">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-brand align-middle"
                  aria-label={t("selectAll")}
                  checked={visible.length > 0 && visible.every((r) => selected.has(r.id))}
                  onChange={(e) =>
                    setSelected(e.target.checked ? new Set(visible.map((r) => r.id)) : new Set())
                  }
                />
              </Th>
              <Th align="start">#</Th>
              <Th align="start">{t("cityCol")}</Th>
              <Th align="start">{t("outcomeCol")}</Th>
              <Th align="start">{t("reasonCol")}</Th>
              <Th>{t("finishedAgo")}</Th>
              <Th align="start">{t("whereItIs")}</Th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-3.5 py-10 text-center text-[13px] text-ink-secondary"
                >
                  {t("emptyHere")}
                </td>
              </tr>
            )}
            {visible.map((r) => {
              const st = stateOf(r);
              const age = daysAgo(r.terminal_at);
              const isOn = selected.has(r.id);
              return (
                <tr key={r.id} className={isOn ? "bg-brand-tint" : undefined}>
                  <Td align="start">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-brand align-middle"
                      aria-label={`${t("putAway")} ${r.id}`}
                      checked={isOn}
                      onChange={() => toggle(r.id)}
                    />
                  </Td>
                  <Td align="start" className="font-mono text-[12px] text-ink-primary">
                    {r.external_id ?? r.id.slice(0, 8)}
                  </Td>
                  <Td align="start" className="text-ink-secondary">
                    {r.customer_city ?? "—"}
                  </Td>
                  <Td align="start">
                    <StatusChip status={r.status} label={tStatus(r.status)} />
                  </Td>
                  <Td align="start" className="text-ink-secondary">
                    {r.rejection_reason ? tReason(r.rejection_reason) : "—"}
                  </Td>
                  <Td className="tabular-nums text-ink-secondary">
                    {age === null ? "—" : t("days", { n: String(age) })}
                  </Td>
                  <Td align="start">
                    <PlacementChip
                      state={st}
                      label={
                        st === "archived"
                          ? t("stateArchived")
                          : st === "eligible"
                            ? t("stateEligible")
                            : t("stateInList")
                      }
                    />
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      </section>
    </div>
  );
}

function visibleCount(
  rows: OrdersListRow[],
  stateOf: (r: OrdersListRow) => string,
  want: string,
): number {
  return rows.filter((r) => stateOf(r) === want).length;
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "brand" }) {
  return (
    <div
      className={`min-w-[112px] rounded-lg border px-3 py-2 ${
        tone === "brand" ? "border-[#CDE8D8] bg-brand-bg" : "border-line bg-surface-card"
      }`}
    >
      <p className="text-[10px] font-bold uppercase tracking-wide text-ink-muted">{label}</p>
      <p
        className={`mt-0.5 text-[19px] font-bold tabular-nums ${
          tone === "brand" ? "text-brand" : "text-ink-primary"
        }`}
      >
        {num(value)}
      </p>
    </div>
  );
}

function WinCard({
  title,
  sub,
  n,
  highlight,
}: {
  title: string;
  sub: string;
  n: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3.5 ${
        highlight ? "border-[#CDE8D8] bg-brand-bg" : "border-line opacity-70"
      }`}
    >
      <p className="text-[10.5px] font-bold uppercase tracking-wide text-ink-muted">{title}</p>
      <p className={`mt-1 text-[27px] font-bold leading-none tabular-nums ${highlight ? "text-brand" : "text-ink-primary"}`}>
        {num(n)}
      </p>
      <p className="mt-1 text-[11.5px] leading-snug text-ink-secondary">{sub}</p>
    </div>
  );
}

/**
 * Table primitives matching prototypes/products-ui-v4.html — sunken header
 * band, hairline `line-subtle` rules, 12/14 cell padding, row hover, and no
 * rule under the final row. All three tables on this page use them, so the
 * register no longer looks like a different component from the two above it.
 */
function StatusChip({ status, label }: { status: string; label: string }) {
  return (
    <span
      className={`inline-flex h-6 items-center rounded-lg px-2.5 text-[11.5px] font-semibold ${
        OUTCOME_STYLE[status as Outcome]?.chip ?? "bg-surface-selected text-ink-secondary"
      }`}
    >
      {label}
    </span>
  );
}

function PlacementChip({ state, label }: { state: string; label: string }) {
  const tone =
    state === "archived"
      ? "bg-surface-selected text-ink-secondary"
      : state === "eligible"
        ? "bg-[#FFF1E6] text-[#8A4B00]"
        : "bg-brand-bg text-brand";
  return (
    <span className={`inline-flex h-6 items-center rounded-lg px-2.5 text-[11.5px] font-semibold ${tone}`}>
      {label}
    </span>
  );
}

function DataTable({
  children,
  minWidth,
}: {
  children: React.ReactNode;
  minWidth?: number;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line-subtle">
      <table
        className="w-full border-separate border-spacing-0 text-[13px] [&_tbody_tr:hover_td]:bg-surface-hover [&_tbody_tr:last-child_td]:border-b-0"
        style={minWidth ? { minWidth } : undefined}
      >
        {children}
      </table>
    </div>
  );
}

function Th({
  children,
  align = "end",
  className = "",
}: {
  children?: React.ReactNode;
  align?: "start" | "end";
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`whitespace-nowrap border-b border-line-subtle bg-surface-sunken px-3.5 py-3 text-[10.5px] font-bold uppercase tracking-[0.06em] text-ink-muted ${
        align === "start" ? "text-start" : "text-end"
      } ${className}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "end",
  className = "",
}: {
  children?: React.ReactNode;
  align?: "start" | "end";
  className?: string;
}) {
  return (
    <td
      className={`border-b border-line-subtle px-3.5 py-3 ${
        align === "start" ? "text-start" : "text-end"
      } ${className}`}
    >
      {children}
    </td>
  );
}
