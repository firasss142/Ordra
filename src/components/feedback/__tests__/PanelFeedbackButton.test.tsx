import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";

const openCapture = vi.fn();
let open = 0;
vi.mock("@/hooks/useFeedback", () => ({
  useFeedbackContext: () => ({ context: { history: { count: 3, open } } }),
}));
vi.mock("../FeedbackCaptureProvider", () => ({
  useFeedbackCapture: () => ({ openCapture, captureOpen: false }),
}));

import { PanelFeedbackButton } from "../PanelFeedbackButton";

const mount = () =>
  render(<NextIntlClientProvider locale="fr" messages={fr}><PanelFeedbackButton orderId="o-1" /></NextIntlClientProvider>);

describe("PanelFeedbackButton", () => {
  it("opens the capture window on this order", () => {
    open = 0;
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Voix du client/ }));
    expect(openCapture).toHaveBeenCalledWith("o-1");
  });

  it("carries the customer's open complaints as a red count", () => {
    open = 1;
    mount();
    expect(screen.getByRole("button", { name: /Voix du client/ })).toHaveTextContent("1");
    expect(screen.getByLabelText("1 réclamation ouverte")).toBeInTheDocument();
  });

  it("no count when nothing is open", () => {
    open = 0;
    mount();
    expect(screen.queryByLabelText(/réclamation ouverte/)).toBeNull();
  });
});
