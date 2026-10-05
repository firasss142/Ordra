import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { SWRConfig } from "swr";
import type { ReactNode } from "react";
import fr from "@/messages/fr.json";
import { useCallOutcome } from "../useCallOutcome";

type Call = { url: string; body: unknown };
let calls: Call[] = [];
let replies: Array<{ status: number; body?: unknown }> = [];

function wrapper({ children }: { children: ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => new Map() }}>
      <NextIntlClientProvider locale="fr" messages={fr} timeZone="Africa/Tripoli">
        {children}
      </NextIntlClientProvider>
    </SWRConfig>
  );
}

beforeEach(() => {
  calls = [];
  replies = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const r = replies.shift() ?? { status: 200, body: { data: {} } };
      return new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers: { "Content-Type": "application/json" } });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const mount = () => renderHook(() => useCallOutcome("o-1"), { wrapper });

describe("useCallOutcome — the endings, as PostCallActionSheet recorded them", () => {
  it("records a no-answer and reports the server's new status and the auto-rejection at the ceiling", async () => {
    replies = [{ status: 200, body: { data: { new_status: "rejected", auto_rejected: true, attempts_count: 3, callback_at: null } } }];
    const { result } = mount();
    let r: Awaited<ReturnType<typeof result.current.noAnswer>> = null;
    await act(async () => {
      r = await result.current.noAnswer();
    });
    expect(calls[0].url).toBe("/api/orders/o-1/no-answer");
    expect(r).toEqual({ newStatus: "rejected", autoRejected: true, attemptsCount: 3, callbackAt: null });
  });

  it("confirms through /confirm and surfaces the server's own words when it refuses", async () => {
    replies = [{ status: 409, body: { error: "Statut déjà changé par le manager" } }];
    const { result } = mount();
    let ok = true;
    await act(async () => {
      ok = await result.current.confirm();
    });
    expect(calls[0].url).toBe("/api/orders/o-1/confirm");
    expect(ok).toBe(false);
    expect(result.current.error).toBe("Statut déjà changé par le manager");
  });

  it("rejects with the group, the sub-reason, the note — and the feedback only when asked", async () => {
    const { result } = mount();
    await act(async () => {
      await result.current.reject({ group: "autre", sub: null, note: "veut payer par carte", feedback: { category: "objection", topicId: "t-1" } });
    });
    expect(calls[0]).toEqual({
      url: "/api/orders/o-1/reject",
      body: { rejection_reason: "autre", rejection_subreason: null, rejection_note: "veut payer par carte", feedback: { category: "objection", topic_id: "t-1" } },
    });
  });

  it("names a refused rejection as such, and a lost order as reassigned", async () => {
    replies = [{ status: 400 }, { status: 404 }];
    const { result } = mount();
    await act(async () => {
      await result.current.reject({ group: "refus_client", sub: "prix_eleve", note: null });
    });
    expect(result.current.error).toBe(fr.queue.rejectRefused);
    await act(async () => {
      await result.current.reject({ group: "refus_client", sub: "prix_eleve", note: null });
    });
    expect(result.current.error).toBe(fr.queue.realtime.toast.reassignedAway);
  });

  it("schedules a callback, and refuses one in the past without asking the server", async () => {
    const { result } = mount();
    const later = new Date(Date.now() + 3_600_000);
    await act(async () => {
      await result.current.callback(later);
    });
    expect(calls[0]).toEqual({ url: "/api/orders/o-1/callback", body: { callback_time: later.toISOString() } });
    let ok = true;
    await act(async () => {
      ok = await result.current.callback(new Date(Date.now() - 60_000));
    });
    expect(ok).toBe(false);
    expect(calls).toHaveLength(1);
    expect(result.current.error).toBe(fr.queue.scheduleMustBeFuture);
  });

  it("dispatches, and stops on the duplicate guard instead of shipping twice", async () => {
    replies = [
      { status: 409, body: { needsConfirmation: true, duplicate: { external_id: "39508" } } },
      { status: 200, body: { data: { tracking_number: "DRB123" } } },
    ];
    const { result } = mount();
    let first: unknown;
    await act(async () => {
      first = await result.current.dispatch("c-1", { stateId: 7 });
    });
    expect(first).toEqual({ kind: "duplicate", externalId: "39508" });
    expect(calls[0].body).toEqual({ carrier_id: "c-1", extra: { state_id: 7 } });
    let second: unknown;
    await act(async () => {
      second = await result.current.dispatch("c-1", { confirmDuplicate: true });
    });
    expect(calls[1].body).toEqual({ carrier_id: "c-1", extra: {}, confirm_duplicate: true });
    expect(second).toEqual({ kind: "sent", tracking: "DRB123" });
  });

  it("maps a carrier refusal to its own message", async () => {
    replies = [{ status: 422, body: {} }];
    const { result } = mount();
    await act(async () => {
      await result.current.dispatch("c-1", {});
    });
    expect(result.current.error).toBe(fr.queue.carrierRetry);
  });

  it("schedules the dispatch with the carrier and the auto flag", async () => {
    const { result } = mount();
    const when = new Date(Date.now() + 86_400_000);
    await act(async () => {
      await result.current.schedule("c-2", when, false);
    });
    expect(calls[0]).toEqual({ url: "/api/orders/o-1/schedule-dispatch", body: { scheduled_at: when.toISOString(), auto_dispatch: false, carrier_id: "c-2" } });
  });

  it("deletes this order as the duplicate of its twin", async () => {
    const { result } = mount();
    await act(async () => {
      await result.current.deleteDuplicate("o-2");
    });
    expect(calls[0]).toEqual({ url: "/api/orders/o-2/delete-duplicate", body: { sibling_id: "o-1" } });
  });
});
