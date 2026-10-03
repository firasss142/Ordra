import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewFinanceSection } from "@/lib/finance-permissions";
import { payable, summarise, rollupSuppliers, type PayableRow } from "@/lib/purchases/derive";

export const dynamic = "force-dynamic";

/**
 * Finances › Achats — ce qu'on doit aux fournisseurs, et à qui on peut se fier.
 *
 * DEUX QUESTIONS, PAS UN TABLEAU DE BORD. « Qu'est-ce que je dois, et quand » est
 * la seule chose sur laquelle on agit ; « à qui puis-je me fier » est ce qui
 * décide du prochain achat. Tout le reste (dépense 90 j, nombre de réceptions)
 * est de la curiosité et descend en sous-ligne.
 *
 * LE GARDE SUIT LE P&L. `canViewFinanceSection` est super_admin seul et
 * `finance-permissions.ts` demande que la page, la barre latérale et l'API
 * s'accordent. Un market_manager garde les coûts et les paiements D'UNE
 * réception (`canSeeReceptionCosts`) ; c'est l'agrégat du marché qui reste au
 * propriétaire, comme Stock & inventaire.
 */

const WINDOW_DAYS = 30;
const SPEND_WINDOW_DAYS = 90;

interface RawLine {
  expected_qty: number | null;
  received_qty: number | null;
  unit_cost: number | null;
}

interface RawReception {
  id: string;
  reference: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  invoice_total: number | null;
  due_at: string | null;
  status: string;
  posted_at: string | null;
  created_at: string;
  reception_payments: { amount: number }[] | null;
  reception_lines: RawLine[] | null;
}

interface RawSupplier {
  id: string;
  name: string;
  category: string | null;
  city: string | null;
  is_active: boolean;
}

function daysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

/** La date qui compte pour une réception : quand elle est devenue un achat. */
function purchasedAt(r: RawReception): string {
  return r.posted_at ?? r.created_at;
}

function sumPaid(r: RawReception): number {
  return (r.reception_payments ?? []).reduce((a, p) => a + Number(p.amount ?? 0), 0);
}

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canViewFinanceSection(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Les deux super_admins de production ont `market_id` NULL — le marché ne peut
  // donc pas venir de l'acteur, il doit être nommé.
  const marketId =
    actor.role === "super_admin" ? req.nextUrl.searchParams.get("market_id") : actor.market_id;
  if (!marketId) {
    return NextResponse.json({ error: "market_id query parameter required" }, { status: 400 });
  }

  const supabase = await createClient();
  const now = new Date();

  const [receptionsRes, suppliersRes] = await Promise.all([
    supabase
      .from("receptions")
      .select(
        "id, reference, supplier_id, supplier_name, invoice_total, due_at, status, posted_at, created_at, " +
          "reception_payments ( amount ), reception_lines ( expected_qty, received_qty, unit_cost )"
      )
      .eq("market_id", marketId),
    supabase
      .from("suppliers")
      .select("id, name, category, city, is_active")
      .eq("market_id", marketId)
      .order("name"),
  ]);

  if (receptionsRes.error) {
    return NextResponse.json({ error: receptionsRes.error.message }, { status: 500 });
  }

  const receptions = (receptionsRes.data ?? []) as unknown as RawReception[];
  const suppliers = (suppliersRes.data ?? []) as unknown as RawSupplier[];

  // Une réception contre-passée n'est plus un achat ni une dette.
  const live = receptions.filter((r) => r.status !== "reversed" && r.status !== "cancelled");

  const rows: PayableRow[] = live.map((r) => ({
    receptionId: r.id,
    supplierId: r.supplier_id,
    invoiceTotal: r.invoice_total === null ? null : Number(r.invoice_total),
    paid: sumPaid(r),
    dueAt: r.due_at,
  }));

  const summary = summarise(rows, now);
  const owedBySupplier = new Map(rollupSuppliers(rows, now).map((s) => [s.supplierId, s]));

  // ── L'échéancier : seulement ce qui reste à payer, le plus urgent d'abord ──
  const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));
  const payables = live
    .map((r) => {
      const p = payable(
        {
          invoiceTotal: r.invoice_total === null ? null : Number(r.invoice_total),
          paid: sumPaid(r),
          dueAt: r.due_at,
        },
        now
      );
      return { r, p };
    })
    // `unknown` (facture non chiffrée) et `paid` ne sont pas des dettes à régler.
    .filter(({ p }) => p.state === "due" || p.state === "overdue")
    .map(({ r, p }) => ({
      receptionId: r.id,
      reference: r.reference,
      supplierId: r.supplier_id,
      // Le nom libre reste le secours tant qu'une réception n'est pas attribuée.
      supplierName: (r.supplier_id ? supplierName.get(r.supplier_id) : null) ?? r.supplier_name,
      purchasedAt: purchasedAt(r),
      invoiceTotal: r.invoice_total === null ? null : Number(r.invoice_total),
      paid: sumPaid(r),
      balance: p.balance,
      dueAt: r.due_at,
      state: p.state,
      daysLate: p.daysLate,
    }))
    .sort((a, b) => {
      // En retard d'abord, du plus ancien ; puis par échéance ; puis sans date.
      const late = (b.daysLate ?? -1) - (a.daysLate ?? -1);
      if (late !== 0) return late;
      if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt);
      if (a.dueAt) return -1;
      if (b.dueAt) return 1;
      return 0;
    });

  // ── Les fournisseurs ───────────────────────────────────────────────────────
  const since90 = daysAgo(now, SPEND_WINDOW_DAYS);
  const supplierRows = suppliers
    .filter((s) => s.is_active)
    .map((s) => {
      const mine = live.filter((r) => r.supplier_id === s.id);
      const owed = owedBySupplier.get(s.id);

      const spend90d = mine
        .filter((r) => purchasedAt(r) >= since90 && r.invoice_total !== null)
        .reduce((a, r) => a + Number(r.invoice_total), 0);

      // LE TAUX DE SERVICE NE SE CALCULE QUE SUR CE QUI A ÉTÉ ANNONCÉ. Aucune
      // ligne annoncée ⇒ `null`, pas 0 % (qui dirait « il ne livre jamais ») ni
      // 100 % (qui dirait « il livre toujours »). Aujourd'hui en production
      // `expected_qty` est NULL partout faute de bon de commande, donc la colonne
      // reste vide — et elle s'allumera d'elle-même le jour où les commandes
      // existent, sans rien changer ici.
      let expected = 0;
      let received = 0;
      for (const r of mine) {
        for (const l of r.reception_lines ?? []) {
          if (l.expected_qty === null) continue;
          expected += l.expected_qty;
          received += l.received_qty ?? 0;
        }
      }
      const fillRate = expected > 0 ? Math.round((received / expected) * 100) : null;

      const lastDeliveryAt =
        mine.map(purchasedAt).sort().at(-1) ?? null;

      return {
        id: s.id,
        name: s.name,
        category: s.category,
        city: s.city,
        receptions: mine.length,
        spend90d,
        owed: owed?.owed ?? 0,
        overdue: owed?.overdue ?? 0,
        fillRate,
        // LE DÉLAI DEMANDE UN BON DE COMMANDE. Il se mesure de la commande au
        // quai ; `expected_at` est une date d'arrivée espérée, pas une date de
        // commande, donc rien ici ne permet de le calculer. `null` jusqu'à
        // l'étape 6 du plan, et l'écran écrit « — ».
        leadTimeDays: null as number | null,
        lastDeliveryAt,
      };
    })
    .sort((a, b) => b.owed - a.owed || b.spend90d - a.spend90d);

  // ── Ce qu'on a acheté sur la fenêtre ───────────────────────────────────────
  const since30 = daysAgo(now, WINDOW_DAYS);
  const recent = live.filter((r) => purchasedAt(r) >= since30);
  const purchases30d = recent
    .filter((r) => r.invoice_total !== null)
    .reduce((a, r) => a + Number(r.invoice_total), 0);

  return NextResponse.json({
    marketId,
    summary: { ...summary, purchases30d, windowDays: WINDOW_DAYS },
    payables,
    suppliers: supplierRows,
  });
}
