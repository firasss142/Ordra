import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ResolutionOutcomeModal } from "../ResolutionOutcomeModal";
import type { OrderFollowUpWithOrder } from "@/types/follow-up";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    const map: Record<string, string> = {
      "outcomes.converted": "Converti en commande",
      "outcomes.lost": "Perdu",
      "lostReasonLabel": "Raison",
      "lostReasons.faux_numero": "Faux numéro",
      "lostReasons.refus_prix": "Refus prix",
      "lostReasons.injoignable": "Injoignable",
      "lostReasons.autre": "Autre",
      "cancel": "Annuler",
      "save": "Confirmer",
    };
    return map[key] ?? key;
  },
}));

vi.mock("@/lib/format", () => ({
  formatCurrency: (v: number) => `${v} TND`,
}));

const followUp: OrderFollowUpWithOrder = {
  id: "fu-1",
  market_id: "mkt-1",
  order_id: "ord-1",
  status: "in_progress",
  campaign_id: null,
  delivery_man_phone: null,
  description: null,
  confirming_agent_id: "agent-1",
  resolved_at: null,
  due_at: null,
  resolution_outcome: null,
  created_by: null,
  created_at: "2024-06-15T08:00:00Z",
  updated_at: "2024-06-15T08:00:00Z",
  order: {
    id: "ord-1",
    customer_name: "Alice Martin",
    customer_phone: "0612345678",
    customer_city: "Tunis",
    total_price: 120,
    status: "confirmed",
    assigned_to: null,
  },
};

describe("ResolutionOutcomeModal", () => {
  it("shows outcome choice buttons when open", () => {
    render(
      <ResolutionOutcomeModal
        open={true}
        followUp={followUp}
        marketCode="TN"
        locale="fr"
        onClose={vi.fn()}
        onResolved={vi.fn()}
      />
    );
    expect(screen.getByText("Converti en commande")).toBeInTheDocument();
    expect(screen.getByText("Perdu")).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <ResolutionOutcomeModal
        open={false}
        followUp={followUp}
        marketCode="TN"
        locale="fr"
        onClose={vi.fn()}
        onResolved={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("selecting lost reveals reason selector", () => {
    render(
      <ResolutionOutcomeModal
        open={true}
        followUp={followUp}
        marketCode="TN"
        locale="fr"
        onClose={vi.fn()}
        onResolved={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText("Perdu"));
    expect(screen.getByText("Raison")).toBeInTheDocument();
    expect(screen.getByText("Faux numéro")).toBeInTheDocument();
  });

  it("confirm is disabled until lost reason selected", () => {
    render(
      <ResolutionOutcomeModal
        open={true}
        followUp={followUp}
        marketCode="TN"
        locale="fr"
        onClose={vi.fn()}
        onResolved={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText("Perdu"));
    const confirmBtn = screen.getByText("Confirmer");
    expect(confirmBtn).toBeDisabled();

    fireEvent.click(screen.getByText("Faux numéro"));
    expect(screen.getByText("Confirmer")).not.toBeDisabled();
  });

  it("calls onResolved with lost + reason on confirm", () => {
    const onResolved = vi.fn();
    render(
      <ResolutionOutcomeModal
        open={true}
        followUp={followUp}
        marketCode="TN"
        locale="fr"
        onClose={vi.fn()}
        onResolved={onResolved}
      />
    );
    fireEvent.click(screen.getByText("Perdu"));
    fireEvent.click(screen.getByText("Injoignable"));
    fireEvent.click(screen.getByText("Confirmer"));
    expect(onResolved).toHaveBeenCalledWith("lost", "injoignable", undefined);
  });

  it("calls onResolved with converted on confirm", () => {
    const onResolved = vi.fn();
    render(
      <ResolutionOutcomeModal
        open={true}
        followUp={followUp}
        marketCode="TN"
        locale="fr"
        onClose={vi.fn()}
        onResolved={onResolved}
      />
    );
    fireEvent.click(screen.getByText("Converti en commande"));
    fireEvent.click(screen.getByText("Confirmer"));
    expect(onResolved).toHaveBeenCalledWith("converted", undefined, undefined);
  });
});
