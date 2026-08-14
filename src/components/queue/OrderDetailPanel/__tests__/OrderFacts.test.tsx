import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OrderFacts } from "../OrderFacts";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const frMessages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(frMessages, ns, key, params),
    useLocale: () => "fr",
  };
});

function renderFacts(overrides: Partial<React.ComponentProps<typeof OrderFacts>> = {}) {
  return render(
    <OrderFacts
      total={199}
      currencyCode="LYD"
      itemCount={1}
      city="Tripoli"
      address="Hay Andalus, rue 9"
      agentName="tasnim"
      carrierName="Darb Assabil"
      {...overrides}
    />,
  );
}

describe("OrderFacts — destination", () => {
  it("shows the city and the address without opening a tab", () => {
    renderFacts();

    expect(screen.getByText("Tripoli")).toBeInTheDocument();
    expect(screen.getByText("Hay Andalus, rue 9")).toBeInTheDocument();
  });

  it("flags a missing city as a blocker rather than leaving a blank cell", () => {
    renderFacts({ city: null });

    const missing = screen.getByTestId("fact-city-missing");
    expect(missing).toHaveTextContent("Non renseignée");
  });

  it("treats a whitespace-only city as missing", () => {
    renderFacts({ city: "   " });

    expect(screen.getByTestId("fact-city-missing")).toBeInTheDocument();
  });

  it("lets the address resolve its own direction, so an Arabic address reads right-to-left", () => {
    renderFacts({ address: "حي الأندلس" });

    expect(screen.getByText("حي الأندلس")).toHaveAttribute("dir", "auto");
  });

  it("falls back to a dash when there is no address at all", () => {
    renderFacts({ address: null });

    expect(screen.getByTestId("fact-address")).toHaveTextContent("—");
  });
});

describe("OrderFacts — the figures it already carried", () => {
  it("still states the total with two decimals and the currency demoted", () => {
    renderFacts();

    expect(screen.getByText("199.00")).toBeInTheDocument();
    expect(screen.getByText("LYD")).toBeInTheDocument();
  });

  it("still names the agent and the carrier", () => {
    renderFacts();

    expect(screen.getByText("tasnim")).toBeInTheDocument();
    expect(screen.getByText("Darb Assabil")).toBeInTheDocument();
  });

  it("says the order is unassigned rather than showing an empty agent cell", () => {
    renderFacts({ agentName: null });

    expect(screen.getByText("Non assigné")).toBeInTheDocument();
  });
});
