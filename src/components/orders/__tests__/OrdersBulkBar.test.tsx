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
  onUpload: vi.fn(),
  onReopen: vi.fn(),
  canAssign: true,
  canCancel: true,
  canUpload: true,
  canReopen: true,
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

  it("shows the Uploader button when canUpload and fires onUpload", async () => {
    const user = userEvent.setup();
    const onUpload = vi.fn();
    render(<OrdersBulkBar {...defaultProps} onUpload={onUpload} />);
    const upload = screen.getByRole("button", { name: /uploader/i });
    await user.click(upload);
    expect(onUpload).toHaveBeenCalledTimes(1);
  });

  it("hides the Uploader button when canUpload is false", () => {
    render(<OrdersBulkBar {...defaultProps} canUpload={false} />);
    expect(screen.queryByRole("button", { name: /uploader/i })).not.toBeInTheDocument();
  });
});
