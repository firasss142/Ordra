"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { jsonFetcher } from "@/lib/fetchers";
import { arrivalVerdict } from "@/lib/warehouse/desk";
import { Drawer, Eb, Ic, Pill, Sec, Thumb, fnum, type DeskSite } from "./ui";

/**
 * « Enregistrer un arrivage » — the dock's gesture (prototypes/entrepot-desk-v1.html).
 *
 * A building, the products in the boxes, the counts. That is all. The stock
 * enters at once (`record_arrival`, one call per product), and the count is
 * BLIND: what was ordered is never on this screen before saving — a count
 * that sees the expected figure copies it. The comparison with the order
 * arrives afterwards, from the database's own answer.
 */

export interface CatalogueProduct {
  id: string;
  name: string;
  sku: string | null;
  image_url: string | null;
  product_variants?: Array<{ id: string; label: string; kind: string; is_active?: boolean | null }>;
}

interface Line {
  productId: string;
  variantId: string | null;
  qty: string;
  damaged: string;
}

interface Saved {
  name: string;
  productId: string;
  qty: number;
  damaged: number;
  ordered: number | null;
  receptionId: string;
}

const sizesOf = (p: CatalogueProduct | undefined) =>
  (p?.product_variants ?? []).filter((v) => v.kind === "attribute" && v.is_active !== false);
const int = (s: string) => {
  const n = Number.parseInt(s.replace(/\D/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
};

export function ArrivalDrawer({
  marketId,
  sites,
  initialSite,
  initialProducts = [],
  onClose,
  onSaved,
  onSettle,
}: {
  marketId: string | null;
  sites: DeskSite[];
  initialSite: string | null;
  /** « C'est arrivé » on an order: its products are pre-picked, never its quantities. */
  initialProducts?: string[];
  onClose: () => void;
  onSaved: () => void;
  onSettle: (receptionId: string) => void;
}) {
  const t = useTranslations("warehouse.desk.receive");
  const [site, setSite] = useState<string | null>(initialSite ?? sites[0]?.id ?? null);
  const [lines, setLines] = useState<Line[]>(initialProducts.map((id) => ({ productId: id, variantId: null, qty: "", damaged: "" })));
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved[] | null>(null);

  const { data } = useSWR<{ data: CatalogueProduct[] }>(marketId ? `/api/products/search?market_id=${marketId}` : null, jsonFetcher);
  const catalogue = useMemo(() => data?.data ?? [], [data]);
  const byId = useMemo(() => new Map(catalogue.map((p) => [p.id, p])), [catalogue]);
  const shown = useMemo(() => {
    const n = filter.trim().toLowerCase();
    const list = n ? catalogue.filter((p) => p.name.toLowerCase().includes(n) || (p.sku ?? "").toLowerCase().includes(n)) : catalogue;
    return list.slice(0, 12);
  }, [catalogue, filter]);

  const toggle = (id: string) =>
    setLines((ls) => (ls.some((l) => l.productId === id) ? ls.filter((l) => l.productId !== id) : [...ls, { productId: id, variantId: null, qty: "", damaged: "" }]));
  const patch = (i: number, p: Partial<Line>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...p } : l)));
  const step = (i: number, d: number) => patch(i, { qty: String(Math.max(0, int(lines[i].qty) + d)) });

  const units = lines.reduce((s, l) => s + int(l.qty), 0);
  const ready =
    !!site &&
    lines.length > 0 &&
    lines.every((l) => int(l.qty) > 0 && (sizesOf(byId.get(l.productId)).length === 0 || l.variantId !== null));

  const save = async () => {
    if (!ready || busy || !site) return;
    setBusy(true);
    setError(null);
    const done: Saved[] = [];
    try {
      for (const l of lines) {
        const res = await fetch("/api/warehouse/arrivals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            product_id: l.productId,
            variant_id: l.variantId,
            qty: int(l.qty),
            damaged_qty: int(l.damaged),
            warehouse_id: site,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string; ordered?: number | null; reception_id?: string };
        const name = byId.get(l.productId)?.name ?? "—";
        if (!res.ok) {
          setError(
            done.length
              ? t("saveFailedAfter", { name, n: done.length, error: body.error ?? String(res.status) })
              : t("saveFailed", { name, error: body.error ?? String(res.status) }),
          );
          if (done.length) {
            setSaved(done);
            onSaved();
          }
          return;
        }
        done.push({ name, productId: l.productId, qty: int(l.qty), damaged: int(l.damaged), ordered: body.ordered ?? null, receptionId: body.reception_id ?? "" });
      }
      setSaved(done);
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  const siteName = sites.find((s) => s.id === site)?.name ?? "—";

  if (saved) {
    const compared = saved.some((s) => s.ordered !== null);
    const total = saved.reduce((s, l) => s + l.qty, 0);
    return (
      <Drawer
        onClose={onClose}
        wide
        label={t("savedTitle")}
        head={<span className="hold j-rec"><Ic n="dock" /></span>}
        title={t("savedTitle")}
        sub={siteName}
        foot={
          <>
            <button type="button" className="btn2" onClick={onClose}>{t("close")}</button>
            <span className="grow" />
            {saved[0]?.receptionId ? (
              <button type="button" className="btn" onClick={() => onSettle(saved[0].receptionId)}>
                <Ic n="receipt" />
                {t("settleNow")}
              </button>
            ) : null}
          </>
        }
      >
        {error ? <div className="err" role="alert">{error}</div> : null}
        <div className="ok-big">
          <span className="hold"><Ic n="check" /></span>
          <div>
            <b>{t("savedUnits", { n: fnum(total), site: siteName })}</b>
            <small>{t("savedSub")}</small>
          </div>
        </div>
        {compared ? (
          <Sec>
            <Eb icon="list">{t("compared")}</Eb>
            {saved.map((s) => {
              const v = arrivalVerdict({ ordered: s.ordered, counted: s.qty, damaged: s.damaged });
              return (
                <div className="res" key={s.productId} data-testid="arrival-verdict">
                  <Thumb seed={s.productId} image={byId.get(s.productId)?.image_url} />
                  <div>
                    <b><bdi>{s.name}</bdi></b>
                    <small>
                      {s.ordered !== null ? t("orderedCounted", { o: s.ordered, c: s.qty + s.damaged }) : t("countedOnly", { c: s.qty + s.damaged })}
                      {s.damaged ? ` ${t("ofWhichDamaged", { n: s.damaged })}` : ""}
                    </small>
                  </div>
                  {v.kind === "off" ? (
                    <Pill hue="h-violet">{t("vOff")}</Pill>
                  ) : v.kind === "complete" ? (
                    <Pill hue="h-green" icon="check">{t("vComplete")}</Pill>
                  ) : v.kind === "short" ? (
                    <Pill hue="h-amber" icon="alert">{t("vShort", { n: v.n })}</Pill>
                  ) : v.kind === "damaged" ? (
                    <Pill hue="h-red" icon="broken">{t("vDamaged", { n: v.n })}</Pill>
                  ) : (
                    <Pill hue="h-violet">{t("vOver", { n: v.n })}</Pill>
                  )}
                </div>
              );
            })}
            <div className="l2" style={{ whiteSpace: "normal" }}>{t("comparedFoot")}</div>
          </Sec>
        ) : null}
      </Drawer>
    );
  }

  return (
    <Drawer
      onClose={onClose}
      wide
      label={t("recordTitle")}
      head={<span className="hold j-rec"><Ic n="dock" /></span>}
      title={t("recordTitle")}
      sub={t("recordSub")}
      foot={
        <>
          <button type="button" className="btn2" onClick={onClose}>{t("cancel")}</button>
          <span className="grow" />
          <span className="l2" style={{ margin: 0, marginInlineEnd: 8 }}>{t("willEnter", { n: fnum(units) })}</span>
          <button type="button" className="btn" disabled={!ready || busy} onClick={() => void save()}>
            <Ic n="check" />
            {t("save")}
          </button>
        </>
      }
    >
      <Sec>
        <Eb icon="pin">{t("where")}</Eb>
        <div className="seg" style={{ justifySelf: "start" }} role="radiogroup" aria-label={t("where")}>
          {sites.map((s) => (
            <button key={s.id} type="button" role="radio" aria-checked={site === s.id} className={site === s.id ? "on" : ""} onClick={() => setSite(s.id)}>
              {s.name}
            </button>
          ))}
        </div>
      </Sec>
      <Sec>
        <Eb icon="boxes" aside={t("tapToAdd")}>{t("what")}</Eb>
        {catalogue.length > 12 ? (
          <input className="inp" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t("filterProducts")} aria-label={t("filterProducts")} />
        ) : null}
        <div className="picker">
          {shown.map((p) => {
            const on = lines.some((l) => l.productId === p.id);
            return (
              <button key={p.id} type="button" className={`ptile ${on ? "on" : ""}`} aria-pressed={on} onClick={() => toggle(p.id)}>
                <Thumb seed={p.id} image={p.image_url} />
                <span dir="auto">{p.name}</span>
              </button>
            );
          })}
        </div>
      </Sec>
      <Sec>
        <Eb icon="count" aside={t("nProducts", { n: lines.length })}>{t("howMany")}</Eb>
        {lines.length === 0 ? (
          <div className="empty" style={{ padding: 22, background: "none" }}>{t("noLine")}</div>
        ) : (
          lines.map((l, i) => {
            const p = byId.get(l.productId);
            const sizes = sizesOf(p);
            return (
              <div className="line" key={l.productId} data-testid="arrival-line">
                <Thumb seed={l.productId} image={p?.image_url} />
                <div>
                  <span className="nm"><bdi>{p?.name ?? "…"}</bdi></span>
                  {sizes.length ? (
                    <select className="inp" style={{ height: 30, marginTop: 4 }} value={l.variantId ?? ""} onChange={(e) => patch(i, { variantId: e.target.value || null })} aria-label={t("size")}>
                      <option value="">{t("pickSize")}</option>
                      {sizes.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                    </select>
                  ) : (
                    <span className="l2">{t("goodCondition")}</span>
                  )}
                </div>
                <div className="qin">
                  <button type="button" aria-label={t("less")} onClick={() => step(i, -1)}><Ic n="minus" /></button>
                  <input className="num" inputMode="numeric" value={l.qty} placeholder="0" aria-label={t("qtyOf", { name: p?.name ?? "" })} onChange={(e) => patch(i, { qty: e.target.value.replace(/\D/g, "") })} />
                  <button type="button" aria-label={t("more")} onClick={() => step(i, 1)}><Ic n="plus" /></button>
                </div>
                <div className="dmg">
                  <label htmlFor={`dmg-${l.productId}`}>{t("ofWhichDamagedLabel")}</label>
                  <input id={`dmg-${l.productId}`} className="num" inputMode="numeric" value={l.damaged} placeholder="0" onChange={(e) => patch(i, { damaged: e.target.value.replace(/\D/g, "") })} />
                </div>
                <button type="button" className="kb" aria-label={t("remove")} onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))}><Ic n="x" /></button>
              </div>
            );
          })
        )}
        <div className="blind"><Ic n="eyeoff" />{t("blind")}</div>
      </Sec>
      {error ? <div className="err" role="alert">{error}</div> : null}
    </Drawer>
  );
}
