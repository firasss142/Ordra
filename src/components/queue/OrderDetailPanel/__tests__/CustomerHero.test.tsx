import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CustomerHero } from "../CustomerHero";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const frMessages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(frMessages, ns, key, params),
    useLocale: () => "fr",
  };
});

function renderHero(overrides: Partial<React.ComponentProps<typeof CustomerHero>> = {}) {
  return render(
    <CustomerHero
      name="Nafesa Ton"
      phone="922692547"
      phone2={null}
      terminal={false}
      canEdit
      isLibyaOrder
      reliability={{ total_orders: 12, delivered_count: 11, returned_count: 1 }}
      onCommitName={vi.fn()}
      onCommitPhone={vi.fn()}
      onCommitPhone2={vi.fn()}
      onCopyPhone={vi.fn()}
      phoneCopied={false}
      validatePhone={() => null}
      {...overrides}
    />,
  );
}

describe("CustomerHero — reliability strip", () => {
  it("states the verdict in one word and backs it with the three figures", () => {
    renderHero();

    const strip = screen.getByTestId("customer-reliability");
    expect(strip).toHaveTextContent("Fiable");
    expect(strip).toHaveTextContent("12");
    expect(strip).toHaveTextContent("11");
    expect(strip).toHaveTextContent("1");
  });

  it("spells the whole reading out for screen readers, since the glyphs carry it visually", () => {
    renderHero();

    expect(screen.getByTestId("customer-reliability")).toHaveAccessibleName(
      /12 commandes, 11 livrées, 1 retour/,
    );
  });

  it("calls a poor delivery record risky", () => {
    renderHero({
      reliability: { total_orders: 10, delivered_count: 4, returned_count: 6 },
    });

    expect(screen.getByTestId("customer-reliability")).toHaveTextContent("À risque");
  });

  it("calls a middling record average", () => {
    renderHero({
      reliability: { total_orders: 12, delivered_count: 9, returned_count: 3 },
    });

    expect(screen.getByTestId("customer-reliability")).toHaveTextContent("Moyen");
  });

  it("says new rather than passing judgement on a thin record", () => {
    renderHero({
      reliability: { total_orders: 2, delivered_count: 2, returned_count: 0 },
    });

    expect(screen.getByTestId("customer-reliability")).toHaveTextContent("Nouveau");
  });

  it("shows nothing at all while the history is still loading", () => {
    renderHero({ reliability: null });

    expect(screen.queryByTestId("customer-reliability")).not.toBeInTheDocument();
  });

  it("shows nothing for a customer with no orders on record", () => {
    renderHero({
      reliability: { total_orders: 0, delivered_count: 0, returned_count: 0 },
    });

    expect(screen.queryByTestId("customer-reliability")).not.toBeInTheDocument();
  });
});

describe("CustomerHero — identity", () => {
  it("leads with the customer name and the number to dial", () => {
    renderHero();

    expect(screen.getByText("Nafesa Ton")).toBeInTheDocument();
    expect(screen.getByText("922692547")).toBeInTheDocument();
  });

  it("offers the call action on a live order", () => {
    renderHero();

    expect(screen.getByRole("link", { name: /Appeler/ })).toHaveAttribute(
      "href",
      "tel:922692547",
    );
  });

  it("drops the call action once the order is terminal", () => {
    renderHero({ terminal: true });

    expect(screen.queryByRole("link", { name: /Appeler/ })).not.toBeInTheDocument();
  });

  // The hero no longer takes a city or an address at all: destination moved to
  // the facts grid, where OrderFacts.test.tsx owns its behaviour. Re-adding it
  // here would mean re-adding the props, which is the regression this absence
  // guards against.
});
