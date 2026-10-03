"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Settings, TriangleAlert } from "lucide-react";
import { daysBetween } from "@/lib/team/room/time";
import type { RoomFormat } from "./useRoomFormat";

interface Props {
  locale: string;
  marketName: string;
  day: string;
  today: string;
  live: boolean;
  nowMin: number | null;
  restDay: boolean;
  firstDay: string;
  fmt: RoomFormat;
  onDay: (day: string | null) => void;
  onStep: (k: -1 | 1) => void;
}

/** Title, the day being read, and the way to move through days. prototypes/team-v5.html `.ph` */
export function RoomHeader({ locale, marketName, day, today, live, nowMin, restDay, firstDay, fmt, onDay, onStep }: Props) {
  const t = useTranslations("team.room");
  const k = daysBetween(day, today);
  const named = k === 0 ? t("today") : k === 1 ? t("yesterday") : null;

  return (
    <div className="flex flex-wrap items-end justify-between gap-[16px] max-[900px]:flex-col max-[900px]:items-stretch max-[900px]:gap-[12px]">
      <div>
        <h1 className="text-[24px] font-[650] tracking-[-0.02em] text-ink-primary max-[900px]:text-[21px]">{t("title")}</h1>
        <div className="mt-[4px] flex flex-wrap items-center gap-[8px] text-[13.5px] text-room-ink-2">
          <span>
            {marketName} · {fmt.dayLong(day)}
          </span>
          {live ? (
            <span className="inline-flex h-[22px] items-center gap-[6px] whitespace-nowrap rounded-full bg-room-green-bg px-[9px] text-[12px] font-semibold text-room-green">
              <i className="h-[7px] w-[7px] rounded-full bg-room-live shadow-[0_0_0_3px_rgba(22,163,74,.18)]" aria-hidden="true" />
              {t("live")} · <bdi className="tabular-nums">{nowMin !== null ? fmt.hm(nowMin) : ""}</bdi>
            </span>
          ) : (
            <span className="inline-flex h-[22px] items-center whitespace-nowrap rounded-full bg-[#EEF0F2] px-[9px] text-[12px] font-semibold text-room-ink-2">{t("past")}</span>
          )}
          {restDay && (
            <span className="inline-flex h-[22px] items-center whitespace-nowrap rounded-full border border-line-subtle bg-surface-sunken px-[9px] text-[12px] font-semibold text-room-ink-2">{t("rest")}</span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-[8px] max-[900px]:w-full">
        {!live && (
          <button type="button" onClick={() => onDay(null)} className="inline-flex h-[32px] items-center gap-[6px] whitespace-nowrap rounded-[9px] border border-line bg-surface-card px-[12px] text-[13px] font-medium hover:border-line-strong hover:bg-room-hover">
            {t("backToday")}
          </button>
        )}
        <div className="inline-flex items-center rounded-[10px] border border-line bg-surface-card p-[2px] max-[900px]:flex-1">
          <button
            type="button"
            onClick={() => onStep(-1)}
            disabled={day <= firstDay}
            aria-label={t("prevDay")}
            className="grid h-[30px] min-w-[30px] place-items-center rounded-[8px] text-room-ink-2 hover:enabled:bg-room-hover hover:enabled:text-ink-primary disabled:cursor-default disabled:opacity-35"
          >
            <ChevronLeft size={16} strokeWidth={1.8} className="rtl:-scale-x-100" aria-hidden="true" />
          </button>
          <span className="min-w-[150px] whitespace-nowrap px-[10px] text-center text-[13px] font-semibold max-[900px]:min-w-0 max-[900px]:flex-1">
            {named ? (
              <>
                {named}
                <small className="ms-[4px] text-[13px] font-medium text-room-ink-3">{fmt.dayShort(day)}</small>
              </>
            ) : (
              fmt.dayShort(day)
            )}
          </span>
          <button
            type="button"
            onClick={() => onStep(1)}
            disabled={live}
            aria-label={t("nextDay")}
            className="grid h-[30px] min-w-[30px] place-items-center rounded-[8px] text-room-ink-2 hover:enabled:bg-room-hover hover:enabled:text-ink-primary disabled:cursor-default disabled:opacity-35"
          >
            <ChevronRight size={16} strokeWidth={1.8} className="rtl:-scale-x-100" aria-hidden="true" />
          </button>
        </div>
        <Link
          href={`/${locale}/system/settings/team#salle-de-controle`}
          className="inline-flex h-[32px] items-center gap-[6px] whitespace-nowrap rounded-[9px] border border-transparent px-[12px] text-[13px] font-medium text-room-ink-2 no-underline hover:border-line hover:bg-surface-card"
        >
          <Settings size={15} strokeWidth={1.8} aria-hidden="true" />
          <span>{t("settings")}</span>
        </Link>
      </div>
    </div>
  );
}

/** No order for six hours: the door is shut, and nothing else on the page would say so. */
export function IntakeBanner({ locale, silentMin, lastLabel, fmt }: { locale: string; silentMin: number; lastLabel: string; fmt: RoomFormat }) {
  const t = useTranslations("team.room.banner");
  return (
    <div role="alert" className="flex items-start gap-[12px] rounded-[12px] border border-room-red-edge bg-room-red-bg px-[14px] py-[12px] text-[#7A2620] max-[900px]:flex-wrap">
      <TriangleAlert size={18} strokeWidth={1.8} className="mt-px flex-none text-room-red" aria-hidden="true" />
      <div>
        <b className="mb-[2px] block text-[14px] font-[650] text-room-red">{t("title", { d: fmt.dur(silentMin) })}</b>
        <p className="max-w-[880px] text-[13px] leading-[1.5]">{t("body", { when: lastLabel })}</p>
      </div>
      <Link
        href={`/${locale}/system/settings/shops`}
        className="ms-auto inline-flex h-[28px] flex-none items-center whitespace-nowrap rounded-[8px] border border-[#F0C9C4] bg-white px-[10px] text-[12.5px] font-medium text-room-red no-underline hover:bg-room-red-bg max-[900px]:ms-0"
      >
        {t("cta")}
      </Link>
    </div>
  );
}
