"use client";

import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { PostCallActionSheet } from "../PostCallActionSheet";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(messages, ns, key, params),
    useLocale: () => "fr",
  };
});

// Mock sub-components
vi.mock("../CallbackPicker", () => ({
  CallbackPicker: ({
    onSelect,
    onInvalid,
    defaultValue,
  }: {
    onSelect: (d: Date) => void;
    onInvalid?: () => void;
    defaultValue?: Date;
  }) => (
    <div data-testid="callback-picker">
      {defaultValue && <span data-testid="has-default">has-default</span>}
      {defaultValue && <span data-testid="shown-default">{defaultValue.toISOString()}</span>}
      <button onClick={() => onSelect(new Date("2026-04-15T10:00:00.000Z"))}>
        Confirmer date
      </button>
      {onInvalid && <button onClick={onInvalid}>Heure passée</button>}
    </div>
  ),
}));

vi.mock("../RejectionReasonSelect", () => ({
  RejectionReasonSelect: ({
    onSelect,
    onPostpone,
    onClear,
    onBack,
    defaultGroup,
    defaultSub,
  }: {
    onSelect: (group: string, sub: string | null, note?: string) => void;
    onPostpone?: () => void;
    onClear?: () => void;
    onBack?: () => void;
    defaultGroup?: string;
    defaultSub?: string;
  }) => {
    // Mirrors the real picker's contract: a complete pre-chosen answer is
    // reported on open (RejectionReasonSelect.test.tsx pins the real one).
    const React = require("react") as typeof import("react");
    React.useEffect(() => {
      if (defaultGroup && defaultSub) onSelect(defaultGroup, defaultSub);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return (
    <div
      data-testid="rejection-select"
      data-default-group={defaultGroup ?? ""}
      data-default-sub={defaultSub ?? ""}
    >
      {/* The real picker only reports a complete pair — a group alone is never
          a valid answer, so the stub reports one too. */}
      <button onClick={() => onSelect("commande_invalide", "doublon")}>Doublon</button>
      {/* A sub-reason a manager added this morning: valid for the market, and
          unknown to the compiled taxonomy. */}
      <button onClick={() => onSelect("refus_client", "promo_concurrent")}>Promo concurrent</button>
      {/* « Autre » + its note — the only answer that offers « Aussi un retour client ». */}
      <button onClick={() => onSelect("autre", null, "قال اريد الدفع بالبطاقة")}>Autre avec note</button>
      {onClear && <button onClick={onClear}>Retirer le motif</button>}
      {onBack && <button onClick={onBack}>Retour aux résultats</button>}
      {onPostpone && <button onClick={onPostpone}>Plus tard</button>}
    </div>
    );
  },
}));

// The Darb upload modal is exercised in its own test; here we only assert the
// sheet opens it and wires onSuccess. A light stub avoids its SWR/network.
vi.mock("../DarbAssabilDispatchModal", () => ({
  DarbAssabilDispatchModal: ({
    onSuccess,
    onClose,
  }: {
    onSuccess: (tracking: string | null) => void;
    onClose: () => void;
  }) => (
    <div data-testid="darb-dispatch-modal">
      <button onClick={() => onSuccess("SH-TEST")}>Darb submit</button>
      <button onClick={onClose}>Darb cancel</button>
    </div>
  ),
}));

vi.mock("../ScheduleDispatchModal", () => ({
  ScheduleDispatchModal: ({
    onClose,
    onSuccess,
  }: {
    orderId: string;
    marketId: string;
    onClose: () => void;
    onSuccess: () => void;
  }) => (
    <div data-testid="schedule-dispatch-modal">
      <button onClick={onSuccess}>Submit schedule</button>
      <button onClick={onClose}>Cancel schedule</button>
    </div>
  ),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

const defaultProps = {
  orderId: "order-1",
  orderStatus: "attempt_1",
  marketId: "market-1",
  onClose: vi.fn(),
  onSuccess: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PostCallActionSheet — which order this is about", () => {
  it("echoes the order, so the sheet is not four choices about nothing", () => {
    render(
      <PostCallActionSheet
        {...defaultProps}
        order={{
          customerName: "Om Al Quran Al Senussi",
          productName: "Coran — grand format",
          quantity: 1,
          amount: 249,
          currency: "LYD",
          imageUrl: null,
        }}
      />,
    );

    const echo = screen.getByTestId("call-result-order");
    expect(echo).toHaveTextContent("Om Al Quran Al Senussi");
    expect(echo).toHaveTextContent("Coran — grand format");
    expect(echo).toHaveTextContent("249");
  });

  it("leaves the echo out where the caller has nothing to echo", () => {
    render(<PostCallActionSheet {...defaultProps} />);
    expect(screen.queryByTestId("call-result-order")).toBeNull();
  });
});

describe("PostCallActionSheet", () => {
  it("renders modal header with title and cancel button", () => {
    render(<PostCallActionSheet {...defaultProps} />);
    expect(screen.getByText("Résultat de l'appel")).toBeDefined();
    expect(screen.getByText("Annuler")).toBeDefined();
  });

  it("calls onClose when Annuler is clicked", () => {
    render(<PostCallActionSheet {...defaultProps} />);
    fireEvent.click(screen.getByText("Annuler"));
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it("renders 4 option buttons in initial state", () => {
    render(<PostCallActionSheet {...defaultProps} />);
    expect(screen.getByText("Pas de réponse")).toBeDefined();
    expect(screen.getByText("Confirmé")).toBeDefined();
    expect(screen.getByText("Rejeté")).toBeDefined();
    expect(screen.getByText("Rappel demandé")).toBeDefined();
  });

  it("keeps Pas de réponse available past attempt 3 when maxAttempts is higher", () => {
    render(
      <PostCallActionSheet
        {...defaultProps}
        orderStatus="attempt_3"
        attemptsCount={3}
        maxAttempts={5}
      />,
    );
    expect(screen.getByText("Tentative 3/5")).toBeDefined();
    expect(screen.getByText("Pas de réponse")).toBeDefined();
  });

  it("Pas de réponse is a direct action — no date picker is shown to the agent", async () => {
    render(<PostCallActionSheet {...defaultProps} />);
    // No-answer records an attempt directly; it does not open the callback picker.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { auto_rejected: false, new_status: "attempt_1", attempts_count: 1 } }),
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Pas de réponse"));
    });
    // The callback-picker testid must NOT appear from the no-answer path.
    expect(screen.queryByTestId("callback-picker")).toBeNull();
  });

  it("clicking Confirmé fires /confirm immediately (no intermediate sub-screen)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, new_status: "confirmed" }),
    });
    render(<PostCallActionSheet {...defaultProps} />);
    await act(async () => {
      fireEvent.click(screen.getByText("Confirmé"));
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/orders/order-1/confirm",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("records the no-answer on open when the panel's button already said so", async () => {
    // The panel footer's fourth button *is* "Pas de réponse". Opening a sheet
    // that asks the same question again would be asking the agent to say it
    // twice — the same reason `confirm_now` exists.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: { auto_rejected: false, new_status: "attempt_2", attempts_count: 2 },
      }),
    });

    await act(async () => {
      render(<PostCallActionSheet {...defaultProps} initialFlow="no_answer_now" />);
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/orders/order-1/no-answer",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("fires that POST once, not twice, however often React mounts the effect", async () => {
    // Exactly one response is queued: a second POST would find none, which is
    // the failure this test is about.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: { auto_rejected: false, new_status: "attempt_2", attempts_count: 2 },
      }),
    });

    const { rerender } = render(
      <PostCallActionSheet {...defaultProps} initialFlow="no_answer_now" />,
    );
    await act(async () => {
      rerender(<PostCallActionSheet {...defaultProps} initialFlow="no_answer_now" />);
    });

    const noAnswerCalls = mockFetch.mock.calls.filter(
      ([url]) => String(url).endsWith("/no-answer"),
    );
    expect(noAnswerCalls).toHaveLength(1);
  });

  it("switches to reject flow when Rejeté is clicked", () => {
    render(<PostCallActionSheet {...defaultProps} />);
    fireEvent.click(screen.getByText("Rejeté"));
    expect(screen.getByTestId("rejection-select")).toBeDefined();
    // One way back, and it is the picker's: the sheet no longer stacks a
    // second « Retour » with a different destination above it.
    expect(screen.queryByText("← Retour")).toBeNull();
    expect(screen.getByText("Retour aux résultats")).toBeDefined();
  });

  it("expands CallbackPicker inline when Rappel demandé is clicked (callback flow)", () => {
    render(<PostCallActionSheet {...defaultProps} />);
    fireEvent.click(screen.getByText("Rappel demandé"));
    expect(screen.getByTestId("callback-picker")).toBeDefined();
    // Still shows option buttons (inline expansion)
    expect(screen.getByText("Rappel demandé")).toBeDefined();
  });

  it("CallbackPicker in callback flow has a default value (+2h)", () => {
    render(<PostCallActionSheet {...defaultProps} />);
    fireEvent.click(screen.getByText("Rappel demandé"));
    expect(screen.getByTestId("has-default")).toBeDefined();
  });

  it("callback submit button is enabled immediately on flow entry (default pre-selected)", () => {
    render(<PostCallActionSheet {...defaultProps} />);
    fireEvent.click(screen.getByText("Rappel demandé"));
    const btn = screen.getByText("Planifier le rappel") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it("returns to option_select when the picker's way back is taken from the groups", () => {
    render(<PostCallActionSheet {...defaultProps} />);
    fireEvent.click(screen.getByText("Rejeté"));
    fireEvent.click(screen.getByText("Retour aux résultats"));
    expect(screen.getByText("Pas de réponse")).toBeDefined();
    expect(screen.queryByTestId("rejection-select")).toBeNull();
  });

  it("collapses callback picker when Rappel demandé is clicked again", () => {
    render(<PostCallActionSheet {...defaultProps} />);
    fireEvent.click(screen.getByText("Rappel demandé"));
    expect(screen.getByTestId("callback-picker")).toBeDefined();
    fireEvent.click(screen.getByText("Rappel demandé"));
    expect(screen.queryByTestId("callback-picker")).toBeNull();
  });

  describe("NOANSWER flow — attempt submission", () => {
    it("submits attempt via /no-answer on direct click and calls onSuccess on normal response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            auto_rejected: false,
            new_status: "attempt_2",
            attempts_count: 2,
          },
        }),
      });

      render(<PostCallActionSheet {...defaultProps} />);
      await act(async () => {
        fireEvent.click(screen.getByText("Pas de réponse"));
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/orders/order-1/no-answer",
        expect.objectContaining({ method: "POST" })
      );
      expect(defaultProps.onSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "attempt",
          newStatus: "attempt_2",
          autoRejected: false,
          attemptsCount: 2,
        })
      );
    });

    it("shows auto-reject message and calls onSuccess with autoRejected:true after delay", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            auto_rejected: true,
            new_status: "rejected",
            attempts_count: 3,
          },
        }),
      });

      render(<PostCallActionSheet {...defaultProps} />);
      await act(async () => {
        fireEvent.click(screen.getByText("Pas de réponse"));
      });

      await waitFor(() => {
        expect(
          screen.getByText(/Commande rejetée automatiquement/)
        ).toBeDefined();
      });

      // Advance real time past 1500ms delay
      await new Promise((r) => setTimeout(r, 1600));

      await waitFor(() => {
        expect(defaultProps.onSuccess).toHaveBeenCalledWith(
          expect.objectContaining({
            action: "attempt",
            newStatus: "rejected",
            autoRejected: true,
          })
        );
      });
    });
  });

  describe("CONFIRM flow — direct confirm", () => {
    it("Confirmé fires /confirm and flips to the carrier picker without an intermediate screen", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, new_status: "confirmed" }),
      });

      render(<PostCallActionSheet {...defaultProps} />);
      await act(async () => {
        fireEvent.click(screen.getByText("Confirmé"));
      });

      // No more "Confirmer" sub-button or "Confirmer + planifier livraison".
      expect(
        screen.queryByRole("button", { name: "Confirmer + planifier livraison" }),
      ).toBeNull();

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/orders/order-1/confirm",
        expect.objectContaining({ method: "POST" }),
      );

      // Sheet flips to the carrier picker; onSuccess fires only after the
      // agent picks an action there.
      await waitFor(() => {
        expect(screen.getByText("Choisir le transporteur")).toBeDefined();
      });
      expect(defaultProps.onSuccess).not.toHaveBeenCalled();
    });

    it("shows error and keeps modal open on confirm failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Transition not allowed" }),
      });

      render(<PostCallActionSheet {...defaultProps} />);
      await act(async () => {
        fireEvent.click(screen.getByText("Confirmé"));
      });

      await waitFor(() => {
        expect(screen.getByText("Transition not allowed")).toBeDefined();
      });
      expect(defaultProps.onSuccess).not.toHaveBeenCalled();
    });
  });

  describe("UPLOAD AFTER CONFIRM flow", () => {
    it("'Plus tard' closes the sheet with newStatus=confirmed (skip upload)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, new_status: "confirmed" }),
      });

      render(<PostCallActionSheet {...defaultProps} />);
      await act(async () => {
        fireEvent.click(screen.getByText("Confirmé"));
      });

      // After /confirm fires, the carrier picker step shows "Plus tard".
      await waitFor(() => {
        expect(screen.getByText("Plus tard")).toBeDefined();
      });

      await act(async () => {
        fireEvent.click(screen.getByText("Plus tard"));
      });

      expect(defaultProps.onSuccess).toHaveBeenCalledWith({
        action: "confirmed",
        newStatus: "confirmed",
      });
    });

    it("Darb Assabil upload opens the shared dispatch modal (service/area/options), not an inline send", async () => {
      // confirm → carriers (Darb only) → order detail (a Darb city) → pick Darb → upload.
      mockFetch.mockImplementation((url: string) => {
        if (url.includes("/confirm")) {
          return Promise.resolve({ ok: true, json: async () => ({ success: true, new_status: "confirmed" }) });
        }
        if (url.includes("/api/carriers")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ data: [{ id: "c-darb", name: "Darb Assabil", code: "darb_assabil", is_active: true }] }),
          });
        }
        if (url.includes("/api/orders/order-1")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ data: { customer_address: "شارع", customer_city: "طرابلس", dexpress_state_id: null } }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      });

      render(<PostCallActionSheet {...defaultProps} />);
      await act(async () => {
        fireEvent.click(screen.getByText("Confirmé"));
      });

      // Darb auto-selects as the only carrier; click "Envoyer maintenant".
      await waitFor(() => expect(screen.getByText("Envoyer maintenant")).toBeDefined());
      await act(async () => {
        fireEvent.click(screen.getByText("Envoyer maintenant"));
      });

      // The shared modal opens — the sheet did NOT POST /dispatch itself.
      await waitFor(() => expect(screen.getByTestId("darb-dispatch-modal")).toBeDefined());
      expect(mockFetch.mock.calls.some((c) => String(c[0]).includes("/dispatch"))).toBe(false);

      // The modal's success finalises the order as uploaded.
      await act(async () => {
        fireEvent.click(screen.getByText("Darb submit"));
      });
      expect(defaultProps.onSuccess).toHaveBeenCalledWith({
        action: "confirmed",
        newStatus: "uploaded",
      });
    });
  });

  describe("UPLOAD AFTER CONFIRM — carrier comparison ('meilleur choix')", () => {
    // Each test uses its OWN orderId/marketId so their SWR cache keys never
    // collide — the sheet has no SWRConfig cache reset between tests, and a
    // shared key ("order-1"/"market-1") would let one test's response bleed
    // into the next (SWR's module-level cache outlives a single it() block).
    function mockCarrierComparisonFlow(orderId: string) {
      mockFetch.mockImplementation((url: string) => {
        if (url.includes("/confirm")) {
          return Promise.resolve({ ok: true, json: async () => ({ success: true, new_status: "confirmed" }) });
        }
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
        if (url.includes(`/api/orders/${orderId}`)) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ data: { customer_address: "شارع", customer_city: "طرابلس", dexpress_state_id: null } }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      });
    }

    it("shows fee, delivery-rate and transit-time stats per carrier", async () => {
      const props = { ...defaultProps, orderId: "order-cmp-1", marketId: "market-cmp-1" };
      mockCarrierComparisonFlow(props.orderId);
      render(<PostCallActionSheet {...props} />);
      await act(async () => {
        fireEvent.click(screen.getByText("Confirmé"));
      });

      await waitFor(() => expect(screen.getByText("Darb Assabil — Benghazi")).toBeDefined());
      // Delivery rate is expressed as a percentage; transit time in days.
      expect(screen.getByText("78%")).toBeDefined();
      expect(screen.getByText("64%")).toBeDefined();
      expect(screen.getByText("2 j")).toBeDefined();
      expect(screen.getByText("3 j")).toBeDefined();
    });

    it("badges the carrier compareCarriers picks as 'meilleur choix', not just the cheapest", async () => {
      const props = { ...defaultProps, orderId: "order-cmp-2", marketId: "market-cmp-2" };
      mockCarrierComparisonFlow(props.orderId);
      render(<PostCallActionSheet {...props} />);
      await act(async () => {
        fireEvent.click(screen.getByText("Confirmé"));
      });

      await waitFor(() => expect(screen.getByText("Darb Assabil — Benghazi")).toBeDefined());
      // Benghazi (20 LYD/78%/2j) beats Tripoli (15 LYD/64%/3j) on the combined
      // score despite costing more — "meilleur choix" must land on it, not on
      // whichever account is merely cheapest.
      const benghaziCard = screen.getByText("Darb Assabil — Benghazi").closest("button")!;
      expect(benghaziCard.textContent).toContain("meilleur choix");
      const tripoliCard = screen.getByText("Darb Assabil — Tripoli").closest("button")!;
      expect(tripoliCard.textContent).not.toContain("meilleur choix");
    });

    it("shows 'tarif non relevé' for a carrier with no rate data instead of a stat row", async () => {
      const props = { ...defaultProps, orderId: "order-cmp-3", marketId: "market-cmp-3" };
      mockFetch.mockImplementation((url: string) => {
        if (url.includes("/confirm")) {
          return Promise.resolve({ ok: true, json: async () => ({ success: true, new_status: "confirmed" }) });
        }
        if (url.includes("/api/carriers/rates")) {
          return Promise.resolve({ ok: true, json: async () => ({ data: { recommended_carrier_id: null, reason: "", rates: [] } }) });
        }
        if (url.includes("/api/carriers/performance")) {
          return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
        }
        if (url.includes("/api/carriers")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ data: [{ id: "c-dexpress", name: "Dexpress", code: "dexpress", is_active: true }] }),
          });
        }
        if (url.includes(`/api/orders/${props.orderId}`)) {
          return Promise.resolve({ ok: true, json: async () => ({ data: { customer_address: "a", customer_city: "طرابلس", dexpress_state_id: 1 } }) });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      });
      render(<PostCallActionSheet {...props} />);
      await act(async () => {
        fireEvent.click(screen.getByText("Confirmé"));
      });

      await waitFor(() => expect(screen.getByText("Dexpress")).toBeDefined());
      expect(screen.getByText("tarif non relevé")).toBeDefined();
    });
  });

  describe("SCHEDULE AFTER CONFIRM — carrier re-selection", () => {
    it("pre-selects the carrier chosen in the previous step, labeled accordingly", async () => {
      const props = { ...defaultProps, orderId: "order-sched-1", marketId: "market-sched-1" };
      mockFetch.mockImplementation((url: string) => {
        if (url.includes("/confirm")) {
          return Promise.resolve({ ok: true, json: async () => ({ success: true, new_status: "confirmed" }) });
        }
        if (url.includes("/api/carriers/rates")) {
          return Promise.resolve({ ok: true, json: async () => ({ data: { recommended_carrier_id: null, reason: "", rates: [] } }) });
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
        if (url.includes(`/api/orders/${props.orderId}`)) {
          return Promise.resolve({ ok: true, json: async () => ({ data: { customer_address: "شارع", customer_city: "طرابلس", dexpress_state_id: null } }) });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      });

      render(<PostCallActionSheet {...props} />);
      await act(async () => {
        fireEvent.click(screen.getByText("Confirmé"));
      });
      await waitFor(() => expect(screen.getByText("Darb Assabil — Benghazi")).toBeDefined());

      // Agent explicitly picks Tripoli in step 1, then schedules instead.
      await act(async () => {
        fireEvent.click(screen.getByText("Darb Assabil — Tripoli"));
      });
      await act(async () => {
        fireEvent.click(screen.getByText("Programmer la livraison"));
      });

      // Tripoli carries into the schedule step, marked as the prior choice.
      await waitFor(() => expect(screen.getByText("choisi à l'étape précédente")).toBeDefined());
      const tripoliRadio = screen.getByText("Darb Assabil — Tripoli", { selector: "*" });
      expect(tripoliRadio).toBeDefined();
    });
  });

  describe("REJECT flow", () => {
    it("submits rejection and calls onSuccess", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { new_status: "rejected" } }),
      });

      render(<PostCallActionSheet {...defaultProps} />);
      await act(async () => {
        fireEvent.click(screen.getByText("Rejeté"));
      });
      // Mock RejectionReasonSelect calls onSelect("doublon")
      await act(async () => {
        fireEvent.click(screen.getByText("Doublon"));
      });
      // Now click the submit button (should be enabled now)
      await act(async () => {
        fireEvent.click(screen.getByText("Confirmer le rejet"));
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/orders/order-1/reject",
        expect.objectContaining({ method: "POST" })
      );
      expect(defaultProps.onSuccess).toHaveBeenCalledWith({
        action: "rejected",
        newStatus: "rejected",
      });
    });
  });

  describe("CALLBACK flow", () => {
    it("submits callback and calls onSuccess", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { new_status: "callback_scheduled" },
        }),
      });

      render(<PostCallActionSheet {...defaultProps} />);
      await act(async () => {
        fireEvent.click(screen.getByText("Rappel demandé"));
      });
      // Mock CallbackPicker calls onSelect → sets callbackTime
      await act(async () => {
        fireEvent.click(screen.getByText("Confirmer date"));
      });
      // Now click the submit button (should be enabled now)
      await act(async () => {
        fireEvent.click(screen.getByText("Planifier le rappel"));
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/orders/order-1/callback",
        expect.objectContaining({ method: "POST" })
      );
      expect(defaultProps.onSuccess).toHaveBeenCalledWith({
        action: "callback",
        newStatus: "callback_scheduled",
      });
    });
  });
});

describe("PostCallActionSheet — rejecting from a phone", () => {
  const openReject = (props: Partial<typeof defaultProps> & { attemptsCount?: number; maxAttempts?: number } = {}) => {
    const view = render(<PostCallActionSheet {...defaultProps} {...props} />);
    fireEvent.click(screen.getByText("Rejeté"));
    return view;
  };
  const submit = () =>
    screen.getByRole("button", { name: "Confirmer le rejet" }) as HTMLButtonElement;

  it("sits above the agent's bottom tab bar and the order panel", () => {
    // The phone tab bar is `fixed z-40` and is rendered AFTER the queue, so a
    // sheet at z-40 painted under it: the bar covered the sheet's last 60px,
    // which is exactly where « Confirmer le rejet » ends up, and a tap there
    // switched tabs instead of rejecting. The panel is z-50.
    render(<PostCallActionSheet {...defaultProps} />);
    let layer: HTMLElement | null = screen.getByRole("dialog");
    while (layer && !/\bfixed\b/.test(layer.className)) layer = layer.parentElement;
    const z = Number(layer?.className.match(/\bz-\[(\d+)\]/)?.[1] ?? 0);
    expect(z).toBeGreaterThan(50);
  });

  // The agent theme paints `bg-ink-primary` in its dark green — the colour of
  // « Confirmer » on the footer. The one button that kills an order must not
  // wear the colour of the one that saves it.
  it("wears the rejection's red, not the confirmation's green", () => {
    openReject();
    expect(submit().className).toMatch(/(^|\s)bg-oms-bad(\s|$)/);
    expect(submit().className).not.toMatch(/bg-ink-primary/);
  });

  it("keeps « Confirmer le rejet » outside the scrolling list, so it is always on screen", () => {
    openReject();
    expect(screen.getByTestId("sheet-body").contains(submit())).toBe(false);
    expect(screen.getByTestId("sheet-footer").contains(submit())).toBe(true);
  });

  it("submits a sub-reason the market added, which the compiled list has never heard of", async () => {
    // The button used to be gated on the COMPILED taxonomy while the picker
    // and the server both read the market's. A manager-added reason could be
    // picked and never sent.
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: { new_status: "rejected" } }) });
    openReject();
    fireEvent.click(screen.getByText("Promo concurrent"));
    expect(submit().disabled).toBe(false);

    await act(async () => {
      fireEvent.click(submit());
    });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body).toMatchObject({ rejection_reason: "refus_client", rejection_subreason: "promo_concurrent" });
  });

  it("disarms the submit when the picker withdraws its answer", () => {
    openReject();
    fireEvent.click(screen.getByText("Doublon"));
    expect(submit().disabled).toBe(false);

    fireEvent.click(screen.getByText("Retirer le motif"));
    expect(submit().disabled).toBe(true);
  });

  it("tells the picker which reason the ceiling pre-armed, so it is shown as chosen", () => {
    openReject({ attemptsCount: 3, maxAttempts: 3 });
    const picker = screen.getByTestId("rejection-select");
    expect(picker.getAttribute("data-default-group")).toBe("injoignable");
    expect(picker.getAttribute("data-default-sub")).toBe("pas_de_reponse");
    expect(submit().disabled).toBe(false);
  });

  // The phone path: the panel's « Refuser » opens the sheet straight on the
  // rejection, skipping the « Rejeté » card whose click used to do the arming.
  it("arms the ceiling's reason when opened straight on the rejection", () => {
    render(
      <PostCallActionSheet {...defaultProps} attemptsCount={3} maxAttempts={3} initialFlow="reject_flow" />,
    );
    expect(submit().disabled).toBe(false);
  });

  it("offers no « plus tard » at the ceiling, where the callback it leads to is gone", () => {
    openReject({ attemptsCount: 3, maxAttempts: 3 });
    expect(screen.queryByText("Plus tard")).toBeNull();
  });

  it("explains a refused rejection instead of calling it a network error", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: "Invalid rejection reason" }) });
    openReject();
    fireEvent.click(screen.getByText("Doublon"));
    await act(async () => {
      fireEvent.click(submit());
    });
    expect(screen.getByRole("alert").textContent).toContain("Refus non enregistré");
    expect(defaultProps.onSuccess).not.toHaveBeenCalled();
  });

  it("says the order is no longer the agent's when the server cannot find it for them", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ error: "Order not found" }) });
    openReject();
    fireEvent.click(screen.getByText("Doublon"));
    await act(async () => {
      fireEvent.click(submit());
    });
    expect(screen.getByRole("alert").textContent).toContain("Cette commande a été réattribuée");
  });

  it("holds the page behind it still while open", () => {
    // Without this, a drag that reaches the end of the sheet on iOS carries
    // on into the queue behind it.
    const view = render(<PostCallActionSheet {...defaultProps} />);
    expect(document.body.style.overflow).toBe("hidden");
    view.unmount();
    expect(document.body.style.overflow).toBe("");
  });
});

describe("PostCallActionSheet — scheduling a callback", () => {
  // At the ceiling the callback option and its picker are hidden. A pinned
  // submit must not survive them: it would schedule a +2h callback the agent
  // never saw or chose.
  it("offers no callback submit at the ceiling, where there is no picker to set it", () => {
    render(
      <PostCallActionSheet {...defaultProps} attemptsCount={3} maxAttempts={3} initialFlow="callback_expanded" />,
    );
    expect(screen.queryByTestId("callback-picker")).toBeNull();
    expect(screen.queryByRole("button", { name: "Planifier le rappel" })).toBeNull();
  });

  it("disarms « Planifier le rappel » when the picker says the time has passed", () => {
    // The picker printed « l'heure doit être future » while the button stayed
    // live with the previous valid time — submitting a time nobody could see.
    render(<PostCallActionSheet {...defaultProps} />);
    fireEvent.click(screen.getByText("Rappel demandé"));
    fireEvent.click(screen.getByText("Heure passée"));
    expect(
      (screen.getByRole("button", { name: "Planifier le rappel" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("submits the time the picker shows after it is re-opened, not an earlier pick", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: { new_status: "callback_scheduled" } }) });
    render(<PostCallActionSheet {...defaultProps} />);
    fireEvent.click(screen.getByText("Rappel demandé"));
    fireEvent.click(screen.getByText("Confirmer date"));
    fireEvent.click(screen.getByText("Rappel demandé")); // collapse
    fireEvent.click(screen.getByText("Rappel demandé")); // re-open: the picker shows a fresh default
    const shown = screen.getByTestId("shown-default").textContent;

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Planifier le rappel" }));
    });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.callback_time).toBe(shown);
  });
});


// Voix du client — « Garder aussi dans la voix du client » under an « Autre » rejection
// (prototype voix-du-client-agent-v2, screen ④).
vi.mock("@/hooks/useFeedback", () => ({
  useFeedbackTopics: () => [
    { id: "t-card", category: "objection", key: "card", label_fr: "Veut payer par carte ou virement", label_ar: "x", sort_order: 2 },
  ],
}));
vi.mock("@/components/feedback/FeedbackCaptureProvider", () => ({
  useFeedbackCapture: () => ({ enabled: true, captureOpen: false, openCapture: () => {}, register: () => () => {} }),
}));

describe("PostCallActionSheet — « Autre » keeps the note as the customer's words", () => {
  const rejectBody = () => {
    const call = mockFetch.mock.calls.find((c) => String(c[0]).endsWith("/reject"));
    return JSON.parse(call![1].body as string);
  };

  it("offers it, on by default, with the category the words suggest — and sends it", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ data: { new_status: "rejected" } }) });
    render(<PostCallActionSheet {...defaultProps} />);
    fireEvent.click(screen.getByText("Rejeté"));
    fireEvent.click(screen.getByText("Autre avec note"));
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Catégorie suggérée d'après les mots")).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByText("Confirmer le rejet")); });
    expect(rejectBody()).toMatchObject({
      rejection_reason: "autre",
      rejection_note: "قال اريد الدفع بالبطاقة",
      feedback: { category: "objection", topic_id: "t-card" },
    });
  });

  it("switched off, the rejection goes alone", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ data: { new_status: "rejected" } }) });
    render(<PostCallActionSheet {...defaultProps} />);
    fireEvent.click(screen.getByText("Rejeté"));
    fireEvent.click(screen.getByText("Autre avec note"));
    fireEvent.click(screen.getByRole("switch"));
    await act(async () => { fireEvent.click(screen.getByText("Confirmer le rejet")); });
    expect(rejectBody().feedback).toBeUndefined();
  });

  it("a structured reason never offers it", () => {
    render(<PostCallActionSheet {...defaultProps} />);
    fireEvent.click(screen.getByText("Rejeté"));
    fireEvent.click(screen.getByText("Doublon"));
    expect(screen.queryByRole("switch")).toBeNull();
  });
});
