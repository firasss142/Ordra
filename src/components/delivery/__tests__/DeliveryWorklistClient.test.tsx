import { render, screen, fireEvent, within, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { SWRConfig } from "swr";
import fr from "@/messages/fr.json";
import type { WorklistRow } from "@/lib/delivery/types";
import { AgentToastProvider } from "@/components/agent/shared";
import { LY_MARKET_ID } from "@/lib/markets";

vi.mock("@/context/market-scope", () => ({ useMarketScope: () => ({ marketId: null }) }));
vi.mock("@/hooks/useWhatsAppAvailability", () => ({ useWhatsAppAvailability: () => ({ active: false, known: true }) }));
vi.mock("@/components/providers/RealtimeProvider", () => ({ useRealtimeBroadcast: () => {} }));
vi.mock("@/hooks/useDeliveryTimeline", () => ({ useDeliveryTimeline: () => ({ timeline: [], isLoading: false, error: null }) }));
vi.mock("@/hooks/useWhatsAppThread", () => ({ useWhatsAppThread: () => ({ thread: null }) }));

import { DeliveryWorklistClient } from "../DeliveryWorklistClient";

const AMINA = {
  order_id: "o1", external_id: "48211", status: "out_for_delivery", bucket: "act_now",
  reason_codes: ["remark:no_answer"], hours_on_status: 5, next_action_at: null, is_risky: false, risk_reasons: [],
  total_price: 185, customer_name: "Amina El Fitouri", customer_phone: "0914456677", customer_phone_2: "0921122334",
  customer_city: "Tripoli", customer_address: "Aïn Zara", assigned_to: "agent-1", agent_name: null,
  tracking_number: "DRB5501", carrier_id: "c1", carrier_status_slug: null, latest_remark: null,
  latest_remark_at: null, remark_class: "no_answer", delayed_until: null, resend_count: 0,
  handler_name: null, handler_phone: null, handler_account_name: null, handler_account_phone: null,
  to_branch_group: null, latest_event_at: null, customer_orders_count: 1, customer_delivered_count: 0,
  customer_returned_count: 0, customer_rejected_count: 0, customer_risk_class: null,
  last_action_at: null, last_action_type: null, last_action_outcome: null, last_action_note: null,
  has_open_task: false, terminal_at: null, created_at: "2026-09-12T08:00:00Z", carrier_name: "Darb Assabil", items: [],
} as WorklistRow;

const calls: string[] = [];
beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.startsWith("/api/delivery/worklist")) return new Response(JSON.stringify({ rows: [AMINA], total: 1, generated_at: "" }));
    if (url === "/api/delivery/scorecard") return new Response(JSON.stringify({ data: { delivered: 7, returned: 2, delivery_rate: 78, saved: 1, window_days: 30 } }));
    if (url.includes("/actions")) return new Response(JSON.stringify({ error: "boom" }), { status: 500 });
    return new Response("{}", { status: 404 });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function mount() {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <NextIntlClientProvider locale="fr" messages={fr} timeZone="Africa/Tripoli">
        <AgentToastProvider>
          <DeliveryWorklistClient role="agent" viewerId="agent-1" marketId={LY_MARKET_ID} locale="fr" />
        </AgentToastProvider>
      </NextIntlClientProvider>
    </SWRConfig>,
  );
}

describe("DeliveryWorklistClient — the agent's page in the Aurore shell", () => {
  it("reads the worklist from the bare key the nav badge shares, and draws the Aurore page", async () => {
    mount();
    expect(await screen.findByRole("heading", { level: 1, name: "Suivi livraison" })).toBeInTheDocument();
    expect(await screen.findByText("Amina El Fitouri", { selector: ".nm" })).toBeInTheDocument();
    expect(calls).toContain("GET /api/delivery/worklist");
  });

  it("a recorded action is POSTed only after the 5-s undo window; a refused POST says so", async () => {
    mount();
    const region = await screen.findByRole("region", { name: "Détail du colis" });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(within(region).getByRole("button", { name: "Pas de réponse" }));
    expect(calls.some((c) => c.startsWith("POST"))).toBe(false);
    await act(async () => { vi.advanceTimersByTime(5100); });
    await waitFor(() => expect(calls).toContain("POST /api/delivery/orders/o1/actions"));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("L'action n'a pas pu être enregistrée. Réessaie."));
  });
});
