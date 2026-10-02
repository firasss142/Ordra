import { render, screen, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import type { RejectionReasonConfig } from "@/types/rejection-config";

const mockRows = vi.fn<() => RejectionReasonConfig[]>(() => []);

vi.mock("@/hooks/useRejectionReasons", () => ({
  useRejectionReasons: () => ({
    rows: mockRows(),
    error: null,
    isLoading: false,
    mutate: vi.fn(),
  }),
}));

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations:
      (ns: string) => (key: string, params?: Record<string, unknown>) =>
        resolveTranslation(messages, ns, key, params),
    useLocale: () => "fr",
  };
});

import { RejectionReasonSelect } from "../RejectionReasonSelect";

const cfg = (
  key: string,
  parent_key: string | null,
  over: Partial<RejectionReasonConfig> = {},
): RejectionReasonConfig => ({
  id: key,
  market_id: "m-tn",
  parent_key,
  key,
  label_fr: key,
  label_ar: key,
  short_fr: key,
  short_ar: key,
  sort_order: 0,
  is_active: true,
  requires_note: false,
  created_at: "",
  updated_at: "",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockRows.mockReturnValue([]);
});

describe("RejectionReasonSelect — driven by the market's configuration", () => {
  // Before the fetch lands there is still a call in progress and an agent
  // waiting, so the picker opens on the compiled taxonomy.
  it("falls back to the bundled taxonomy when no config has loaded", () => {
    render(<RejectionReasonSelect onSelect={vi.fn()} marketId="m-tn" />);

    expect(screen.getByText("Refus client")).toBeDefined();
    expect(screen.getByText("Injoignable")).toBeDefined();
  });

  it("offers a sub-reason the manager added, with the manager's wording", () => {
    mockRows.mockReturnValue([
      cfg("refus_client", null, { label_fr: "Refus client" }),
      cfg("promo_terminee", "refus_client", {
        label_fr: "La promo était terminée",
      }),
    ]);

    const onSelect = vi.fn();
    render(<RejectionReasonSelect onSelect={onSelect} marketId="m-tn" />);
    fireEvent.click(screen.getByText("Refus client"));

    fireEvent.click(screen.getByText("La promo était terminée"));
    expect(onSelect).toHaveBeenCalledWith(
      "refus_client",
      "promo_terminee",
      undefined,
    );
  });

  it("hides a sub-reason the manager retired", () => {
    mockRows.mockReturnValue([
      cfg("refus_client", null, { label_fr: "Refus client" }),
      cfg("prix_eleve", "refus_client", {
        label_fr: "Prix trop élevé",
        is_active: false,
      }),
      cfg("achete_ailleurs", "refus_client", { label_fr: "Acheté ailleurs" }),
    ]);

    render(<RejectionReasonSelect onSelect={vi.fn()} marketId="m-tn" />);
    fireEvent.click(screen.getByText("Refus client"));

    expect(screen.queryByText("Prix trop élevé")).toBeNull();
    expect(screen.getByText("Acheté ailleurs")).toBeDefined();
  });

  it("hides a group the manager retired", () => {
    mockRows.mockReturnValue([
      cfg("refus_client", null, { label_fr: "Refus client" }),
      cfg("injoignable", null, { label_fr: "Injoignable", is_active: false }),
    ]);

    render(<RejectionReasonSelect onSelect={vi.fn()} marketId="m-tn" />);

    expect(screen.getByText("Refus client")).toBeDefined();
    expect(screen.queryByText("Injoignable")).toBeNull();
  });

  it("respects the order the manager put the groups in", () => {
    mockRows.mockReturnValue([
      cfg("injoignable", null, { label_fr: "Injoignable", sort_order: 0 }),
      cfg("refus_client", null, { label_fr: "Refus client", sort_order: 1 }),
    ]);

    render(<RejectionReasonSelect onSelect={vi.fn()} marketId="m-tn" />);
    const buttons = screen.getAllByRole("button").map((b) => b.textContent);

    expect(buttons[0]).toContain("Injoignable");
    expect(buttons[1]).toContain("Refus client");
  });

  // `requires_note` is data, so the note pane must follow the flag rather than
  // the literal key "autre".
  it("asks for a note on whichever group is flagged note-only", () => {
    mockRows.mockReturnValue([
      cfg("sans_suite", null, {
        label_fr: "Sans suite",
        requires_note: true,
      }),
    ]);

    const onSelect = vi.fn();
    render(<RejectionReasonSelect onSelect={onSelect} marketId="m-tn" />);
    fireEvent.click(screen.getByText("Sans suite"));

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "rappelle en mai" } });

    expect(onSelect).toHaveBeenCalledWith("sans_suite", null, "rappelle en mai");
  });

  it("still refuses to report an empty note", () => {
    mockRows.mockReturnValue([
      cfg("autre", null, { label_fr: "Autre", requires_note: true }),
    ]);

    const onSelect = vi.fn();
    render(<RejectionReasonSelect onSelect={onSelect} marketId="m-tn" />);
    fireEvent.click(screen.getByText("Autre"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "   " } });

    expect(onSelect).not.toHaveBeenCalled();
  });

  // A group whose sub-reasons were all retired must stay pickable, or it
  // becomes a dead end in the sheet.
  it("reports the bare group when it has no sub-reasons left", () => {
    mockRows.mockReturnValue([
      cfg("livraison_impossible", null, { label_fr: "Livraison impossible" }),
    ]);

    const onSelect = vi.fn();
    render(<RejectionReasonSelect onSelect={onSelect} marketId="m-tn" />);
    fireEvent.click(screen.getByText("Livraison impossible"));

    expect(onSelect).toHaveBeenCalledWith("livraison_impossible", null, undefined);
  });
});

describe("RejectionReasonSelect — a pre-chosen answer the market no longer offers", () => {
  // The ceiling pre-arms « injoignable › pas_de_reponse » from compiled code.
  // In a market that retired that sub-reason the server answers 400 — so the
  // picker withdraws it instead of letting the sheet send it.
  it("withdraws a pre-chosen sub-reason the manager retired", () => {
    mockRows.mockReturnValue([
      cfg("injoignable", null, { label_fr: "Injoignable" }),
      cfg("pas_de_reponse", "injoignable", { is_active: false }),
      cfg("raccroche", "injoignable", { label_fr: "Raccroche" }),
    ]);

    const onClear = vi.fn();
    render(
      <RejectionReasonSelect
        onSelect={vi.fn()}
        onClear={onClear}
        marketId="m-tn"
        defaultGroup="injoignable"
        defaultSub="pas_de_reponse"
      />,
    );

    expect(onClear).toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Raccroche" }).getAttribute("aria-pressed"),
    ).toBe("false");
  });
});
