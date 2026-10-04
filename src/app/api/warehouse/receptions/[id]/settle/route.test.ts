import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetActor = vi.fn();
const state = {
  rpc: null as { name: string; args: Record<string, unknown> } | null,
  rpcError: null as { message: string; details?: string } | null,
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    rpc: vi.fn().mockImplementation((name: string, args: Record<string, unknown>) => {
      state.rpc = { name, args };
      return Promise.resolve(
        state.rpcError
          ? { data: null, error: state.rpcError }
          : { data: { reference: "REC-LY-2026-0042" }, error: null },
      );
    }),
  }),
}));

vi.mock("@/lib/auth/actor", () => ({ getActor: (...a: unknown[]) => mockGetActor(...a) }));

import { POST } from "./route";
import { NextRequest } from "next/server";

const params = Promise.resolve({ id: "r-1" });
function post(body: unknown) {
  return new NextRequest(new URL("http://localhost/api/warehouse/receptions/r-1/settle"), {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.rpc = null;
  state.rpcError = null;
  mockGetActor.mockResolvedValue({
    actor: { id: "m-1", role: "market_manager", market_id: "m-ly" },
  });
});

describe("POST …/[id]/settle", () => {
  test("solde avec la facture, l'échéance et le fournisseur", async () => {
    const res = await POST(
      post({ supplier_id: "s-1", invoice_total: 18720, due_at: "2026-10-15" }),
      { params },
    );
    expect(res.status).toBe(200);
    expect(state.rpc?.name).toBe("settle_reception");
    expect(state.rpc?.args).toMatchObject({
      p_reception_id: "r-1",
      p_actor_id: "m-1",
      p_supplier_id: "s-1",
      p_invoice_total: 18720,
      p_due_at: "2026-10-15",
    });
  });

  test("refuse de solder sans fournisseur", async () => {
    const res = await POST(post({ invoice_total: 100 }), { params });
    expect(res.status).toBe(400);
    expect(state.rpc).toBeNull();
  });

  test("laisse passer une facture `null` — on peut solder sans l'avoir sous les yeux", async () => {
    // C'est `0` qui mentirait : « on ne doit rien » n'est pas « on ne sait pas ».
    await POST(post({ supplier_id: "s-1", invoice_total: null }), { params });
    expect(state.rpc?.args.p_invoice_total).toBeNull();
  });

  test("refuse le quai", async () => {
    mockGetActor.mockResolvedValue({
      actor: { id: "a-1", role: "warehouse_agent", market_id: "m-ly" },
    });
    expect((await POST(post({ supplier_id: "s-1" }), { params })).status).toBe(403);
    expect(state.rpc).toBeNull();
  });

  test("répond 422 sur un écart non justifié", async () => {
    // La requête est bien formée ; c'est le MONDE qui ne tombe pas juste.
    state.rpcError = { message: "écart de 170", details: '{"code":"DISCREPANCY"}' };
    expect(
      (await POST(post({ supplier_id: "s-1", invoice_total: 18890 }), { params })).status,
    ).toBe(422);
  });
});

/**
 * LE LITIGE EST CE QU'ON REFUSE DE PAYER, et la facture garde le chiffre du
 * fournisseur. Les deux voyagent dans le MÊME appel : solder puis réclamer en
 * deux requêtes laisserait une fenêtre où la réception est soldée et la
 * réclamation perdue — alors que l'écran a promis qu'elle resterait visible.
 */
describe("POST …/[id]/settle — ouvrir un litige", () => {
  test("transmet le montant réclamé à côté de la facture entière", async () => {
    await POST(
      post({
        supplier_id: "s-1",
        invoice_total: 18890,
        discrepancy_reason: "damaged_billed",
        claim_amount: 170,
      }),
      { params },
    );
    expect(state.rpc?.args.p_invoice_total).toBe(18890);
    expect(state.rpc?.args.p_claim_amount).toBe(170);
  });

  test("sans litige, le paramètre reste null et non zéro", async () => {
    await POST(post({ supplier_id: "s-1", invoice_total: 18720 }), { params });
    expect(state.rpc?.args.p_claim_amount).toBeNull();
  });

  test("refuse un montant réclamé négatif sans appeler la base", async () => {
    const res = await POST(
      post({ supplier_id: "s-1", invoice_total: 100, claim_amount: -5 }),
      { params },
    );
    expect(res.status).toBe(400);
    expect(state.rpc).toBeNull();
  });

  test("refuse de réclamer sans facture à contester", async () => {
    // Un litige sans facture serait une créance que rien ne justifie.
    const res = await POST(
      post({ supplier_id: "s-1", invoice_total: null, claim_amount: 170 }),
      { params },
    );
    expect(res.status).toBe(400);
    expect(state.rpc).toBeNull();
  });
});
