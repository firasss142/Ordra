"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { useLocale, useTranslations } from "next-intl";
import { jsonFetcher } from "@/lib/fetchers";
import type { WarehouseStockRow } from "@/app/api/warehouse/stock/route";
import { PAGE_SIZE } from "@/lib/warehouse/desk";
import { DeskHeader, DeskPage, Ic, LiveSub, Pager, Thumb, usePaged, useToast } from "./ui";
import { useDeskSite } from "./useDeskSite";

/**
 * Entrepôt › Compter, on the desk (prototypes/entrepot-desk-v1.html).
 *
 * One product at a time, never-counted first, about a minute each. The count is
 * BLIND: the operator types what is on the shelf, and only then does Ordra say
 * what it believed — a count that sees the expected figure copies it. The
 * correction is written only on « suivant », never on the reveal.
 *
 * It counts ONE building. A first count of a building draws from the stock no
 * building has counted yet (20261002190000_record_stock_count_draws_from_pool),
 * so Ordra's figure there is the register's, and the reveal says so.
 */

export function CountDesk({ market, productId }: { market: "ly" | "tn"; productId: string | null }) {
  const t = useTranslations("warehouse.desk");
  const tc = useTranslations("warehouse.desk.count");
  const locale = useLocale();
  const { sites, siteId, setSite, nameOf } = useDeskSite();
  const [toast, showToast] = useToast();
  const { data, mutate } = useSWR<{ rows: WarehouseStockRow[] }>("/api/warehouse/stock", jsonFetcher);

  // The building counted: the one in the address, else the first.
  const site = siteId ?? sites[0]?.id ?? null;

  // The order is fixed per building when the run opens; a save must not reshuffle it.
  const [order, setOrder] = useState<string[] | null>(null);
  useEffect(() => setOrder(null), [site]);
  useEffect(() => {
    if (order || !data || (sites.length > 0 && !site)) return;
    const countedAt = (r: WarehouseStockRow) =>
      site ? r.sites.find((s) => s.warehouse_id === site)?.last_counted_at ?? null : r.last_counted_at;
    const list = data.rows
      .filter((r) => !productId || r.product_id === productId)
      .sort((a, b) => {
        const ta = countedAt(a) ? new Date(countedAt(a) as string).getTime() : -1;
        const tb = countedAt(b) ? new Date(countedAt(b) as string).getTime() : -1;
        return ta - tb || a.name.localeCompare(b.name);
      })
      .map((r) => r.product_id);
    setOrder(list);
  }, [order, data, site, sites.length, productId]);

  const byId = useMemo(() => new Map((data?.rows ?? []).map((r) => [r.product_id, r])), [data]);
  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState("");
  const [shown, setShown] = useState(false);
  const [done, setDone] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setIndex(0);
    setDone([]);
    setTyped("");
    setShown(false);
  }, [site]);

  const queue = order ?? [];
  // The list beside the count turns its page on its own as the run moves on.
  const [todo, setTodoPage] = usePaged(queue, site ?? "");
  useEffect(() => setTodoPage(Math.floor(index / PAGE_SIZE) + 1), [index, setTodoPage]);
  const current = queue[index] ? byId.get(queue[index]) ?? null : null;
  const here = current && site ? current.sites.find((s) => s.warehouse_id === site) ?? null : null;
  const expected = current ? (sites.length > 1 ? here?.current_stock ?? 0 : current.current_stock) : 0;
  const firstCount = sites.length > 1 ? !here?.last_counted_at : current?.last_counted_at === null;
  const n = typed === "" ? null : Number(typed);
  const diff = n === null ? 0 : n - expected;
  const siteName = nameOf(site) ?? "";

  const next = () => {
    setIndex((i) => Math.min(i + 1, queue.length));
    setTyped("");
    setShown(false);
  };

  const confirm = async () => {
    if (!current || n === null || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/warehouse/stock/count", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: current.product_id, counted_qty: n, note: tc("note"), ...(site ? { warehouse_id: site } : {}) }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        showToast(b.error ?? tc("failed"), "bad");
        return;
      }
      showToast(tc("saved", { name: current.name, site: siteName, n }));
      setDone((d) => [...d, current.product_id]);
      void mutate();
      next();
    } finally {
      setBusy(false);
    }
  };

  const pct = queue.length ? Math.round((done.length / queue.length) * 100) : 0;
  const stockHref = `/${locale}/warehouse/stock${siteId ? `?warehouse_id=${siteId}` : ""}`;

  return (
    <DeskPage overlay={toast}>
      <DeskHeader
        title={siteName ? tc("titleAt", { site: siteName }) : tc("title")}
        sub={<LiveSub parts={[t(`market.${market}`), tc("order"), tc("pace")]} live={false} />}
        acts={
          <>
            {sites.length > 1 ? (
            <div className="seg" role="tablist" aria-label={t("siteLabel")}>
              {sites.map((s) => (
                    <button key={s.id} type="button" role="tab" aria-selected={site === s.id} className={site === s.id ? "on" : ""} onClick={() => setSite(s.id)}>
                      {s.name}
                    </button>
                  ))}
            </div>
            ) : null}
            <Link className="btn2" href={stockHref}><Ic n="x" />{tc("later")}</Link>
          </>
        }
      />

      {!data || !order ? (
        <div className="card sk" style={{ height: 420 }} aria-busy="true" />
      ) : !current ? (
        <div className="card empty" style={{ borderRadius: 22 }}>
          <Ic n="check" />
          <b>{queue.length ? tc("finished", { n: done.length }) : tc("nothing")}</b>
          <Link className="btn" href={stockHref}>{tc("backToStock")}</Link>
        </div>
      ) : (
        <div className="cnt">
          <div className="card cnt-main">
            <div className="prog j-cnt">
              <div className="bar"><i style={{ width: `${pct}%`, background: "#A16207" }} /></div>
              <span>{tc("progress", { done: done.length, total: queue.length })}</span>
            </div>
            <Thumb seed={current.product_id} image={current.image_url} size="lg" />
            <div>
              <h2><bdi>{current.name}</bdi></h2>
              <div className="q" style={{ marginTop: 6 }}>{tc("question", { site: siteName || tc("theShelves") })}</div>
            </div>
            <div className="cnt-in">
              <button type="button" aria-label={tc("less")} disabled={shown} onClick={() => setTyped(String(Math.max(0, (n ?? 0) - 1)))}><Ic n="minus" /></button>
              <input
                className="num"
                inputMode="numeric"
                value={typed}
                placeholder="0"
                disabled={shown}
                autoFocus
                aria-label={tc("counted")}
                onChange={(e) => setTyped(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && typed !== "") setShown(true);
                }}
              />
              <button type="button" aria-label={tc("more")} disabled={shown} onClick={() => setTyped(String((n ?? 0) + 1))}><Ic n="plus" /></button>
            </div>
            {shown ? (
              <>
                <div className="reveal" data-testid="reveal">
                  <div><small>{tc("youCounted")}</small><b>{n}</b></div>
                  <Ic n="minus" />
                  <div><small>{firstCount ? tc("registerSaid") : tc("ordraThought")}</small><b>{expected}</b></div>
                  <span style={{ fontSize: 22, color: "var(--ink-q)", fontWeight: 800 }}>=</span>
                  <div>
                    <small>{tc("gap")}</small>
                    <b style={{ color: diff === 0 ? "var(--good)" : diff < 0 ? "var(--bad)" : "var(--warn)" }}>
                      {diff === 0 ? "0" : `${diff > 0 ? "+" : "−"}${Math.abs(diff)}`}
                    </b>
                  </div>
                </div>
                {firstCount ? <div className="l2" style={{ whiteSpace: "normal", maxWidth: 520 }}>{tc("firstCountHint")}</div> : null}
                <div className="acts">
                  <button type="button" className="btn2" onClick={() => { setShown(false); setTyped(""); }}>{tc("recount")}</button>
                  <button type="button" className="btn" disabled={busy} onClick={() => void confirm()}>
                    <Ic n="check" />
                    {diff === 0 ? tc("rightNext") : tc("fixNext", { n: n ?? 0 })}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="acts">
                  <button type="button" className="btn2" onClick={next}>{tc("skip")}</button>
                  <button type="button" className="btn" disabled={typed === ""} onClick={() => setShown(true)}>
                    <Ic n="check" />
                    {tc("validate")}
                  </button>
                </div>
                <div className="blind" style={{ maxWidth: 520 }}><Ic n="eyeoff" />{tc("blind")}</div>
              </>
            )}
          </div>
          <div className="card todo">
            <div className="dec-h">
              <b>{tc("toCount")}</b>
              <span className="l2" style={{ margin: 0 }}>{tc("remaining", { n: queue.length - done.length })}</span>
            </div>
            {todo.rows.map((id, i) => {
              const k = (todo.page - 1) * PAGE_SIZE + i;
              const r = byId.get(id);
              if (!r) return null;
              return (
                <button type="button" key={id} data-testid="todo-item" className={`todo-i ${k === index ? "now" : ""}`} onClick={() => { setIndex(k); setTyped(""); setShown(false); }}>
                  <Thumb seed={id} image={r.image_url} />
                  <span><bdi>{r.name}</bdi></span>
                  {done.includes(id) ? <span className="ck"><Ic n="check" /></span> : <small className="l2" style={{ margin: 0 }}>{k === index ? tc("now") : ""}</small>}
                </button>
              );
            })}
            <Pager paged={todo} onPage={setTodoPage} />
          </div>
        </div>
      )}
    </DeskPage>
  );
}
