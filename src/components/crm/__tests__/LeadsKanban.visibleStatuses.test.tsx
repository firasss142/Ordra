import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LeadsKanban } from "../LeadsKanban";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(messages, ns, key, params),
    useLocale: () => "fr",
  };
});

vi.mock("@/hooks/useLeads", () => ({
  useLeads: () => ({ leads: [], isLoading: false, mutate: vi.fn() }),
}));

vi.mock("@/hooks/useStatusConfigs", () => ({
  useStatusConfigs: () => ({
    configs: [
      {
        key: "new",
        label_en: "New",
        label_fr: "Nouveau",
        label_ar: "جديد",
        color: "neutral",
        sort_order: 1,
        is_terminal: false,
        allowed_transitions: ["assigned"],
      },
      {
        key: "assigned",
        label_en: "Assigned",
        label_fr: "Assigné",
        label_ar: "معيّن",
        color: "action",
        sort_order: 2,
        is_terminal: false,
        allowed_transitions: [],
      },
      {
        key: "qualified",
        label_en: "Qualified",
        label_fr: "Qualifié",
        label_ar: "مؤهل",
        color: "success",
        sort_order: 3,
        is_terminal: false,
        allowed_transitions: [],
      },
      {
        key: "won",
        label_en: "Won",
        label_fr: "Gagné",
        label_ar: "مربوح",
        color: "success",
        sort_order: 4,
        is_terminal: true,
        allowed_transitions: [],
      },
    ],
  }),
}));

vi.mock("../NewLeadModal", () => ({
  NewLeadModal: () => null,
}));

describe("LeadsKanban visibleStatuses", () => {
  it("renders every configured column when visibleStatuses is omitted", () => {
    render(<LeadsKanban marketId="m1" locale="fr" />);
    expect(screen.getByText("Nouveau")).toBeDefined();
    expect(screen.getByText("Assigné")).toBeDefined();
    expect(screen.getByText("Qualifié")).toBeDefined();
    expect(screen.getByText("Gagné")).toBeDefined();
  });

  it("filters columns to the visibleStatuses set", () => {
    render(
      <LeadsKanban
        marketId="m1"
        locale="fr"
        visibleStatuses={["qualified"]}
      />,
    );
    expect(screen.getByText("Qualifié")).toBeDefined();
    expect(screen.queryByText("Nouveau")).toBeNull();
    expect(screen.queryByText("Assigné")).toBeNull();
    expect(screen.queryByText("Gagné")).toBeNull();
  });

  it("preserves sort_order when filtering", () => {
    const { container } = render(
      <LeadsKanban
        marketId="m1"
        locale="fr"
        visibleStatuses={["won", "new", "qualified"]}
      />,
    );
    const text = container.textContent ?? "";
    expect(text.indexOf("Nouveau")).toBeLessThan(text.indexOf("Qualifié"));
    expect(text.indexOf("Qualifié")).toBeLessThan(text.indexOf("Gagné"));
  });
});
