import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import frMessages from "@/messages/fr.json";
import arMessages from "@/messages/ar.json";

const intl = vi.hoisted(() => ({ messages: {} as Record<string, unknown>, locale: "fr" }));
vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) => resolveTranslation(intl.messages, ns, key, params),
    useLocale: () => intl.locale,
  };
});
const swrMutate = vi.fn();
const threadState: { current: unknown } = { current: null };
vi.mock("swr", () => ({ default: () => ({ data: threadState.current, mutate: swrMutate }) }));
vi.mock("@/hooks/useWhatsAppTemplates", () => ({ useWhatsAppTemplates: () => ({ templates: [], isLoading: false, mutate: vi.fn() }) }));

import { ConversationDrawer } from "../ConversationDrawer";

/**
 * One conversation of Clients › Messages (prototype `messages`): the thread,
 * the reply box open on free text while the customer's window is open, and
 * « Rattacher à » — which shows the market's recent live orders and open
 * prospects before anything is typed.
 */
const LY = "00000000-0000-0000-0000-000000000002";
const CONV = { id: "c1", phone_e164: "218927710034", customer_id: null, current_order_id: null, current_lead_id: null, profile_name: "Fatma", last_inbound_at: new Date(Date.now() - 3_600_000).toISOString(), last_outbound_at: null, unread_count: 2, opted_out_at: null, opt_out_text: null, undeliverable_at: null };
const MSG = { id: "m1", market_id: LY, conversation_id: "c1", direction: "in", wamid: "w", phone_e164: "218927710034", customer_id: null, order_id: null, lead_id: null, campaign_id: null, template_id: null, event_key: null, kind: "text", language: null, body: "السلام عليكم", variables: null, media_id: null, media_link: null, media_mime: null, media_caption: null, context_wamid: null, status: "received", sent_at: null, delivered_at: null, read_at: null, failed_at: null, error_code: null, error_title: null, error_detail: null, sent_by: null, actor_type: "customer", created_at: new Date().toISOString(), updated_at: new Date().toISOString() };

const RECENT = {
  orders: [{ id: "o-39470", external_id: "39470", customer_name: "ام الحارث", customer_phone: "0935897986", customer_city: "الكفرة", status: "pending" }],
  leads: [{ id: "l-7", customer_name: "سعاد الفيتوري", customer_phone: "0911234567", customer_city: "طرابلس", status: "new", campaign_id: "camp-1", campaign_name: "Sérum · clients 60–120 j" }],
  recent: true,
};

function fetchRouter(handlers: Record<string, (init?: RequestInit, url?: string) => Response | Promise<Response>>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    for (const [prefix, h] of Object.entries(handlers)) if (url.startsWith(prefix)) return h(init, url);
    return new Response(JSON.stringify({}), { status: 404 });
  });
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  vi.clearAllMocks();
  intl.messages = frMessages as Record<string, unknown>;
  intl.locale = "fr";
  threadState.current = {
    data: { conversation: CONV, messages: [MSG], phone_e164: "218927710034", customer_language: null, window_open: true, window_closes_at: new Date(Date.now() + 23 * 3_600_000).toISOString(), config_active: true, config_status: "active" },
  };
});
afterEach(() => vi.unstubAllGlobals());

function mount() {
  return render(<ConversationDrawer conversationId="c1" marketId={LY} marketCode="ly" locale="fr" onChanged={vi.fn()} />);
}

describe("ConversationDrawer", () => {
  it("marks the thread read on open, and opens straight on the reply box while the window is open", async () => {
    const fetchMock = fetchRouter({
      "/api/whatsapp/conversations/c1/read": () => json({ data: { cleared: 1 } }),
      "/api/whatsapp/claim-search": () => json({ data: { orders: [], leads: [], recent: true } }),
      "/api/whatsapp/send": () => json({ data: { id: "m2" } }, 201),
    });
    vi.stubGlobal("fetch", fetchMock);
    mount();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/whatsapp/conversations/c1/read", { method: "POST" }));
    expect(screen.getByText("السلام عليكم")).toBeInTheDocument();
    const box = await screen.findByRole("textbox", { name: "Texte libre" });
    expect(box).toHaveAttribute("placeholder", "Répondre au client…");
    await userEvent.type(box, "نعم متوفر");
    await userEvent.click(screen.getByRole("button", { name: "Envoyer" }));
    const sendCall = fetchMock.mock.calls.find((c) => String(c[0]) === "/api/whatsapp/send")!;
    expect(JSON.parse((sendCall[1] as RequestInit).body as string)).toMatchObject({ target: { conversation_id: "c1" }, language: "ar", mode: "text", text: "نعم متوفر" });
  });

  it("the header puts the name at the start and the number at the end", () => {
    vi.stubGlobal("fetch", fetchRouter({ "/api/whatsapp/claim-search": () => json({ data: { orders: [], leads: [] } }) }));
    mount();
    const header = screen.getByTestId("conversation-header");
    const heading = within(header).getByRole("heading", { name: "Fatma" });
    const phone = within(header).getByText("+218 927710034");
    expect(heading.compareDocumentPosition(phone) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(phone.className).toMatch(/ms-auto/);
  });

  it("shows the market's recent live orders and open prospects before anything is typed", async () => {
    const fetchMock = fetchRouter({
      "/api/whatsapp/conversations/c1/read": () => json({ data: { cleared: 1 } }),
      "/api/whatsapp/claim-search": () => json({ data: RECENT }),
    });
    vi.stubGlobal("fetch", fetchMock);
    mount();
    expect(await screen.findByText(/#39470/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => String(c[0]) === `/api/whatsapp/claim-search?market_id=${LY}&q=`)).toBe(true);
    // The order's status in words, the prospect's campaign by name.
    expect(screen.getByText("commande · En attente · 0935897986")).toBeInTheDocument();
    expect(screen.getByText("prospect · Sérum · clients 60–120 j")).toBeInTheDocument();
    expect(screen.getAllByText("Rattacher à").length).toBeGreaterThanOrEqual(3);
  });

  it("searches and attaches to an order through the claim route", async () => {
    const onChanged = vi.fn();
    const fetchMock = fetchRouter({
      "/api/whatsapp/conversations/c1/read": () => json({ data: { cleared: 1 } }),
      "/api/whatsapp/claim-search": (_init, url) =>
        json({ data: url?.endsWith("q=") ? { orders: [], leads: [] } : { orders: RECENT.orders, leads: [] } }),
      "/api/whatsapp/conversations/c1/claim": () => json({ data: { backfilled: 2, order_id: "o-39470", lead_id: null } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ConversationDrawer conversationId="c1" marketId={LY} marketCode="ly" locale="fr" onChanged={onChanged} />);
    await userEvent.type(screen.getByRole("textbox", { name: "Rattacher à" }), "ام");
    const result = await screen.findByText(/#39470/);
    await userEvent.click(result.closest("button")!);
    await waitFor(() => {
      const claim = fetchMock.mock.calls.find((c) => String(c[0]) === "/api/whatsapp/conversations/c1/claim");
      expect(claim).toBeTruthy();
      expect(JSON.parse((claim![1] as RequestInit).body as string)).toEqual({ order_id: "o-39470" });
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it("creates a prospect from the number and attaches to it", async () => {
    const fetchMock = fetchRouter({
      "/api/whatsapp/conversations/c1/read": () => json({ data: { cleared: 1 } }),
      "/api/whatsapp/claim-search": () => json({ data: { orders: [], leads: [] } }),
      "/api/leads": () => json({ data: { id: "l-new" } }, 201),
      "/api/whatsapp/conversations/c1/claim": () => json({ data: { backfilled: 1, order_id: null, lead_id: "l-new" } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    mount();
    await userEvent.click(screen.getByRole("button", { name: /Créer un prospect/ }));
    await waitFor(() => {
      const lead = fetchMock.mock.calls.find((c) => String(c[0]) === "/api/leads")!;
      expect(JSON.parse((lead[1] as RequestInit).body as string)).toMatchObject({ market_id: LY, customer_name: "Fatma", customer_phone: "218927710034", source: "whatsapp" });
      const claim = fetchMock.mock.calls.find((c) => String(c[0]) === "/api/whatsapp/conversations/c1/claim")!;
      expect(JSON.parse((claim[1] as RequestInit).body as string)).toEqual({ lead_id: "l-new" });
    });
  });

  it("hides the attach block once the conversation is anchored, and links to the order", () => {
    threadState.current = { data: { ...(threadState.current as { data: object }).data, conversation: { ...CONV, unread_count: 0, current_order_id: "o-1" } } };
    vi.stubGlobal("fetch", vi.fn());
    const onOpenOrder = vi.fn();
    render(<ConversationDrawer conversationId="c1" marketId={LY} marketCode="ly" locale="fr" onChanged={vi.fn()} onOpenOrder={onOpenOrder} />);
    expect(screen.queryByRole("textbox", { name: "Rattacher à" })).not.toBeInTheDocument();
    screen.getByRole("button", { name: /Rattachée à une commande/ }).click();
    expect(onOpenOrder).toHaveBeenCalledWith("o-1");
  });

  it("speaks Arabic: the attach block and the order status", async () => {
    intl.messages = arMessages as Record<string, unknown>;
    intl.locale = "ar";
    vi.stubGlobal("fetch", fetchRouter({ "/api/whatsapp/claim-search": () => json({ data: RECENT }) }));
    mount();
    expect(await screen.findByText("طلب · قيد الانتظار · 0935897986")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "ربط بـ" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /إنشاء عميل محتمل/ })).toBeInTheDocument();
  });
});
