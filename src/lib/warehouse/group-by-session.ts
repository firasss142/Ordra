import type { WarehouseHistoryRow } from "./history-fetch";

export interface WarehouseSession {
  sessionKey: string;
  actorId: string | null;
  actorName: string | null;
  actorRole: WarehouseHistoryRow["actor"] extends null ? null : NonNullable<WarehouseHistoryRow["actor"]>["role"];
  startAt: string;
  endAt: string;
  lastRowTime: number;
  scanCount: number;
  returnCount: number;
  printCount: number;
  adjustCount: number;
  rows: WarehouseHistoryRow[];
}

export function groupRowsIntoSessions(
  rows: WarehouseHistoryRow[],
  gapMinutes = 30,
): WarehouseSession[] {
  if (rows.length === 0) return [];
  const gap = gapMinutes * 60 * 1000;

  const sessions: WarehouseSession[] = [];
  let current: WarehouseSession | null = null;

  for (const row of rows) {
    const actorId = row.actor?.id ?? null;
    const rowTime = new Date(row.at).getTime();

    if (current) {
      const sameActor = current.actorId === actorId;
      const withinGap = Math.abs(current.lastRowTime - rowTime) <= gap;
      if (sameActor && withinGap) {
        current.rows.push(row);
        current.endAt = row.at;
        current.lastRowTime = rowTime;
        if (row.kind === "scan") current.scanCount++;
        else if (row.kind === "return" || row.kind === "writeoff") current.returnCount++;
        else if (row.kind === "print") current.printCount++;
        else if (row.kind === "adjust") current.adjustCount++;
        continue;
      }
    }

    // Start a new session
    current = {
      sessionKey: `${actorId ?? "system"}-${row.at}-${row.id}`,
      actorId,
      actorName: row.actor?.full_name ?? null,
      actorRole: row.actor?.role ?? null,
      startAt: row.at,
      endAt: row.at,
      lastRowTime: rowTime,
      scanCount: row.kind === "scan" ? 1 : 0,
      returnCount: row.kind === "return" || row.kind === "writeoff" ? 1 : 0,
      printCount: row.kind === "print" ? 1 : 0,
      adjustCount: row.kind === "adjust" ? 1 : 0,
      rows: [row],
    };
    sessions.push(current);
  }

  return sessions;
}

// Used for day-separator boundaries: extract YYYY-MM-DD from ISO string
export function rowDay(at: string): string {
  return at.slice(0, 10);
}
