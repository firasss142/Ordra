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
    defaultValue,
  }: {
    onSelect: (d: Date) => void;
    defaultValue?: Date;
  }) => (
    <div data-testid="callback-picker">
      {defaultValue && <span data-testid="has-default">has-default</span>}
      <button onClick={() => onSelect(new Date("2026-04-15T10:00:00.000Z"))}>
        Confirmer date
      </button>
    </div>
  ),
}));

vi.mock("../RejectionReasonSelect", () => ({
  RejectionReasonSelect: ({
    onSelect,
  }: {
    onSelect: (r: string, n?: string) => void;
  }) => (
    <div data-testid="rejection-select">
      <button onClick={() => onSelect("doublon")}>Doublon</button>
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

  it("Pas de réponse is a direct action — no date picker is shown to the agent", () => {
    render(<PostCallActionSheet {...defaultProps} />);
    // Server computes next retry slot from manager-configured preset times;
    // clicking should submit, not open an inline picker.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { auto_rejected: false, new_status: "callback_scheduled", attempts_count: 1, callback_at: "2026-04-18T14:00:00.000Z" } }),
    });
    fireEvent.click(screen.getByText("Pas de réponse"));
    // The callback-picker testid must NOT appear from the no-answer path.
    expect(screen.queryByTestId("callback-picker")).toBeNull();
  });

  it("switches to confirm flow when Confirmé is clicked", () => {
    render(<PostCallActionSheet {...defaultProps} />);
    fireEvent.click(screen.getByText("Confirmé"));
    expect(screen.getByText("← Retour")).toBeDefined();
    // New simplified confirm: shows confirm button, no carrier select
    expect(screen.queryByTestId("carrier-select")).toBeNull();
  });

  it("switches to reject flow when Rejeté is clicked", () => {
    render(<PostCallActionSheet {...defaultProps} />);
    fireEvent.click(screen.getByText("Rejeté"));
    expect(screen.getByTestId("rejection-select")).toBeDefined();
    expect(screen.getByText("← Retour")).toBeDefined();
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

  it("confirm flow shows confirmedHint text", () => {
    render(<PostCallActionSheet {...defaultProps} />);
    fireEvent.click(screen.getByText("Confirmé"));
    // The hint text from queue.confirmedHint should be visible
    expect(screen.getByText("← Retour")).toBeDefined();
  });

  it("returns to option_select when ← Retour is clicked from confirm flow", () => {
    render(<PostCallActionSheet {...defaultProps} />);
    fireEvent.click(screen.getByText("Confirmé"));
    fireEvent.click(screen.getByText("← Retour"));
    expect(screen.getByText("Pas de réponse")).toBeDefined();
  });

  it("returns to option_select when ← Retour is clicked from reject flow", () => {
    render(<PostCallActionSheet {...defaultProps} />);
    fireEvent.click(screen.getByText("Rejeté"));
    fireEvent.click(screen.getByText("← Retour"));
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
            new_status: "callback_scheduled",
            attempts_count: 2,
            callback_at: "2026-04-18T14:00:00.000Z",
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
          newStatus: "callback_scheduled",
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

    it("submits confirm and calls onSuccess with new_status confirmed", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          new_status: "confirmed",
        }),
      });

      render(<PostCallActionSheet {...defaultProps} />);
      await act(async () => {
        fireEvent.click(screen.getByText("Confirmé"));
      });
      // Click the confirm submit button
      await act(async () => {
        fireEvent.click(screen.getByText("Confirmé", { selector: "button" }));
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/orders/order-1/confirm",
        expect.objectContaining({ method: "POST" })
      );

      // Wait past the 1.2s delay before onSuccess is called
      await new Promise((r) => setTimeout(r, 1300));

      await waitFor(() => {
        expect(defaultProps.onSuccess).toHaveBeenCalledWith({
          action: "confirmed",
          newStatus: "confirmed",
        });
      });
    });

    it("shows error and keeps modal open on confirm failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          error: "Transition not allowed",
        }),
      });

      render(<PostCallActionSheet {...defaultProps} />);
      await act(async () => {
        fireEvent.click(screen.getByText("Confirmé"));
      });
      await act(async () => {
        fireEvent.click(screen.getByText("Confirmé", { selector: "button" }));
      });

      await waitFor(() => {
        expect(screen.getByText("Transition not allowed")).toBeDefined();
      });
      expect(defaultProps.onSuccess).not.toHaveBeenCalled();
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
