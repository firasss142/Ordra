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
  onReset: vi.fn(),
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

  it("hides Reset when no filters active", () => {
    render(<LeadsFilterBar {...baseProps} hasActiveFilters={false} />);
    expect(screen.queryByRole("button", { name: "Réinitialiser" })).toBeNull();
  });

  it("shows Reset when filters are active", () => {
    render(<LeadsFilterBar {...baseProps} hasActiveFilters={true} />);
    expect(screen.getByRole("button", { name: "Réinitialiser" })).toBeDefined();
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
