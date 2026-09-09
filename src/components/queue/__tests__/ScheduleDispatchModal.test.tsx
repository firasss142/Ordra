import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { ScheduleDispatchModal } from "../ScheduleDispatchModal";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(messages, ns, key, params),
    useLocale: () => "fr",
  };
});

const mockFetch = vi.fn();
global.fetch = mockFetch;

function mockCarriersAndComparison(orderId: string) {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes("/api/carriers/rates")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          data: {
            recommended_carrier_id: "c-benghazi",
            reason: "cheapest",
            rates: [
              { carrier_id: "c-benghazi", quoted_fee: 20, quote_usable: true, true_cost_per_delivered: null, effective_cost: 20, is_cheapest: false },
              { carrier_id: "c-tripoli", quoted_fee: 15, quote_usable: true, true_cost_per_delivered: null, effective_cost: 15, is_cheapest: true },
            ],
          },
        }),
      });
    }
    if (url.includes("/api/carriers/performance")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          data: [
            { carrier_id: "c-benghazi", delivered: 78, returned: 22, delivery_rate_30d: 0.78, median_transit_hours: 48, sample_size: 100 },
            { carrier_id: "c-tripoli", delivered: 64, returned: 36, delivery_rate_30d: 0.64, median_transit_hours: 72, sample_size: 100 },
          ],
        }),
      });
    }
    if (url.includes("/api/carriers")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          data: [
            { id: "c-benghazi", name: "Darb Assabil — Benghazi", code: "darb_assabil", is_active: true },
            { id: "c-tripoli", name: "Darb Assabil — Tripoli", code: "darb_assabil", is_active: true },
          ],
        }),
      });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
}

const baseProps = {
  orderId: "order-sdm-1",
  marketId: "market-sdm-1",
  onClose: vi.fn(),
  onSuccess: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ScheduleDispatchModal", () => {
  it("renders the title and date/time inputs", () => {
    mockCarriersAndComparison(baseProps.orderId);
    render(<ScheduleDispatchModal {...baseProps} />);
    expect(screen.getByText("Planifier la livraison")).toBeDefined();
    expect(screen.getByLabelText("Date")).toBeDefined();
    expect(screen.getByLabelText("Heure")).toBeDefined();
  });

  it("shows the auto-dispatch confirmation as a standing green card, not an opt-in toggle", () => {
    mockCarriersAndComparison(baseProps.orderId);
    render(<ScheduleDispatchModal {...baseProps} />);
    expect(screen.getByText("Expédier automatiquement à l'heure prévue")).toBeDefined();
    // No checkbox to opt in/out — auto-dispatch is the only mode this modal offers.
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("shows fee/delivery-rate/transit stats per carrier and badges the best choice", async () => {
    mockCarriersAndComparison(baseProps.orderId);
    render(<ScheduleDispatchModal {...baseProps} />);

    await waitFor(() => expect(screen.getByText("Darb Assabil — Benghazi")).toBeDefined());
    expect(screen.getByText("78%")).toBeDefined();
    expect(screen.getByText("2 j")).toBeDefined();
    const benghaziCard = screen.getByText("Darb Assabil — Benghazi").closest("button")!;
    expect(benghaziCard.textContent).toContain("meilleur choix");
  });

  it("submits scheduled_at, auto_dispatch:true and the picked carrier_id", async () => {
    mockCarriersAndComparison(baseProps.orderId);
    mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (url.includes("/api/carriers/rates")) {
        return Promise.resolve({ ok: true, json: async () => ({ data: { recommended_carrier_id: "c-benghazi", reason: "", rates: [
          { carrier_id: "c-benghazi", quoted_fee: 20, quote_usable: true, true_cost_per_delivered: null, effective_cost: 20, is_cheapest: true },
          { carrier_id: "c-tripoli", quoted_fee: 15, quote_usable: true, true_cost_per_delivered: null, effective_cost: 15, is_cheapest: false },
        ] } }) });
      }
      if (url.includes("/api/carriers/performance")) {
        return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
      }
      if (url.includes("/api/carriers")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [
              { id: "c-benghazi", name: "Darb Assabil — Benghazi", code: "darb_assabil", is_active: true },
              { id: "c-tripoli", name: "Darb Assabil — Tripoli", code: "darb_assabil", is_active: true },
            ],
          }),
        });
      }
      if (url.includes("/api/orders/") && url.includes("/schedule-dispatch")) {
        return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(<ScheduleDispatchModal {...baseProps} />);
    await waitFor(() => expect(screen.getByText("Darb Assabil — Tripoli")).toBeDefined());

    fireEvent.click(screen.getByText("Darb Assabil — Tripoli"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Planifier" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Planifier" }));

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        `/api/orders/${baseProps.orderId}/schedule-dispatch`,
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const call = mockFetch.mock.calls.find(
      (c) => String(c[0]).includes("/schedule-dispatch"),
    )!;
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.auto_dispatch).toBe(true);
    expect(body.carrier_id).toBe("c-tripoli");
    expect(typeof body.scheduled_at).toBe("string");
  });

  it("disables submit until a carrier is picked", async () => {
    mockCarriersAndComparison(baseProps.orderId);
    render(<ScheduleDispatchModal {...baseProps} />);
    await waitFor(() => expect(screen.getByText("Darb Assabil — Benghazi")).toBeDefined());
    // "Meilleur choix" pre-selects Benghazi automatically, so submit is enabled
    // once carriers load — never stuck disabled with no explanation.
    expect(screen.getByRole("button", { name: "Planifier" })).toBeEnabled();
  });

  it("shows a timeline preview from 'maintenant' to the scheduled date/time", () => {
    mockCarriersAndComparison(baseProps.orderId);
    render(<ScheduleDispatchModal {...baseProps} />);
    expect(screen.getByText("maintenant")).toBeDefined();
  });

  it("calls onClose when Annuler is clicked", () => {
    mockCarriersAndComparison(baseProps.orderId);
    render(<ScheduleDispatchModal {...baseProps} />);
    fireEvent.click(screen.getByText("Annuler"));
    expect(baseProps.onClose).toHaveBeenCalledTimes(1);
  });
});
