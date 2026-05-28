import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { ToastProvider, useToast } from "./Toast";

function Trigger({ tone, message }: { tone?: "info" | "warning" | "critical"; message: string }) {
  const toast = useToast();
  return (
    <button type="button" onClick={() => toast.show({ tone, message })}>
      Fire
    </button>
  );
}

describe("Toast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("show renders the toast message", () => {
    render(
      <ToastProvider>
        <Trigger message="Hello" />
      </ToastProvider>,
    );
    act(() => {
      screen.getByText("Fire").click();
    });
    expect(screen.getByText("Hello")).toBeDefined();
  });

  test("auto-dismisses after 5 seconds", () => {
    render(
      <ToastProvider>
        <Trigger message="Bye" />
      </ToastProvider>,
    );
    act(() => {
      screen.getByText("Fire").click();
    });
    expect(screen.queryByText("Bye")).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByText("Bye")).toBeNull();
  });

  test("uses role=status for info and warning", () => {
    render(
      <ToastProvider>
        <Trigger tone="warning" message="Warn" />
      </ToastProvider>,
    );
    act(() => {
      screen.getByText("Fire").click();
    });
    expect(screen.getByRole("status").textContent).toContain("Warn");
  });

  test("uses role=alert for critical", () => {
    render(
      <ToastProvider>
        <Trigger tone="critical" message="Crit" />
      </ToastProvider>,
    );
    act(() => {
      screen.getByText("Fire").click();
    });
    expect(screen.getByRole("alert").textContent).toContain("Crit");
  });

  test("Escape dismisses an open toast", () => {
    render(
      <ToastProvider>
        <Trigger message="Esc me" />
      </ToastProvider>,
    );
    act(() => {
      screen.getByText("Fire").click();
    });
    expect(screen.queryByText("Esc me")).not.toBeNull();
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(screen.queryByText("Esc me")).toBeNull();
  });

  test("useToast outside provider throws", () => {
    // The component does not wrap with ToastProvider — useToast must throw.
    expect(() => {
      const err = console.error;
      console.error = () => {};
      try {
        render(<Trigger message="x" />);
      } finally {
        console.error = err;
      }
    }).toThrow();
  });
});
