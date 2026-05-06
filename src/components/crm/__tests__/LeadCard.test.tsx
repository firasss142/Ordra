import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(messages, ns, key, params),
    useLocale: () => "fr",
  };
});

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { LeadCard } from "../LeadCard";
import type { Lead } from "@/types/lead";

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    market_id: "market-1",
    source: "manual_call",
    source_external_id: null,
    source_platform: null,
    status: "new",
    customer_name: "Alice",
    customer_phone: "+216 22 333 444",
    customer_city: "Tunis",
    customer_address: null,
    product_interest_id: null,
    product_interest_note: null,
    notes: null,
    assigned_to: null,
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
    ...overrides,
  };
}

const defaultCallbacks = {
  onCallback: vi.fn(),
  onMarkLost: vi.fn(),
  onReassign: vi.fn(),
};

describe("LeadCard", () => {
  it("renders customer name", () => {
    render(<LeadCard lead={makeLead()} locale="fr" {...defaultCallbacks} />);
    expect(screen.getByText("Alice")).toBeDefined();
  });

  it("renders campaign lead source", () => {
    render(
      <LeadCard lead={makeLead({ source: "campaign" })} locale="fr" {...defaultCallbacks} />
    );
    expect(screen.getByText("Campagne")).toBeDefined();
  });

  it("renders duplicate badge when has_duplicate=true", () => {
    render(
      <LeadCard lead={makeLead({ has_duplicate: true })} locale="fr" {...defaultCallbacks} />
    );
    expect(screen.getByText("Doublon")).toBeDefined();
  });

  it("does NOT render duplicate badge when has_duplicate=false", () => {
    render(
      <LeadCard lead={makeLead({ has_duplicate: false })} locale="fr" {...defaultCallbacks} />
    );
    expect(screen.queryByText("Doublon")).toBeNull();
  });

  it("renders hot badge when is_hot=true", () => {
    render(
      <LeadCard lead={makeLead({ is_hot: true })} locale="fr" {...defaultCallbacks} />
    );
    expect(screen.getByText("Chaud")).toBeDefined();
  });

  it("does NOT render hot badge when is_hot=false", () => {
    render(
      <LeadCard lead={makeLead({ is_hot: false })} locale="fr" {...defaultCallbacks} />
    );
    expect(screen.queryByText("Chaud")).toBeNull();
  });

  it("calls onMarkLost when mark lost button is clicked", () => {
    const onMarkLost = vi.fn();
    render(
      <LeadCard lead={makeLead()} locale="fr" {...defaultCallbacks} onMarkLost={onMarkLost} />
    );
    fireEvent.click(screen.getByRole("button", { name: /perdu/i }));
    expect(onMarkLost).toHaveBeenCalled();
  });

  it("calls onCallback when callback button is clicked", () => {
    const onCallback = vi.fn();
    render(
      <LeadCard lead={makeLead()} locale="fr" {...defaultCallbacks} onCallback={onCallback} />
    );
    fireEvent.click(screen.getByRole("button", { name: /rappel/i }));
    expect(onCallback).toHaveBeenCalled();
  });

  it("does not render a convert button on qualified cards", () => {
    render(
      <LeadCard lead={makeLead({ status: "qualified" })} locale="fr" {...defaultCallbacks} />
    );
    expect(screen.queryByRole("button", { name: /convertir/i })).toBeNull();
  });

  it("has call-now link with tel: href", () => {
    render(
      <LeadCard lead={makeLead({ customer_phone: "+21622333444" })} locale="fr" {...defaultCallbacks} />
    );
    const links = screen.getAllByRole("link", { name: /appeler/i });
    const telLink = links.find((l) => l.getAttribute("href")?.startsWith("tel:"));
    expect(telLink?.getAttribute("href")).toBe("tel:+21622333444");
  });
});
