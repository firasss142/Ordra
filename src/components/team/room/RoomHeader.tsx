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

/** Title, the day being read, and the way through days. prototypes/team-v6.html `header()` */
export function RoomHeader({ locale, marketName, day, today, live, nowMin, restDay, firstDay, fmt, onDay, onStep }: Props) {
  const t = useTranslations("team.room");
  const k = daysBetween(day, today);
  const named = k === 0 ? t("today") : k === 1 ? t("yesterday") : null;

  return (
    <header className="r6-ph">
      <div>
        <div className="r6-crumb">
          {t("crumb")}
          <i>/</i>
          {t("title")}
        </div>
        <h1>{t("title")}</h1>
        <div className="r6-sub">
          <span>
            {marketName} · {fmt.dayLong(day)}
          </span>
          {live ? (
            <span className="r6-chip r6-live">
              <i aria-hidden="true" />
              {t("live")} · <bdi className="r6-num">{nowMin !== null ? fmt.hm(nowMin) : ""}</bdi>
            </span>
          ) : (
            <span className="r6-chip r6-past">{t("past")}</span>
          )}
          {restDay && <span className="r6-chip r6-rest">{t("rest")}</span>}
        </div>
      </div>

      <div className="r6-daynav">
        {!live && (
          <button type="button" className="r6-gbtn" onClick={() => onDay(null)}>
            {t("backToday")}
          </button>
        )}
        <div className="r6-stepper">
          <button type="button" onClick={() => onStep(-1)} disabled={day <= firstDay} aria-label={t("prevDay")}>
            <ChevronLeft className="r6-ic rtl:-scale-x-100" aria-hidden="true" />
          </button>
          <span className="r6-lbl">
            {named ? (
              <>
                {named}
                <small>{fmt.dayShort(day)}</small>
              </>
            ) : (
              fmt.dayShort(day)
            )}
          </span>
          <button type="button" onClick={() => onStep(1)} disabled={live} aria-label={t("nextDay")}>
            <ChevronRight className="r6-ic rtl:-scale-x-100" aria-hidden="true" />
          </button>
        </div>
        <Link href={`/${locale}/system/settings/team#salle-de-controle`} className="r6-gbtn" style={{ textDecoration: "none" }}>
          <Settings className="r6-ic" aria-hidden="true" />
          <span>{t("settings")}</span>
        </Link>
      </div>
    </header>
  );
}

/** No order for six hours: the door is shut, and nothing else on the page would say so. */
export function IntakeBanner({ locale, silentMin, lastLabel, fmt }: { locale: string; silentMin: number; lastLabel: string; fmt: RoomFormat }) {
  const t = useTranslations("team.room.banner");
  return (
    <div role="alert" className="r6-banner">
      <span className="r6-bi">
        <TriangleAlert className="r6-ic" aria-hidden="true" />
      </span>
      <div>
        <b>{t("title", { d: fmt.dur(silentMin) })}</b>
        <p>{t("body", { when: lastLabel })}</p>
      </div>
      <Link href={`/${locale}/system/settings/shops`} className="r6-btn r6-sm" style={{ textDecoration: "none" }}>
        {t("cta")}
      </Link>
    </div>
  );
}
