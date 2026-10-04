"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Boxes, ChevronRight, UserRound } from "lucide-react";
import type { DayJob } from "@/lib/warehouse/day-loop";
import type { TodayResponse } from "@/app/api/warehouse/today/route";

/**
 * « Aujourd'hui » — the warehouse agent's home.
 *
 * The four jobs of a day in the order they happen: get today's parcels out
 * before the driver comes, take back what returned, receive what was
 * delivered, count. Each row is the ONLY door to its job and carries one
 * number, the size of that job — no KPI tiles. The dashboard deleted on
 * 2026-09-08 repeated the other screens' figures and could not be clicked;
 * that is what this screen is not.
 *
 * Each job wears its hue (`job-out`, `job-returns`, `job-receive`,
 * `job-count`, globals.css), all from the brand green's family.
 *
 * Presentational: `TodayLive` feeds it the /api/warehouse/today payload.
 */

const HREF: Record<DayJob["key"], string> = {
  out: "/warehouse/out",
  returns: "/warehouse/returns",
  receive: "/warehouse/stock?tab=receptions",
  count: "/warehouse/count",
};

const HUE: Record<DayJob["key"], string> = {
  out: "job-out",
  returns: "job-returns",
  receive: "job-receive",
  count: "job-count",
};

/** Hours become days past two of them; nobody reads "70 h" as three days. */
function ageLabel(hours: number, t: (k: "hours" | "days", v: { n: number }) => string): string {
  return hours >= 48 ? t("days", { n: Math.floor(hours / 24) }) : t("hours", { n: Math.round(hours) });
}

export function TodayHome({
  data,
  locale,
  dateLabel,
  pickup,
}: {
  data: TodayResponse;
  locale: string;
  /** The market's date, already formatted on the server in its time zone. */
  dateLabel: string;
  /** The driver switch (Libya). A slot, so this screen stays presentational. */
  pickup?: React.ReactNode;
}) {
  const t = useTranslations("warehouse.today");
  const tBench = useTranslations("warehouse.bench");
  const tAge = useTranslations("warehouse.age");

  const header = (eyebrow: string | null) => (
    <header className="mb-4 flex items-center justify-between gap-3">
      <div className="min-w-0">
        {eyebrow ? <p className="text-[12.5px] font-semibold text-wm-ink-2" dir="auto">{eyebrow}</p> : null}
        <h1 className="text-[28px] font-bold leading-tight tracking-[-0.02em] text-wm-ink">{t("title")}</h1>
      </div>
      <Link
        href={`/${locale}/warehouse/settings`}
        aria-label={t("settings")}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-wm-card-edge bg-wm-card text-wm-ink-2"
      >
        <UserRound size={19} strokeWidth={1.8} aria-hidden="true" />
      </Link>
    </header>
  );

  if (data.siteUnassigned) {
    return (
      <div className="px-4 py-4">
        {header(null)}
        <div className="rounded-[16px] border border-wm-card-edge bg-wm-card px-4 py-6 text-center">
          <p className="text-[16px] font-bold text-wm-ink">{tBench("noSiteTitle")}</p>
          <p className="mt-2 text-[14px] leading-relaxed text-wm-ink-2">{tBench("noSiteBody")}</p>
        </div>
      </div>
    );
  }

  const byKey = Object.fromEntries(data.loop.jobs.map((j) => [j.key, j])) as Record<DayJob["key"], DayJob>;
  const out = byKey.out;
  const { counts } = data;
  const progress = data.loop.progress;

  const subtitle = (job: DayJob): React.ReactNode => {
    switch (job.key) {
      case "returns":
        return [
          t("returnsSub", { n: job.count }),
          counts.returnsOnTheWay > 0 ? t("returnsOnWay", { n: counts.returnsOnTheWay }) : null,
        ]
          .filter(Boolean)
          .join(" · ");
      case "receive":
        return [
          t("receiveSub", { n: job.count }),
          counts.receptionsLate > 0 ? t("receiveLate", { n: counts.receptionsLate }) : null,
        ]
          .filter(Boolean)
          .join(" · ");
      case "count":
        return job.state === "never" ? t("countNever") : t("countSub", { n: job.count });
      default:
        return null;
    }
  };

  return (
    <div className="px-4 py-4">
      {header([data.siteName, dateLabel].filter(Boolean).join(" · "))}

      {pickup ? <div className="mb-3">{pickup}</div> : null}

      {/* ── 1 · Sortir: the hero, because it is the job of every day ── */}
      <Link
        href={`/${locale}${HREF.out}`}
        data-job="out"
        data-state={out.state}
        className={`${HUE.out} block rounded-[16px] border border-wm-card-edge bg-wm-card px-[18px] pb-[18px] pt-5 no-underline`}
      >
        <div className="flex items-center gap-3">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-job text-[13px] font-bold text-white">1</span>
          <span className="flex-1 text-[17px] font-bold text-wm-ink">{t("jobs.out")}</span>
          <ChevronRight size={18} className="shrink-0 text-wm-ink-3 rtl:-scale-x-100" aria-hidden="true" />
        </div>
        <p data-testid="today-figure" className="mt-3.5 text-[44px] font-bold leading-none tracking-[-0.03em] tabular-nums text-job-ink">
          {out.count}
        </p>
        <p className="mt-1.5 flex flex-wrap gap-x-1.5 text-[14px] text-wm-ink-2">
          <span>{t("outUnit", { n: out.count })}</span>
          {out.count > 0 ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{t("oldest", { age: ageLabel(counts.oldestHours, tAge) })}</span>
            </>
          ) : null}
        </p>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.pct}
          aria-label={t("scannedToday")}
          className="mt-4 h-2 overflow-hidden rounded-pill bg-wm-track"
        >
          <i className="block h-full rounded-pill bg-job" style={{ width: `${progress.pct}%` }} />
        </div>
        <div className="mt-2 flex items-center justify-between text-[13px] text-wm-ink-2">
          <span>
            <b className="tabular-nums text-wm-ink">{progress.done}</b> {t("scannedToday")}
          </span>
          <span className="tabular-nums">
            {progress.hasGoal ? t("goal", { n: progress.target }) : `${progress.done} / ${progress.target}`}
          </span>
        </div>
      </Link>

      {/* ── 2–4 · the rest of the day ─────────────────────────────── */}
      <div className="mt-3 overflow-hidden rounded-[16px] border border-wm-card-edge bg-wm-card">
        {(["returns", "receive", "count"] as const).map((key, i) => {
          const job = byKey[key];
          const idle = job.state === "idle";
          return (
            <Link
              key={key}
              href={`/${locale}${HREF[key]}`}
              data-job={key}
              data-state={job.state}
              className={[
                HUE[key],
                "flex min-h-[72px] items-center gap-3.5 px-4 py-3.5 no-underline",
                i > 0 ? "border-t border-wm-card-edge" : "",
              ].join(" ")}
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-job-bg text-[13px] font-bold text-job-ink">
                {i + 2}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15.5px] font-bold text-wm-ink">{t(`jobs.${key}`)}</span>
                <span className="block text-[13px] text-wm-ink-2" dir="auto">{subtitle(job)}</span>
                {job.state === "never" ? (
                  <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-pill bg-status-warningBg px-2.5 py-0.5 text-[12px] font-semibold text-status-warning">
                    <i className="h-1.5 w-1.5 rounded-full bg-status-warning" aria-hidden="true" />
                    {t("neverChip")}
                  </span>
                ) : null}
              </span>
              <span
                data-testid="today-figure"
                className={`text-[24px] font-bold tabular-nums tracking-[-0.02em] ${idle ? "text-wm-ink-3" : "text-job-ink"}`}
              >
                {job.count}
              </span>
              <ChevronRight size={18} className="shrink-0 text-wm-ink-3 rtl:-scale-x-100" aria-hidden="true" />
            </Link>
          );
        })}
      </div>

      {/* ── Stock: where the four jobs end up ─────────────────────── */}
      <Link
        href={`/${locale}/warehouse/stock`}
        className="job-receive mt-3 flex items-center gap-3 rounded-[16px] border border-wm-card-edge bg-wm-card px-4 py-3.5 no-underline"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-job-bg text-job-ink">
          <Boxes size={18} strokeWidth={1.8} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold text-wm-ink">{t("stock")}</span>
          <span className="block text-[13px] text-wm-ink-2">
            {counts.neverCounted > 0 ? t("stockSub", { n: counts.products }) : t("stockSubCounted", { n: counts.products })}
          </span>
        </span>
        <ChevronRight size={18} className="shrink-0 text-wm-ink-3 rtl:-scale-x-100" aria-hidden="true" />
      </Link>
    </div>
  );
}
