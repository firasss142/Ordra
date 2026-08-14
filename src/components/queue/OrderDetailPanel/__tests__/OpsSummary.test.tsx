import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OpsSummary } from "../OpsSummary";
import { LY_MARKET_ID } from "@/lib/markets";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const frMessages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(frMessages, ns, key, params),
    useLocale: () => "fr",
  };
});

function renderSummary(overrides: Partial<React.ComponentProps<typeof OpsSummary>> = {}) {
  return render(
    <OpsSummary
      marketId={LY_MARKET_ID}
      currencyCode="LYD"
      createdAt="2026-08-14T09:42:00.000Z"
      externalId="A-21837"
      duplicateCount={0}
      attemptsCount={1}
      maxAttempts={3}
      locale="fr"
      {...overrides}
    />,
  );
}

describe("OpsSummary", () => {
  it("names the market and its currency", () => {
    renderSummary();

    expect(screen.getByTestId("ops-market")).toHaveTextContent("Libye");
    expect(screen.getByTestId("ops-market")).toHaveTextContent("LYD");
  });

  it("reads an order with a storefront reference as storefront-born", () => {
    renderSummary();

    expect(screen.getByTestId("ops-origin")).toHaveTextContent("Storefront");
    expect(screen.getByTestId("ops-origin")).toHaveTextContent("A-21837");
  });

  it("reads an order with no storefront reference as hand-made", () => {
    renderSummary({ externalId: null });

    expect(screen.getByTestId("ops-origin")).toHaveTextContent("Manuelle");
  });

  it("says plainly when there are no duplicates, rather than showing a zero", () => {
    renderSummary();

    expect(screen.getByTestId("ops-duplicates")).toHaveTextContent("Aucun");
  });

  it("counts duplicates when there are some", () => {
    renderSummary({ duplicateCount: 2 });

    expect(screen.getByTestId("ops-duplicates")).toHaveTextContent("2");
  });

  it("shows attempts against the market's own ceiling", () => {
    renderSummary({ attemptsCount: 2, maxAttempts: 8 });

    expect(screen.getByTestId("ops-attempts")).toHaveTextContent("2 / 8");
  });

  it("shows the bare count while the ceiling is still unknown, never a guessed one", () => {
    renderSummary({ attemptsCount: 2, maxAttempts: null });

    expect(screen.getByTestId("ops-attempts")).toHaveTextContent("2");
    expect(screen.getByTestId("ops-attempts")).not.toHaveTextContent("/");
  });
});
