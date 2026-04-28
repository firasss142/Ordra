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
  marketLabel: "Tous les marchés",
  bucket: "all" as const,
  onBucketChange: vi.fn(),
  source: null,
  onSourceChange: vi.fn(),
  campaigns: [],
  selectedCampaignId: null,
  onCampaignChange: vi.fn(),
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

  it("renders inline Source and Campaign chip controls (no popover)", () => {
    render(
      <LeadsFilterBar
        {...baseProps}
        campaigns={[
          {
            id: "c1",
            market_id: "m1",
            name: "Camp A",
            filter_json: {},
            created_by: null,
            created_at: "",
          },
        ]}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Source/i, expanded: false }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: /Campagne/i, expanded: false }),
    ).toBeDefined();
  });

  it("does not render the Campaign chip when there are no campaigns", () => {
    render(<LeadsFilterBar {...baseProps} />);
    expect(
      screen.queryByRole("button", { name: /^Campagne/i, expanded: false }),
    ).toBeNull();
  });

  it("opens the Source chip dropdown on click and lets the user select", () => {
    const onSourceChange = vi.fn();
    render(<LeadsFilterBar {...baseProps} onSourceChange={onSourceChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Source/i }));
    fireEvent.click(screen.getByRole("option", { name: "WhatsApp" }));
    expect(onSourceChange).toHaveBeenCalledWith("whatsapp");
  });

  it("shows a clear (×) button on the Source chip when a source is selected", () => {
    const onSourceChange = vi.fn();
    render(
      <LeadsFilterBar
        {...baseProps}
        source="whatsapp"
        onSourceChange={onSourceChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Clear Source/i }));
    expect(onSourceChange).toHaveBeenCalledWith(null);
  });

  it("calls onOpenCsvImport when upload icon button clicked", () => {
    const onOpenCsvImport = vi.fn();
    render(<LeadsFilterBar {...baseProps} onOpenCsvImport={onOpenCsvImport} />);
    fireEvent.click(screen.getByRole("button", { name: "Importer CSV" }));
    expect(onOpenCsvImport).toHaveBeenCalledTimes(1);
  });

  it("renders the market label as a read-only chip (sidebar is the only writer)", () => {
    render(<LeadsFilterBar {...baseProps} marketLabel="Tunisie" />);
    expect(screen.getByText("Tunisie")).toBeDefined();
    expect(
      screen.queryByRole("button", { name: /Tunisie/ }),
    ).toBeNull();
  });

  it("fires onNewLead when primary button clicked", () => {
    const onNewLead = vi.fn();
    render(<LeadsFilterBar {...baseProps} onNewLead={onNewLead} />);
    fireEvent.click(screen.getByRole("button", { name: /Nouveau prospect/i }));
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

  it("renders view toggle with Kanban and Tableau buttons", () => {
    render(
      <LeadsFilterBar
        {...baseProps}
        view="kanban"
        onViewChange={vi.fn()}
        hotOnly={false}
        onHotOnlyChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Kanban" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Tableau" })).toBeDefined();
  });

  it("marks the active view tab as aria-selected=true", () => {
    render(
      <LeadsFilterBar
        {...baseProps}
        view="table"
        onViewChange={vi.fn()}
        hotOnly={false}
        onHotOnlyChange={vi.fn()}
      />,
    );
    const tableBtn = screen.getByRole("button", { name: "Tableau" });
    expect(tableBtn.getAttribute("aria-selected")).toBe("true");
    const kanbanBtn = screen.getByRole("button", { name: "Kanban" });
    expect(kanbanBtn.getAttribute("aria-selected")).toBe("false");
  });

  it("fires onViewChange with 'table' when Tableau button clicked", () => {
    const onViewChange = vi.fn();
    render(
      <LeadsFilterBar
        {...baseProps}
        view="kanban"
        onViewChange={onViewChange}
        hotOnly={false}
        onHotOnlyChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Tableau" }));
    expect(onViewChange).toHaveBeenCalledWith("table");
  });

  it("renders an inline 'Chauds seulement' toggle chip", () => {
    render(
      <LeadsFilterBar
        {...baseProps}
        view="kanban"
        onViewChange={vi.fn()}
        hotOnly={false}
        onHotOnlyChange={vi.fn()}
      />,
    );
    const chip = screen.getByRole("button", { name: /Chauds seulement/i });
    expect(chip.getAttribute("aria-pressed")).toBe("false");
  });

  it("fires onHotOnlyChange when the hot-only chip is clicked", () => {
    const onHotOnlyChange = vi.fn();
    render(
      <LeadsFilterBar
        {...baseProps}
        view="kanban"
        onViewChange={vi.fn()}
        hotOnly={false}
        onHotOnlyChange={onHotOnlyChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Chauds seulement/i }));
    expect(onHotOnlyChange).toHaveBeenCalledWith(true);
  });

  it("renders 'Tout effacer' once any filter is active", () => {
    render(<LeadsFilterBar {...baseProps} source="whatsapp" />);
    expect(screen.getByRole("button", { name: "Tout effacer" })).toBeDefined();
  });
});
