import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import { ProspectsClient } from "../ProspectsClient";
import type { ProspectsResponse } from "@/lib/prospects/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/context/market-scope", () => ({ useMarketScope: () => ({ marketId: "m-ly", scope: "ly" }) }));
vi.mock("@/lib/markets", () => ({ marketIdToCode: () => "ly", marketTimezone: () => "Africa/Tripoli" }));

const API: ProspectsResponse = {
  rows: [
    {
      id: "l1", market_id: "m-ly", status: "assigned", source: "whatsapp", bucket: "hot",
      customer_name: "Amal", customer_phone: "0917788001", customer_city: "Tripoli", customer_address: null,
      product_id: null, product_name: null, product_price: null, product_image_url: null, product_note: null,
      notes: null, assigned_to: "a1", assigned_name: "Hend", callback_scheduled_at: null,
      converted_order_id: null, converted_order_ref: null,
      campaign_id: null, campaign_name: null, campaign_offer: null, campaign_script: null,
      source_order_id: null, source_order_ref: null, return_reason: null,
      repeat_kind: "none", prior_order_count: 0, prior_delivered_count: 0, prior_returned_count: 0,
      last_known_address: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_touch_at: null,
    },
  ],
  total: 1, truncated: false, hot_window_minutes: 60, generated_at: new Date().toISOString(),
};

vi.mock("@/lib/swr-config", () => ({ fetcher: () => Promise.resolve(API) }));

function mount() {
  return render(
    <NextIntlClientProvider locale="fr" messages={fr} timeZone="Africa/Tripoli">
      <ProspectsClient role="agent" viewerId="a1" marketId="m-ly" locale="fr" />
    </NextIntlClientProvider>,
  );
}

/** Save an outcome so the undo toast appears. */
async function recordNoAnswer() {
  const list = () => screen.getByRole("list", { name: "Prospects" });
  await waitFor(() => expect(within(list()).getByText("Amal")).toBeTruthy());
  fireEvent.click(within(list()).getByText("Amal"));
  fireEvent.click(screen.getAllByRole("button", { name: "Résultat de l'appel" })[0]);
  fireEvent.click(screen.getByRole("button", { name: /Pas de réponse/ }));
  fireEvent.click(screen.getByRole("button", { name: "Enregistrer le résultat" }));
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ProspectsClient — the undo window", () => {
  test("the outcome is not sent while undo is still offered", async () => {
    mount();
    await recordNoAnswer();
    expect(screen.getByRole("button", { name: "Annuler" })).toBeTruthy();
    // Nothing has been POSTed: undo must leave no trace in lead_history.
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  test("undo cancels the write outright, rather than sending a reversal", async () => {
    mount();
    await recordNoAnswer();
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  test("the outcome is sent once the window closes", async () => {
    mount();
    await recordNoAnswer();
    await act(async () => { vi.advanceTimersByTime(5_100); });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/prospects/l1/outcome");
    expect(JSON.parse(init.body as string)).toEqual({ kind: "no_answer", note: null });
  });

  // The toast outlived the window it described: "Annuler" stayed on screen and
  // clickable long after the POST had gone, and clicking it did nothing.
  test("the toast disappears once undo is no longer possible", async () => {
    mount();
    await recordNoAnswer();
    await act(async () => { vi.advanceTimersByTime(5_100); });
    expect(screen.queryByRole("button", { name: "Annuler" })).toBeNull();
  });
});

describe("ProspectsClient — listeners", () => {
  // The visibilitychange handler was registered with an inline function and
  // never removed, so every change of `flush` identity left another one behind.
  test("every listener it adds is removed when it unmounts", () => {
    const winAdd = vi.spyOn(window, "addEventListener");
    const winRemove = vi.spyOn(window, "removeEventListener");
    const docAdd = vi.spyOn(document, "addEventListener");
    const docRemove = vi.spyOn(document, "removeEventListener");

    const { unmount } = mount();
    unmount();

    const added = [...winAdd.mock.calls, ...docAdd.mock.calls]
      .filter(([e]) => e === "pagehide" || e === "visibilitychange");
    const removed = [...winRemove.mock.calls, ...docRemove.mock.calls]
      .filter(([e]) => e === "pagehide" || e === "visibilitychange");

    expect(added.length).toBeGreaterThan(0);
    for (const [event, handler] of added) {
      expect(removed.some(([e, h]) => e === event && h === handler)).toBe(true);
    }
  });
});
