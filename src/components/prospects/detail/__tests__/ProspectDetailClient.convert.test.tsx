import { describe, test, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { SWRConfig } from "swr";
import fr from "@/messages/fr.json";
import { LY_MARKET_ID } from "@/lib/markets";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const LEAD = {
  id: "l1", market_id: LY_MARKET_ID, status: "assigned", source: "whatsapp",
  customer_name: "Amal Zentani", customer_phone: "0917788001", customer_city: "Tripoli", customer_address: null,
  product_interest_id: null, product_interest_note: null, notes: null, assigned_to: "a1",
  callback_scheduled_at: null, converted_order_id: null, created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(), history: [],
};
vi.mock("@/lib/swr-config", () => ({
  fetcher: (u: string) => Promise.resolve(u.startsWith("/api/leads/") ? { data: LEAD } : { data: [] }),
}));

import { ProspectDetailClient } from "../ProspectDetailClient";

function mount(openConvert?: boolean) {
  return render(
    <NextIntlClientProvider locale="fr" messages={fr} timeZone="Africa/Tripoli">
      <SWRConfig value={{ provider: () => new Map() }}>
        <ProspectDetailClient leadId="l1" locale="fr" openConvert={openConvert} />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
}

describe("/leads/[id]?convert=1 — the agent's « Convertir en commande » lands on the open form", () => {
  test("opens the convert sheet once the lead is loaded", async () => {
    mount(true);
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Convertir en commande" })).toBeTruthy());
  });

  test("without the flag the page opens closed, as before", async () => {
    mount();
    await waitFor(() => expect(screen.getAllByText("Amal Zentani").length).toBeGreaterThan(0));
    expect(screen.queryByRole("dialog", { name: "Convertir en commande" })).toBeNull();
  });
});
