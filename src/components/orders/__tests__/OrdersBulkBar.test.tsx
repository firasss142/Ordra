import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { OrdersBulkBar } from "../OrdersBulkBar";

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

const defaultProps = {
  selectedIds: ["o-1", "o-2"],
  agents: [],
  onClearSelection: vi.fn(),
  onBulkAssign: vi.fn(),
  onBulkCancel: vi.fn(),
  canAssign: true,
  canCancel: true,
};

describe("OrdersBulkBar", () => {
  it("disables bulk Annuler when the selection has ineligible orders", async () => {
    const user = userEvent.setup();
    const onBulkCancel = vi.fn();
    render(
      <OrdersBulkBar
        {...defaultProps}
        onBulkCancel={onBulkCancel}
        cancelDisabled
        cancelDisabledReason="Certaines commandes sélectionnées ne peuvent pas être supprimées."
      />,
    );

    const cancel = screen.getByRole("button", { name: /annuler/i });
    expect(cancel).toBeDisabled();
    await user.click(cancel);
    expect(onBulkCancel).not.toHaveBeenCalled();
  });
});
