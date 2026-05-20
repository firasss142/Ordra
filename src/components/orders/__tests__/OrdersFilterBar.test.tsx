import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";

import { OrdersFilterBar } from "../OrdersFilterBar";
import { DEFAULT_FILTERS } from "@/lib/orders/list-filters";

vi.mock("@/hooks/useIsMobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(messages, ns, key, params),
  };
});

function renderBar(props: Partial<ComponentProps<typeof OrdersFilterBar>> = {}) {
  const onChange = vi.fn();
  render(
    <OrdersFilterBar
      filters={DEFAULT_FILTERS}
      onChange={onChange}
      onOpenAdvanced={vi.fn()}
      onNewOrder={vi.fn()}
      onExport={vi.fn()}
      marketLabel="Libya"
      {...props}
    />,
  );
  return { onChange };
}

describe("OrdersFilterBar", () => {
  it("toggles deleted order visibility", async () => {
    const user = userEvent.setup();
    const { onChange } = renderBar();

    await user.click(screen.getByLabelText("Afficher supprimées"));

    expect(onChange).toHaveBeenCalledWith({ includeDeleted: true });
  });

  it("can turn deleted order visibility off", async () => {
    const user = userEvent.setup();
    const { onChange } = renderBar({
      filters: { ...DEFAULT_FILTERS, includeDeleted: true },
    });

    await user.click(screen.getByLabelText("Afficher supprimées"));

    expect(onChange).toHaveBeenCalledWith({ includeDeleted: false });
  });
});
