import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import frMessages from "@/messages/fr.json";
import { AgentDashboard } from "../AgentDashboard";
import type { WarehouseSummary } from "@/lib/warehouse/summary";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock("swr", () => ({ default: () => ({ data: undefined }) }));

/**
 * An idle bench must say WHY it is idle.
 *
 * Measured in Libya: 78 live orders, 77 of them fulfilled from Darb's own
 * warehouse, so the bench legitimately held one parcel. Every tile read 0 and
 * the agent concluded the app was broken. The work had not vanished — it had
 * gone somewhere the screen never mentioned.
 */
function summary(over: Partial<WarehouseSummary["queue"]> = {}): WarehouseSummary {
  return {
    queue: {
      toPrepare: 0,
      oldestPrepareHours: 0,
      latePrepare: 0,
      neverScanned: 0,
      confirmedNotUploaded: 0,
      carrierWarehouse: 0,
      returnsInbox: 0,
      toHandOver: 0,
      setAside: 0,
      ...over,
    },
    day: { scannedToday: 0, returnsToday: 0 },
    trend: [],
    lowStock: [],
  } as unknown as WarehouseSummary;
}

function renderFr(s: WarehouseSummary) {
  return render(
    <NextIntlClientProvider locale="fr" messages={frMessages}>
      <AgentDashboard summary={s} dailyGoal={40} locale="fr" />
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe("AgentDashboard — an empty bench explains itself", () => {
  it("names the parcels the carrier ships from its own warehouse", () => {
    renderFr(summary({ carrierWarehouse: 77 }));
    const note = screen.getByTestId("wm-carrier-warehouse");
    expect(note.textContent).toContain("77");
  });

  it("says nothing is waiting when the bench is genuinely idle", () => {
    renderFr(summary());
    expect(screen.getByTestId("wm-bench-idle")).toBeInTheDocument();
    // Not the carrier-warehouse explanation: there is none to give.
    expect(screen.queryByTestId("wm-carrier-warehouse")).toBeNull();
  });

  it("stays quiet about both when there is real work on the bench", () => {
    renderFr(summary({ toPrepare: 4, carrierWarehouse: 77 }));
    expect(screen.queryByTestId("wm-bench-idle")).toBeNull();
    // The carrier count is context for an EMPTY bench, not a permanent tile.
    expect(screen.queryByTestId("wm-carrier-warehouse")).toBeNull();
  });
});
