import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { Sheet } from "./Sheet";

afterEach(() => {
  // Sheet locks body scroll while open; reset between tests.
  document.body.style.overflow = "";
});

function getPanel() {
  return screen.getByRole("dialog");
}

describe("Sheet", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <Sheet open={false} onClose={() => {}}>
        <div>content</div>
      </Sheet>,
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(screen.queryByText("content")).toBeNull();
  });

  it("renders children in a dialog when open", () => {
    render(
      <Sheet open onClose={() => {}} ariaLabel="Details">
        <div>content</div>
      </Sheet>,
    );
    expect(screen.getByText("content")).toBeDefined();
    expect(getPanel().getAttribute("aria-modal")).toBe("true");
  });

  it("end placement docks to the inline-end edge as a full-height drawer", () => {
    render(
      <Sheet open onClose={() => {}} placement="end" ariaLabel="Drawer">
        x
      </Sheet>,
    );
    const cls = getPanel().className;
    expect(cls).toMatch(/end-0/);
    expect(cls).toMatch(/h-full/);
    expect(cls).toMatch(/top-0/);
  });

  it("bottom placement anchors to the bottom edge with rounded top corners", () => {
    render(
      <Sheet open onClose={() => {}} placement="bottom" ariaLabel="Sheet">
        x
      </Sheet>,
    );
    const cls = getPanel().className;
    expect(cls).toMatch(/bottom-0/);
    expect(cls).toMatch(/inset-x-0/);
    // Rounded top corners — the bottom-sheet signature.
    expect(cls).toMatch(/rounded-t-/);
    // Capped height so it never covers the whole viewport.
    expect(cls).toMatch(/max-h-/);
    // Slides up from the bottom, not in from the side.
    expect(cls).toMatch(/slideInBottom/);
  });

  it("bottom placement shows a grab-handle affordance", () => {
    render(
      <Sheet open onClose={() => {}} placement="bottom" ariaLabel="Sheet">
        x
      </Sheet>,
    );
    expect(screen.getByTestId("sheet-grab-handle")).toBeDefined();
  });

  it("does not render a grab handle for end placement", () => {
    render(
      <Sheet open onClose={() => {}} placement="end" ariaLabel="Drawer">
        x
      </Sheet>,
    );
    expect(screen.queryByTestId("sheet-grab-handle")).toBeNull();
  });

  it("closes on overlay click (bottom placement)", () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} placement="bottom" ariaLabel="Sheet">
        x
      </Sheet>,
    );
    const overlay = document.querySelector('[aria-hidden="true"].fixed.inset-0');
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape (bottom placement)", () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} placement="bottom" ariaLabel="Sheet">
        x
      </Sheet>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("locks body scroll while open and restores on unmount", () => {
    const { unmount } = render(
      <Sheet open onClose={() => {}} placement="bottom" ariaLabel="Sheet">
        x
      </Sheet>,
    );
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).not.toBe("hidden");
  });
});
