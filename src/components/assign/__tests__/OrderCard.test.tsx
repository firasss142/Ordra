import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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

import { OrderCard } from "../OrderCard";
import type { UnassignedOrder } from "@/hooks/useUnassignedOrders";

const NOW = new Date("2026-04-24T12:00:00Z");

function makeOrder(overrides: Partial<UnassignedOrder> = {}): UnassignedOrder {
  return {
    id: "o1",
    external_id: "ext-1",
    external_platform: "shopify",
    storefront_id: "sf-1",
    customer_name: "Alice Ben",
    customer_phone: "+216...",
    customer_city: "Tunis",
    customer_address: null,
    product_id: "p1",
    product_name: "Crème",
    variant_label: null,
    quantity: 1,
    total_price: 49,
    created_at: new Date(NOW.getTime() - 10 * 60_000).toISOString(), // 10m ago → fresh
    ...overrides,
  };
}

describe("<OrderCard />", () => {
  it("renders customer + city + product + platform badge", () => {
    render(
      <OrderCard
        order={makeOrder()}
        selected={false}
        onToggle={() => {}}
        marketCode="TN"
        now={NOW}
      />
    );
    expect(screen.getByText("Alice Ben")).toBeTruthy();
    expect(screen.getByText(/Tunis/)).toBeTruthy();
    expect(screen.getByText("shopify")).toBeTruthy();
  });

  it("shows short age label for a fresh order", () => {
    render(
      <OrderCard
        order={makeOrder()}
        selected={false}
        onToggle={() => {}}
        marketCode="TN"
        now={NOW}
      />
    );
    expect(screen.getByText("10m")).toBeTruthy();
  });

  it("calls onToggle when checkbox clicked", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <OrderCard
        order={makeOrder()}
        selected={false}
        onToggle={onToggle}
        marketCode="TN"
        now={NOW}
      />
    );
    await user.click(screen.getByRole("checkbox"));
    expect(onToggle).toHaveBeenCalledWith("o1");
  });

  it("shows critical bucket age label for >4h old order", () => {
    const old = makeOrder({
      created_at: new Date(NOW.getTime() - 5 * 60 * 60_000).toISOString(),
    });
    render(
      <OrderCard order={old} selected={false} onToggle={() => {}} marketCode="TN" now={NOW} />
    );
    expect(screen.getByText("5h")).toBeTruthy();
  });
});
