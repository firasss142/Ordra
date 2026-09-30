import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentNotification } from "@/hooks/useAgentNotifications";

/**
 * Prototype whatsapp-agent-v1.html, state `unread`: the bell's WhatsApp row is
 * its own kind of row — a green tile with the WhatsApp mark, « {client} a
 * répondu sur WhatsApp », the customer's words as the sub-line, and how long
 * ago; the badge turns WhatsApp green; the row opens the order on Messages.
 */
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("swr", () => ({ default: () => ({ data: undefined }) }));
vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const fr = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) => resolveTranslation(fr, ns, key, params),
    useLocale: () => "fr",
  };
});

let notifications: AgentNotification[] = [];
vi.mock("@/hooks/useAgentNotifications", () => ({
  useAgentNotifications: () => ({ notifications, unreadCount: notifications.filter((n) => !n.read_at).length, markRead: vi.fn(), markAllRead: vi.fn() }),
}));

import { NotificationBell } from "../NotificationBell";

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

afterEach(() => {
  notifications = [];
  push.mockClear();
});

describe("NotificationBell — WhatsApp reply", () => {
  it("renders the WhatsApp row like the prototype and opens the order on Messages", () => {
    notifications = [
      { id: "n-wa", order_id: "o-2", kind: "whatsapp_inbound", due_at: minutesAgo(2), read_at: null, created_at: minutesAgo(2), order: { customer_name: "Mahmoud Senoussi", product_name: "Coran", variant_label: null }, excerpt: "تمام، شكراً. لو ممكن يتصل قبل ما يوصل" },
      { id: "n-cb", order_id: "o-3", kind: "callback_due", due_at: minutesAgo(25), read_at: null, created_at: minutesAgo(25), order: { customer_name: "Habib", product_name: "Livre", variant_label: null } },
    ];
    render(<NotificationBell agentId="agent-1" />);

    const bell = screen.getByRole("button", { name: "Notifications" });
    expect(bell.querySelector("[data-badge]")).toHaveAttribute("data-kind", "whatsapp_inbound");
    fireEvent.click(bell);

    const row = screen.getByTestId("notif-whatsapp");
    expect(row).toHaveTextContent("Mahmoud Senoussi a répondu sur WhatsApp");
    expect(row).toHaveTextContent("تمام، شكراً. لو ممكن يتصل قبل ما يوصل");
    expect(row).toHaveTextContent("il y a 2 min");
    expect(row).not.toHaveTextContent("dû il y a");
    expect(row.querySelector('[data-icon="whatsapp"]')).not.toBeNull();

    fireEvent.click(row);
    expect(push).toHaveBeenCalledWith("/fr/queue?openOrderId=o-2&tab=messages");
  });
});
