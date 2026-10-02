import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import type { RejectionReasonConfig } from "@/types/rejection-config";

const mockRows = vi.fn<() => RejectionReasonConfig[]>(() => []);

vi.mock("./useRejectionReasons", () => ({
  useRejectionReasons: () => ({
    rows: mockRows(),
    error: null,
    isLoading: false,
    mutate: vi.fn(),
  }),
}));

import { useRejectionBadge } from "./useRejectionBadge";

const messages = {
  orders: {
    rejectionSubreasonsShort: { numero_invalide: "Faux n°" },
    rejectionReasons: { prix: "Prix", injoignable: "Injoignable" },
  },
};

function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="fr" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

const run = (marketId: string | null = "m-tn") =>
  renderHook(() => useRejectionBadge(marketId), { wrapper }).result.current;

const configRow = (
  over: Partial<RejectionReasonConfig>,
): RejectionReasonConfig => ({
  id: "x",
  market_id: "m-tn",
  parent_key: null,
  key: "k",
  label_fr: "Long",
  label_ar: "طويل",
  short_fr: "Court",
  short_ar: "قصير",
  sort_order: 0,
  is_active: true,
  requires_note: false,
  created_at: "",
  updated_at: "",
  ...over,
});

describe("useRejectionBadge", () => {
  it("returns null for an order that was not rejected", () => {
    mockRows.mockReturnValue([]);
    const resolve = run();

    expect(
      resolve({ status: "delivered", rejection_reason: null, rejection_subreason: null }),
    ).toBeNull();
  });

  it("prefers the market's own short label once the config has loaded", () => {
    mockRows.mockReturnValue([
      configRow({ key: "injoignable", label_fr: "Injoignable" }),
      configRow({
        key: "numero_invalide",
        parent_key: "injoignable",
        short_fr: "Mauvais numéro",
        label_fr: "Numéro faux ou inexistant",
      }),
    ]);

    expect(
      run()({
        status: "rejected",
        rejection_reason: "injoignable",
        rejection_subreason: "numero_invalide",
      }),
    ).toEqual({
      icon: "rejectedUnreachable",
      text: "Mauvais numéro",
      detail: "Injoignable · Numéro faux ou inexistant",
    });
  });

  // Before the fetch resolves there is still a thousand-row table to paint.
  it("falls back to the bundled translations while the config is empty", () => {
    mockRows.mockReturnValue([]);

    expect(
      run()({
        status: "rejected",
        rejection_reason: "injoignable",
        rejection_subreason: "numero_invalide",
      }),
    ).toEqual({ icon: "rejectedUnreachable", text: "Faux n°", detail: null });
  });

  it("resolves a legacy group that no picker offers any more", () => {
    mockRows.mockReturnValue([]);

    expect(
      run()({
        status: "rejected",
        rejection_reason: "prix",
        rejection_subreason: null,
      }),
    ).toEqual({ icon: "rejectedRefused", text: "Prix", detail: null });
  });

  it("shows the agent's own note for `autre`", () => {
    mockRows.mockReturnValue([
      configRow({ key: "autre", label_fr: "Autre", requires_note: true }),
    ]);

    expect(
      run()({
        status: "rejected",
        rejection_reason: "autre",
        rejection_subreason: null,
        rejection_note: "veut la taille au-dessus",
      }),
    ).toEqual({
      icon: "rejectedOther",
      text: "veut la taille au-dessus",
      detail: "Autre · veut la taille au-dessus",
    });
  });

  // A key deleted from the config and absent from the bundled messages must not
  // render "orders.rejectionSubreasonsShort.foo" into the table.
  it("returns null rather than an untranslated key", () => {
    mockRows.mockReturnValue([]);

    expect(
      run()({
        status: "rejected",
        rejection_reason: "injoignable",
        rejection_subreason: "motif_invente_hier",
      }),
    ).toBeNull();
  });

  it("returns null when the rejection carries no reason at all", () => {
    mockRows.mockReturnValue([]);

    expect(
      run()({
        status: "rejected",
        rejection_reason: null,
        rejection_subreason: null,
      }),
    ).toBeNull();
  });
});
