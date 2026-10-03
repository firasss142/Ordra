import { dayOfWeek, parseHM } from "./time";
import type { RoomSettings } from "./types";

/** Defaults the owner agreed on (prototypes/team-v5.html), used until Réglages says otherwise. */
export const ROOM_DEFAULTS = { callDelayHours: 2, idleMinutes: 30, lateMinutes: 15 } as const;

export interface ResolvedSettings {
  callMin: number;
  idleMin: number;
  lateMin: number;
  /** The team planning in minutes of day, or null when none is set. */
  shift: { start: number; end: number; days: number[] } | null;
  overrides: Record<string, [number, number]>;
}

const posInt = (v: unknown, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
};

export function resolveSettings(s: RoomSettings | null | undefined): ResolvedSettings {
  const start = parseHM(s?.shift?.start);
  const end = parseHM(s?.shift?.end);
  const days = Array.isArray(s?.shift?.days) ? s!.shift!.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : [];
  const overrides: Record<string, [number, number]> = {};
  for (const [agentId, o] of Object.entries(s?.overrides ?? {})) {
    const os = parseHM(o?.start);
    const oe = parseHM(o?.end);
    if (os !== null && oe !== null && oe > os) overrides[agentId] = [os, oe];
  }
  return {
    callMin: posInt(s?.call_delay_hours, ROOM_DEFAULTS.callDelayHours) * 60,
    idleMin: posInt(s?.idle_minutes, ROOM_DEFAULTS.idleMinutes),
    lateMin: Math.max(0, Math.round(Number(s?.late_minutes ?? ROOM_DEFAULTS.lateMinutes)) || 0),
    shift: start !== null && end !== null && end > start ? { start, end, days } : null,
    overrides,
  };
}

/** Her planned hours: her own override, else the team's, else none. */
export function shiftFor(rs: ResolvedSettings, agentId: string): [number, number] | null {
  return rs.overrides[agentId] ?? (rs.shift ? [rs.shift.start, rs.shift.end] : null);
}

/** Whether the planning makes this a working day; null when there is no planning. */
export function isWorkday(rs: ResolvedSettings, day: string): boolean | null {
  return rs.shift ? rs.shift.days.includes(dayOfWeek(day)) : null;
}
