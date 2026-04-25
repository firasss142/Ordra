import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import frMessages from "@/messages/fr.json";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    const resolve = (key: string, params?: Record<string, unknown>) => {
      const parts = namespace ? `${namespace}.${key}`.split(".") : key.split(".");
      let val: unknown = frMessages;
      for (const p of parts) val = (val as Record<string, unknown>)?.[p];
      if (typeof val !== "string") return key;
      if (params)
        return Object.entries(params).reduce(
          (s, [k, v]) => s.replace(`{${k}}`, String(v)),
          val
        );
      return val;
    };
    return resolve;
  },
}));

// Stub supabase browser client used by useUnassignedOrders realtime subscription
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel: () => ({
      on: function () {
        return this;
      },
      subscribe: () => ({}),
    }),
    removeChannel: () => {},
  }),
}));

// Mock the three hooks so we control data deterministically
const mutateOrders = vi.fn().mockResolvedValue(undefined);
const mutateAgents = vi.fn().mockResolvedValue(undefined);

const ORDERS = [
  {
    id: "o1",
    external_id: "x1",
    external_platform: "shopify",
    storefront_id: "sf-1",
    customer_name: "Alice",
    customer_phone: "+216",
    customer_city: "Tunis",
    customer_address: null,
    product_id: "p1",
    product_name: "Crème",
    variant_label: null,
    quantity: 1,
    total_price: 49,
    created_at: new Date(Date.now() - 10 * 60_000).toISOString(),
  },
  {
    id: "o2",
    external_id: "x2",
    external_platform: "woocommerce",
    storefront_id: "sf-2",
    customer_name: "Bob",
    customer_phone: "+216",
    customer_city: "Sfax",
    customer_address: null,
    product_id: "p1",
    product_name: "Crème",
    variant_label: null,
    quantity: 2,
    total_price: 98,
    created_at: new Date(Date.now() - 10 * 60_000).toISOString(),
  },
];

const AGENTS = [
  {
    id: "a1",
    full_name: "Agent One",
    avatar_url: null,
    is_active: true,
    last_seen_at: new Date(Date.now() - 60_000).toISOString(),
    last_action_at: null,
    queue_size: 2,
    confirmation_rate: 0.8,
    actioned_count: 40,
  },
];

vi.mock("@/hooks/useUnassignedOrders", () => ({
  useUnassignedOrders: () => ({
    orders: ORDERS,
    total: ORDERS.length,
    error: null,
    isLoading: false,
    mutate: mutateOrders,
  }),
}));

vi.mock("@/hooks/useAgentCapacity", () => ({
  useAgentCapacity: () => ({
    agents: AGENTS,
    error: null,
    isLoading: false,
    mutate: mutateAgents,
  }),
}));

vi.mock("@/hooks/useAssignmentRule", () => ({
  useAssignmentRule: () => ({
    rule: { algorithm: "manual", config: null, is_active: false },
    error: null,
    isLoading: false,
    mutate: vi.fn(),
    update: vi.fn().mockResolvedValue(undefined),
  }),
}));

import { AssignPageClient } from "./AssignPageClient";

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockReset();
});

describe("<AssignPageClient /> integration", () => {
  it("bulk-assigns selected orders to an agent via /api/orders/bulk-assign", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { assigned: 2, skipped: 0, errors: [] } }),
    });

    render(
      <AssignPageClient role="market_manager" marketId="m-tn" marketCode="TN" locale="fr" />
    );

    // Select both orders
    const checkboxes = screen.getAllByRole("checkbox");
    const orderCheckboxes = checkboxes.filter((c) =>
      (c.getAttribute("aria-label") ?? "").includes("Sélectionner la commande")
    );
    await user.click(orderCheckboxes[0]);
    await user.click(orderCheckboxes[1]);

    // Click the agent's Assigner (2) button
    const assignBtn = await screen.findByRole("button", { name: /Assigner \(2\)/ });
    await user.click(assignBtn);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/orders/bulk-assign",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"agent_id":"a1"'),
        })
      );
    });

    const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(calledBody.order_ids.sort()).toEqual(["o1", "o2"]);
    expect(mutateOrders).toHaveBeenCalled();
  });

  it("renders bucket sections for each age group that has orders", () => {
    render(
      <AssignPageClient role="market_manager" marketId="m-tn" marketCode="TN" locale="fr" />
    );
    // The 10-minute old orders land in "fresh" bucket
    expect(screen.getByText(/Fraîches/)).toBeTruthy();
  });
});
