import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LeadsFilterBar, BUCKET_STATUSES } from "../LeadsFilterBar";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(messages, ns, key, params),
    useLocale: () => "fr",
  };
});

const baseProps = {
  markets: [{ id: "m1", name: "Tunisie" }],
  selectedMarketId: "all" as const,
  onMarketChange: vi.fn(),
  lockMarket: false,
  lockedMarketLabel: "",
  bucket: "all" as const,
  onBucketChange: vi.fn(),
  source: null,
  onSourceChange: vi.fn(),
  campaigns: [],
  selectedCampaignId: null,
  onCampaignChange: vi.fn(),
  filtersOpen: false,
  onFiltersOpenChange: vi.fn(),
  hasActiveFilters: false,
  onOpenCampaigns: vi.fn(),
  onOpenCsvImport: vi.fn(),
  onNewLead: vi.fn(),
};

describe("LeadsFilterBar", () => {
  it("renders the 5 bucket tabs", () => {
    render(<LeadsFilterBar {...baseProps} />);
    expect(screen.getByRole("tab", { name: "Tous" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "Nouveaux" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "En cours" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "Qualifiés" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "Terminés" })).toBeDefined();
  });

  it("marks the active bucket as selected", () => {
    render(<LeadsFilterBar {...baseProps} bucket="active" />);
    const tab = screen.getByRole("tab", { name: "En cours" });
    expect(tab.getAttribute("aria-selected")).toBe("true");
  });

  it("fires onBucketChange when a tab is clicked", () => {
    const onBucketChange = vi.fn();
    render(<LeadsFilterBar {...baseProps} onBucketChange={onBucketChange} />);
    fireEvent.click(screen.getByRole("tab", { name: "Qualifiés" }));
    expect(onBucketChange).toHaveBeenCalledWith("qualified");
  });

  it("renders Filters button instead of Reset, Source chip, or Campaign chip", () => {
    render(<LeadsFilterBar {...baseProps} />);
    expect(screen.getByRole("button", { name: /Filtres/i })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Réinitialiser" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Campagnes" })).toBeNull();
  });

  it("shows active count in Filters button label when source is set", () => {
    render(<LeadsFilterBar {...baseProps} source="whatsapp" />);
    expect(screen.getByRole("button", { name: /Filtres · 1/i })).toBeDefined();
  });

  it("shows active count 2 when both source and campaign are set", () => {
    render(
      <LeadsFilterBar
        {...baseProps}
        source="whatsapp"
        selectedCampaignId="c1"
        campaigns={[{ id: "c1", market_id: "m1", name: "Camp A", filter_json: {}, created_by: null, created_at: "" }]}
      />,
    );
    expect(screen.getByRole("button", { name: /Filtres · 2/i })).toBeDefined();
  });

  it("calls onFiltersOpenChange(true) when Filters button clicked", () => {
    const onFiltersOpenChange = vi.fn();
    render(<LeadsFilterBar {...baseProps} onFiltersOpenChange={onFiltersOpenChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Filtres/i }));
    expect(onFiltersOpenChange).toHaveBeenCalledWith(true);
  });

  it("calls onOpenCsvImport when upload icon button clicked", () => {
    const onOpenCsvImport = vi.fn();
    render(<LeadsFilterBar {...baseProps} onOpenCsvImport={onOpenCsvImport} />);
    fireEvent.click(screen.getByRole("button", { name: "Importer CSV" }));
    expect(onOpenCsvImport).toHaveBeenCalledTimes(1);
  });

  it("locks the market to a label for non-super_admin roles", () => {
    render(
      <LeadsFilterBar
        {...baseProps}
        lockMarket={true}
        lockedMarketLabel="Tunisie"
      />,
    );
    expect(screen.getByText("Tunisie")).toBeDefined();
    expect(screen.queryByRole("button", { name: /Tous les marchés|Tunisie/ })).toBeNull();
  });

  it("fires onNewLead when primary button clicked", () => {
    const onNewLead = vi.fn();
    render(<LeadsFilterBar {...baseProps} onNewLead={onNewLead} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Nouveau prospect" }));
    expect(onNewLead).toHaveBeenCalledTimes(1);
  });

  it("exports BUCKET_STATUSES that covers every actionable status", () => {
    const covered = new Set([
      ...BUCKET_STATUSES.new,
      ...BUCKET_STATUSES.active,
      ...BUCKET_STATUSES.qualified,
      ...BUCKET_STATUSES.closed,
    ]);
    expect(covered.size).toBe(10);
  });
});
