"use client";
import { useTranslations } from "next-intl";
import { minutesSince } from "@/lib/investors/ui-format";

const STALE_AFTER_MIN = 60;

/** "Updated X min ago" — and a visible warning when the rollup is late, so a silent failure never reads as zeros. */
export function FreshnessLine({ asOf, error }: { asOf: string | null; error?: boolean }) {
  const t = useTranslations("investor.shell");
  const te = useTranslations("investor.errors");
  const min = minutesSince(asOf);
  const stale = min !== null && min > STALE_AFTER_MIN;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-[11.5px] text-oms-ink-3">
        <span className={`inline-block h-[7px] w-[7px] rounded-full ${stale ? "bg-oms-age-warm" : "bg-[#16A34A]"}`} />
        {min === null ? t("updatedUnknown") : t("updatedAgo", { min })}
      </div>
      {stale && <div className="rounded-lg border border-[#F0D9A8] bg-oms-warn-bg px-2.5 py-2 text-[12px] leading-snug text-oms-warn-ink">{t("stale", { min: min ?? 0 })}</div>}
      {error && <div className="rounded-lg border border-oms-border bg-oms-sunken px-2.5 py-2 text-[12px] text-oms-ink-2">{te("stale")}</div>}
    </div>
  );
}
