import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import frMessages from "@/messages/fr.json";
import arMessages from "@/messages/ar.json";
import { ConversationsList } from "../ConversationsList";
import type { InboxConversation } from "@/hooks/useOrphanConversations";

const intl = vi.hoisted(() => ({ messages: {} as Record<string, unknown> }));
vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) => resolveTranslation(intl.messages, ns, key, params),
    useLocale: () => "fr",
  };
});

const conv = (over: Partial<InboxConversation>): InboxConversation => ({
  id: "c", market_id: "ly", phone_e164: "218927710034", customer_id: null, current_order_id: null, current_lead_id: null, profile_name: "Fatma",
  last_inbound_at: new Date(Date.now() - 8 * 60_000).toISOString(), last_outbound_at: null, last_message_at: new Date(Date.now() - 8 * 60_000).toISOString(),
  last_message_preview: "السلام عليكم، بغيت نسأل على كتاب الحفظ الميسر متوفر؟", unread_count: 2, opted_out_at: null, opt_out_text: null, undeliverable_at: null, claimed_by: null, claimed_at: null, created_at: "x", ...over,
});

beforeEach(() => {
  intl.messages = frMessages as Record<string, unknown>;
});

describe("ConversationsList", () => {
  it("lists who, what, when and how many unread; a nameless number shows as the number", async () => {
    const onSelect = vi.fn();
    const onScope = vi.fn();
    render(
      <ConversationsList
        conversations={[conv({}), conv({ id: "c3", profile_name: null, phone_e164: "218945521180", last_message_preview: "؟", unread_count: 0, last_message_at: new Date(Date.now() - 26 * 3_600_000).toISOString() })]}
        selectedId={null}
        onSelect={onSelect}
        scope="orphans"
        onScope={onScope}
        counts={{ orphans: 3, all: 27 }}
        isLoading={false}
      />,
    );
    const first = screen.getByText("Fatma").closest("button")!;
    expect(within(first).getByText("il y a 8 min")).toBeInTheDocument();
    expect(within(first).getByText("2")).toBeInTheDocument();
    expect(within(first).getByText(/بغيت نسأل/)).toBeInTheDocument();
    expect(screen.getByText("+218 945521180")).toBeInTheDocument();
    await userEvent.click(first);
    expect(onSelect).toHaveBeenCalledWith("c");
    await userEvent.click(screen.getByRole("tab", { name: /Toutes/ }));
    expect(onScope).toHaveBeenCalledWith("all");
  });

  it("counts both tabs in grey pills, whichever is open", () => {
    render(<ConversationsList conversations={[]} selectedId={null} onSelect={vi.fn()} scope="all" onScope={vi.fn()} counts={{ orphans: 3, all: 27 }} isLoading={false} />);
    const orphans = screen.getByRole("tab", { name: /À rattacher/ });
    const all = screen.getByRole("tab", { name: /Toutes/ });
    expect(orphans).toHaveTextContent("À rattacher3");
    expect(all).toHaveTextContent("Toutes27");
    expect(within(orphans).getByText("3").className).toMatch(/bg-status-neutralBg/);
    expect(all).toHaveAttribute("aria-selected", "true");
  });

  it("says when there is nothing to attach", () => {
    render(<ConversationsList conversations={[]} selectedId={null} onSelect={vi.fn()} scope="orphans" onScope={vi.fn()} counts={{ orphans: 0, all: 0 }} isLoading={false} />);
    expect(screen.getByText("Aucune conversation à rattacher.")).toBeInTheDocument();
  });

  it("speaks Arabic", () => {
    intl.messages = arMessages as Record<string, unknown>;
    render(<ConversationsList conversations={[conv({})]} selectedId={null} onSelect={vi.fn()} scope="orphans" onScope={vi.fn()} counts={{ orphans: 1, all: 1 }} isLoading={false} />);
    expect(screen.getByRole("tab", { name: /للربط/ })).toBeInTheDocument();
    expect(screen.getByText("منذ 8 د")).toBeInTheDocument();
  });
});
