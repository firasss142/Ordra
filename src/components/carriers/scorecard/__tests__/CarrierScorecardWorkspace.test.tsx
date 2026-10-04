import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import { libyaScorecard, LY, TRI } from "@/test/helpers/scorecardFixture";

const replace = vi.fn();
let search = "period=7";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/fr/carriers",
  useSearchParams: () => new URLSearchParams(search),
}));
const useCarrierScorecard = vi.fn();
vi.mock("@/hooks/useCarrierScorecard", () => ({
  useCarrierScorecard: (...a: unknown[]) => useCarrierScorecard(...a),
  useScorecardParcels: () => ({ parcels: [], isLoading: false, error: null }),
  buildScorecardParcelsKey: () => "/api/carriers/scorecard/parcels?x",
}));
vi.mock("@/lib/swr-config", () => ({
  fetcher: vi.fn().mockResolvedValue({ data: [{ tracking_number: "1593038" }, { tracking_number: "1597630" }] }),
}));

import { CarrierScorecardWorkspace, parsePeriod } from "../CarrierScorecardWorkspace";

function renderWorkspace(screenName: "overview" | "carrier" | "compare", carrierId?: string) {
  render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <CarrierScorecardWorkspace screen={screenName} carrierId={carrierId} marketId={LY} marketCode="ly" locale="fr" />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  replace.mockClear();
  search = "period=7";
  useCarrierScorecard.mockReturnValue({ scorecard: libyaScorecard({ days: 7 }), error: null, isLoading: false, mutate: vi.fn() });
});

describe("CarrierScorecardWorkspace", () => {
  it("reads the period from the URL (30 by default) and asks for that window", () => {
    expect(parsePeriod("90")).toBe(90);
    expect(parsePeriod("45")).toBe(30);
    expect(parsePeriod(null)).toBe(30);
    renderWorkspace("overview");
    expect(useCarrierScorecard).toHaveBeenCalledWith(LY, 7);
  });

  it("writes a new period back to the URL and keeps it in every link", () => {
    renderWorkspace("overview");
    expect(screen.getByRole("article", { name: "Tripoli" }).closest("a")).toHaveAttribute("href", `/fr/carriers/${TRI}?period=7`);
    fireEvent.click(screen.getByRole("button", { name: "90 j" }));
    expect(replace).toHaveBeenCalledWith("/fr/carriers?period=90", { scroll: false });
  });

  it("shows a skeleton while loading and a retry on error", () => {
    useCarrierScorecard.mockReturnValue({ scorecard: null, error: null, isLoading: true, mutate: vi.fn() });
    renderWorkspace("overview");
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("copies the late parcels for Darb, with the message in Arabic", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderWorkspace("carrier", TRI);
    fireEvent.click(screen.getByRole("button", { name: "Copier pour Darb" }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).toBe("السلام عليكم، هذه الطرود متأخرة، نرجو المتابعة:\n1593038\n1597630");
    expect(await screen.findByRole("status")).toHaveTextContent("Copié : 2 numéros de suivi + message pour Darb");
  });

  it("says so when the carrier is not in this market", () => {
    renderWorkspace("carrier", "unknown");
    expect(screen.getByText("Aucun colis sur la période")).toBeInTheDocument();
  });
});
