import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/messages/fr.json";
import { OrdersKpiStrip } from "../OrdersKpiStrip";
import type { StatusCounts } from "@/app/api/orders/status-counts/route";

const COUNTS: StatusCounts = {
  unassigned: 188,
  waiting: 19,
  toRecall: 43,
  confirmed: 6,
  uploaded: 452,
  today: 181,
  confirmationRate: 63.5,
  confirmationRatePrev: 57.6,
  total: 2578,
};

function renderStrip(props: Partial<React.ComponentProps<typeof OrdersKpiStrip>> = {}) {
  const onSelect = props.onSelect ?? vi.fn();
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <OrdersKpiStrip counts={COUNTS} activeTile={null} onSelect={onSelect} {...props} />
    </NextIntlClientProvider>,
  );
  return { onSelect };
}

describe("OrdersKpiStrip", () => {
  beforeEach(() => vi.clearAllMocks());

  /** fr-FR groups with U+202F, so match on digits rather than a literal space. */
  const digits = (s: string) => s.replace(/[\s\u202f\u00a0]/g, "");

  test("shows the true total, not a truncated one", () => {
    renderStrip();
    const totals = screen
      .getAllByText((_, el) => digits(el?.textContent ?? "").includes("2578"))
      .filter((el) => el.children.length === 0);
    expect(totals.length).toBeGreaterThan(0);
  });

  test("renders every funnel stage with its count", () => {
    renderStrip();
    for (const [label, count] of [
      ["Aujourd'hui", "181"],
      ["En attente", "19"],
      ["À rappeler", "43"],
      ["Confirmées", "6"],
      ["Téléchargées", "452"],
    ] as const) {
      const tile = screen.getByRole("button", { name: new RegExp("^" + label, "i") });
      expect(within(tile).getByText(count)).toBeInTheDocument();
    }
  });

  test("labels each tile with the period it measures", () => {
    renderStrip();
    // A backlog and a period count must never be confused for one another.
    // A backlog tile must say "maintenant"; a period tile must say "aujourd'hui".
    expect(screen.getByRole("button", { name: /^En attente/i })).toHaveTextContent(/maintenant/i);
    expect(screen.getByRole("button", { name: /^Aujourd'hui/i })).toHaveTextContent(/aujourd'hui/i);
    expect(screen.getByRole("button", { name: /^Confirmées/i })).toHaveTextContent(/maintenant/i);
    expect(screen.getByRole("button", { name: /^Téléchargées/i })).toHaveTextContent(/maintenant/i);
  });

  test("selecting a tile reports the filter it stands for", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderStrip();

    await user.click(screen.getByRole("button", { name: /^En attente/i }));

    expect(onSelect).toHaveBeenCalledWith("waiting");
  });

  test("selecting the active tile clears it instead of reapplying", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderStrip({ activeTile: "waiting", onSelect });

    await user.click(screen.getByRole("button", { name: /^En attente/i }));

    expect(onSelect).toHaveBeenCalledWith(null);
  });

  test("marks the active tile as pressed for assistive tech", () => {
    renderStrip({ activeTile: "unassigned" });
    expect(screen.getByRole("button", { name: /^Non assignées/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("shows the confirmation rate with a trend against the previous period", () => {
    renderStrip();
    expect(screen.getByText(/63,5\s*%/)).toBeInTheDocument();
    // 63.5 - 57.6 = 5.9 improvement
    expect(screen.getByText(/5,9/)).toBeInTheDocument();
  });

  test("the rate is a readout, not a filter", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderStrip();

    const rate = screen.getByText(/Taux de confirmation/i).closest("button");
    if (rate) await user.click(rate);

    // Clicking a percentage must never filter the table to an arbitrary set.
    expect(onSelect).not.toHaveBeenCalled();
  });

  test("omits the trend when there is no previous period to compare", () => {
    renderStrip({ counts: { ...COUNTS, confirmationRatePrev: null } });
    expect(screen.queryByText(/5,9/)).not.toBeInTheDocument();
  });

  test("renders a loading state without inventing numbers", () => {
    renderStrip({ counts: undefined, isLoading: true });
    expect(screen.queryByText("2 578")).not.toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});
