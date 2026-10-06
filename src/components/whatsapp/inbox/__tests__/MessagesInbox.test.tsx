import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import frMessages from "@/messages/fr.json";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) => resolveTranslation(frMessages, ns, key, params),
    useLocale: () => "fr",
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("swr", () => ({ default: () => ({ data: undefined, mutate: vi.fn() }) }));
vi.mock("@/hooks/useWhatsAppTemplates", () => ({ useWhatsAppTemplates: () => ({ templates: [], isLoading: false, mutate: vi.fn() }) }));

import { MessagesInbox } from "../MessagesInbox";
import type { InboxConversation } from "@/hooks/useOrphanConversations";

/**
 * The list column of the inbox: « À confier · Non lus · Toutes » with their
 * counts, the search over the loaded rows, and the oldest waiting customer on
 * top. Fixture numbers are fake.
 */
const LY = "00000000-0000-0000-0000-000000000002";
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const conv = (id: string, over: Partial<InboxConversation> = {}): InboxConversation => ({
  id,
  market_id: LY,
  phone_e164: "218900000000",
  customer_id: null,
  current_order_id: null,
  current_lead_id: null,
  profile_name: null,
  last_inbound_at: ago(30),
  last_outbound_at: null,
  last_message_at: ago(30),
  last_message_preview: "…",
  unread_count: 0,
  opted_out_at: null,
  opt_out_text: null,
  undeliverable_at: null,
  claimed_by: null,
  claimed_at: null,
  created_at: ago(60),
  ...over,
});

const ROWS = [
  conv("a", { profile_name: "Amal", phone_e164: "218911111111", last_message_preview: "متى يصل الطلب؟", unread_count: 1, last_inbound_at: ago(22), last_message_at: ago(22) }),
  conv("b", { profile_name: "Badr", phone_e164: "218922222222", last_message_preview: "شكراً", unread_count: 2, last_inbound_at: ago(180), last_message_at: ago(180) }),
  conv("c", { profile_name: "Chiraz", phone_e164: "218933333333", current_order_id: "o-1", last_message_preview: "ok", last_inbound_at: ago(60 * 30), last_message_at: ago(5) }),
];

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { orders: [], leads: [] } }), { status: 200 })));
});
afterEach(() => vi.unstubAllGlobals());

function mount(rows = ROWS) {
  return render(
    <MessagesInbox marketId={LY} marketCode="ly" locale="fr" isSuperAdmin={false} conversations={rows} counts={{ orphans: 2, all: 3 }} isLoading={false} onChanged={vi.fn()} />,
  );
}

const listNames = () => within(screen.getByTestId("inbox-list")).getAllByTestId("cv-name").map((n) => n.textContent);

describe("MessagesInbox", () => {
  it("counts each tab: to hand over (server), unread (loaded rows), all (server)", () => {
    mount();
    expect(screen.getByRole("tab", { name: /À confier/ })).toHaveTextContent("2");
    expect(screen.getByRole("tab", { name: /Non lus/ })).toHaveTextContent("2");
    expect(screen.getByRole("tab", { name: /Toutes/ })).toHaveTextContent("3");
  });

  it("« À confier » lists only unclaimed conversations, the oldest waiting customer first", () => {
    mount();
    expect(listNames()).toEqual(["Badr", "Amal"]);
  });

  it("« Toutes » adds the handed-over ones, tagged « Confiée »; a closed window says so", async () => {
    mount();
    await userEvent.click(screen.getByRole("tab", { name: /Toutes/ }));
    expect(listNames()).toEqual(["Badr", "Amal", "Chiraz"]);
    const row = screen.getAllByTestId("cv").find((r) => r.textContent?.includes("Chiraz"))!;
    expect(within(row).getByText("Confiée")).toBeInTheDocument();
    expect(within(row).getByText("fenêtre fermée")).toBeInTheDocument();
  });

  it("an unread customer reads « attend · … » with the unread badge", () => {
    mount();
    const row = screen.getAllByTestId("cv").find((r) => r.textContent?.includes("Amal"))!;
    expect(within(row).getByText(/attend · /)).toHaveClass("wait");
    expect(within(row).getByText("1")).toBeInTheDocument();
  });

  it("the search filters by name or number", async () => {
    mount();
    await userEvent.click(screen.getByRole("tab", { name: /Toutes/ }));
    await userEvent.type(screen.getByPlaceholderText("Nom ou numéro…"), "933");
    expect(listNames()).toEqual(["Chiraz"]);
    await userEvent.clear(screen.getByPlaceholderText("Nom ou numéro…"));
    await userEvent.type(screen.getByPlaceholderText("Nom ou numéro…"), "amal");
    expect(listNames()).toEqual(["Amal"]);
  });

  it("opens on the first conversation and marks it read", async () => {
    mount();
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/whatsapp/conversations/b/read", { method: "POST" }));
  });

  it("selecting a row opens it in the thread column", async () => {
    mount();
    await userEvent.click(screen.getAllByTestId("cv").find((r) => r.textContent?.includes("Amal"))!);
    expect(within(screen.getByTestId("inbox-thread")).getByRole("heading", { name: "Amal" })).toBeInTheDocument();
  });
});
