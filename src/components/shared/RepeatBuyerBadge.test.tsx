import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import frMessages from "@/messages/fr.json";
import { RepeatBuyerBadge } from "./RepeatBuyerBadge";

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

vi.mock("@/hooks/useCustomerHistory", () => ({
  useCustomerHistory: () => ({ detail: null, isLoading: false, error: null }),
}));

describe("RepeatBuyerBadge", () => {
  const baseProps = {
    source: "order" as const,
    sourceId: "order-1",
    priorOrderCount: 0,
    priorLeadCount: 0,
    priorRejectedCount: 0,
    currencyCode: "LBY",
  };

  it("renders nothing for repeat_kind='none'", () => {
    const { container } = render(
      <RepeatBuyerBadge {...baseProps} repeatKind="none" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the count for repeat_kind='repeat'", () => {
    render(
      <RepeatBuyerBadge
        {...baseProps}
        repeatKind="repeat"
        priorOrderCount={3}
      />,
    );
    expect(screen.getByText(/3/)).toBeDefined();
    expect(screen.getByText(/Récurrent/)).toBeDefined();
  });

  it("renders 'likely' label for repeat_kind='likely'", () => {
    render(
      <RepeatBuyerBadge
        {...baseProps}
        repeatKind="likely"
        priorOrderCount={2}
      />,
    );
    expect(screen.getByText(/Probablement/)).toBeDefined();
  });

  it("renders rejected count and critical tone for repeat_kind='risk'", () => {
    const { container } = render(
      <RepeatBuyerBadge
        {...baseProps}
        repeatKind="risk"
        priorOrderCount={3}
        priorRejectedCount={2}
      />,
    );
    const badge = container.querySelector("[data-repeat-kind='risk']");
    expect(badge).not.toBeNull();
    expect(screen.getByText(/Risque/)).toBeDefined();
    expect(screen.getByText(/2/)).toBeDefined();
  });

  it("includes a data-repeat-kind attribute matching the kind", () => {
    const { container } = render(
      <RepeatBuyerBadge {...baseProps} repeatKind="repeat" priorOrderCount={1} />,
    );
    expect(
      container.querySelector("[data-repeat-kind='repeat']"),
    ).not.toBeNull();
  });
});
