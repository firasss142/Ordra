"use client";

import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { MONO, isLightRoll } from "./ui";

/**
 * The colour to reach for, edge to edge (`.band` in the v3 prototype).
 *
 * Darb routes by the colour of a pre-printed sticker and binds whatever number
 * it is given, so a wrong roll ships the parcel to the wrong city and nothing
 * downstream catches it. The band therefore takes the whole width in Darb's own
 * hex, unmodified — the agent matches it against a physical roll — and the
 * colour never travels alone: its name, its region and the branch code ride on
 * it. Yellow and lime take dark text; every other roll takes white.
 *
 * Outside Libya, or for a batch that is not a roll, the band wears the job's
 * own hue and names the batch instead.
 */
export function RollBand({
  hex,
  title,
  sub,
  plate,
  onExit,
}: {
  /** Darb's hex for the roll; null = no roll (Tunisia, unknown destination). */
  hex: string | null;
  title: string;
  sub: string | null;
  /** Darb's branch code, on a white plate. */
  plate: string | null;
  onExit?: () => void;
}) {
  const t = useTranslations("warehouse.run");
  const light = isLightRoll(hex);

  return (
    <div
      data-testid="wh-run-band"
      data-roll={hex ?? ""}
      data-light={light ? "true" : "false"}
      className={`-mx-[16px] -mt-[18px] mb-[16px] flex items-center gap-[10px] px-[16px] pb-[14px] pt-[16px] ${
        light ? "text-wm-ink" : "text-white"
      } ${hex ? "" : "bg-job"}`}
      style={hex ? { background: hex } : undefined}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-[16px] font-bold leading-[1.3]">
          <bdi>{title}</bdi>
        </p>
        {sub ? <p className="truncate text-[12.5px] opacity-90">{sub}</p> : null}
      </div>
      {plate ? (
        <span
          data-testid="wh-run-plate"
          dir="ltr"
          className={`shrink-0 rounded-[6px] bg-[rgba(255,255,255,.92)] px-[9px] py-[3px] text-[12.5px] font-bold text-wm-ink ${MONO}`}
        >
          {plate}
        </span>
      ) : null}
      {onExit ? (
        <button
          type="button"
          onClick={onExit}
          aria-label={t("exit")}
          className={`grid h-[36px] w-[36px] shrink-0 place-items-center rounded-full ${
            light ? "bg-[rgba(0,0,0,.08)]" : "bg-[rgba(0,0,0,.18)]"
          }`}
        >
          <X size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
