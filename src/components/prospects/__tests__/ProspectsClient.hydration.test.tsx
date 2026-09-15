import { describe, test, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import { ProspectsClient } from "@/components/prospects/ProspectsClient";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/context/market-scope", () => ({ useMarketScope: () => ({ marketId: "m-ly", scope: "ly" }) }));
vi.mock("@/lib/markets", () => ({ marketIdToCode: () => "ly", marketTimezone: () => "Africa/Tripoli" }));

// The exact payload the live API returned for agent1.tn.
const API = {
  rows: [
    { id:"l1", market_id:"m-ly", status:"qualified", source:"manual_call", bucket:"retry",
      customer_name:"FIRAS", customer_phone:"0917788001", customer_city:"Tunis", customer_address:null,
      product_id:"p1", product_name:"Sérum", product_price:49, product_image_url:null, product_note:null,
      notes:null, assigned_to:"a1", assigned_name:"Agent TN 1", callback_scheduled_at:null,
      converted_order_id:null, converted_order_ref:null, campaign_id:null, campaign_name:null,
      campaign_offer:null, campaign_script:null, source_order_id:null, source_order_ref:null,
      return_reason:null, repeat_kind:"none", prior_order_count:0, prior_delivered_count:0,
      prior_returned_count:0, last_known_address:null,
      created_at:new Date().toISOString(), updated_at:new Date().toISOString(), last_touch_at:null },
  ],
  total: 4, hot_window_minutes: 60, generated_at: new Date().toISOString(),
};

vi.mock("@/lib/swr-config", () => ({ fetcher: () => Promise.resolve(API) }));

describe("ProspectsClient hydration", () => {
  test("the rows the API returns reach the screen", async () => {
    render(
      <NextIntlClientProvider locale="fr" messages={fr} timeZone="Africa/Tripoli">
        <ProspectsClient role="agent" viewerId="a1" marketId="m-ly" locale="fr" />
      </NextIntlClientProvider>,
    );
    await waitFor(() => expect(screen.getByText("FIRAS")).toBeTruthy());
    expect(screen.getByRole("list", { name: "Prospects" })).toBeTruthy();
    // The bucket tile counts what arrived, not the pre-fetch zero.
    expect(screen.getByRole("button", { name: /Sans réponse\s*1/ })).toBeTruthy();
  });
});
