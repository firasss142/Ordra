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

import { InboxComposer } from "../InboxComposer";
import type { ThreadPayload } from "@/lib/whatsapp/thread";

/**
 * The bottom of the inbox thread: free text while the customer's window is
 * open (same send route as everywhere), « Envoyer un modèle » once it closed.
 */
const conv = { id: "c1", phone_e164: "218900000001", customer_id: null, current_order_id: null, current_lead_id: null, profile_name: null, last_inbound_at: null, last_outbound_at: null, unread_count: 0, opted_out_at: null, opt_out_text: null, undeliverable_at: null };
const thread = (over: Partial<ThreadPayload> = {}): ThreadPayload => ({
  conversation: conv,
  messages: [],
  phone_e164: conv.phone_e164,
  customer_language: null,
  window_open: true,
  window_closes_at: null,
  config_active: true,
  config_status: "active",
  ...over,
});

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { id: "m9" } }), { status: 201 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("InboxComposer", () => {
  it("window open: the reply goes out as free text in the market's language", async () => {
    const onThreadChanged = vi.fn();
    render(<InboxComposer conversationId="c1" thread={thread()} templates={[]} marketCode="ly" onThreadChanged={onThreadChanged} />);
    await userEvent.type(screen.getByRole("textbox", { name: "Répondre au client…" }), "نعم متوفر");
    await userEvent.click(screen.getByRole("button", { name: "Envoyer" }));
    const call = fetchMock.mock.calls.find((c) => String(c[0]) === "/api/whatsapp/send")!;
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ target: { conversation_id: "c1" }, language: "ar", mode: "text", text: "نعم متوفر" });
    await waitFor(() => expect(onThreadChanged).toHaveBeenCalled());
    expect(screen.getByRole("textbox", { name: "Répondre au client…" })).toHaveValue("");
  });

  it("a refused send says why", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "window_closed" }), { status: 409 }));
    render(<InboxComposer conversationId="c1" thread={thread()} templates={[]} marketCode="ly" onThreadChanged={vi.fn()} />);
    await userEvent.type(screen.getByRole("textbox", { name: "Répondre au client…" }), "x");
    await userEvent.click(screen.getByRole("button", { name: "Envoyer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Non envoyé/);
  });

  it("window closed: the bar, and « Envoyer un modèle » opens the template composer", async () => {
    render(<InboxComposer conversationId="c1" thread={thread({ window_open: false })} templates={[]} marketCode="tn" onThreadChanged={vi.fn()} />);
    expect(screen.getByText("Plus de 24 h depuis le dernier message du client.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Envoyer un modèle" }));
    expect(screen.getByTestId("whatsapp-composer")).toBeInTheDocument();
  });

  it("not connected: the shared composer's brake, no reply box", () => {
    render(<InboxComposer conversationId="c1" thread={thread({ config_active: false })} templates={[]} marketCode="tn" onThreadChanged={vi.fn()} />);
    expect(screen.getByTestId("whatsapp-composer-banner")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Envoyer" })).not.toBeInTheDocument();
  });
});
