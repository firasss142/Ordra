"use client";

import { useTranslations } from "next-intl";
import { CheckCircle2, PhoneOff, UserX, Users } from "lucide-react";
import type { ReactNode } from "react";
import type { TeamLive } from "@/lib/team/types";
import { fmtAge, fmtNum } from "@/lib/team/format";

type Tone = "critical" | "warning" | "neutral" | "ok";

const HOLDER: Record<Tone, string> = {
  critical: "bg-status-criticalBg text-status-critical",
  warning: "bg-status-warningBg text-hue-amber-ink",
  neutral: "bg-[#F0F1F2] text-ink-secondary",
  ok: "bg-status-successBg text-status-success",
};
const VALUE: Record<Tone, string> = {
  critical: "text-status-critical",
  warning: "text-hue-amber-ink",
  neutral: "text-ink-primary",
  ok: "text-ink-primary",
};

function Tile({
  tone,
  icon,
  label,
  value,
  caption,
  children,
}: {
  tone: Tone;
  icon: ReactNode;
  label: string;
  value?: ReactNode;
  caption?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[60px_1fr] gap-x-4 gap-y-2 rounded-card border border-line-subtle bg-surface-card px-[18px] py-4 transition-shadow duration-fast hover:shadow-hover-row">
      <div className={`grid h-[60px] w-[60px] place-items-center rounded-[14px] ${HOLDER[tone]}`}>{icon}</div>
      {children ?? (
        <div>
          <div className="text-[14.5px] text-ink-primary">{label}</div>
          <div className={`mt-0.5 text-[34px] font-bold leading-[1.1] tabular-nums ${VALUE[tone]}`}>{value}</div>
        </div>
      )}
      {caption && <div className="col-span-2 text-[13px] leading-[1.45] text-ink-secondary">{caption}</div>}
    </div>
  );
}

interface Props {
  live: TeamLive;
  locale: string;
  /** "tasnim vue il y a 16 min" — resolved by the parent with relative i18n. */
  lastSeenCaption: string | null;
}

export function LiveTiles({ live, locale, lastSeenCaption }: Props) {
  const t = useTranslations("team.live.tiles");
  const ex = live.tiles.exhausted;
  const orph = live.tiles.orphan_queues;
  const list = (items: { name: string; count: number }[]) => items.map((a) => `${a.name} ${fmtNum(locale, a.count)}`).join(" · ");

  const exhaustedCap = [
    ex.oldest_days != null ? t("oldest", { age: fmtAge(locale, ex.oldest_days) }) : null,
    ex.by_agent.length ? list(ex.by_agent) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const orphanCap = [
    orph.by_agent.length ? list(orph.by_agent) : null,
    orph.confirmed_never_uploaded > 0 ? t("orphanConfirmed", { count: orph.confirmed_never_uploaded }) : null,
  ]
    .filter(Boolean)
    .join(" — ");

  const overdue = live.tiles.overdue_callbacks.count;
  const never = live.tiles.never_called.count;
  const zeroTone: Tone = overdue > 0 || never > 0 ? "warning" : "ok";

  return (
    <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-4">
      <Tile
        tone={ex.count > 0 ? "critical" : "ok"}
        icon={<PhoneOff size={28} strokeWidth={1.9} />}
        label={t("exhausted")}
        value={fmtNum(locale, ex.count)}
        caption={exhaustedCap || undefined}
      />
      <Tile
        tone={orph.count > 0 ? "warning" : "ok"}
        icon={<UserX size={28} strokeWidth={1.9} />}
        label={t("orphan")}
        value={fmtNum(locale, orph.count)}
        caption={orphanCap || undefined}
      />
      <Tile
        tone="neutral"
        icon={<Users size={28} strokeWidth={1.9} />}
        label={t("online")}
        value={
          <>
            {fmtNum(locale, live.presence.online)}
            <span className="text-[15px] font-medium text-ink-secondary"> / {fmtNum(locale, live.presence.total)}</span>
          </>
        }
        caption={lastSeenCaption ?? undefined}
      />
      <Tile tone={zeroTone} icon={<CheckCircle2 size={28} strokeWidth={1.9} />} label="">
        <div className="flex flex-col">
          <div className="flex flex-col py-0.5">
            <span className="text-[14.5px] text-ink-primary">{t("overdue")}</span>
            <span className={`text-[26px] font-bold leading-[1.1] tabular-nums ${overdue > 0 ? "text-status-critical" : "text-ink-primary"}`}>
              {fmtNum(locale, overdue)}
            </span>
          </div>
          <div className="mt-2 flex flex-col border-t border-line-subtle pt-2">
            <span className="text-[14.5px] text-ink-primary">{t("neverCalled")}</span>
            <span className={`text-[26px] font-bold leading-[1.1] tabular-nums ${never > 0 ? "text-hue-amber-ink" : "text-ink-primary"}`}>
              {fmtNum(locale, never)}
            </span>
          </div>
        </div>
      </Tile>
    </div>
  );
}
