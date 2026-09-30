import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";

let thread: Record<string, unknown> | null = null;
vi.mock("@/hooks/useWhatsAppThread", () => ({
  useWhatsAppThread: () => ({ thread, unread: 0, isLoading: false, error: null, mutate: vi.fn(), markRead: vi.fn(), retry: vi.fn() }),
}));

import { DeliveryMessages } from "../DeliveryMessages";

const mount = () =>
  render(
    <NextIntlClientProvider locale="fr" messages={fr} timeZone="Africa/Tripoli">
      <DeliveryMessages orderId="o1" marketId="m" onOpenSheet={vi.fn()} />
    </NextIntlClientProvider>,
  );

/** Owner decision 2026-09-25: not connected is shown, not hidden. */
describe("DeliveryMessages", () => {
  it("not connected and nothing said yet: one line that says why, and the WhatsApp mark", () => {
    thread = { conversation: null, messages: [], phone_e164: "218914456677", customer_language: null, window_open: false, window_closes_at: null, config_active: false, config_status: null };
    const { container } = mount();
    expect(screen.getByText("WhatsApp n'est pas connecté pour ce marché")).toBeInTheDocument();
    expect(container.querySelector('[data-icon="whatsapp"]')).not.toBeNull();
  });
});
