import { describe, test, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import frMessages from "@/messages/fr.json";
import { BalanceHero } from "./BalanceHero";

vi.mock("next-intl", () => ({
  useTranslations:
    (namespace?: string) =>
    (key: string, params?: Record<string, unknown>) => {
      const parts = namespace ? `${namespace}.${key}`.split(".") : key.split(".");
      let val: unknown = frMessages;
      for (const p of parts) val = (val as Record<string, unknown>)?.[p];
      if (typeof val !== "string") return key;
      return params
        ? Object.entries(params).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), val)
        : val;
    },
}));

const hero = (props: Partial<React.ComponentProps<typeof BalanceHero>> = {}) =>
  render(
    <BalanceHero available={605.34} claimedByOpenRequests={0} market="TN" locale="fr" {...props} />
  );

const heroFigure = () =>
  screen.getByRole("region", { name: frMessages.investor.balance.available });

/**
 * The portfolio promised "Disponible 605,340 — retirable maintenant" while the
 * withdrawals page, which subtracts open requests, offered only 305,340. Two
 * pages of the same portal disagreeing about withdrawable money is the fastest
 * way to lose an investor's trust.
 */
describe("BalanceHero — withdrawable vs claimed", () => {
  test("subtracts money already claimed by open requests", () => {
    hero({ claimedByOpenRequests: 300 });
    expect(heroFigure()).toHaveTextContent("305,340");
    expect(heroFigure()).not.toHaveTextContent("605,340");
  });

  test("shows the full settled figure when nothing is claimed", () => {
    hero();
    expect(heroFigure()).toHaveTextContent("605,340");
  });

  test("says how much is awaiting payout rather than hiding it", () => {
    hero({ claimedByOpenRequests: 300 });
    expect(screen.getByText(/300,000/)).toBeInTheDocument();
  });

  test("never renders a negative withdrawable figure", () => {
    hero({ available: 100, claimedByOpenRequests: 250 });
    expect(heroFigure()).toHaveTextContent("0,000");
    expect(heroFigure()).not.toHaveTextContent("-");
  });

  test("uses millimes so an exact drain lands on zero", () => {
    hero({ available: 605.34, claimedByOpenRequests: 605.34 });
    expect(heroFigure()).toHaveTextContent("0,000");
  });
});

/**
 * The withdraw action used to be a 32px button behind a nav tab. Bringing it
 * next to the figure only helps if it also stops lying about being usable.
 */
describe("BalanceHero — the withdraw action", () => {
  test("links to the withdrawals page when there is money", () => {
    hero();
    const link = screen.getByRole("link", { name: /Demander un retrait/i });
    expect(link).toHaveAttribute("href", "/fr/investor/withdrawals");
    expect(link).not.toHaveAttribute("aria-disabled");
  });

  test("is disabled and explains itself at a zero balance", () => {
    hero({ available: 0 });
    expect(screen.getByRole("link", { name: /Demander un retrait/i })).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    expect(
      screen.getByText(frMessages.investor.balance.availableEmpty)
    ).toBeInTheDocument();
  });

  test("respects the locale it was rendered under", () => {
    hero({ locale: "ar" });
    expect(screen.getByRole("link", { name: /Demander un retrait/i })).toHaveAttribute(
      "href",
      "/ar/investor/withdrawals"
    );
  });
});
