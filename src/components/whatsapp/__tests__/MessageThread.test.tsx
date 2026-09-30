import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MessageThread } from "../MessageThread";
import type { MessageRow } from "@/lib/whatsapp/send";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const frMessages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) => resolveTranslation(frMessages, ns, key, params),
    useLocale: () => "fr",
  };
});

const today = new Date();
const yesterday = new Date(Date.now() - 86_400_000);
const at = (d: Date, h: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, 0, 0).toISOString();

const msg = (over: Partial<MessageRow>): MessageRow =>
  ({
    id: "m", market_id: "tn", conversation_id: "c", direction: "out", wamid: "w", phone_e164: "216", customer_id: null, order_id: "o", lead_id: null, campaign_id: null,
    template_id: null, event_key: null, kind: "text", language: "fr", body: "x", variables: null, media_id: null, media_link: null, media_mime: null, media_caption: null,
    context_wamid: null, status: "sent", sent_at: null, delivered_at: null, read_at: null, failed_at: null, error_code: null, error_title: null, error_detail: null,
    sent_by: null, actor_type: "agent", created_at: at(today, 10), updated_at: at(today, 10), ...over,
  }) as MessageRow;

const CONV = { id: "c", phone_e164: "21698765432", customer_id: null, current_order_id: "o", current_lead_id: null, profile_name: "Amel", last_inbound_at: null, last_outbound_at: null, unread_count: 0, opted_out_at: null, opt_out_text: null, undeliverable_at: null };

describe("MessageThread", () => {
  it("shows the empty state with its rule", () => {
    render(<MessageThread messages={[]} conversation={null} />);
    expect(screen.getByText("Aucun message avec ce client.")).toBeInTheDocument();
    expect(screen.getByText(/modèle approuvé/)).toBeInTheDocument();
  });

  it("renders bubbles with day separators, ticks, template heads and the reply", () => {
    render(
      <MessageThread
        conversation={CONV}
        messages={[
          msg({ id: "1", kind: "template", actor_type: "system", event_key: "shipped", status: "read", body: "Bonjour Amel, votre colis est en route.", created_at: at(yesterday, 9) }),
          msg({ id: "2", direction: "in", actor_type: "customer", status: "received", body: "Merci !", created_at: at(yesterday, 10) }),
          msg({ id: "3", kind: "template", actor_type: "agent", status: "delivered", body: "Le livreur a essayé…", created_at: at(today, 8) }),
          msg({ id: "4", status: "sent", body: "Je vous rappelle à 14h.", created_at: at(today, 9) }),
        ]}
      />,
    );
    expect(screen.getByText("Hier")).toBeInTheDocument();
    expect(screen.getByText("Aujourd'hui")).toBeInTheDocument();
    expect(screen.getByText("Automatique · Expédié")).toBeInTheDocument();
    expect(screen.getByText("Modèle")).toBeInTheDocument();
    expect(screen.getByLabelText("lu")).toBeInTheDocument();
    expect(screen.getByLabelText("remis")).toBeInTheDocument();
    expect(screen.getByLabelText("envoyé")).toBeInTheDocument();
    const inbound = screen.getByText("Merci !").closest("[data-dir]")!;
    expect(inbound).toHaveAttribute("data-dir", "in");
  });

  it("marks a failed send in red with Meta's code and offers a retry", async () => {
    const onRetry = vi.fn();
    const failed = msg({ id: "f", status: "failed", error_code: 131026, body: "Bonjour" });
    render(<MessageThread conversation={CONV} messages={[failed]} onRetry={onRetry} />);
    const row = screen.getByText("Bonjour").closest("[data-dir]") as HTMLElement;
    expect(row).toHaveAttribute("data-failed");
    expect(within(row).getByText(/Meta 131026/)).toBeInTheDocument();
    await userEvent.click(within(row).getByRole("button", { name: "Réessayer" }));
    expect(onRetry).toHaveBeenCalledWith(failed);
  });

  it("shows the opt-out as a system row and rings the unread inbound", () => {
    render(
      <MessageThread
        conversation={{ ...CONV, unread_count: 1, opted_out_at: at(today, 11), opt_out_text: "STOP" }}
        messages={[msg({ id: "a", body: "Bonjour" }), msg({ id: "b", direction: "in", actor_type: "customer", status: "received", body: "STOP", created_at: at(today, 11) })]}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/ne plus recevoir de messages/);
    expect(screen.getByText("STOP").closest("[data-dir]")).toHaveAttribute("data-new");
    expect(screen.getByText("Bonjour").closest("[data-dir]")).not.toHaveAttribute("data-new");
  });

  it("renders an image message with its caption and an unsupported one as such", () => {
    render(
      <MessageThread
        conversation={CONV}
        messages={[msg({ id: "i", kind: "image", media_link: "https://x/p.jpg", media_caption: "Sérum — 89 TND", body: null }), msg({ id: "u", direction: "in", kind: "unsupported", body: null, status: "received" })]}
      />,
    );
    expect(screen.getByRole("img", { name: "Image" })).toHaveAttribute("src", "https://x/p.jpg");
    expect(screen.getByText("Sérum — 89 TND")).toBeInTheDocument();
    expect(screen.getByText("Message non pris en charge")).toBeInTheDocument();
  });
});

describe("MessageThread — prototype fidelity (whatsapp-agent-v1.html)", () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

  it("names older days relatively (« Il y a 3 jours »), like the prototype's separators", () => {
    render(<MessageThread conversation={CONV} messages={[msg({ id: "1", created_at: at(daysAgo(3), 17) }), msg({ id: "2", created_at: at(today, 9) })]} />);
    expect(screen.getByText("Il y a 3 jours")).toBeInTheDocument();
    expect(screen.getByText("Aujourd'hui")).toBeInTheDocument();
  });

  it("signs an agent's message with their name, and leaves automatic sends unsigned", () => {
    render(
      <MessageThread
        conversation={CONV}
        messages={[
          msg({ id: "1", kind: "template", actor_type: "system", event_key: "shipped", body: "Auto", created_at: at(today, 8) }),
          msg({ id: "2", body: "Je vous rappelle", sent_by: "u-1", sent_by_name: "Tasnim", created_at: at(today, 9) }),
        ]}
      />,
    );
    const signed = screen.getByText("Je vous rappelle").closest("[data-dir]")!;
    expect(within(signed as HTMLElement).getByText("Tasnim")).toBeInTheDocument();
    const auto = screen.getByText("Auto").closest("[data-dir]")!;
    expect(within(auto as HTMLElement).queryByText("Tasnim")).not.toBeInTheDocument();
  });

  it("shows a sent image inside the bubble", () => {
    render(<MessageThread conversation={CONV} messages={[msg({ id: "1", kind: "image", media_link: "https://cdn.example/p.jpg", body: null, media_caption: "Coran Tadabbor — 249 LYD" })]} />);
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "https://cdn.example/p.jpg");
    expect(screen.getByText("Coran Tadabbor — 249 LYD")).toBeInTheDocument();
  });

  it("keeps the new-reply ring after the conversation is marked read", () => {
    const messages = [msg({ id: "1", body: "Bonjour", created_at: at(today, 9) }), msg({ id: "2", direction: "in", actor_type: "customer", status: "received", body: "Il arrive quand ?", created_at: at(today, 10) })];
    const { rerender } = render(<MessageThread conversation={{ ...CONV, unread_count: 1 }} messages={messages} />);
    expect(screen.getByText("Il arrive quand ?").closest("[data-dir]")).toHaveAttribute("data-new", "true");
    rerender(<MessageThread conversation={{ ...CONV, unread_count: 0 }} messages={messages} />);
    expect(screen.getByText("Il arrive quand ?").closest("[data-dir]")).toHaveAttribute("data-new", "true");
  });

  it("opens on the newest message", () => {
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy;
    render(<MessageThread conversation={CONV} messages={[msg({ id: "1", created_at: at(today, 9) }), msg({ id: "2", body: "dernier", created_at: at(today, 10) })]} />);
    expect(spy).toHaveBeenCalled();
  });

  it("dates the opt-out row with its time", () => {
    render(<MessageThread conversation={{ ...CONV, opted_out_at: new Date(2026, 8, 25, 10, 20).toISOString(), opt_out_text: "توقف" }} messages={[msg({ id: "1" })]} />);
    expect(screen.getByRole("status")).toHaveTextContent(/Le client a demandé à ne plus recevoir de messages · 25 sept\. 10:20/);
  });
});
