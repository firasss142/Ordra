import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/messages/fr.json";
import { OrdersFacetBar } from "../OrdersFacetBar";
import { DEFAULT_FILTERS } from "@/lib/orders/list-filters";

const AGENTS = [
  { id: "a1", full_name: "tasnim" },
  { id: "a2", full_name: "hend" },
];

function renderBar(props: Partial<React.ComponentProps<typeof OrdersFacetBar>> = {}) {
  const onChange = vi.fn();
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <OrdersFacetBar
        filters={DEFAULT_FILTERS}
        onChange={onChange}
        agents={AGENTS}
        cities={["بنغازي", "طرابلس"]}
        resultCount={61}
        resultValue="10 890"
        currencyCode="TND"
        {...props}
      />
    </NextIntlClientProvider>,
  );
  return { onChange };
}

describe("OrdersFacetBar", () => {
  beforeEach(() => vi.clearAllMocks());

  test("offers each facet as a named control, not a generic panel", () => {
    renderBar();
    for (const label of ["Statut", "Agent", "Ville"]) {
      expect(screen.getByRole("button", { name: new RegExp(label, "i") })).toBeDefined();
    }
  });

  test("applies a value on a single click, with no confirm step", async () => {
    const user = userEvent.setup();
    const { onChange } = renderBar();

    await user.click(screen.getByRole("button", { name: /Statut/i }));
    await user.click(screen.getByRole("option", { name: /En attente/i }));

    // One click in, already applied — no "Apply" to hunt for.
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toMatchObject({ statuses: ["pending"] });
    expect(screen.queryByRole("button", { name: /appliquer/i })).toBeNull();
  });

  test("states the combination rule inside the menu", async () => {
    const user = userEvent.setup();
    renderBar();

    await user.click(screen.getByRole("button", { name: /Statut/i }));

    // OR within a facet is not guessable — the menu says so.
    expect(screen.getByRole("listbox")).toHaveTextContent(/n'importe lequel/i);
  });

  test("selecting a second value in a facet widens rather than replaces", async () => {
    const user = userEvent.setup();
    const { onChange } = renderBar({
      filters: { ...DEFAULT_FILTERS, statuses: ["pending"] },
    });

    await user.click(screen.getByRole("button", { name: /Statut/i }));
    await user.click(screen.getByRole("option", { name: /^Confirmé$/i }));

    expect(onChange.mock.calls[0][0].statuses).toEqual(
      expect.arrayContaining(["pending", "confirmed"]),
    );
  });

  test("shows a removable chip per active value", async () => {
    const user = userEvent.setup();
    const { onChange } = renderBar({
      filters: { ...DEFAULT_FILTERS, statuses: ["pending"], city: "بنغازي" },
    });

    const chips = screen.getByTestId("active-chips");
    expect(within(chips).getByText(/En attente/i)).toBeDefined();
    expect(within(chips).getByText("بنغازي")).toBeDefined();

    await user.click(within(chips).getByRole("button", { name: /retirer.*En attente/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ statuses: [] }));
  });

  test("clears everything from one control", async () => {
    const user = userEvent.setup();
    const { onChange } = renderBar({
      filters: { ...DEFAULT_FILTERS, statuses: ["pending"], city: "بنغازي" },
    });

    await user.click(screen.getByRole("button", { name: /tout effacer/i }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ statuses: [], city: "" }),
    );
  });

  test("hides the chip row entirely when nothing is filtered", () => {
    renderBar();
    expect(screen.queryByTestId("active-chips")).toBeNull();
    expect(screen.queryByRole("button", { name: /tout effacer/i })).toBeNull();
  });

  test("reports what the current filters actually returned", () => {
    renderBar();
    const summary = screen.getByTestId("result-summary");
    expect(summary.textContent).toMatch(/61/);
    expect(summary.textContent).toMatch(/10 890/);
    expect(summary.textContent).toMatch(/TND/);
  });

  test("marks a facet with an active count so state is visible while closed", () => {
    renderBar({ filters: { ...DEFAULT_FILTERS, statuses: ["pending", "confirmed"] } });
    expect(screen.getByRole("button", { name: /Statut/i })).toHaveTextContent("2");
  });
});
