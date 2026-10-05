"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import type { Role } from "@/types";
import { jsonFetcher } from "@/lib/fetchers";
import { isDue } from "@/lib/warehouse/desk";
import { useReceptions } from "@/hooks/useReceptions";
import type { ProjectedReception } from "@/lib/receptions/project";
import type { ProjectedPurchaseOrder } from "@/lib/purchases/orders";
import { ReceptionSheet } from "@/components/warehouse/receptions/ReceptionSheet";
import { DeskHeader, DeskPage, Ic, LiveSub, Pill, SiteSeg, Tag, Thumb, fnum, useToast } from "./ui";
import { useDeskSite } from "./useDeskSite";
import { ArrivalDrawer } from "./ArrivalDrawer";
import { SettleDrawer } from "./SettleDrawer";

/**
 * Entrepôt › Recevoir, on the desk (prototypes/entrepot-desk-v1.html).
 *
 * Promoted from a tab hidden in Stock — where, in production, no reception had
 * ever been settled. It reads left to right as the goods move:
 *   1 · En route — ordered from the supplier, not here yet;
 *   2 · Arrivé, à solder — already in stock and on sale, the invoice missing;
 *   3 · Soldé — invoice reconciled, landed cost known.
 * The dock records an arrival blind; the office settles it against the
 * invoice. A settled card opens the full reception sheet (payments, reversal).
 */

const SETTLED_SHOWN = 6;

export function ReceiveDesk({
  market,
  marketId,
  role,
  today,
}: {
  market: "ly" | "tn";
  marketId: string | null;
  role: Role;
  today: string;
}) {
  const t = useTranslations("warehouse.desk");
  const tr = useTranslations("warehouse.desk.receive");
  const locale = useLocale();
  const format = useFormatter();
  const { sites, siteId, setSite, nameOf } = useDeskSite();
  const [toast, showToast] = useToast();
  const currency = market === "ly" ? "LYD" : "TND";

  const { receptions, mutate } = useReceptions({ warehouseId: siteId });
  const { data: pos, mutate: mutatePos } = useSWR<{ orders?: ProjectedPurchaseOrder[] }>(
    marketId ? `/api/purchases/orders?status=open&market_id=${marketId}` : null,
    jsonFetcher,
  );

  const [arrival, setArrival] = useState<{ site: string | null; products: string[] } | null>(null);
  const [settleId, setSettleId] = useState<string | null>(null);
  const [sheetId, setSheetId] = useState<string | null>(null);

  const enRoute = useMemo(
    () => (pos?.orders ?? []).filter((po) => (!siteId || po.warehouse_id === siteId) && po.outstanding_units > 0),
    [pos, siteId],
  );
  const open = receptions.filter((r) => r.status === "open");
  const settled = receptions.filter((r) => r.status === "settled").slice(0, SETTLED_SHOWN);
  const settling = settleId ? receptions.find((r) => r.id === settleId) ?? null : null;

  const site = (r: { warehouse_id: string; warehouse_name?: string | null }) => nameOf(r.warehouse_id) ?? r.warehouse_name ?? "—";
  const day = (iso: string | null) =>
    iso ? format.dateTime(new Date(`${iso.slice(0, 10)}T12:00:00Z`), { day: "numeric", month: "short", timeZone: "UTC" }) : "—";
  const dayWord = (iso: string | null) => {
    if (!iso) return "—";
    const d = iso.slice(0, 10);
    if (d === today) return tr("today");
    const y = new Date(`${today}T12:00:00Z`);
    y.setUTCDate(y.getUTCDate() - 1);
    return d === y.toISOString().slice(0, 10) ? tr("yesterday") : day(d);
  };
  const lineText = (items: Array<{ qty: number; name: string }>) =>
    items.map((l, i) => (
      <span key={i}>
        {i > 0 ? " · " : ""}
        <span className="qty">{fnum(l.qty)}</span> <bdi>{l.name}</bdi>
      </span>
    ));

  const refresh = () => {
    void mutate();
    void mutatePos();
  };

  return (
    <DeskPage
      overlay={
        <>
          {arrival ? (
            <ArrivalDrawer
              marketId={marketId}
              sites={sites}
              initialSite={arrival.site}
              initialProducts={arrival.products}
              onClose={() => setArrival(null)}
              onSaved={refresh}
              onSettle={(id) => {
                setArrival(null);
                setSettleId(id);
              }}
            />
          ) : null}
          {settling ? (
            <SettleDrawer
              reception={settling}
              siteName={site(settling)}
              currency={currency}
              onClose={() => setSettleId(null)}
              onSettled={(text) => {
                setSettleId(null);
                showToast(text);
                refresh();
              }}
            />
          ) : null}
          {sheetId ? (
            <ReceptionSheet id={sheetId} locale={locale} role={role} currency={currency} onClose={() => setSheetId(null)} onChanged={refresh} />
          ) : null}
          {toast}
        </>
      }
    >
      <DeskHeader
        title={tr("title")}
        sub={<LiveSub parts={[t(`market.${market}`), tr("question")]} live={false} />}
        acts={
          <>
            <SiteSeg sites={sites} value={siteId} onChange={setSite} />
            <button type="button" className="btn" onClick={() => setArrival({ site: siteId, products: [] })}>
              <Ic n="plus" />
              {tr("record")}
            </button>
          </>
        }
      />

      <div className="pipe">
        <section className="card stage-c j-rec" aria-labelledby="ent-st1">
          <div className="sh">
            <span className="hold" style={{ width: 34, height: 34, borderRadius: 11 }}><Ic n="truck" /></span>
            <b id="ent-st1">{tr("stage1")}</b>
            <span className="n">{enRoute.length}</span>
          </div>
          <p>{tr("stage1Sub")}</p>
          {enRoute.length === 0 ? (
            <div className="empty" style={{ background: "none", padding: "22px 10px" }}>{marketId ? tr("stage1Empty") : tr("stage1NoMarket")}</div>
          ) : (
            enRoute.map((po) => {
              const pct = po.ordered_units > 0 ? Math.round((po.received_units / po.ordered_units) * 100) : 0;
              const due = isDue(po, today);
              return (
                <div className="po" key={po.id} data-testid="po-card">
                  <div className="po-h">
                    <Thumb seed={po.lines[0]?.product_id ?? po.id} />
                    <b dir="auto">{po.supplier_name ?? "—"}</b>
                    <small>{po.reference} · {nameOf(po.warehouse_id) ?? po.warehouse_name ?? "—"}</small>
                  </div>
                  <span className="l2">{lineText(po.lines.map((l) => ({ qty: l.ordered_qty, name: l.product_name })))}</span>
                  <div className="bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></div>
                  <div className="po-f">
                    <span>
                      {po.is_late && po.days_late ? (
                        <Tag hue="h-red" icon="clock">{tr("late", { n: po.days_late })}</Tag>
                      ) : due ? (
                        <Tag hue="h-amber" icon="clock">{tr("dueToday")}</Tag>
                      ) : po.wanted_by ? (
                        tr("dueOn", { date: day(po.wanted_by) })
                      ) : (
                        tr("noDate")
                      )}
                    </span>
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => setArrival({ site: po.warehouse_id, products: po.lines.filter((l) => l.outstanding_qty > 0).map((l) => l.product_id) })}
                    >
                      <Ic n="dock" />
                      {tr("arrived")}
                    </button>
                  </div>
                </div>
              );
            })
          )}
          <span className="arrow"><Ic n="right" /></span>
        </section>

        <section className="card stage-c j-rec" aria-labelledby="ent-st2">
          <div className="sh">
            <span className="hold" style={{ width: 34, height: 34, borderRadius: 11 }}><Ic n="dock" /></span>
            <b id="ent-st2">{tr("stage2")}</b>
            <span className="n">{open.length}</span>
          </div>
          <p>{tr("stage2Sub")}</p>
          {open.length === 0 ? (
            <div className="empty" style={{ background: "none", padding: "22px 10px" }}><Ic n="check" />{tr("stage2Empty")}</div>
          ) : (
            open.map((r: ProjectedReception) => (
              <button type="button" className="po" key={r.id} data-testid="open-card" onClick={() => setSettleId(r.id)} disabled={!r.can.settle}>
                <div className="po-h">
                  <Thumb seed={r.lines[0]?.product_id ?? r.id} image={r.lines[0]?.product_image_url} />
                  <b>{site(r)} · {dayWord(r.arrival_date)}</b>
                  <small>{r.counted_by_name ?? ""}</small>
                </div>
                <span className="l2">{lineText(r.lines.map((l) => ({ qty: l.received_qty ?? 0, name: l.product_name })))}</span>
                <div className="po-f">
                  <span>
                    {tr("inStock", { n: fnum(r.totals.units) })}
                    {r.totals.damaged ? <> · <span style={{ color: "var(--bad)" }}>{tr("damagedN", { n: r.totals.damaged })}</span></> : null}
                  </span>
                  {r.can.settle ? (
                    <span className="btn sm"><Ic n="receipt" />{tr("settle")}</span>
                  ) : null}
                </div>
              </button>
            ))
          )}
          <span className="arrow"><Ic n="right" /></span>
        </section>

        <section className="card stage-c h-green" aria-labelledby="ent-st3">
          <div className="sh">
            <span className="hold" style={{ width: 34, height: 34, borderRadius: 11 }}><Ic n="receipt" /></span>
            <b id="ent-st3">{tr("stage3")}</b>
            <span className="n">{receptions.filter((r) => r.status === "settled").length}</span>
          </div>
          <p>{tr("stage3Sub")}</p>
          {settled.length === 0 ? (
            <div className="empty" style={{ background: "none", padding: "22px 10px" }}>{tr("stage3Empty")}</div>
          ) : (
            settled.map((r) => (
              <button type="button" className="po" key={r.id} style={{ background: "rgba(255,255,255,.6)" }} onClick={() => setSheetId(r.id)}>
                <div className="po-h">
                  <span className="hold h-green" style={{ width: 32, height: 32, borderRadius: 10 }}><Ic n="check" /></span>
                  <b dir="auto">{r.supplier?.name ?? r.supplier_name ?? "—"}</b>
                  <small>{day(r.settled_at ?? r.arrival_date)}</small>
                </div>
                <span className="l2">
                  <span className="num">{r.reference}</span> · {tr("units", { n: fnum(r.totals.units) })}
                  {r.totals.value !== null ? <> · <b>{fnum(r.totals.value)} {currency}</b></> : null}
                </span>
                <div className="po-f">
                  {r.claim && r.claim.status === "open" ? (
                    <Pill hue="h-amber" icon="alert">{tr("claimOpen", { amount: fnum(r.claim.withheld), currency })}</Pill>
                  ) : (
                    <Pill hue="h-green" icon="check">{tr("reconciled")}</Pill>
                  )}
                </div>
              </button>
            ))
          )}
        </section>
      </div>

      <div className="card" style={{ padding: "14px 18px", display: "flex", gap: 14, alignItems: "center" }}>
        <span className="hold h-neutral"><Ic n="eyeoff" /></span>
        <div style={{ flex: 1 }}>
          <b style={{ fontSize: 14 }}>{tr("howTitle")}</b>
          <div className="l2" style={{ whiteSpace: "normal" }}>{tr("how")}</div>
        </div>
      </div>
    </DeskPage>
  );
}
