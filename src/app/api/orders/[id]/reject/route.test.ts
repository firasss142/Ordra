import { describe, test, expect, vi, beforeEach } from "vitest";

const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}));

vi.mock("@/lib/auth/actor", () => ({ getActor: vi.fn() }));

import { POST } from "./route";
import { getActor } from "@/lib/auth/actor";
import { NextRequest } from "next/server";

const TN = "00000000-0000-0000-0000-000000000001";
const ORDER = "11111111-1111-1111-1111-111111111111";
const AGENT = "22222222-2222-2222-2222-222222222222";

function req(body: unknown) {
  return new NextRequest(
    new URL(`/api/orders/${ORDER}/reject`, "http://localhost:3000"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { method: "POST", body: JSON.stringify(body) } as any,
  );
}
const params = { params: Promise.resolve({ id: ORDER }) };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const agent = { actor: { id: AGENT, role: "agent", market_id: TN } } as any;

const cfg = (
  key: string,
  parent_key: string | null,
  over: Record<string, unknown> = {},
) => ({
  id: key,
  market_id: TN,
  parent_key,
  key,
  label_fr: key,
  label_ar: key,
  short_fr: key,
  short_ar: key,
  hue: "red",
  sort_order: 0,
  is_active: true,
  requires_note: false,
  ...over,
});

/** The market's taxonomy, plus the order the agent owns. */
function setup(configRows: unknown[] | null, orderStatus = "attempt_1") {
  mockFrom.mockImplementation((table: string) => {
    if (table === "rejection_reason_configs") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: configRows, error: null }),
      };
    }
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: ORDER,
          status: orderStatus,
          assigned_to: AGENT,
          market_id: TN,
        },
        error: null,
      }),
    };
  });
  mockRpc.mockResolvedValue({ error: null });
}

const TAXONOMY = [
  cfg("refus_client", null),
  cfg("prix_eleve", "refus_client"),
  cfg("injoignable", null, { hue: "amber" }),
  cfg("raccroche", "injoignable"),
  cfg("autre", null, { requires_note: true, hue: "neutral" }),
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActor).mockResolvedValue(agent);
});

describe("POST /api/orders/[id]/reject — validates against the market's taxonomy", () => {
  test("accepts a pair the market actually defines", async () => {
    setup(TAXONOMY);

    const res = await POST(
      req({ rejection_reason: "refus_client", rejection_subreason: "prix_eleve" }),
      params,
    );

    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      "transition_order_status",
      expect.objectContaining({
        p_rejection_reason: "refus_client",
        p_rejection_subreason: "prix_eleve",
      }),
    );
  });

  // The point of the CRUD: a reason a manager added this morning works this
  // afternoon, with no deploy.
  test("accepts a sub-reason that exists only in this market's config", async () => {
    setup([...TAXONOMY, cfg("promo_terminee", "refus_client")]);

    const res = await POST(
      req({
        rejection_reason: "refus_client",
        rejection_subreason: "promo_terminee",
      }),
      params,
    );

    expect(res.status).toBe(200);
  });

  test("refuses a sub-reason the manager retired", async () => {
    setup([
      ...TAXONOMY.filter((r) => r.key !== "prix_eleve"),
      cfg("prix_eleve", "refus_client", { is_active: false }),
    ]);

    const res = await POST(
      req({ rejection_reason: "refus_client", rejection_subreason: "prix_eleve" }),
      params,
    );

    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("refuses a sub-reason borrowed from another group", async () => {
    setup(TAXONOMY);

    const res = await POST(
      req({ rejection_reason: "refus_client", rejection_subreason: "raccroche" }),
      params,
    );

    expect(res.status).toBe(400);
  });

  test("refuses a bare group while that group still offers sub-reasons", async () => {
    setup(TAXONOMY);

    const res = await POST(
      req({ rejection_reason: "refus_client", rejection_subreason: null }),
      params,
    );

    expect(res.status).toBe(400);
  });

  // `requires_note` is data now, not the string "autre".
  test("requires a note on a note-only group", async () => {
    setup(TAXONOMY);

    expect(
      (await POST(req({ rejection_reason: "autre", rejection_note: "  " }), params))
        .status,
    ).toBe(400);

    setup(TAXONOMY);
    expect(
      (
        await POST(
          req({ rejection_reason: "autre", rejection_note: "rappelle en mai" }),
          params,
        )
      ).status,
    ).toBe(200);
  });

  // Deploy ordering: the code can land before the migration runs.
  test("falls back to the bundled taxonomy when the config table is empty", async () => {
    setup([]);

    const res = await POST(
      req({ rejection_reason: "injoignable", rejection_subreason: "raccroche" }),
      params,
    );

    expect(res.status).toBe(200);
  });

  test("still refuses nonsense under that fallback", async () => {
    setup([]);

    const res = await POST(
      req({ rejection_reason: "pas_un_groupe", rejection_subreason: "raccroche" }),
      params,
    );

    expect(res.status).toBe(400);
  });
});

// Voix du client: « Autre » offers to keep the note as the customer's words (agent prototype v2,
// screen ④). The rejection never depends on it.
describe("POST /api/orders/[id]/reject — the « Aussi un retour client » rider", () => {
  const TOPIC = "33333333-3333-4333-8333-333333333333";
  const FEEDBACK_ID = "44444444-4444-4444-8444-444444444444";

  function rpcs(feedback: { error?: { code: string; message: string } } = {}) {
    mockRpc.mockImplementation(async (name: string) => {
      if (name === "create_customer_feedback") {
        return feedback.error ? { data: null, error: feedback.error } : { data: FEEDBACK_ID, error: null };
      }
      return { error: null };
    });
  }

  test("an « Autre » note with the offer on becomes a rejection-sourced entry, after the order is rejected", async () => {
    setup(TAXONOMY);
    rpcs();
    const res = await POST(
      req({ rejection_reason: "autre", rejection_note: "قال اريد الدفع بالبطاقة", feedback: { category: "objection", topic_id: TOPIC } }),
      params,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { new_status: "rejected", feedback_id: FEEDBACK_ID } });
    const names = mockRpc.mock.calls.map((c) => c[0]);
    expect(names).toEqual(["transition_order_status", "create_customer_feedback"]);
    expect(mockRpc).toHaveBeenLastCalledWith("create_customer_feedback", {
      p_category: "objection",
      p_body: "قال اريد الدفع بالبطاقة",
      p_topic_id: TOPIC,
      p_order_id: ORDER,
      p_source: "rejection",
    });
  });

  test("a failed entry never undoes the rejection", async () => {
    setup(TAXONOMY);
    rpcs({ error: { code: "22023", message: "invalid_topic" } });
    const res = await POST(
      req({ rejection_reason: "autre", rejection_note: "غالي", feedback: { category: "objection", topic_id: TOPIC } }),
      params,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { new_status: "rejected", feedback_id: null } });
  });

  test("no offer, or a structured reason → no entry; a bad category is ignored", async () => {
    setup(TAXONOMY);
    rpcs();
    await POST(req({ rejection_reason: "autre", rejection_note: "غالي" }), params);
    setup(TAXONOMY);
    rpcs();
    await POST(req({ rejection_reason: "refus_client", rejection_subreason: "prix_eleve", feedback: { category: "objection" } }), params);
    setup(TAXONOMY);
    rpcs();
    await POST(req({ rejection_reason: "autre", rejection_note: "غالي", feedback: { category: "compliment" } }), params);
    expect(mockRpc.mock.calls.map((c) => c[0])).not.toContain("create_customer_feedback");
  });
});
