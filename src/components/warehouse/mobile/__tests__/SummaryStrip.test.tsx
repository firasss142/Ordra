import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SummaryStrip } from "../SummaryStrip";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations:
      (ns: string) =>
      (key: string, params?: Record<string, unknown>) =>
        resolveTranslation(messages, ns, key, params),
  };
});

/**
 * The "Interactive Summary" strip (mockup 01).
 *
 * The mockup prints 120/hr, 99.5 % and 65 with no qualification. Every one of
 * those is null in this warehouse today — nobody has scanned and nobody has
 * counted — so the whole point of this component is that it says so instead
 * of printing a zero that reads as a measurement.
 */
afterEach(cleanup);

const full = {
  ratePerHour: 120,
  accuracy: 99.5,
  scansLastHour: 65,
  hourly: [0, 2, 5, 9, 12, 8],
  accuracyHistory: [95, 97, 99.5],
  countedProducts: 8,
};

describe("SummaryStrip", () => {
  it("prints the three figures when they exist", () => {
    render(<SummaryStrip {...full} />);
    expect(screen.getByTestId("wm-speed").textContent).toContain("120");
    expect(screen.getByTestId("wm-accuracy").textContent).toContain("99.5");
    expect(screen.getByTestId("wm-lasthour").textContent).toContain("65");
  });

  it("says no scans rather than printing a cadence of zero", () => {
    // 0/h would claim the agent is standing still. Not scanning at all and
    // scanning nothing per hour are different facts.
    render(<SummaryStrip {...full} ratePerHour={null} />);
    expect(screen.getByTestId("wm-speed").textContent).toContain("—");
    expect(screen.getByText(/aucun scan aujourd'hui/i)).toBeInTheDocument();
  });

  it("says no counts rather than printing 100 % accuracy", () => {
    // "Never verified" and "verified and correct" must not share a number.
    render(<SummaryStrip {...full} accuracy={null} countedProducts={0} />);
    expect(screen.getByTestId("wm-accuracy").textContent).toContain("—");
    expect(screen.getByText(/aucun comptage/i)).toBeInTheDocument();
  });

  it("qualifies an accuracy that rests on very few counts", () => {
    render(<SummaryStrip {...full} accuracy={98} countedProducts={2} />);
    expect(screen.getByTestId("wm-accuracy").textContent).toMatch(/sur 2/);
  });

  it("draws no sparkline when there is no history to draw", () => {
    render(
      <SummaryStrip {...full} hourly={[]} accuracyHistory={[]} />,
    );
    expect(screen.queryAllByTestId("wh-spark")).toHaveLength(0);
  });

  it("keeps last-hour at zero, which is a real count and not an absence", () => {
    // Unlike a rate, "how many in the last hour" has a true zero.
    render(<SummaryStrip {...full} scansLastHour={0} />);
    expect(screen.getByTestId("wm-lasthour").textContent).toContain("0");
  });
});
