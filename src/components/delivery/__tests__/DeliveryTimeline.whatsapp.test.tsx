import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";

vi.mock("@/hooks/useDeliveryTimeline", () => ({
  useDeliveryTimeline: () => ({
    timeline: [{ id: "w1", source: "action", at: "2026-09-25T10:31:00Z", kind: "whatsapp_customer", text: null, outcome: "sent", actor: "Tasnim", mine: false, template_key: "before_delivery" }],
    isLoading: false,
    error: null,
  }),
}));

import { DeliveryTimeline } from "../DeliveryTimeline";

/** Prototype whatsapp-agent-v1.html, /delivery aside: « WhatsApp · Avant livraison ✓✓ — Aujourd'hui 10:31 · Tasnim ». */
describe("DeliveryTimeline — a WhatsApp action names its template", () => {
  it("titles the entry « WhatsApp · {modèle} »", () => {
    render(
      <NextIntlClientProvider locale="fr" messages={fr} timeZone="Africa/Tripoli">
        <DeliveryTimeline orderId="o1" locale="fr" tz="Africa/Tripoli" now={Date.parse("2026-09-25T11:00:00Z")} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("WhatsApp · Avant livraison")).toBeInTheDocument();
  });

  it("the newest WhatsApp entry carries the message's live status", () => {
    render(
      <NextIntlClientProvider locale="fr" messages={fr} timeZone="Africa/Tripoli">
        <DeliveryTimeline orderId="o1" locale="fr" tz="Africa/Tripoli" now={Date.parse("2026-09-25T11:00:00Z")} waStatus="read" />
      </NextIntlClientProvider>,
    );
    const title = screen.getByText("WhatsApp · Avant livraison");
    expect(title.closest("li")!.querySelector('[data-status="read"]')).not.toBeNull();
  });
});
