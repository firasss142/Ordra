import type { useTranslations } from "next-intl";
import type { AgentDayRow } from "@/lib/team/room/day-view";
import type { Presence } from "./parts";
import type { RoomFormat } from "./useRoomFormat";

type T = ReturnType<typeof useTranslations<"team.room.agents">>;

/** The line under her name: what she is doing, in words. Card and drawer share it. */
export function stateLine(r: AgentDayRow, t: T, fmt: RoomFormat): string {
  switch (r.state) {
    case "working":
      return t("st.working", { d: fmt.dur(r.sinceLastMin ?? 0) });
    case "idle":
      return t("st.idle", { d: fmt.dur(r.sinceLastMin ?? 0) });
    case "early":
      return t("st.early", { t: fmt.hm(r.last ?? 0), e: fmt.hm(r.shift?.[1] ?? 0) });
    case "left":
      return t("st.left", { t: fmt.hm(r.last ?? 0) });
    case "rest":
      return r.seenTodayMin !== null ? t("st.restSeen", { t: fmt.hm(r.seenTodayMin) }) : t("st.rest");
    case "late":
      return t("st.late", { t: fmt.hm(r.shift?.[0] ?? 0) });
    case "before":
      return t("st.before", { t: fmt.hm(r.shift?.[0] ?? 0) });
    case "done":
      return t("st.done", { a: fmt.hm(r.first ?? 0), b: fmt.hm(r.last ?? 0) });
    default:
      return t("st.absent");
  }
}

/** The live dot: green working, amber for someone to look at, grey otherwise; none on a past day. */
export function presenceOf(r: AgentDayRow, live: boolean): Presence {
  if (!live) return null;
  return r.state === "working" || r.state === "idle" || r.state === "late" || r.state === "early" ? r.state : "off";
}
