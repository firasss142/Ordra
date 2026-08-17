import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/messages/fr.json";
import { OrdersKpiStrip } from "../OrdersKpiStrip";
import type { StatusCounts } from "@/app/api/orders/status-counts/route";

const COUNTS: StatusCounts = {
  unassigned: 188,
  toRecall: 43,
  uploaded: 452,
  rejected: 731,
  delivered: 96,
  periodTotal: 181,
  window: { from: null, to: null },
  confirmationRate: 63.5,
  confirmationRatePrev: 57.6,
  confirmationSample: 216,
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
      ["Total commandes", "181"],
      ["Téléchargées", "452"],
      ["Rejetées", "731"],
      ["Livrées", "96"],
      ["À rappeler", "43"],
    ] as const) {
      const tile = screen.getByRole("button", { name: new RegExp("^" + label, "i") });
      expect(within(tile).getByText(count)).toBeInTheDocument();
    }
  });

  test("no longer offers the removed 'En attente' tile", () => {
    renderStrip();
    expect(screen.queryByRole("button", { name: /^En attente/i })).not.toBeInTheDocument();
  });

  test("stages read left to right as intake, outcomes, then the queue owed a call", () => {
    renderStrip();
    const order = screen
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label") ?? "")
      .filter((l) => /^(Total commandes|Téléchargées|Rejetées|Livrées|À rappeler)/i.test(l))
      .map((l) => l.split(":")[0]);
    expect(order).toEqual([
      "Total commandes",
      "Téléchargées",
      "Rejetées",
      "Livrées",
      "À rappeler",
    ]);
  });

  test("labels each tile with the period it measures", () => {
    renderStrip();
    // A backlog and a period count must never be confused for one another.
    // A backlog tile must say "maintenant"; a period tile names its window.
    expect(screen.getByRole("button", { name: /^À rappeler/i })).toHaveTextContent(/maintenant/i);
    expect(screen.getByRole("button", { name: /^Total commandes/i })).toHaveTextContent(
      /aujourd'hui/i,
    );
    // Outcome tiles default to today, so they must not claim to be standing totals.
    for (const label of ["Téléchargées", "Rejetées", "Livrées"] as const) {
      const tile = screen.getByRole("button", { name: new RegExp("^" + label, "i") });
      expect(tile).toHaveTextContent(/aujourd'hui/i);
      expect(tile).not.toHaveTextContent(/maintenant/i);
    }
  });

  test("outcome tiles name the applied window instead of saying 'aujourd'hui'", () => {
    renderStrip({ counts: { ...COUNTS, window: { from: "2026-08-01", to: "2026-08-12" } } });
    const rejected = screen.getByRole("button", { name: /^Rejetées/i });
    expect(rejected).toHaveTextContent(/01/);
    expect(rejected).toHaveTextContent(/12/);
    // The backlog ignores the window entirely — it has no date.
    expect(screen.getByRole("button", { name: /^À rappeler/i })).toHaveTextContent(/maintenant/i);
  });

  test("the intake tile moves with the period like the rest of the row", async () => {
    // It was a fixed "Aujourd'hui" tile. Selecting "30 derniers jours" shifted
    // every other tile and left this one reporting the current day, so the row
    // described two periods at once and its number looked simply wrong.
    renderStrip({
      counts: { ...COUNTS, periodTotal: 935, window: { from: "2026-08-01", to: "2026-08-12" } },
    });

    const tile = screen.getByRole("button", { name: /^Total commandes/i });
    expect(within(tile).getByText("935")).toBeInTheDocument();
    expect(tile).toHaveTextContent(/01/);
    expect(tile).toHaveTextContent(/12/);
    expect(tile).not.toHaveTextContent(/maintenant/i);
  });

  test("the intake tile opens the window it counts", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderStrip();

    await user.click(screen.getByRole("button", { name: /^Total commandes/i }));

    expect(onSelect).toHaveBeenCalledWith("periodTotal");
  });

  test("selecting a tile reports the filter it stands for", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderStrip();

    await user.click(screen.getByRole("button", { name: /^Livrées/i }));

    expect(onSelect).toHaveBeenCalledWith("delivered");
  });

  test("selecting the active tile clears it instead of reapplying", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderStrip({ activeTile: "delivered", onSelect });

    await user.click(screen.getByRole("button", { name: /^Livrées/i }));

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

  test("says what the rate is of, so a small sample cannot pass as a trend", () => {
    // 100% of two calls and 100% of two hundred are the same number and
    // completely different facts. Libya shipped a "▼ 40.8" computed against a
    // previous window holding exactly one order.
    renderStrip({ counts: { ...COUNTS, confirmationSample: 216 } });
    expect(screen.getByText(/216/)).toBeInTheDocument();
  });

  test("shows no rate at all when nothing was decided", () => {
    renderStrip({
      counts: {
        ...COUNTS,
        confirmationRate: null,
        confirmationRatePrev: null,
        confirmationSample: 0,
      },
    });
    // A rate over no decisions is unknown, not 0% — and 0% reads as catastrophe.
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  test("renders a loading state without inventing numbers", () => {
    renderStrip({ counts: undefined, isLoading: true });
    expect(screen.queryByText("2 578")).not.toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});
