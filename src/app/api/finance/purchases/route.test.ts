import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetActor = vi.fn();
const tables: Record<string, { data: unknown[]; error: unknown }> = {};

/**
 * Un seul faux client pour deux tables. Chaque chaîne est thenable : la route
 * peut enchaîner `.eq()`/`.order()` autant qu'elle veut, c'est le `await` qui
 * résout — on n'impose donc pas une forme de requête au code testé.
 */
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (table: string) => {
      const result = tables[table] ?? { data: [], error: null };
      const chain: Record<string, unknown> = {
        then: (res: (v: unknown) => unknown) => Promise.resolve(result).then(res),
      };
      for (const m of ["select", "eq", "in", "order", "not", "is", "gte", "lte", "limit"]) {
        chain[m] = vi.fn().mockReturnValue(chain);
      }
      return chain;
    },
  }),
}));

vi.mock("@/lib/auth/actor", () => ({ getActor: (...a: unknown[]) => mockGetActor(...a) }));

import { GET } from "./route";
import { NextRequest } from "next/server";

function req(qs = "") {
  return new NextRequest(new URL(`http://localhost/api/finance/purchases${qs}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.setSystemTime(new Date("2026-10-03T09:00:00Z"));

  tables.suppliers = {
    data: [
      { id: "s-risala", name: "مكتبة الرسالة", category: "livres", city: "Misrata", is_active: true },
      { id: "s-biovera", name: "Biovera Import", category: "cosmétique", city: "import", is_active: true },
    ],
    error: null,
  };
  tables.receptions = {
    data: [
      {
        id: "r-14", reference: "REC-LY-2026-0014", supplier_id: "s-risala", supplier_name: null,
        invoice_total: 18720, due_at: "2026-10-15", status: "posted", posted_at: "2026-09-22T10:00:00Z",
        created_at: "2026-09-22T08:00:00Z",
        reception_payments: [{ amount: 7488 }],
        reception_lines: [{ expected_qty: 150, received_qty: 141, unit_cost: 40 }],
      },
      {
        id: "r-09", reference: "REC-LY-2026-0009", supplier_id: "s-biovera", supplier_name: null,
        invoice_total: 6200, due_at: "2026-09-24", status: "posted", posted_at: "2026-08-24T10:00:00Z",
        created_at: "2026-08-24T08:00:00Z",
        reception_payments: [],
        reception_lines: [{ expected_qty: null, received_qty: 80, unit_cost: 77.5 }],
      },
      {
        // Jamais chiffrée : le stock est entré, la facture n'est pas saisie.
        id: "r-open", reference: null, supplier_id: null, supplier_name: null,
        invoice_total: null, due_at: null, status: "draft", posted_at: null,
        created_at: "2026-09-29T08:00:00Z",
        reception_payments: [], reception_lines: [{ expected_qty: null, received_qty: 312, unit_cost: null }],
      },
    ],
    error: null,
  };

  mockGetActor.mockResolvedValue({ actor: { id: "sa", role: "super_admin", market_id: null } });
});

/**
 * LA PAGE, LA BARRE LATÉRALE ET L'API DISENT LA MÊME CHOSE.
 *
 * `canViewFinanceSection` est super_admin seul, et `finance-permissions.ts`
 * demande explicitement que les trois s'accordent : la section Finances de la
 * barre latérale est invisible aux autres rôles (`canViewFinances: false`), donc
 * ouvrir l'API à un market_manager lui donnerait une route sans écran. Le détail
 * par réception, lui, ne change pas : un manager garde les coûts et les
 * paiements d'une réception via `canSeeReceptionCosts`. C'est l'AGRÉGAT du
 * marché qui reste au propriétaire, comme le P&L et Stock & inventaire.
 */
describe("GET /api/finance/purchases — le garde", () => {
  test("un agent d'entrepôt n'entre pas : l'argent n'est pas une information de quai", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "w-1", role: "warehouse_agent", market_id: "m-ly" } });
    expect((await GET(req())).status).toBe(403);
  });

  test("un market_manager non plus — l'agrégat du marché suit le P&L", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "m-1", role: "market_manager", market_id: "m-ly" } });
    expect((await GET(req())).status).toBe(403);
  });

  test("le super_admin doit nommer un marché — il n'en a pas", async () => {
    expect((await GET(req())).status).toBe(400);
    expect((await GET(req("?market_id=m-ly"))).status).toBe(200);
  });
});

describe("GET /api/finance/purchases — les trois indicateurs", () => {
  test("le dû est la somme des soldes, acompte déduit", async () => {
    const body = await (await GET(req("?market_id=m-ly"))).json();
    // 18 720 − 7 488 versés = 11 232, plus 6 200 impayés.
    expect(body.summary.owed).toBe(17432);
  });

  test("le retard ne compte que l'échu impayé, et nomme son pire jour", async () => {
    const body = await (await GET(req("?market_id=m-ly"))).json();
    expect(body.summary.overdue).toBe(6200);
    expect(body.summary.overdueSuppliers).toBe(1);
    expect(body.summary.worstDaysLate).toBe(9);
  });

  test("la réception non chiffrée est comptée à part, jamais à zéro", async () => {
    const body = await (await GET(req("?market_id=m-ly"))).json();
    expect(body.summary.unpriced).toBe(1);
    // Elle ne gonfle pas le dû : on ignore le montant, on ne l'invente pas.
    expect(body.summary.owed).toBe(17432);
  });
});

describe("GET /api/finance/purchases — l'échéancier", () => {
  test("ne liste que ce qui reste à payer", async () => {
    const body = await (await GET(req("?market_id=m-ly"))).json();
    const ids = body.payables.map((p: { receptionId: string }) => p.receptionId);
    expect(ids).toContain("r-09");
    expect(ids).toContain("r-14");
    // Non chiffrée : rien à payer tant qu'on ne sait pas combien.
    expect(ids).not.toContain("r-open");
  });

  test("le plus urgent d'abord", async () => {
    const body = await (await GET(req("?market_id=m-ly"))).json();
    expect(body.payables[0].receptionId).toBe("r-09");
    expect(body.payables[0].state).toBe("overdue");
    expect(body.payables[0].daysLate).toBe(9);
  });

  test("porte le solde ET ce qui a déjà été versé", async () => {
    const body = await (await GET(req("?market_id=m-ly"))).json();
    const r14 = body.payables.find((p: { receptionId: string }) => p.receptionId === "r-14");
    expect(r14).toMatchObject({ balance: 11232, paid: 7488, invoiceTotal: 18720 });
  });
});

describe("GET /api/finance/purchases — les fournisseurs", () => {
  test("chaque fournisseur porte ce qu'on lui doit", async () => {
    const body = await (await GET(req("?market_id=m-ly"))).json();
    const risala = body.suppliers.find((s: { id: string }) => s.id === "s-risala");
    expect(risala).toMatchObject({ name: "مكتبة الرسالة", owed: 11232, overdue: 0 });
  });

  test("le taux de service se calcule quand l'attendu existe, et vaut null sinon", async () => {
    const body = await (await GET(req("?market_id=m-ly"))).json();
    const risala = body.suppliers.find((s: { id: string }) => s.id === "s-risala");
    const biovera = body.suppliers.find((s: { id: string }) => s.id === "s-biovera");
    // 141 reçues sur 150 annoncées.
    expect(risala.fillRate).toBe(94);
    // Rien n'a jamais été annoncé chez lui : « — », pas « 0 % » ni « 100 % ».
    expect(biovera.fillRate).toBeNull();
  });

  test("le délai moyen est null : il demande un bon de commande, qui n'existe pas encore", async () => {
    const body = await (await GET(req("?market_id=m-ly"))).json();
    for (const s of body.suppliers) expect(s.leadTimeDays).toBeNull();
  });
});
