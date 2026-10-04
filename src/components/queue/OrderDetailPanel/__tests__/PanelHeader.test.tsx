import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/messages/fr.json";
import { PanelHeader } from "../PanelHeader";

// 10:13 market time in Tunis (UTC+1) — the order came in at 07:00 the same day.
const NOW = new Date("2026-08-14T09:13:00.000Z");
const CREATED = "2026-08-14T06:00:00.000Z";
const TN = "tn-market";

function renderHeader(overrides: Partial<React.ComponentProps<typeof PanelHeader>> = {}) {
  const onClose = vi.fn();
  render(
    <NextIntlClientProvider locale="fr" messages={messages} timeZone="UTC">
      <PanelHeader
        reference="41250"
        marketId={TN}
        createdAt={CREATED}
        pill={{ status: "pending" }}
        maxAttempts={3}
        rejection={() => null}
        locale="fr"
        slaMinutes={120}
        now={NOW}
        saveFlash={null}
        onClose={onClose}
        {...overrides}
      />
    </NextIntlClientProvider>,
  );
  return { onClose };
}

describe("PanelHeader — the top line (prototype .dr-top)", () => {
  it("leads with the status pill, in words", () => {
    renderHeader();
    expect(screen.getByText("En attente").closest(".pl")).not.toBeNull();
  });

  it("counts a call attempt against the market's maximum", () => {
    renderHeader({ pill: { status: "attempt_2", attempts_count: 2 } });
    expect(screen.getByText("Appel 2/3")).toBeInTheDocument();
  });

  it("says when the order came in", () => {
    renderHeader();
    expect(screen.getByTestId("panel-received")).toHaveTextContent(/^reçue aujourd'hui \d\d:\d\d$/);
  });

  it("shows the late chip only once the order is past the market's target", () => {
    renderHeader();
    expect(screen.getByTestId("panel-sla")).toHaveTextContent("en retard · délai 2 h");
  });

  it("stays quiet while the order is within its target", () => {
    renderHeader({ createdAt: "2026-08-14T09:00:00.000Z" });
    expect(screen.queryByTestId("panel-sla")).toBeNull();
  });

  it("never calls an order late once nobody owes it a call", () => {
    renderHeader({ pill: { status: "delivered" } });
    expect(screen.queryByTestId("panel-sla")).toBeNull();
  });

  it("shows the reference whole when it is a storefront number", () => {
    renderHeader();
    expect(screen.getByRole("button", { name: /copier la référence/i })).toHaveTextContent("#41250");
  });

  it("shows only the tail of a UUID", () => {
    renderHeader({ reference: "8f0c2a4e-1111-4bbb-9ccc-0d3e5f6a7b21" });
    expect(screen.getByRole("button", { name: /copier la référence/i })).toHaveTextContent("#…6a7b21");
  });

  it("copies the whole reference, not the truncated form", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderHeader({ reference: "8f0c2a4e-1111-4bbb-9ccc-0d3e5f6a7b21" });
    fireEvent.click(screen.getByRole("button", { name: /copier la référence/i }));
    expect(writeText).toHaveBeenCalledWith("8f0c2a4e-1111-4bbb-9ccc-0d3e5f6a7b21");
  });

  it("closes", () => {
    const { onClose } = renderHeader();
    fireEvent.click(screen.getByRole("button", { name: "Fermer" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("puts the « Voix du client » slot after the reference, before the close button", () => {
    renderHeader({ feedbackSlot: <button type="button">fbk</button> });
    const buttons = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label") || b.textContent);
    const fbk = buttons.indexOf("fbk");
    expect(fbk).toBeGreaterThan(-1);
    expect(buttons[fbk + 1]).toBe("Fermer");
  });

  it("still names a carrier reference that was pulled back", () => {
    renderHeader({ carrierDeletedChip: { label: "dexpress annulé", tooltip: "x" } });
    expect(screen.getByText("dexpress annulé")).toBeInTheDocument();
  });
});
