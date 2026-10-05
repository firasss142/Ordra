import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { SWRConfig } from "swr";
import fr from "@/messages/fr.json";
import ar from "@/messages/ar.json";
import { AgentToastProvider } from "@/components/agent/shared";
import { LY_MARKET_ID } from "@/lib/markets";
import type { ProspectRow, ProspectsResponse } from "@/lib/prospects/types";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/hooks/useWhatsAppAvailability", () => ({ useWhatsAppAvailability: () => ({ active: false, known: false }) }));

const NOW = Date.now();
const ago = (m: number) => new Date(NOW - m * 60_000).toISOString();

function row(over: Partial<ProspectRow> = {}): ProspectRow {
  return {
    id: "l1", market_id: LY_MARKET_ID, status: "assigned", source: "whatsapp", bucket: "hot",
    customer_name: "Amal Zentani", customer_phone: "0917788001", customer_city: "Tripoli", customer_address: null,
    product_id: "p1", product_name: "Sérum vitamine C", product_price: 110, product_image_url: null, product_note: null,
    notes: "بكم سعر السيروم؟", assigned_to: "a1", assigned_name: "Hend", callback_scheduled_at: null,
    converted_order_id: null, converted_order_ref: null,
    campaign_id: null, campaign_name: null, campaign_offer: null, campaign_script: null,
    source_order_id: null, source_order_ref: null, return_reason: null,
    repeat_kind: "none", prior_order_count: 0, prior_delivered_count: 0, prior_returned_count: 0,
    last_known_address: null, created_at: ago(12), updated_at: ago(12), last_touch_at: ago(12),
    ...over,
  };
}

const ROWS: ProspectRow[] = [
  row(),
  row({ id: "l2", bucket: "retry", status: "attempt_2", source: "manual_call", customer_name: "Fatma Arfi", customer_phone: "0919982211", product_id: null, product_name: null, product_price: null, notes: null }),
  row({ id: "l3", bucket: "converted", status: "won", customer_name: "Samira Darsi", converted_order_id: "o9", converted_order_ref: "48219" }),
];

let worklist: ProspectsResponse;
const fetcher = vi.fn((url: string) => {
  if (url.startsWith("/api/prospects/worklist")) return Promise.resolve(worklist);
  if (url.startsWith("/api/products")) return Promise.resolve({ data: [{ id: "p1", name: "Sérum vitamine C" }, { id: "p2", name: "Plaid d'hiver" }] });
  return Promise.resolve({});
});
vi.mock("@/lib/swr-config", () => ({ fetcher: (u: string) => fetcher(u) }));

import { AgentCrmPage } from "../AgentCrmPage";

function mount(locale: "fr" | "ar" = "fr") {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "fr" ? fr : ar} timeZone="Africa/Tripoli">
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <AgentToastProvider>
          <AgentCrmPage marketId={LY_MARKET_ID}locale={locale} />
        </AgentToastProvider>
      </SWRConfig>
    </NextIntlClientProvider>,
  );
}

const fetchMock = vi.fn();

beforeEach(() => {
  worklist = { rows: ROWS, total: 3, truncated: false, hot_window_minutes: 60, generated_at: new Date().toISOString() };
  push.mockReset();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: { id: "new", status: "assigned", created_at: new Date().toISOString() } }) });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const list = () => screen.getByRole("list", { name: "Prospects" });
const detail = () => screen.getByRole("complementary");
const outcomeCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes("/outcome"));

describe("Prospects — the agent's CRM tab", () => {
  test("the header, the seven tiles with their counts, and the first prospect open beside the list", async () => {
    mount();
    await waitFor(() => expect(within(list()).getByText("Amal Zentani")).toBeTruthy());
    expect(screen.getByRole("heading", { level: 1, name: "Prospects" })).toBeTruthy();
    const tiles = screen.getByRole("region", { name: "Seaux" });
    expect(within(tiles).getAllByRole("button")).toHaveLength(7);
    expect(within(tiles).getByRole("button", { name: /Tout\s*3/ })).toBeTruthy();
    expect(within(tiles).getByRole("button", { name: /Sans réponse\s*1/ })).toBeTruthy();
    // The card's eyebrow says what to do next — not « Résultat de l'appel ».
    expect(within(detail()).getByText("Prochaine action")).toBeTruthy();
    expect(within(detail()).getByText("Appeler maintenant")).toBeTruthy();
    expect(within(detail()).getByText("Message d'origine")).toBeTruthy();
    expect(detail().querySelector(".bub")?.textContent).toContain("بكم سعر السيروم؟");
  });

  test("a tile filters the list", async () => {
    mount();
    await waitFor(() => expect(within(list()).getByText("Amal Zentani")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Sans réponse\s*1/ }));
    expect(within(list()).queryByText("Amal Zentani")).toBeNull();
    expect(within(list()).getByText("Fatma Arfi")).toBeTruthy();
  });

  test("the call result is saved after the 5-second undo window, with the bucket it moved to", async () => {
    mount();
    await waitFor(() => expect(within(list()).getByText("Amal Zentani")).toBeTruthy());
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(within(detail()).getByRole("button", { name: /Résultat de l'appel/ }));
    fireEvent.click(within(detail()).getByRole("button", { name: /Pas de réponse/ }));
    fireEvent.click(within(detail()).getByRole("button", { name: /Enregistrer le résultat/ }));
    expect(screen.getByRole("status").textContent).toContain("Enregistré · déplacé vers « Sans réponse »");
    expect(outcomeCalls()).toHaveLength(0);
    await act(async () => { vi.advanceTimersByTime(5_100); });
    expect(outcomeCalls()).toHaveLength(1);
    const [url, init] = outcomeCalls()[0];
    expect(url).toBe("/api/prospects/l1/outcome");
    expect(JSON.parse(init.body)).toEqual({ kind: "no_answer", note: null });
  });

  test("« Annuler » means the write never leaves", async () => {
    mount();
    await waitFor(() => expect(within(list()).getByText("Amal Zentani")).toBeTruthy());
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(within(detail()).getByRole("button", { name: /Résultat de l'appel/ }));
    fireEvent.click(within(detail()).getByRole("button", { name: /Pas intéressé/ }));
    expect((within(detail()).getByRole("button", { name: /Enregistrer le résultat/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(detail()).getByRole("button", { name: "Prix" }));
    fireEvent.click(within(detail()).getByRole("button", { name: /Enregistrer le résultat/ }));
    expect(screen.getByRole("status").textContent).toContain("Enregistré · prospect clos");
    fireEvent.click(within(screen.getByRole("status")).getByRole("button", { name: "Annuler" }));
    await act(async () => { vi.advanceTimersByTime(6_000); });
    expect(outcomeCalls()).toHaveLength(0);
  });

  test("a failed save is not silent: the prospect comes back and the toast says so", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: "Internal server error" }) });
    mount();
    await waitFor(() => expect(within(list()).getByText("Amal Zentani")).toBeTruthy());
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(within(detail()).getByRole("button", { name: /Résultat de l'appel/ }));
    fireEvent.click(within(detail()).getByRole("button", { name: /Rappeler plus tard/ }));
    fireEvent.click(within(detail()).getByRole("button", { name: "+1 h" }));
    fireEvent.click(within(detail()).getByRole("button", { name: /Enregistrer le résultat/ }));
    await act(async () => { vi.advanceTimersByTime(5_100); });
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("Échec de l'enregistrement — Amal Zentani est revenu à sa place"),
    );
    expect(JSON.parse(outcomeCalls()[0][1].body).kind).toBe("callback");
  });

  test("« Convertir en commande » opens the prefilled order form", async () => {
    mount();
    await waitFor(() => expect(within(list()).getByText("Amal Zentani")).toBeTruthy());
    fireEvent.click(within(detail()).getByRole("button", { name: /Convertir en commande/ }));
    expect(push).toHaveBeenCalledWith("/fr/leads/l1?convert=1");
  });

  test("a converted prospect opens its order", async () => {
    mount();
    await waitFor(() => expect(within(list()).getByText("Samira Darsi")).toBeTruthy());
    fireEvent.click(within(list()).getByText("Samira Darsi"));
    fireEvent.click(within(detail()).getByRole("button", { name: /Voir la commande/ }));
    expect(push).toHaveBeenCalledWith("/fr/orders/o9");
  });

  test("« Nouveau prospect » opens a drawer that really creates the lead", async () => {
    mount();
    await waitFor(() => expect(within(list()).getByText("Amal Zentani")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Nouveau prospect/ }));
    const drawer = screen.getByRole("dialog", { name: "Nouveau prospect" });
    expect(within(drawer).getByText("+218")).toBeTruthy();
    fireEvent.click(within(drawer).getByRole("button", { name: /Créer le prospect/ }));
    expect(within(drawer).getByRole("alert").textContent).toBe("Le téléphone est obligatoire.");
    fireEvent.change(within(drawer).getByLabelText(/Téléphone/), { target: { value: "91 234 5678" } });
    fireEvent.change(within(drawer).getByLabelText(/Nom/), { target: { value: "Nour" } });
    await waitFor(() => expect(within(drawer).getByRole("option", { name: "Plaid d'hiver" })).toBeTruthy());
    fireEvent.change(within(drawer).getByLabelText("Produit"), { target: { value: "p2" } });
    fireEvent.change(within(drawer).getByLabelText("Ce qu'il a dit"), { target: { value: "Veut deux plaids" } });
    fireEvent.click(within(drawer).getByRole("button", { name: /Créer le prospect/ }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Nouveau prospect" })).toBeNull());
    const call = fetchMock.mock.calls.find(([u]) => u === "/api/leads");
    expect(call).toBeTruthy();
    expect(JSON.parse(call![1].body)).toEqual({
      customer_phone: "912345678", customer_name: "Nour", source: "manual_call",
      product_interest_id: "p2", notes: "Veut deux plaids",
    });
    expect(screen.getByRole("status").textContent).toContain("Prospect créé");
  });

  test("the drawer shows the server's refusal instead of closing", async () => {
    mount();
    await waitFor(() => expect(within(list()).getByText("Amal Zentani")).toBeTruthy());
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ error: "Forbidden" }) });
    fireEvent.click(screen.getByRole("button", { name: /Nouveau prospect/ }));
    const drawer = screen.getByRole("dialog", { name: "Nouveau prospect" });
    fireEvent.change(within(drawer).getByLabelText(/Téléphone/), { target: { value: "912345678" } });
    fireEvent.change(within(drawer).getByLabelText(/Nom/), { target: { value: "Nour" } });
    fireEvent.click(within(drawer).getByRole("button", { name: /Créer le prospect/ }));
    await waitFor(() => expect(within(drawer).getByRole("alert").textContent).toContain("Forbidden"));
  });

  test("Arabic renders the same page in Arabic words", async () => {
    mount("ar");
    await waitFor(() => expect(screen.getByRole("list", { name: "العملاء المحتملون" })).toBeTruthy());
    expect(screen.getByText("الإجراء التالي")).toBeTruthy();
  });
});

describe("Prospects on a phone", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q.includes("max-width: 767px"), media: q, addEventListener: () => {}, removeEventListener: () => {},
    }));
  });

  test("no prospect opens by itself; a tap opens the full-screen card, the green button dials then asks the result", async () => {
    mount();
    await waitFor(() => expect(within(list()).getByText("Amal Zentani")).toBeTruthy());
    expect(screen.queryByRole("complementary")).toBeNull();
    const call = within(list()).getAllByRole("link", { name: "Appeler" })[0];
    expect(call.getAttribute("href")).toBe("tel:0917788001");
    fireEvent.click(call);
    expect(screen.getByRole("dialog", { name: "Résultat de l'appel" })).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Annuler" })[0]);
    fireEvent.click(within(list()).getByText("Fatma Arfi"));
    const panel = screen.getByRole("dialog", { name: "Fatma Arfi" });
    expect(within(panel).getByText("Prochaine action")).toBeTruthy();
    expect(within(panel).getByRole("button", { name: /WhatsApp/ })).toBeTruthy();
  });
});
