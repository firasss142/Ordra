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
        products={[{ id: "p1", name: "Boxing Doll", image_url: null }]}
        carriers={[{ id: "c1", name: "Sanad" }]}
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
    for (const label of ["Appel", "Livraison", "Agent", "Ville", "Produit", "Transporteur"]) {
      expect(screen.getByRole("button", { name: new RegExp(label, "i") })).toBeDefined();
    }
  });

  test("applies a value on a single click, with no confirm step", async () => {
    const user = userEvent.setup();
    const { onChange } = renderBar();

    await user.click(screen.getByRole("button", { name: /Appel/i }));
    await user.click(screen.getByRole("option", { name: /En attente/i }));

    // One click in, already applied — no "Apply" to hunt for.
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toMatchObject({ statuses: ["pending"] });
    expect(screen.queryByRole("button", { name: /appliquer/i })).toBeNull();
  });

  test("states the combination rule inside the menu", async () => {
    const user = userEvent.setup();
    renderBar();

    await user.click(screen.getByRole("button", { name: /Appel/i }));

    // OR within a facet is not guessable — the menu says so.
    expect(screen.getByRole("listbox")).toHaveTextContent(/n'importe lequel/i);
  });

  test("selecting a second value in a facet widens rather than replaces", async () => {
    const user = userEvent.setup();
    const { onChange } = renderBar({
      filters: { ...DEFAULT_FILTERS, statuses: ["pending"] },
    });

    await user.click(screen.getByRole("button", { name: /Appel/i }));
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

  test("toggles deleted-order visibility from the same row", async () => {
    const user = userEvent.setup();
    const { onChange } = renderBar();

    await user.click(screen.getByLabelText(/afficher supprim/i));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ includeDeleted: true }));
  });

  test("splits the single status enum into the two axes an operator thinks in", async () => {
    const user = userEvent.setup();
    renderBar();

    await user.click(screen.getByRole("button", { name: /Appel/i }));
    const call = screen.getByRole("listbox");
    expect(call).toHaveTextContent(/En attente/i);
    // Fulfilment states belong to the other axis, not this menu.
    expect(call).not.toHaveTextContent(/Livré/i);
  });

  test("each option carries its own visual, not just a label", async () => {
    const user = userEvent.setup();
    render(
      <NextIntlClientProvider locale="fr" messages={messages}>
        <OrdersFacetBar
          filters={DEFAULT_FILTERS}
          onChange={vi.fn()}
          agents={AGENTS}
          products={[{ id: "p1", name: "Boxing Doll", image_url: "https://x/p.jpg" }]}
          carriers={[{ id: "c1", name: "Sanad" }]}
          cities={["بنغازي"]}
          resultCount={0}
          resultValue="0"
          currencyCode="TND"
        />
      </NextIntlClientProvider>,
    );

    // A product picker without the product photo makes you read near-identical
    // Arabic names instead of recognising them.
    await user.click(screen.getByRole("button", { name: /Produit/i }));
    expect(screen.getByRole("img", { name: /Boxing Doll/i })).toBeDefined();

    await user.click(screen.getByRole("button", { name: /Agent/i }));
    const agentOpt = screen.getByRole("option", { name: /tasnim/i });
    expect(agentOpt.querySelector("span[aria-hidden]")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: /Transporteur/i }));
    const carrierOpt = screen.getByRole("option", { name: /Sanad/i });
    expect(carrierOpt.textContent).toMatch(/Sa/);
  });

  test("marks a facet with an active count so state is visible while closed", () => {
    renderBar({ filters: { ...DEFAULT_FILTERS, statuses: ["pending", "confirmed"] } });
    expect(screen.getByRole("button", { name: /Appel/i })).toHaveTextContent("2");
  });
});
