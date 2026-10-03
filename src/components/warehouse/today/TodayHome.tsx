"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronRight, LayoutGrid } from "lucide-react";
import { ageOf, type DayJob } from "@/lib/warehouse/day-loop";
import type { TodayResponse } from "@/app/api/warehouse/today/route";
import { Chip } from "./Chip";
import { FillBar } from "./FillBar";

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
 * Built to the approved prototype (prototypes/entrepot-day-loop-agent-v3.html,
 * `R.today`), its px sizes copied as px: the root font is 14px here, so rem
 * scale classes would render everything an eighth too small.
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

const Chevron = () => (
  <ChevronRight size={20} strokeWidth={2} className="shrink-0 text-ink-muted rtl:-scale-x-100" aria-hidden="true" />
);

export function TodayHome({
  data,
  locale,
  dateLabel,
  initial,
  pickup,
}: {
  data: TodayResponse;
  locale: string;
  /** The market's date, already formatted on the server in its time zone. */
  dateLabel: string;
  /** The agent's initial, drawn in the avatar that opens Réglages. */
  initial: string;
  /** The driver switch (Libya). A slot, so this screen stays presentational. */
  pickup?: React.ReactNode;
}) {
  const t = useTranslations("warehouse.today");
  const tBench = useTranslations("warehouse.bench");

  const header = (eyebrow: string | null) => (
    <header className="mb-[18px] flex items-center justify-between gap-[12px]">
      <div className="min-w-0 flex-1">
        {eyebrow ? <p className="text-[12.5px] font-semibold text-wm-ink-2" dir="auto">{eyebrow}</p> : null}
        <h1 className="text-[28px] font-bold leading-[1.2] tracking-[-0.02em] text-wm-ink">{t("title")}</h1>
      </div>
      <Link
        href={`/${locale}/warehouse/settings`}
        aria-label={t("settings")}
        className="grid h-[40px] w-[40px] shrink-0 place-items-center rounded-full border border-line bg-wm-card text-[14px] font-bold text-wm-ink-2 no-underline"
      >
        <span aria-hidden="true">{initial}</span>
      </Link>
    </header>
  );

  if (data.siteUnassigned) {
    return (
      <div className="px-[16px] pt-[18px]">
        {header(null)}
        <div className="rounded-[16px] border border-line-subtle bg-wm-card px-[16px] py-[24px] text-center">
          <p className="text-[16px] font-bold text-wm-ink">{tBench("noSiteTitle")}</p>
          <p className="mt-[8px] text-[14px] leading-relaxed text-wm-ink-2">{tBench("noSiteBody")}</p>
        </div>
      </div>
    );
  }

  const byKey = Object.fromEntries(data.loop.jobs.map((j) => [j.key, j])) as Record<DayJob["key"], DayJob>;
  const out = byKey.out;
  const { counts } = data;
  const progress = data.loop.progress;

  const age = ageOf(counts.oldestHours);
  const outSub = [
    t("outSub", { n: out.count }),
    out.count > 0 ? t("oldest", { age: t(age.unit === "days" ? "ageDays" : "ageHours", { n: age.n }) }) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const subtitle = (job: DayJob): string => {
    switch (job.key) {
      case "returns":
        return [
          t("returnsSub", { n: job.count }),
          counts.returnsOnTheWay > 0 ? t("returnsOnWay", { n: counts.returnsOnTheWay }) : null,
        ]
          .filter(Boolean)
          .join(" · ");
      case "receive": {
        if (job.count === 0) {
          return data.siteName ? t("receiveNoneAt", { site: data.siteName }) : t("receiveSub", { n: 0 });
        }
        const sole = data.soleReception;
        return (
          sole
            ? [sole.reference, sole.lateDays > 0 ? t("receiveLateBy", { n: sole.lateDays }) : null, sole.empty ? t("receiveNoLine") : null]
            : [
                t("receiveSub", { n: job.count }),
                counts.receptionsLate > 0 ? t("receiveLate", { n: counts.receptionsLate }) : null,
                counts.receptionsEmpty > 0 ? t("receiveEmpty", { n: counts.receptionsEmpty }) : null,
              ]
        )
          .filter(Boolean)
          .join(" · ");
      }
      case "count":
        return t("countSub", { n: job.count });
      default:
        return "";
    }
  };

  return (
    <div className="px-[16px] pt-[18px]">
      {header([data.siteName, dateLabel].filter(Boolean).join(" · "))}

      {pickup ? <div className="mb-[14px]">{pickup}</div> : null}

      {/* ── 1 · Sortir: the hero, because it is the job of every day ── */}
      <Link
        href={`/${locale}${HREF.out}`}
        data-job="out"
        data-state={out.state}
        className={`${HUE.out} block w-full rounded-[16px] border border-line-subtle bg-wm-card px-[18px] pb-[18px] pt-[20px] no-underline`}
      >
        <div className="flex items-end gap-[12px]">
          <span className="grid h-[28px] w-[28px] shrink-0 place-items-center rounded-full bg-job text-[13px] font-bold text-white">1</span>
          <span className="min-w-0 flex-1 text-[17px] font-bold text-wm-ink">{t("jobs.out")}</span>
          <Chevron />
        </div>
        <div className="mt-[14px]">
          <p
            data-testid="today-figure"
            dir="ltr"
            className="text-[44px] font-bold leading-none tracking-[-0.03em] tabular-nums text-job-ink"
          >
            {out.count}
          </p>
          <p className="mt-[6px] text-[14px] text-wm-ink-2" dir="auto">{outSub}</p>
        </div>
        <FillBar
          pct={progress.pct}
          label={t("scannedToday")}
          className="mt-[16px] h-[8px] rounded-pill bg-wm-track"
        />
        <div className="mt-[8px] flex items-center gap-[12px] text-[12.5px] text-wm-ink-2">
          <span className="min-w-0 flex-1">
            <b className="tabular-nums text-wm-ink">{progress.done}</b> {t("scannedToday")}
          </span>
          <span dir="ltr" className="tabular-nums">{`${progress.done} / ${progress.target}`}</span>
        </div>
      </Link>

      {/* ── 2–4 · the rest of the day ─────────────────────────────── */}
      <div className="mt-[12px] overflow-hidden rounded-[16px] border border-line-subtle bg-wm-card">
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
                "flex min-h-[72px] w-full items-center gap-[14px] p-[16px] no-underline",
                i > 0 ? "border-t border-line-subtle" : "",
              ].join(" ")}
            >
              <span className="grid h-[28px] w-[28px] shrink-0 place-items-center rounded-full bg-job-bg text-[13px] font-bold text-job-ink">
                {i + 2}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15.5px] font-bold text-wm-ink">{t(`jobs.${key}`)}</span>
                <span className="block text-[13px] text-wm-ink-2" dir="auto">{subtitle(job)}</span>
                {job.state === "never" ? (
                  <Chip tone="warn" className="mt-[6px] py-[3px]">{t("neverChip")}</Chip>
                ) : null}
              </span>
              <span
                data-testid="today-figure"
                dir="ltr"
                className={`text-[24px] font-bold tabular-nums tracking-[-0.02em] ${idle ? "text-ink-muted" : "text-job-ink"}`}
              >
                {job.count}
              </span>
              <Chevron />
            </Link>
          );
        })}
      </div>

      {/* ── Stock: where the four jobs end up ─────────────────────── */}
      <Link
        href={`/${locale}/warehouse/stock`}
        className="job-receive mt-[12px] flex w-full items-center gap-[12px] rounded-[16px] border border-line-subtle bg-wm-card px-[16px] py-[14px] no-underline"
      >
        <span className="grid h-[40px] w-[40px] shrink-0 place-items-center rounded-[10px] bg-job-bg text-job-ink">
          <LayoutGrid size={18} strokeWidth={2} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold text-wm-ink">{t("stock")}</span>
          <span className="block text-[12.5px] text-wm-ink-2">
            {counts.products > 0 && counts.neverCounted >= counts.products
              ? t("stockSub", { n: counts.products })
              : t("stockSubCounted", { n: counts.products })}
          </span>
        </span>
        <Chevron />
      </Link>
    </div>
  );
}
