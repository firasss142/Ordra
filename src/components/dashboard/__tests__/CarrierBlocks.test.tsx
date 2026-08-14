import { describe, test, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(messages, ns, key, params),
  };
});

import { CarrierSummary } from "../charts/CarrierSummary";
import { CarrierTable } from "../charts/CarrierTable";
import type { CarrierStat } from "@/lib/dashboard/health";

function carrier(over: Partial<CarrierStat> & { carrier_id: string; name: string }): CarrierStat {
  const delivered = over.delivered ?? 0;
  const returned = over.returned ?? 0;
  const resolved = delivered + returned;
  return {
    delivered,
    returned,
    deliveryRate: resolved > 0 ? (delivered / resolved) * 100 : 0,
    avgTransitDays: null,
    realCostPerDelivered: null,
    returnSpend: 0,
    inFlight: 0,
    stuck: 0,
    hasResolved: resolved > 0,
    ...over,
  };
}

const TRIPOLI = carrier({
  carrier_id: "tripoli",
  name: "Dar Assadli – Tripoli",
  delivered: 221,
  returned: 64,
  avgTransitDays: 3.6,
  realCostPerDelivered: 11.44,
  returnSpend: 320,
  inFlight: 42,
  stuck: 3,
});

const BENGHAZI = carrier({
  carrier_id: "benghazi",
  name: "Dar Assadli – Benghazi",
  delivered: 133,
  returned: 30,
  avgTransitDays: 4.1,
  realCostPerDelivered: 10.73,
  returnSpend: 150,
});

describe("CarrierSummary", () => {
  test("leads with the market's own delivery rate", () => {
    render(<CarrierSummary carriers={[TRIPOLI, BENGHAZI]} currency="LYD" locale="fr" />);
    expect(screen.getByText("79")).toBeInTheDocument();
    expect(screen.getByText("%")).toBeInTheDocument();
  });

  test("breaks the ring down into counts and shares", () => {
    render(<CarrierSummary carriers={[TRIPOLI, BENGHAZI]} currency="LYD" locale="fr" />);
    expect(screen.getByText("354")).toBeInTheDocument();
    expect(screen.getByText("(79%)")).toBeInTheDocument();
    expect(screen.getByText("94")).toBeInTheDocument();
    expect(screen.getByText("(21%)")).toBeInTheDocument();
  });

  test("totals the shipments the rate was computed from", () => {
    render(<CarrierSummary carriers={[TRIPOLI, BENGHAZI]} currency="LYD" locale="fr" />);
    expect(screen.getByText("Total expéditions")).toBeInTheDocument();
    expect(screen.getByText("448")).toBeInTheDocument();
  });

  // A percentage is an abstraction; the money that bought nothing is the
  // sentence that changes a decision, so the block ends on it.
  test("ends on what the returns cost", () => {
    render(<CarrierSummary carriers={[TRIPOLI, BENGHAZI]} currency="LYD" locale="fr" />);
    expect(
      screen.getByText("470 LYD perdus en retours — 94 colis repartis sans vente"),
    ).toBeInTheDocument();
  });

  test("falls back to an empty well with no carriers at all", () => {
    render(<CarrierSummary carriers={[]} currency="LYD" locale="fr" />);
    expect(screen.getByText("Aucun transporteur sur la période.")).toBeInTheDocument();
  });
});

describe("CarrierTable", () => {
  function row(name: string): HTMLElement {
    return screen.getByText(name).closest("li") as HTMLElement;
  }

  test("gives each carrier a monogram that separates the two accounts", () => {
    render(<CarrierTable carriers={[TRIPOLI, BENGHAZI]} currency="LYD" locale="fr" />);
    expect(within(row("Dar Assadli – Tripoli")).getByText("DT")).toBeInTheDocument();
    expect(within(row("Dar Assadli – Benghazi")).getByText("DB")).toBeInTheDocument();
  });

  test("states each carrier's volume alongside its rate", () => {
    render(<CarrierTable carriers={[TRIPOLI, BENGHAZI]} currency="LYD" locale="fr" />);
    const tripoli = row("Dar Assadli – Tripoli");
    expect(
      within(tripoli).getByText("221 livrées · 64 retours · 285 expéditions"),
    ).toBeInTheDocument();
    expect(within(tripoli).getByText("77,5 %")).toBeInTheDocument();
  });

  test("badges only the carrier that actually leads", () => {
    render(<CarrierTable carriers={[TRIPOLI, BENGHAZI]} currency="LYD" locale="fr" />);
    expect(within(row("Dar Assadli – Benghazi")).getByText("meilleur")).toBeInTheDocument();
    expect(within(row("Dar Assadli – Tripoli")).queryByText("meilleur")).not.toBeInTheDocument();
  });

  test("shows the real cost to two decimals, so the gap survives rounding", () => {
    render(<CarrierTable carriers={[TRIPOLI, BENGHAZI]} currency="LYD" locale="fr" />);
    expect(screen.getByText("11,44 LYD")).toBeInTheDocument();
    expect(screen.getByText("10,73 LYD")).toBeInTheDocument();
  });

  /**
   * Not in the reference layout, which stops at cost. It stays because it is
   * the only place on the dashboard that says a carrier is sitting on parcels
   * it has not moved.
   */
  test("keeps the live in-flight column with its stuck warning", () => {
    render(<CarrierTable carriers={[TRIPOLI, BENGHAZI]} currency="LYD" locale="fr" />);
    const tripoli = row("Dar Assadli – Tripoli");
    expect(within(tripoli).getByText("42")).toBeInTheDocument();
    expect(within(tripoli).getByText("3")).toBeInTheDocument();
    expect(within(row("Dar Assadli – Benghazi")).getByTitle("aucun colis en circulation"))
      .toBeInTheDocument();
  });

  test("refuses a rate for a carrier below the confidence floor", () => {
    const thin = carrier({ carrier_id: "thin", name: "Nouveau", delivered: 3, returned: 1 });
    render(<CarrierTable carriers={[TRIPOLI, thin]} currency="LYD" locale="fr" />);
    expect(
      within(row("Nouveau")).getByText("4 commandes — pas assez pour un taux"),
    ).toBeInTheDocument();
  });
});
