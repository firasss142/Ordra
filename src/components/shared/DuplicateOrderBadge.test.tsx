import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import frMessages from "@/messages/fr.json";
import { DuplicateOrderBadge } from "./DuplicateOrderBadge";
import type { SiblingOrder } from "@/lib/duplicate-orders/detect";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    const resolve = (key: string, params?: Record<string, unknown>) => {
      const parts = namespace ? `${namespace}.${key}`.split(".") : key.split(".");
      let val: unknown = frMessages;
      for (const p of parts) val = (val as Record<string, unknown>)?.[p];
      if (typeof val !== "string") return key;
      if (params) {
        return Object.entries(params).reduce(
          (s, [k, v]) => s.replace(`{${k}}`, String(v)),
          val,
        );
      }
      return val;
    };
    return resolve;
  },
  useLocale: () => "fr",
}));

function sibling(o: Partial<SiblingOrder> = {}): SiblingOrder {
  return {
    id: "sib-1",
    external_id: "EXT-9",
    status: "uploaded",
    created_at: "2026-05-21T10:00:00Z",
    product_name: "T-Shirt",
    quantity: 1,
    already_shipped: true,
    ...o,
  };
}

describe("DuplicateOrderBadge", () => {
  it("renders nothing when count is 0", () => {
    const { container } = render(
      <DuplicateOrderBadge count={0} siblings={[]} hasUploadedSibling={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the duplicate label with the count", () => {
    render(
      <DuplicateOrderBadge
        count={2}
        siblings={[sibling({ id: "a" }), sibling({ id: "b" })]}
        hasUploadedSibling
      />,
    );
    expect(screen.getByText(/Doublon/)).toBeDefined();
    expect(screen.getByText(/2/)).toBeDefined();
  });

  it("sets a data-duplicate attribute on the badge", () => {
    const { container } = render(
      <DuplicateOrderBadge count={1} siblings={[sibling()]} hasUploadedSibling />,
    );
    expect(container.querySelector("[data-duplicate='true']")).not.toBeNull();
  });

  it("shows the 'already shipped' indicator on hover when a sibling is shipped", () => {
    const { container } = render(
      <DuplicateOrderBadge
        count={1}
        siblings={[sibling({ already_shipped: true })]}
        hasUploadedSibling
      />,
    );
    const trigger = container.querySelector("[data-duplicate='true']")!;
    fireEvent.mouseEnter(trigger.parentElement!);
    expect(screen.getByText(/Déjà envoyé au transporteur/)).toBeDefined();
  });

  it("does not show the 'already shipped' indicator when no sibling is shipped", () => {
    const { container } = render(
      <DuplicateOrderBadge
        count={1}
        siblings={[sibling({ already_shipped: false, status: "pending" })]}
        hasUploadedSibling={false}
      />,
    );
    const trigger = container.querySelector("[data-duplicate='true']")!;
    fireEvent.mouseEnter(trigger.parentElement!);
    expect(screen.queryByText(/Déjà envoyé au transporteur/)).toBeNull();
  });
});
