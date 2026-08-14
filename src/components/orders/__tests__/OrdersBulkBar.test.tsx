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

  it("stays mounted but hidden with no selection, so it can animate out", () => {
    // Unmounting on an empty selection makes the exit a disappearance. It stays
    // in the tree, transparent and untabbable, and fades itself out.
    render(<OrdersBulkBar {...defaultProps} selectedIds={[]} />);
    const bar = screen.getByRole("toolbar", { hidden: true });

    expect(bar).toHaveAttribute("data-visible", "false");
    expect(bar).toHaveAttribute("aria-hidden", "true");
    expect(bar.style.opacity).toBe("0");
    expect(bar.style.visibility).toBe("hidden");
    expect(bar.style.pointerEvents).toBe("none");
  });

  it("holds the last count through the exit instead of flashing zero", () => {
    const { rerender } = render(<OrdersBulkBar {...defaultProps} />);
    expect(screen.getByRole("toolbar")).toHaveTextContent("2");

    // The selection is already empty while the bar is still on screen fading.
    rerender(<OrdersBulkBar {...defaultProps} selectedIds={[]} />);

    expect(screen.getByRole("toolbar", { hidden: true })).toHaveTextContent("2");
  });

  it("is a centred pill rather than a full-width band", () => {
    // Spanning the page read as a section of the layout instead of as a
    // response to the selection, and buried the bar below the fold.
    render(<OrdersBulkBar {...defaultProps} />);
    const bar = screen.getByRole("toolbar");

    expect(bar.className).toMatch(/\bfixed\b/);
    expect(bar.className).toMatch(/left-1\/2/);
    expect(bar.className).not.toMatch(/\bw-full\b/);
    // Centring lives in the transform, alongside the entrance offset.
    expect(bar.style.transform).toContain("translateX(-50%)");
  });

  it("animates on both opacity and transform", () => {
    render(<OrdersBulkBar {...defaultProps} />);
    const bar = screen.getByRole("toolbar");
    expect(bar.style.transition).toMatch(/opacity/);
    expect(bar.style.transition).toMatch(/transform/);
    expect(bar.style.opacity).toBe("1");
  });

  it("opens the assign menu upward, since the bar sits at the viewport bottom", async () => {
    const user = userEvent.setup();
    render(
      <OrdersBulkBar {...defaultProps} agents={[{ id: "a1", full_name: "tasnim" }]} />,
    );

    await user.click(screen.getByRole("button", { name: /assigner/i }));
    const menu = screen.getByRole("listbox");

    // Hanging below the trigger would put the menu off the bottom of the screen.
    expect(menu.className).toMatch(/bottom-\[/);
    expect(menu.className).not.toMatch(/top-\[/);
  });

  it("closes the assign menu when the selection is cleared", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <OrdersBulkBar {...defaultProps} agents={[{ id: "a1", full_name: "tasnim" }]} />,
    );

    await user.click(screen.getByRole("button", { name: /assigner/i }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    rerender(
      <OrdersBulkBar {...defaultProps} agents={[{ id: "a1", full_name: "tasnim" }]} selectedIds={[]} />,
    );

    // A menu left open on a bar that is fading out would hang in mid-air.
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("still reports how many are selected", () => {
    render(<OrdersBulkBar {...defaultProps} />);
    expect(screen.getByRole("toolbar")).toHaveTextContent("2");
  });
});
