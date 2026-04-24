import { describe, test, expect } from "vitest";
import { summarizeCycleTimes, OUTLIER_CAP_MS } from "../cycle-time";
import type { TrayRow } from "../tray-state";

const BASE_TIME = 1_700_000_000_000;

function scannedRow(printedMsAgo: number, scannedMsAgo: number): TrayRow {
  return {
    id: Math.random().toString(),
    shortId: "X",
    city: "Tunis",
    customer: "Alice",
    productLabel: "Widget",
    quantity: 1,
    stockLevel: 5,
    state: "scanned",
    printedAt: BASE_TIME + printedMsAgo,
    scannedAt: BASE_TIME + scannedMsAgo,
  };
}

describe("summarizeCycleTimes", () => {
  test("returns 0 for empty array", () => {
    expect(summarizeCycleTimes([]).avgSeconds).toBe(0);
  });

  test("returns 0 when no scanned rows", () => {
    const rows: TrayRow[] = [
      { ...scannedRow(0, 1000), state: "printed" },
    ];
    expect(summarizeCycleTimes(rows).avgSeconds).toBe(0);
  });

  test("returns 0 when scanned row has no printedAt", () => {
    const row: TrayRow = {
      ...scannedRow(0, 60_000),
      printedAt: undefined,
    };
    expect(summarizeCycleTimes([row]).avgSeconds).toBe(0);
  });

  test("computes correct average for two rows", () => {
    // Row A: 60 s cycle, Row B: 120 s cycle → avg 90 s
    const rows = [
      scannedRow(0, 60_000),
      scannedRow(0, 120_000),
    ];
    expect(summarizeCycleTimes(rows).avgSeconds).toBe(90);
  });

  test("caps outliers at OUTLIER_CAP_MS (3600 s = 1 h)", () => {
    // 2 h cycle should be capped at 1 h
    const rows = [
      scannedRow(0, 2 * 60 * 60 * 1_000),
      scannedRow(0, 60_000), // 60 s
    ];
    const { avgSeconds } = summarizeCycleTimes(rows);
    // avg of [3600, 60] = 1830
    expect(avgSeconds).toBe(1830);
  });

  test("handles single scanned row", () => {
    const rows = [scannedRow(0, 180_000)]; // 180 s
    expect(summarizeCycleTimes(rows).avgSeconds).toBe(180);
  });

  test("ignores rows without scannedAt", () => {
    const rows = [
      scannedRow(0, 60_000),
      { ...scannedRow(0, 120_000), scannedAt: undefined },
    ];
    expect(summarizeCycleTimes(rows).avgSeconds).toBe(60);
  });

  test("returns count of scanned rows only", () => {
    const rows = [
      scannedRow(0, 60_000),
      { ...scannedRow(0, 60_000), state: "printed" as const, scannedAt: undefined },
    ];
    expect(summarizeCycleTimes(rows).count).toBe(1);
  });
});
