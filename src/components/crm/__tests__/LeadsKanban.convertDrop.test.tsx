import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  leads: [] as any[],
  mutate: vi.fn(),
}));

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(messages, ns, key, params),
    useLocale: () => "fr",
  };
});

vi.mock("next/dynamic", () => ({
  default: () =>
    function MockDynamicModal(props: { open?: boolean; lead?: { customer_name?: string } }) {
      if (!props.open) return null;
      return <div role="dialog">{props.lead?.customer_name ?? "modal"}</div>;
    },
}));

vi.mock("@/components/shared/KanbanBoard", () => ({
  KanbanBoard: (props: any) => (
    <div>
      {props.columns.map((column: { key: string; label: string }) => (
        <div key={column.key}>{column.label}</div>
      ))}
      <button
        type="button"
        onClick={() => props.onMove(props.items[0], "qualified", "won")}
      >
        drop qualified to won
      </button>
    </div>
  ),
}));

vi.mock("@/hooks/useLeads", () => ({
  useLeads: () => ({ leads: mocks.leads, isLoading: false, mutate: mocks.mutate }),
}));

vi.mock("@/hooks/useStatusConfigs", () => ({
  useStatusConfigs: () => ({
    configs: [
      {
        id: "status-qualified",
        market_id: "m1",
        scope: "prospect",
        key: "qualified",
        label_fr: "Qualifié",
        label_ar: "مؤهل",
        color: "#10B981",
        sort_order: 1,
        is_initial: false,
        is_terminal: false,
        allowed_transitions: ["won"],
        created_at: "2026-04-01T00:00:00Z",
        updated_at: "2026-04-01T00:00:00Z",
      },
      {
        id: "status-won",
        market_id: "m1",
        scope: "prospect",
        key: "won",
        label_fr: "Gagné",
        label_ar: "ربح",
        color: "#059669",
        sort_order: 2,
        is_initial: false,
        is_terminal: true,
        allowed_transitions: [],
        created_at: "2026-04-01T00:00:00Z",
        updated_at: "2026-04-01T00:00:00Z",
      },
    ],
  }),
}));

vi.mock("../NewLeadModal", () => ({
  NewLeadModal: () => null,
}));

import { LeadsKanban } from "../LeadsKanban";

describe("LeadsKanban convert drop", () => {
  beforeEach(() => {
    mocks.mutate.mockReset();
    mocks.leads = [
      {
        id: "lead-1",
        market_id: "m1",
        source: "manual_call",
        source_external_id: null,
        source_platform: null,
        status: "qualified",
        customer_name: "Alice",
        customer_phone: "+216 22 333 444",
        customer_city: "Tunis",
        customer_address: null,
        product_interest_id: null,
        product_interest_note: null,
        notes: null,
        assigned_to: "agent-1",
        callback_scheduled_at: null,
        lost_reason: null,
        lost_note: null,
        converted_order_id: null,
        campaign_id: null,
        raw_payload: null,
        created_at: "2026-04-01T00:00:00Z",
        updated_at: "2026-04-01T00:00:00Z",
        is_hot: false,
        has_duplicate: false,
      },
    ];
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens the conversion modal instead of calling the generic transition API", async () => {
    render(<LeadsKanban marketId="m1" locale="fr" />);

    fireEvent.click(screen.getByRole("button", { name: "drop qualified to won" }));

    expect(await screen.findByRole("dialog")).toHaveTextContent("Alice");
    expect(fetch).not.toHaveBeenCalled();
  });
});
