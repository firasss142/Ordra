"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";
import type { DayJob, Decision, DecisionTarget } from "@/lib/warehouse/day-loop";
import type { DayLoopPayload } from "@/lib/warehouse/day-loop-assemble";
import { Chip } from "./Chip";
import { FillBar } from "./FillBar";

/**
 * « Aujourd'hui » on the manager's desk — prototype `C.today`
 * (prototypes/entrepot-day-loop-manager-v3.html), px for px: Ordra's root font
 * is 14px, so rem classes would render everything an eighth smaller.
 *
 * The agent's four jobs, wider: each card carries its backlog and, under it,
 * the split by building. What only a manager sees sits below — the decisions
 * waiting for them (every one a link to where it is taken) and today's team.
 * Same assembly as the agent's screen (`day-loop-assemble.ts`), so the two can
 * never disagree. The building switch is NOT here: it lives in the desk top
 * bar (DeskTopBar), on every Entrepôt screen.
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

/** The prototype's warning-ink (#7A5B00): amber text needs its dark partner. */
const WARN_INK = "text-[#7A5B00]";

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
  const sole = data.soleReception;

  /** The muted line under a card's figure, or the warning-ink one. */
  const foot = (job: DayJob): { text: string; warn: boolean } | null => {
    switch (job.key) {
      case "returns":
        return counts.returnsOnTheWay > 0 ? { text: t("returnsStillOnWay", { n: counts.returnsOnTheWay }), warn: false } : null;
      case "receive": {
        // One reception: name it — « REC-LY-2026-0001 · en retard d'1 j · aucune ligne ».
        if (sole) {
          const parts = [
            sole.reference,
            sole.lateDays > 0 ? t("receiveLateBy", { n: sole.lateDays }) : null,
            sole.empty ? t("receiveNoLine") : null,
          ].filter(Boolean);
          return { text: parts.join(" · "), warn: sole.lateDays > 0 || sole.empty };
        }
        const parts = [
          counts.receptionsLate > 0 ? t("receiveLate", { n: counts.receptionsLate }) : null,
          counts.receptionsEmpty > 0 ? t("receiveEmpty", { n: counts.receptionsEmpty }) : null,
        ].filter(Boolean);
        return parts.length ? { text: parts.join(" · "), warn: true } : null;
      }
      case "count":
        return data.countedSites === 0 && counts.products > 0 ? { text: t("noSiteCounted"), warn: true } : null;
      default:
        return null;
    }
  };

  const decisionTitle = (d: Decision): string => {
    if (sole && d.key === "receptionsLate") return t("decisions.receptionOneLate", { ref: sole.reference });
    if (sole && d.key === "receptionsEmpty") return t("decisions.receptionOneEmpty", { ref: sole.reference });
    if (d.key === "neverCounted" && data.countedSites === 0) return t("decisions.neverCountedAnywhere");
    return t(`decisions.${d.key}`, { n: d.count });
  };
  const decisionHint = (d: Decision): string => {
    if (d.key === "neverCounted" && data.countedSites === 0 && sites.length > 0) {
      return t("decisions.neverCountedAnywhereHint", { products: counts.products, sites: sites.length });
    }
    return t(`decisions.${d.key}Hint`);
  };

  const top = Math.max(1, ...data.team.map((r) => r.scannedToday));

  return (
    <div className="mx-auto w-full max-w-[1440px] px-[28px] pb-[40px] pt-[24px]">
      {/* `.head` */}
      <header className="mb-[20px] flex items-end gap-[16px]">
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-semibold text-wh-ink-2" dir="auto">{dateLabel}</p>
          <h1 className="text-[24px] font-bold tracking-[-0.02em] text-wh-ink-1">{t("title")}</h1>
        </div>
      </header>

      {pickup ? <div className="mb-[18px]">{pickup}</div> : null}

      {/* `.jobs`: the four jobs, in the order of a day. */}
      <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2 xl:grid-cols-4">
        {loop.jobs.map((job, i) => {
          const f = foot(job);
          const idle = job.state === "idle";
          return (
            <Link
              key={job.key}
              href={`/${locale}${JOB_HREF[job.key]}`}
              data-job={job.key}
              data-state={job.state}
              className={`${HUE[job.key]} flex flex-col gap-[10px] rounded-[14px] border border-line-subtle bg-wh-surface p-[18px] text-start no-underline transition-colors hover:border-wh-border-strong`}
            >
              <div className="flex items-center gap-[12px]">
                <span
                  className={[
                    "grid h-[24px] w-[24px] shrink-0 place-items-center rounded-full text-[12px] font-bold",
                    i === 0 ? "bg-job text-white" : "bg-job-bg text-job-ink",
                  ].join(" ")}
                >
                  {i + 1}
                </span>
                <span className="flex-1 text-[16px] font-bold text-wh-ink-1">{t(`short.${job.key}`)}</span>
                <ChevronRight size={18} className="text-wh-ink-3 rtl:-scale-x-100" aria-hidden="true" />
              </div>
              <p>
                <span
                  data-testid="today-figure"
                  className={`text-[40px] font-bold leading-none tracking-[-0.03em] tabular-nums ${idle ? "text-wh-ink-3" : "text-job-ink"}`}
                  dir="ltr"
                >
                  {job.count}
                </span>{" "}
                <span className="text-wh-ink-2">{t(`deskUnit.${job.key}`, { n: job.count })}</span>
              </p>
              {sites.length > 1 ? (
                <p data-testid="today-split" className="flex gap-[14px] text-[12.5px] text-wh-ink-2">
                  {sites.map((s) => (
                    <span key={s.id}>
                      {s.name}{" "}
                      <b className="tabular-nums text-wh-ink-1" dir="ltr">
                        {s.counts[SPLIT_KEY[job.key]]}
                      </b>
                    </span>
                  ))}
                </p>
              ) : null}
              {job.key === "out" ? (
                <>
                  <FillBar
                    pct={progress.pct}
                    label={t("scannedToday")}
                    className="h-[6px] rounded-pill bg-wm-track"
                  />
                  <div className="flex items-center gap-[12px] text-[12.5px]">
                    <span className="min-w-0 flex-1 text-wh-ink-2">
                      <b className="tabular-nums text-wh-ink-1" dir="ltr">{progress.done}</b> {t("scannedToday")}
                      {progress.hasGoal ? ` · ${t("goal", { n: progress.target })}` : null}
                    </span>
                    {counts.setAside > 0 ? (
                      <Chip tone="warn" className="py-[2px]">
                        <span className="tabular-nums" dir="ltr">{counts.setAside}</span> {t("olderChip")}
                      </Chip>
                    ) : null}
                  </div>
                </>
              ) : f ? (
                <p className={`mt-auto text-[12.5px] ${f.warn ? WARN_INK : "text-wh-ink-2"}`} dir="auto">
                  {f.text}
                </p>
              ) : null}
            </Link>
          );
        })}
      </div>

      {/* `.cols` */}
      <div className="mt-[12px] grid grid-cols-1 gap-[12px] lg:grid-cols-[1.15fr_1fr]">
        {/* ── À décider ─────────────────────────────────────────────── */}
        <section aria-labelledby="today-decide" className="overflow-hidden rounded-[14px] border border-line-subtle bg-wh-surface">
          <div className="flex items-center gap-[10px] border-b border-line-subtle px-[18px] py-[14px]">
            <h2 id="today-decide" className="flex-1 text-[16px] font-bold text-wh-ink-1">
              {t("decide")}
            </h2>
            {data.decisions.length > 0 ? (
              <Chip tone="mute" dot={false} className="py-[2px]" testId="decide-count">
                <span className="tabular-nums" dir="ltr">{data.decisions.length}</span>
              </Chip>
            ) : null}
          </div>
          {data.decisions.length === 0 ? (
            <p className="px-[18px] py-[20px] text-[13.5px] text-wh-ink-2">{t("nothingToDecide")}</p>
          ) : (
            <ul>
              {data.decisions.map((d, i) => (
                <li key={d.key} className={i > 0 ? "border-t border-line-subtle" : ""}>
                  <Link
                    href={`/${locale}${DECISION_HREF[d.target]}`}
                    className="flex items-center gap-[12px] px-[18px] py-[13px] text-start no-underline hover:bg-wh-surface-2"
                  >
                    <i
                      aria-hidden="true"
                      className={`h-[8px] w-[8px] shrink-0 rounded-full ${d.severity === "critical" ? "bg-status-critical" : "bg-status-warning"}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-wh-ink-1" dir="auto">{decisionTitle(d)}</span>
                      <span className="block text-[12.5px] text-wh-ink-2" dir="auto">{decisionHint(d)}</span>
                    </span>
                    <span className="inline-flex h-[30px] shrink-0 items-center rounded-[8px] border border-wh-border-strong bg-wh-surface px-[10px] text-[12.5px] font-semibold text-wh-ink-1">
                      {t("open")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Équipe aujourd'hui ────────────────────────────────────── */}
        <section aria-labelledby="today-team" className="overflow-hidden rounded-[14px] border border-line-subtle bg-wh-surface">
          <div className="flex items-center gap-[10px] border-b border-line-subtle px-[18px] py-[14px]">
            <h2 id="today-team" className="flex-1 text-[16px] font-bold text-wh-ink-1">
              {t("team")}
            </h2>
          </div>
          {data.team.length === 0 ? (
            <p className="px-[18px] py-[20px] text-[13.5px] text-wh-ink-2">{t("noTeam")}</p>
          ) : (
            <ul>
              {data.team.map((m, i) => {
                const site = sites.find((s) => s.id === m.warehouseId);
                return (
                  <li
                    key={m.id}
                    className={`flex items-center gap-[12px] px-[18px] py-[13px] ${i > 0 ? "border-t border-line-subtle" : ""}`}
                  >
                    <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full bg-wm-track font-bold uppercase text-wh-ink-2">
                      {m.name.slice(0, 1)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-wh-ink-1" dir="auto">
                        {m.name}
                        {site ? <span className="font-normal text-wh-ink-2"> · {site.name}</span> : null}
                      </span>
                      {m.scannedToday > 0 ? (
                        <FillBar
                          pct={(m.scannedToday / top) * 100}
                          label={t("scannedToday")}
                          className="job-out mt-[8px] h-[6px] rounded-pill bg-wm-track"
                        />
                      ) : (
                        <span className="mt-[6px] block">
                          <Chip tone="bad" className="py-[2px]">{t("noScanToday")}</Chip>
                        </span>
                      )}
                    </span>
                    <span className="text-end">
                      <span
                        className={`block text-[16px] font-bold tabular-nums ${m.scannedToday ? "text-wh-ink-1" : "text-wh-ink-3"}`}
                        dir="ltr"
                      >
                        {m.scannedToday}
                      </span>
                      {m.lastScanAt ? (
                        <span className="block text-[12.5px] text-wh-ink-2">
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
