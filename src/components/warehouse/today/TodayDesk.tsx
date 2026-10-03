"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";
import type { DayJob, Decision, DecisionTarget } from "@/lib/warehouse/day-loop";
import type { DayLoopPayload } from "@/lib/warehouse/day-loop-assemble";

/**
 * « Aujourd'hui » on the manager's desk.
 *
 * The agent's four jobs, wider: each card carries its backlog and, under it,
 * the split by building. What only a manager sees sits below — the decisions
 * waiting for them (every one a link to where it is taken) and today's team,
 * a building that has not scanned included. Same assembly as the agent's
 * screen (`day-loop-assemble.ts`), so the two can never disagree.
 */

const JOB_HREF: Record<DayJob["key"], string> = {
  out: "/warehouse/out",
  returns: "/warehouse/returns",
  receive: "/warehouse/stock?tab=receptions",
  count: "/warehouse/count",
};

const DECISION_HREF: Record<DecisionTarget, string> = {
  out: "/warehouse/out",
  returns: "/warehouse/returns",
  receptions: "/warehouse/stock?tab=receptions",
  count: "/warehouse/count",
};

const HUE: Record<DayJob["key"], string> = {
  out: "job-out",
  returns: "job-returns",
  receive: "job-receive",
  count: "job-count",
};

type SiteCountKey = "toPrepare" | "returnsAtCarrier" | "receptionsExpected" | "neverCounted";
const SPLIT_KEY: Record<DayJob["key"], SiteCountKey> = {
  out: "toPrepare",
  returns: "returnsAtCarrier",
  receive: "receptionsExpected",
  count: "neverCounted",
};

export function TodayDesk({
  data,
  locale,
  dateLabel,
  pickup,
}: {
  data: DayLoopPayload;
  locale: string;
  dateLabel: string;
  pickup?: React.ReactNode;
}) {
  const t = useTranslations("warehouse.today");
  const format = useFormatter();
  const { counts, sites, loop } = data;
  const progress = loop.progress;

  const unit = (job: DayJob) =>
    job.key === "out"
      ? t("outUnit", { n: job.count })
      : job.key === "returns"
        ? t("returnsSub", { n: job.count })
        : job.key === "receive"
          ? t("receiveSub", { n: job.count })
          : job.state === "never"
            ? t("countNever")
            : t("countSub", { n: job.count });

  const foot = (job: DayJob): { text: string; warn: boolean } | null => {
    switch (job.key) {
      case "returns":
        return counts.returnsOnTheWay > 0 ? { text: t("returnsOnWay", { n: counts.returnsOnTheWay }), warn: false } : null;
      case "receive": {
        const parts = [
          counts.receptionsLate > 0 ? t("receiveLate", { n: counts.receptionsLate }) : null,
          counts.receptionsEmpty > 0 ? t("receiveEmpty", { n: counts.receptionsEmpty }) : null,
        ].filter(Boolean);
        return parts.length ? { text: parts.join(" · "), warn: true } : null;
      }
      case "count":
        return job.state === "never" ? { text: t("neverChip"), warn: true } : null;
      default:
        return null;
    }
  };

  const decisionTitle = (d: Decision) => t(`decisions.${d.key}`, { n: d.count });
  const decisionHint = (d: Decision) => t(`decisions.${d.key}Hint`);

  return (
    <div className="mx-auto w-full max-w-[1460px] px-4 pb-10 pt-4 md:px-7">
      <header className="mb-5 flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-wh-ink-2" dir="auto">{dateLabel}</p>
          <h1 className="text-[24px] font-bold tracking-[-0.02em] text-wh-ink-1">{t("title")}</h1>
        </div>
        {sites.length > 1 ? (
          <nav aria-label={t("siteScope")} className="inline-flex gap-0.5 rounded-[10px] bg-wh-sunken p-[3px]">
            {[{ id: null as string | null, name: t("allSites") }, ...sites.map((s) => ({ id: s.id as string | null, name: s.name }))].map(
              (s) => {
                const current = data.focus === s.id;
                return (
                  <Link
                    key={s.id ?? "all"}
                    href={`/${locale}/warehouse${s.id ? `?warehouse_id=${s.id}` : ""}`}
                    aria-current={current ? "page" : undefined}
                    className={[
                      "rounded-[8px] px-3.5 py-1.5 text-[13px] font-semibold no-underline",
                      current ? "bg-wh-surface text-wh-ink-1 shadow-[0_1px_2px_rgba(16,24,40,.06)]" : "text-wh-ink-2",
                    ].join(" ")}
                  >
                    {s.name}
                  </Link>
                );
              },
            )}
          </nav>
        ) : null}
      </header>

      {pickup ? <div className="mb-4">{pickup}</div> : null}

      {/* ── The four jobs, in the order of a day ──────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {loop.jobs.map((job, i) => {
          const f = foot(job);
          const idle = job.state === "idle";
          return (
            <Link
              key={job.key}
              href={`/${locale}${JOB_HREF[job.key]}`}
              data-job={job.key}
              data-state={job.state}
              className={`${HUE[job.key]} flex flex-col gap-3 rounded-[14px] border border-wh-border bg-wh-surface p-[18px] no-underline transition-colors hover:border-wh-border-strong`}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={[
                    "grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-bold",
                    i === 0 ? "bg-job text-white" : "bg-job-bg text-job-ink",
                  ].join(" ")}
                >
                  {i + 1}
                </span>
                <span className="flex-1 text-[15px] font-bold text-wh-ink-1">{t(`short.${job.key}`)}</span>
                <ChevronRight size={16} className="text-wh-ink-3 rtl:-scale-x-100" aria-hidden="true" />
              </div>
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span
                  data-testid="today-figure"
                  className={`text-[40px] font-bold leading-none tracking-[-0.03em] tabular-nums ${idle ? "text-wh-ink-3" : "text-job-ink"}`}
                >
                  {job.count}
                </span>
                <span className="text-[13.5px] text-wh-ink-2">{unit(job)}</span>
              </p>
              {sites.length > 1 ? (
                <p data-testid="today-split" className="flex gap-4 text-[12.5px] text-wh-ink-2">
                  {sites.map((s) => (
                    <span key={s.id}>
                      {s.name} <b className="tabular-nums text-wh-ink-1">{s.counts[SPLIT_KEY[job.key]]}</b>
                    </span>
                  ))}
                </p>
              ) : null}
              {job.key === "out" ? (
                <div className="mt-auto">
                  <div
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progress.pct}
                    aria-label={t("scannedToday")}
                    className="h-1.5 overflow-hidden rounded-pill bg-wh-sunken"
                  >
                    <i className="block h-full rounded-pill bg-job" style={{ width: `${progress.pct}%` }} />
                  </div>
                  <p className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-wh-ink-2">
                    <span>
                      <b className="tabular-nums text-wh-ink-1">{progress.done}</b> {t("scannedToday")}
                      {progress.hasGoal ? ` · ${t("goal", { n: progress.target })}` : null}
                    </span>
                  </p>
                </div>
              ) : f ? (
                <p className={`mt-auto text-[12.5px] ${f.warn ? "text-status-warning" : "text-wh-ink-2"}`} dir="auto">
                  {f.text}
                </p>
              ) : null}
            </Link>
          );
        })}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[1.15fr_1fr]">
        {/* ── À décider ─────────────────────────────────────────────── */}
        <section aria-labelledby="today-decide" className="overflow-hidden rounded-[14px] border border-wh-border bg-wh-surface">
          <h2 id="today-decide" className="border-b border-wh-border px-[18px] py-3.5 text-[15px] font-bold text-wh-ink-1">
            {t("decide")}
          </h2>
          {data.decisions.length === 0 ? (
            <p className="px-[18px] py-5 text-[13.5px] text-wh-ink-2">{t("nothingToDecide")}</p>
          ) : (
            <ul>
              {data.decisions.map((d, i) => (
                <li key={d.key} className={i > 0 ? "border-t border-wh-border" : ""}>
                  <Link
                    href={`/${locale}${DECISION_HREF[d.target]}`}
                    className="flex items-center gap-3 px-[18px] py-3.5 no-underline hover:bg-wh-surface-2"
                  >
                    <i
                      aria-hidden="true"
                      className={`h-2 w-2 shrink-0 rounded-full ${d.severity === "critical" ? "bg-wh-bad" : "bg-status-warning"}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-wh-ink-1">{decisionTitle(d)}</span>
                      <span className="block text-[12.5px] text-wh-ink-2" dir="auto">{decisionHint(d)}</span>
                    </span>
                    <span className="shrink-0 rounded-[8px] border border-wh-border px-2.5 py-1 text-[12.5px] font-semibold text-wh-ink-1">
                      {t("open")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Équipe aujourd'hui ────────────────────────────────────── */}
        <section aria-labelledby="today-team" className="overflow-hidden rounded-[14px] border border-wh-border bg-wh-surface">
          <h2 id="today-team" className="border-b border-wh-border px-[18px] py-3.5 text-[15px] font-bold text-wh-ink-1">
            {t("team")}
          </h2>
          {data.team.length === 0 ? (
            <p className="px-[18px] py-5 text-[13.5px] text-wh-ink-2">{t("noTeam")}</p>
          ) : (
            <ul>
              {data.team.map((m, i) => {
                const site = sites.find((s) => s.id === m.warehouseId);
                const top = Math.max(1, ...data.team.map((r) => r.scannedToday));
                return (
                  <li key={m.id} className={`flex items-center gap-3 px-[18px] py-3.5 ${i > 0 ? "border-t border-wh-border" : ""}`}>
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-wh-sunken text-[13px] font-bold uppercase text-wh-ink-2">
                      {m.name.slice(0, 1)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block">
                        <b className="font-semibold text-wh-ink-1">{m.name}</b>
                        {site ? <span className="text-wh-ink-2"> · {site.name}</span> : null}
                      </span>
                      {m.scannedToday > 0 ? (
                        <span className="job-out mt-1.5 block h-1.5 max-w-[220px] overflow-hidden rounded-pill bg-wh-sunken">
                          <i className="block h-full rounded-pill bg-job" style={{ width: `${(m.scannedToday / top) * 100}%` }} />
                        </span>
                      ) : (
                        <span className="mt-0.5 block text-[12.5px] text-wh-bad">{t("noScanToday")}</span>
                      )}
                    </span>
                    <span className="text-end">
                      <span className={`block text-[18px] font-bold tabular-nums ${m.scannedToday ? "text-wh-ink-1" : "text-wh-ink-3"}`}>
                        {m.scannedToday}
                      </span>
                      {m.lastScanAt ? (
                        <span className="block text-[12px] text-wh-ink-2">
                          {t("lastScan", {
                            time: format.dateTime(new Date(m.lastScanAt), { hour: "2-digit", minute: "2-digit" }),
                          })}
                        </span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
