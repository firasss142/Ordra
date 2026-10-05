import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { SWRConfig } from "swr";
import fr from "@/messages/fr.json";
import type { QueueOrder } from "@/types/queue";
import { CallResultSheet } from "../CallResultSheet";

vi.mock("next/dynamic", () => ({ default: () => () => null }));

const LY = "00000000-0000-0000-0000-000000000002";
type Call = { url: string; body: unknown };
let calls: Call[] = [];
const routes: Record<string, { status: number; body: unknown }> = {};

const REASONS = [
  { id: "g1", market_id: LY, key: "refus_client", parent_key: null, label_fr: "Refus client", label_ar: "رفض", short_fr: "Refus", short_ar: "رفض", sort_order: 1, is_active: true, requires_note: false },
  { id: "s1", market_id: LY, key: "prix_eleve", parent_key: "refus_client", label_fr: "Prix trop élevé", label_ar: "سعر", short_fr: "Prix", short_ar: "سعر", sort_order: 1, is_active: true, requires_note: false },
  { id: "g2", market_id: LY, key: "injoignable", parent_key: null, label_fr: "Injoignable", label_ar: "x", short_fr: "x", short_ar: "x", sort_order: 2, is_active: true, requires_note: false },
  { id: "s2", market_id: LY, key: "pas_de_reponse", parent_key: "injoignable", label_fr: "Ne répond pas", label_ar: "x", short_fr: "x", short_ar: "x", sort_order: 1, is_active: true, requires_note: false },
  { id: "g3", market_id: LY, key: "autre", parent_key: null, label_fr: "Autre", label_ar: "x", short_fr: "x", short_ar: "x", sort_order: 9, is_active: true, requires_note: true },
];

const order = (over: Partial<QueueOrder> = {}): QueueOrder =>
  ({
    id: "o-1",
    status: "attempt_1",
    customer_name: "Ali Ben Salem",
    customer_phone: "0912345678",
    customer_city: "Tripoli",
    product_name: "Kitab",
    product_display_name: "Livre Tadabbur",
    product_image_url: null,
    quantity: 1,
    total_price: 120,
    currency: "LYD",
    market_id: LY,
    attempt_count: 1,
    is_potential_duplicate: false,
    duplicate_siblings: [],
    ...over,
  }) as QueueOrder;

beforeEach(() => {
  calls = [];
  for (const k of Object.keys(routes)) delete routes[k];
  routes["/api/settings/rejection-reasons"] = { status: 200, body: { data: REASONS } };
  routes["/api/carriers?"] = { status: 200, body: { data: [{ id: "c-1", name: "Vanex", code: "vanex", is_active: true }] } };
  routes["/api/carriers/rates"] = { status: 200, body: { data: { recommended_carrier_id: "c-1", reason: "", rates: [{ carrier_id: "c-1", quoted_fee: 25, quote_usable: true, true_cost_per_delivered: null, effective_cost: null, is_cheapest: true }] } } };
  routes["/api/carriers/performance"] = { status: 200, body: { data: [{ carrier_id: "c-1", delivery_rate_30d: 0.54, median_transit_hours: 50, sample_size: 40 }] } };
  routes["/api/orders/o-1"] = { status: 200, body: { data: { customer_city: "Tripoli", customer_address: null, dexpress_state_id: null, darb_destination_id: null, total_price: 120 } } };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const key = Object.keys(routes)
        .sort((a, b) => b.length - a.length)
        .find((k) => url.startsWith(k));
      const r = key ? routes[key] : { status: 200, body: { data: {} } };
      return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function mount(o: QueueOrder, extra: { initialStep?: "reject" | "callback" | "send" | "schedule"; maxAttempts?: number } = {}) {
  const onDone = vi.fn();
  const onClose = vi.fn();
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <NextIntlClientProvider locale="fr" messages={fr} timeZone="Africa/Tripoli">
        <div className="agt">
          <CallResultSheet order={o} maxAttempts={extra.maxAttempts ?? 3} marketId={LY} initialStep={extra.initialStep} onClose={onClose} onDone={onDone} />
        </div>
      </NextIntlClientProvider>
    </SWRConfig>,
  );
  return { onDone, onClose };
}
const posted = (path: string) => calls.filter((c) => c.url === path);

describe("CallResultSheet — « Résultat de l'appel » on a phone", () => {
  it("shows the title, « Tentative n/3 », the order echo and the four endings with the footnote", () => {
    mount(order());
    const sheet = screen.getByRole("dialog", { name: "Résultat de l'appel" });
    expect(within(sheet).getByText("Tentative 1/3")).toBeInTheDocument();
    expect(within(sheet).getByText("Ali Ben Salem")).toBeInTheDocument();
    for (const t of ["Pas de réponse", "Confirmé", "Rejeté", "Rappel demandé"]) expect(within(sheet).getByText(t)).toBeInTheDocument();
    expect(within(sheet).getByText("Requis")).toBeInTheDocument();
    expect(within(sheet).getByText("Le résultat est enregistré dans l'historique de la commande.")).toBeInTheDocument();
  });

  it("records « Pas de réponse » at once and reports it", async () => {
    routes["/api/orders/o-1/no-answer"] = { status: 200, body: { data: { new_status: "attempt_2", auto_rejected: false, attempts_count: 2 } } };
    const { onDone, onClose } = mount(order());
    fireEvent.click(screen.getByText("Pas de réponse"));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ action: "attempt", newStatus: "attempt_2", autoRejected: false }));
    expect(onClose).toHaveBeenCalled();
  });

  it("at the ceiling: no « Pas de réponse », and the rejection opens with Injoignable › Ne répond pas chosen", async () => {
    mount(order({ attempt_count: 3, status: "attempt_3" }));
    expect(screen.queryByText("Pas de réponse")).toBeNull();
    fireEvent.click(screen.getByText("Rejeté"));
    await screen.findByRole("radio", { name: /Ne répond pas/ });
    await waitFor(() => expect(screen.getByRole("radio", { name: /Ne répond pas/ })).toHaveAttribute("aria-checked", "true"));
    expect(screen.getByText("Injoignable pré-sélectionné — tentatives max atteintes")).toBeInTheDocument();
  });

  it("rejects with a group and a sub-reason from the market's configurable list", async () => {
    const { onDone } = mount(order(), { initialStep: "reject" });
    const submit = screen.getByRole("button", { name: /Confirmer le rejet/ });
    fireEvent.click(await screen.findByRole("radio", { name: /Refus client/ }));
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "Prix trop élevé" }));
    fireEvent.click(submit);
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ action: "rejected", newStatus: "rejected" }));
    expect(posted("/api/orders/o-1/reject")[0].body).toMatchObject({ rejection_reason: "refus_client", rejection_subreason: "prix_eleve" });
  });

  it("needs a note for « Autre »", async () => {
    mount(order(), { initialStep: "reject" });
    fireEvent.click(await screen.findByRole("radio", { name: /Autre/ }));
    const submit = screen.getByRole("button", { name: /Confirmer le rejet/ });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Précisez…" }), { target: { value: "veut payer par carte" } });
    expect(submit).toBeEnabled();
  });

  it("« Le client veut plus tard » jumps to the callback step, which offers the quick picks", async () => {
    const { onDone } = mount(order(), { initialStep: "reject" });
    fireEvent.click(screen.getByText("Le client veut plus tard"));
    expect(screen.getByRole("dialog", { name: "Rappel demandé" })).toBeInTheDocument();
    const pick = screen.getAllByRole("radio")[0];
    expect(pick).toHaveTextContent("+2 h");
    fireEvent.click(pick);
    fireEvent.click(screen.getByRole("button", { name: /Planifier le rappel ·/ }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ action: "callback", newStatus: "callback_scheduled" }));
  });

  it("after Confirmer opens the send step with « Commande confirmée avec succès. » and sends with the carrier", async () => {
    routes["/api/orders/o-1/dispatch"] = { status: 200, body: { data: { tracking_number: "VX1" } } };
    const { onDone } = mount(order());
    fireEvent.click(screen.getByText("Confirmé"));
    expect(await screen.findByText("Commande confirmée avec succès.")).toBeInTheDocument();
    expect(posted("/api/orders/o-1/confirm")).toHaveLength(1);
    const vanex = await screen.findByRole("radio", { name: /Vanex/ });
    await waitFor(() => expect(vanex).toHaveAttribute("aria-checked", "true"));
    await waitFor(() => expect(vanex).toHaveTextContent("Taux de livraison 54 % · Délai 2 j"));
    expect(vanex).toHaveTextContent("meilleur choix");
    fireEvent.click(screen.getByRole("button", { name: /Envoyer maintenant/ }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ action: "confirmed", newStatus: "uploaded" }));
    expect(posted("/api/orders/o-1/dispatch")[0].body).toMatchObject({ carrier_id: "c-1" });
  });

  it("« Plus tard » after a confirmation reports the order confirmed", async () => {
    const { onDone } = mount(order());
    fireEvent.click(screen.getByText("Confirmé"));
    fireEvent.click(await screen.findByRole("button", { name: "Plus tard" }));
    expect(onDone).toHaveBeenCalledWith({ action: "confirmed", newStatus: "confirmed" });
  });
});
