import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import frMessages from "@/messages/fr.json";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) => resolveTranslation(frMessages, ns, key, params),
    useLocale: () => "fr",
  };
});
const feedback = vi.hoisted(() => ({ createFeedback: vi.fn() }));
vi.mock("@/hooks/useFeedback", () => ({ createFeedback: feedback.createFeedback }));

import { WhoPanel } from "../WhoPanel";
import type { ThreadConversation, ThreadPayload } from "@/lib/whatsapp/thread";

/**
 * « Qui est-ce ? » — the panel proposes the order placed with this number,
 * hands the conversation over in one click (the existing claim), and keeps a
 * message that says something about our products in Voix du client. Fixture
 * numbers and names are fake.
 */
const LY = "00000000-0000-0000-0000-000000000002";
const CONV: ThreadConversation = {
  id: "c1",
  phone_e164: "218900000001",
  customer_id: null,
  current_order_id: null,
  current_lead_id: null,
  profile_name: "Test",
  last_inbound_at: new Date().toISOString(),
  last_outbound_at: null,
  unread_count: 0,
  opted_out_at: null,
  opt_out_text: null,
  undeliverable_at: null,
};
const msg = (id: string, direction: "in" | "out", body: string) => ({ id, direction, body, media_caption: null, created_at: new Date().toISOString() });
const THREAD = {
  conversation: CONV,
  messages: [msg("m1", "in", "le premier"), msg("m2", "out", "réponse"), msg("m3", "in", "la crème brûle un peu")],
  phone_e164: CONV.phone_e164,
  customer_language: null,
  window_open: true,
  window_closes_at: null,
  config_active: true,
  config_status: "active",
} as unknown as ThreadPayload;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let fetchMock: ReturnType<typeof vi.fn>;
function route(handlers: Record<string, (init?: RequestInit, url?: string) => Response>) {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    for (const [prefix, h] of Object.entries(handlers)) if (url.startsWith(prefix)) return h(init, url);
    return json({}, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
}
const ORDER = { id: "o-1", external_id: "50001", customer_name: "Test", customer_phone: "0900000001", customer_city: "Tripoli", status: "confirmed", created_at: new Date().toISOString() };

beforeEach(() => {
  vi.clearAllMocks();
  feedback.createFeedback.mockResolvedValue({ id: "f1" });
});
afterEach(() => vi.unstubAllGlobals());

function mount(over: Partial<React.ComponentProps<typeof WhoPanel>> = {}) {
  const props: React.ComponentProps<typeof WhoPanel> = {
    conversation: CONV,
    thread: THREAD,
    marketId: LY,
    isSuperAdmin: false,
    kept: false,
    attachedRef: null,
    onClaimed: vi.fn(),
    onKept: vi.fn(),
    onOpenOrder: vi.fn(),
    onOpenLead: vi.fn(),
    ...over,
  };
  render(<WhoPanel {...props} />);
  return props;
}

describe("WhoPanel", () => {
  it("looks the number up and proposes its order; « Confier à la commande » is the claim", async () => {
    route({
      "/api/whatsapp/claim-search": () => json({ data: { orders: [ORDER], leads: [] } }),
      "/api/whatsapp/conversations/c1/claim": () => json({ data: { backfilled: 3 } }),
    });
    const props = mount();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/whatsapp/claim-search?market_id=" + LY + "&q=900000001")));
    expect(await screen.findByText("A déjà commandé avec ce numéro")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Confier à la commande #50001" }));
    const call = fetchMock.mock.calls.find((c) => String(c[0]) === "/api/whatsapp/conversations/c1/claim")!;
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ order_id: "o-1" });
    await waitFor(() => expect(props.onClaimed).toHaveBeenCalledWith("#50001"));
  });

  it("once handed over, the green box says to which order", () => {
    route({ "/api/whatsapp/claim-search": () => json({ data: { orders: [], leads: [] } }) });
    mount({ conversation: { ...CONV, current_order_id: "o-1" }, attachedRef: "#50001" });
    expect(screen.getByText("Confiée à la commande #50001. Elle quitte « À confier ».")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Confier à la commande/ })).not.toBeInTheDocument();
  });

  it("no order on the number: says so and offers « Créer un prospect »", async () => {
    route({ "/api/whatsapp/claim-search": () => json({ data: { orders: [], leads: [] } }) });
    mount();
    expect(await screen.findByText("Ce numéro n'a jamais commandé ni répondu à une campagne.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Créer un prospect" })).toBeInTheDocument();
  });

  it("« Garder dans Voix du client » keeps the last customer message as a WhatsApp suggestion", async () => {
    route({ "/api/whatsapp/claim-search": () => json({ data: { orders: [ORDER], leads: [] } }) });
    const props = mount({ isSuperAdmin: true });
    await screen.findByText("A déjà commandé avec ce numéro");
    await userEvent.click(screen.getByRole("button", { name: "Garder dans Voix du client" }));
    expect(feedback.createFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ category: "suggestion", body: "la crème brûle un peu", order_id: "o-1", source: "whatsapp", market_id: LY }),
    );
    await waitFor(() => expect(props.onKept).toHaveBeenCalled());
  });

  it("kept: the done box replaces the button", () => {
    route({ "/api/whatsapp/claim-search": () => json({ data: { orders: [], leads: [] } }) });
    mount({ kept: true });
    expect(screen.getByText("Gardé dans Voix du client · Suggestion")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Garder dans Voix du client" })).not.toBeInTheDocument();
  });
});
