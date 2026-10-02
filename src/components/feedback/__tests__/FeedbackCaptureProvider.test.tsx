import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";

const undoFeedback = vi.fn();
vi.mock("@/hooks/useFeedback", () => ({ undoFeedback: (...a: unknown[]) => undoFeedback(...a) }));
vi.mock("@/context/market-scope", () => ({ useMarketScope: () => ({ marketId: null }) }));
vi.mock("swr", () => ({ useSWRConfig: () => ({ mutate: vi.fn() }) }));

// The window itself is tested on its own; here only what the provider hands it.
let lastProps: { orderId: string | null; onSaved: (s: unknown) => void; onClose: () => void } | null = null;
vi.mock("../CaptureDialog", () => ({
  CaptureDialog: (p: { orderId: string | null; onSaved: (s: unknown) => void; onClose: () => void }) => {
    lastProps = p;
    return <div role="dialog" aria-label="capture">{p.orderId ?? "blank"}</div>;
  },
}));

import { FeedbackCaptureProvider, useRegisterFeedbackContext, useFeedbackCapture } from "../FeedbackCaptureProvider";

function Panel({ orderId }: { orderId: string }) {
  useRegisterFeedbackContext(orderId);
  const { openCapture } = useFeedbackCapture();
  return <button type="button" onClick={() => openCapture()}>panel-button</button>;
}

function mount(children: React.ReactNode, role: "agent" | "warehouse_agent" = "agent") {
  return render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <FeedbackCaptureProvider role={role}>{children}<input aria-label="field" /></FeedbackCaptureProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  lastProps = null;
  undoFeedback.mockReset();
  undoFeedback.mockResolvedValue({ id: "fb1" });
});

describe("FeedbackCaptureProvider — the F key", () => {
  it("F opens the window on the order the panel registered — on any keyboard layout (e.code)", () => {
    mount(<Panel orderId="o-1" />);
    fireEvent.keyDown(document.body, { code: "KeyF", key: "ب" });
    expect(screen.getByRole("dialog", { name: "capture" })).toHaveTextContent("o-1");
  });

  it("with no order on screen, F opens the callback search", () => {
    mount(<div />);
    fireEvent.keyDown(document.body, { code: "KeyF", key: "f" });
    expect(screen.getByRole("dialog", { name: "capture" })).toHaveTextContent("blank");
  });

  it("F while typing, with a modifier, or under another dialog does nothing", () => {
    const { rerender } = mount(<div />);
    fireEvent.keyDown(screen.getByLabelText("field"), { code: "KeyF", key: "f" });
    fireEvent.keyDown(document.body, { code: "KeyF", key: "f", ctrlKey: true });
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(
      <NextIntlClientProvider locale="fr" messages={fr}>
        <FeedbackCaptureProvider role="agent"><div role="dialog" aria-modal="true" aria-label="call sheet" /></FeedbackCaptureProvider>
      </NextIntlClientProvider>,
    );
    fireEvent.keyDown(document.body, { code: "KeyF", key: "f" });
    expect(screen.queryByRole("dialog", { name: "capture" })).toBeNull();
  });

  it("the panel's button opens it too, and closing unregisters nothing", () => {
    mount(<Panel orderId="o-2" />);
    fireEvent.click(screen.getByRole("button", { name: "panel-button" }));
    expect(screen.getByRole("dialog", { name: "capture" })).toHaveTextContent("o-2");
    act(() => lastProps!.onClose());
    expect(screen.queryByRole("dialog", { name: "capture" })).toBeNull();
  });

  it("roles without capture get no shortcut", () => {
    mount(<div />, "warehouse_agent");
    fireEvent.keyDown(document.body, { code: "KeyF", key: "f" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("FeedbackCaptureProvider — « Enregistré · Annuler »", () => {
  it("after a save, a toast names the category and moment, and Annuler undoes it", async () => {
    mount(<div />);
    fireEvent.keyDown(document.body, { code: "KeyF", key: "f" });
    act(() => lastProps!.onSaved({ id: "fb1", category: "objection", moment: "transit" }));
    const toast = screen.getByRole("status");
    expect(toast).toHaveTextContent("Enregistré");
    expect(toast).toHaveTextContent("Objection");
    expect(toast).toHaveTextContent("En attente · en route");
    expect(screen.queryByRole("dialog", { name: "capture" })).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Annuler" })); });
    expect(undoFeedback).toHaveBeenCalledWith("fb1");
  });
});
