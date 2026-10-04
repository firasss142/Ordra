import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewFinanceSection } from "@/lib/finance-permissions";
import { payable, summarise, rollupSuppliers, type PayableRow } from "@/lib/purchases/derive";
import { withRouteErrors } from "@/lib/journal/route-errors";
import {
  projectPurchaseOrder,
  supplierReliability,
  type PurchaseOrderRow,
} from "@/lib/purchases/orders";
import {
  claimEffect,
  disputedTotal,
  summariseClaims,
  type SupplierClaim,
} from "@/lib/purchases/claims";

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

async function handleGET(req: NextRequest) {
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

  const [receptionsRes, suppliersRes, ordersRes, claimsRes] = await Promise.all([
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
    supabase
      .from("purchase_orders")
      .select(
        "id, reference, market_id, warehouse_id, supplier_id, status, wanted_by, ordered_at, closed_at, close_reason, note",
      )
      .eq("market_id", marketId),
    supabase
      .from("supplier_claims")
      .select(
        "id, market_id, supplier_id, reception_id, kind, amount, units, status, opened_at, resolved_at, resolution_note, credit_ref",
      )
      .eq("market_id", marketId),
  ]);

  if (receptionsRes.error) {
    return NextResponse.json({ error: receptionsRes.error.message }, { status: 500 });
  }

  const receptions = (receptionsRes.data ?? []) as unknown as RawReception[];
  const suppliers = (suppliersRes.data ?? []) as unknown as RawSupplier[];

  /*
   * LES LITIGES. `invoice_total` porte ce que le fournisseur a ÉCRIT ; un litige
   * dit ce qu'on REFUSE DE PAYER. Sans cette soustraction, l'échéancier
   * réclamerait des unités arrivées cassées — et continuerait de les réclamer
   * APRÈS que le fournisseur a émis son avoir.
   */
  const claims: SupplierClaim[] = ((claimsRes.data ?? []) as unknown as Array<
    Record<string, unknown>
  >).map((c) => ({
    id: c.id as string,
    supplierId: c.supplier_id as string,
    receptionId: (c.reception_id as string | null) ?? null,
    kind: c.kind as SupplierClaim["kind"],
    amount: Number(c.amount ?? 0),
    units: c.units === null || c.units === undefined ? null : Number(c.units),
    status: c.status as SupplierClaim["status"],
    openedAt: c.opened_at as string,
    resolvedAt: (c.resolved_at as string | null) ?? null,
    resolutionNote: (c.resolution_note as string | null) ?? null,
    creditRef: (c.credit_ref as string | null) ?? null,
  }));

  // Par réception, parce que la retenue appartient à UNE facture.
  const withheldByReception = new Map<string, number>();
  for (const c of claims) {
    if (!c.receptionId) continue;
    const w = claimEffect(c).withheld;
    if (w === 0) continue;
    withheldByReception.set(c.receptionId, (withheldByReception.get(c.receptionId) ?? 0) + w);
  }
  const claimsBySupplier = summariseClaims(claims);

  /*
   * LES COMMANDES, PAR FOURNISSEUR — ce qui allume enfin les deux colonnes.
   *
   * Deuxième requête pour les lignes : `purchase_order_line_progress` est une
   * VUE, et PostgREST ne garantit pas de déduire sa relation vers
   * `purchase_orders`. Un `select` imbriqué qui échoue rendrait un tableau vide
   * — donc « 0 % de taux de service » pour tout le monde, ce qui est bien pire
   * qu'une colonne vide.
   */
  const poRows = (ordersRes.data ?? []) as unknown as Array<Record<string, unknown>>;
  const poIds = poRows.map((o) => o.id as string);
  const { data: poLineRows } = poIds.length
    ? await supabase
        .from("purchase_order_line_progress")
        .select(
          "id, purchase_order_id, product_id, variant_id, ordered_qty, unit_cost, received_qty, first_received_at",
        )
        .in("purchase_order_id", poIds)
    : { data: [] };

  const poLinesBy = new Map<string, PurchaseOrderRow["lines"]>();
  for (const raw of (poLineRows ?? []) as unknown as Array<Record<string, unknown>>) {
    const key = raw.purchase_order_id as string;
    const bucket = poLinesBy.get(key) ?? [];
    bucket.push({
      id: raw.id as string,
      product_id: raw.product_id as string,
      product_name: "",
      variant_id: (raw.variant_id as string | null) ?? null,
      variant_label: null,
      ordered_qty: Number(raw.ordered_qty ?? 0),
      unit_cost:
        raw.unit_cost === null || raw.unit_cost === undefined ? null : Number(raw.unit_cost),
      received_qty: Number(raw.received_qty ?? 0),
      first_received_at: (raw.first_received_at as string | null) ?? null,
    });
    poLinesBy.set(key, bucket);
  }

  const ordersBySupplier = new Map<string, PurchaseOrderRow[]>();
  for (const o of poRows) {
    const sid = o.supplier_id as string;
    const row = {
      ...o,
      warehouse_name: null,
      supplier_name: null,
      ordered_by_name: null,
      lines: poLinesBy.get(o.id as string) ?? [],
    } as unknown as PurchaseOrderRow;
    ordersBySupplier.set(sid, [...(ordersBySupplier.get(sid) ?? []), row]);
  }

  // Une réception contre-passée n'est plus un achat ni une dette.
  const live = receptions.filter((r) => r.status !== "reversed" && r.status !== "cancelled");

  const rows: PayableRow[] = live.map((r) => ({
    receptionId: r.id,
    supplierId: r.supplier_id,
    invoiceTotal: r.invoice_total === null ? null : Number(r.invoice_total),
    paid: sumPaid(r),
    dueAt: r.due_at,
    withheld: withheldByReception.get(r.id) ?? 0,
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
          withheld: withheldByReception.get(r.id) ?? 0,
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
      // Ce qui est retiré de cette facture, pour que la ligne puisse l'expliquer
      // au lieu de montrer un solde inférieur à la facture sans raison visible.
      withheld: withheldByReception.get(r.id) ?? 0,
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

      /*
       * LE TAUX DE SERVICE ET LE DÉLAI VIENNENT DES BONS DE COMMANDE, et de rien
       * d'autre. `reception_lines.expected_qty` ne les portera jamais : personne
       * n'écrit un attendu dans un formulaire vide, et il est NULL partout en
       * production. Le voilà mesuré contre NOTRE PROPRE PLAN, ce qui est plus
       * utile que contre le papier du fournisseur.
       *
       * On ne note que les commandes TERMINÉES : tant qu'une commande court, le
       * reste peut encore arriver, et la juger maintenant condamnerait tout
       * fournisseur dont le camion roule. Aucune commande terminée ⇒ `null`, pas
       * 0 % (« il ne livre jamais ») ni 100 % (« il livre toujours »).
       */
      const myOrders = ordersBySupplier.get(s.id) ?? [];
      const rel = supplierReliability(myOrders, now);
      const fillRate = rel.service_rate === null ? null : Math.round(rel.service_rate * 100);

      // Ce qui est engagé mais pas arrivé — la contrepartie du « en route » de
      // Niveaux, vue depuis l'ardoise du fournisseur.
      const openProjected = myOrders
        .filter((o) => o.status === "open")
        .map((o) => projectPurchaseOrder(o, now));
      const onOrderUnits = openProjected.reduce((a, o) => a + o.outstanding_units, 0);

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
        /* `null` ET JAMAIS `0` : « rien en litige » ne doit pas se lire comme
           « on a vérifié, il n'y a rien ». */
        disputed: claimsBySupplier.get(s.id)?.disputed || null,
        openClaims: claimsBySupplier.get(s.id)?.openCount ?? 0,
        fillRate,
        /** Médiane et non moyenne : un conteneur bloqué trois mois en douane
         *  déplacerait une moyenne de plusieurs semaines et ferait commander
         *  trop tôt, pour toujours. */
        leadTimeDays: rel.lead_time_days,
        /** Combien de commandes terminées nourrissent la note, pour que le
         *  lecteur sache si « 94 % » pèse une commande ou trente. */
        closedOrders: rel.sample_orders,
        openOrders: openProjected.length,
        onOrderUnits: onOrderUnits > 0 ? onOrderUnits : null,
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
    summary: {
      ...summary,
      purchases30d,
      windowDays: WINDOW_DAYS,
      // L'argent en jeu mais pas encore dû : ni dans `owed`, ni oublié.
      disputed: disputedTotal(claims),
    },
    payables,
    suppliers: supplierRows,
  });
}

/*
 * Chaque gestionnaire passe par `withRouteErrors`, sinon ses 500 n'arrivent
 * jamais dans Journaux › « Ordra — erreurs et sécurité ». Un test du dépôt
 * (`routes-are-wrapped`) refuse toute route qui exporte un gestionnaire nu.
 */
export const GET = withRouteErrors("/api/finance/purchases", "GET", handleGET);
