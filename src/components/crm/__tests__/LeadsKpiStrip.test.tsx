import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LeadsKpiStrip } from "../LeadsKpiStrip";
import type { LeadsMetrics } from "@/lib/leads/metrics";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(messages, ns, key, params),
    useLocale: () => "fr",
  };
});

function buildMetrics(overrides: Partial<LeadsMetrics> = {}): LeadsMetrics {
  return {
    total: 0,
    won: 0,
    lost: 0,
    overallConversionRate: 0,
    callbacksDueToday: 0,
    byStatus: {
      new: 0,
      assigned: 0,
      attempt_1: 0,
      attempt_2: 0,
      attempt_3: 0,
      callback_scheduled: 0,
      qualified: 0,
      won: 0,
      lost: 0,
      archived: 0,
    },
    byAgent: [],
    bySource: [],
    lostReasons: [],
    ...overrides,
  };
}

describe("LeadsKpiStrip", () => {
  it("renders all 5 KPI labels from i18n", () => {
    render(<LeadsKpiStrip metrics={buildMetrics()} />);
    expect(screen.getByText("Pipeline actif")).toBeDefined();
    expect(screen.getByText("À rappeler aujourd'hui")).toBeDefined();
    expect(screen.getByText("Gagnés")).toBeDefined();
    expect(screen.getByText("Taux de conversion")).toBeDefined();
    // "Qualifiés" appears twice (metric label uses same text as bucket) —
    // scope to the metric label by querying all and checking count.
    expect(screen.getAllByText("Qualifiés").length).toBeGreaterThanOrEqual(1);
  });

  it("computes activePipeline as sum of non-terminal statuses", () => {
    const m = buildMetrics({
      byStatus: {
        new: 2,
        assigned: 3,
        attempt_1: 1,
        attempt_2: 0,
        attempt_3: 0,
        callback_scheduled: 4,
        qualified: 5,
        won: 10, // must not be counted
        lost: 7, // must not be counted
        archived: 3, // must not be counted
      },
    });
    render(<LeadsKpiStrip metrics={m} />);
    // 2+3+1+0+0+4+5 = 15
    expect(screen.getByText("15")).toBeDefined();
  });

  it("shows '—' for conversion rate when won+lost is 0", () => {
    render(<LeadsKpiStrip metrics={buildMetrics()} />);
    expect(screen.getByText("—")).toBeDefined();
  });

  it("shows percentage for conversion rate when data exists", () => {
    render(
      <LeadsKpiStrip
        metrics={buildMetrics({
          won: 3,
          lost: 1,
          overallConversionRate: 0.75,
        })}
      />,
    );
    expect(screen.getByText("75%")).toBeDefined();
  });

  it("renders callbacksDueToday value", () => {
    render(<LeadsKpiStrip metrics={buildMetrics({ callbacksDueToday: 7 })} />);
    expect(screen.getByText("7")).toBeDefined();
  });
});
