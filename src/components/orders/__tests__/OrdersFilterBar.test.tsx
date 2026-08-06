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
  it("renders the search field with the reference hint", () => {
    renderBar();
    expect(screen.getByLabelText(/rechercher une commande/i)).toBeDefined();
  });

  it("no longer carries filter controls — those are named facets now", () => {
    // Status, agent, city, product, date and deleted-visibility all moved to
    // OrdersFacetBar, where each is a named control rather than a drawer.
    renderBar();
    expect(screen.queryByRole("button", { name: /plus de filtres/i })).toBeNull();
    expect(screen.queryByText(/^Avancé$/)).toBeNull();
  });
});
