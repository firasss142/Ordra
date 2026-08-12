import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import { GoogleSheetsSyncWidget } from "../GoogleSheetsSyncWidget";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(messages, ns, key, params),
  };
});

const useGoogleSheetsSync = vi.fn();
vi.mock("@/hooks/useGoogleSheetsSync", () => ({
  useGoogleSheetsSync: (marketId: string) => useGoogleSheetsSync(marketId),
}));

const HOUR = 3_600_000;

function hookState(over: Record<string, unknown> = {}) {
  return {
    status: { sources: [], configs_count: 1, failures: [] },
    isLoading: false,
    isSyncing: false,
    syncError: null,
    triggerSync: vi.fn(),
    hasSheets: true,
    isBroken: false,
    brokenSources: [],
    failures: [],
    lastSuccessAt: new Date(Date.now() - HOUR).toISOString(),
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("GoogleSheetsSyncWidget", () => {
  it("says the import is broken instead of showing a frozen row count", () => {
    // The widget used to read "{n} lignes synchronisées" whether the sync ran a
    // minute ago or died four days ago — the number just stops moving. That is
    // how a 55-second timeout every fifteen minutes went unnoticed until an
    // operator counted rows in the spreadsheet by hand.
    useGoogleSheetsSync.mockReturnValue(
      hookState({
        isBroken: true,
        lastSuccessAt: new Date(Date.now() - 96 * HOUR).toISOString(),
        status: { sources: [], configs_count: 1, failures: [] },
      }),
    );

    render(<GoogleSheetsSyncWidget marketId="m-1" />);

    const health = screen.getByTestId("sheets-sync-health");
    expect(health).toHaveAttribute("role", "alert");
    expect(health.textContent).toMatch(/n’arrivent pas/i);
  });

  it("names the state when the sync has never once succeeded", () => {
    useGoogleSheetsSync.mockReturnValue(hookState({ isBroken: true, lastSuccessAt: null }));
    render(<GoogleSheetsSyncWidget marketId="m-1" />);
    expect(screen.getByTestId("sheets-sync-health").textContent).toMatch(/jamais abouti/i);
  });

  it("reads as healthy, and quietly, when orders are landing", () => {
    useGoogleSheetsSync.mockReturnValue(hookState());
    render(<GoogleSheetsSyncWidget marketId="m-1" />);

    const health = screen.getByTestId("sheets-sync-health");
    expect(health).not.toHaveAttribute("role", "alert");
    expect(health.textContent).toMatch(/derni[èe]re synchronisation/i);
  });

  it("surfaces rows that could not be imported", () => {
    // These used to exist only in an errors array returned to pg_net, which
    // discards it — the row was skipped and nothing anywhere recorded it.
    useGoogleSheetsSync.mockReturnValue(
      hookState({
        failures: [
          {
            id: "f1",
            storefront_id: "sf",
            row_index: 2841,
            message: "no product match",
            raw_row: {},
            created_at: new Date().toISOString(),
          },
        ],
      }),
    );

    render(<GoogleSheetsSyncWidget marketId="m-1" />);
    expect(screen.getByTestId("sheets-failed-rows").textContent).toMatch(/1 ligne/i);
  });

  it("says it is still catching up rather than looking finished", () => {
    useGoogleSheetsSync.mockReturnValue(
      hookState({
        status: {
          configs_count: 1,
          failures: [],
          sources: [{ storefront_id: "sf", last_success: { has_more: true } }],
        },
      }),
    );

    render(<GoogleSheetsSyncWidget marketId="m-1" />);
    expect(screen.getByText(/rattrapage/i)).toBeInTheDocument();
  });
});
