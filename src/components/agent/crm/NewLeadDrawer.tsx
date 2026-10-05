"use client";

/**
 * « Nouveau prospect » — the drawer of the prototype's `overlays()` (S.newlead). It went nowhere
 * before (the button pushed `?new=1`, which nothing read); it now creates the lead through
 * POST /api/leads, which self-assigns it to the agent. The name is required because
 * `leads.customer_name` is NOT NULL and the route refuses a lead without one.
 */
import { useState } from "react";
import useSWR from "swr";
import { Ic } from "@/components/agent/shared";
import { fetcher } from "@/lib/swr-config";
import { MARKET_DIAL_CODE } from "@/lib/markets";
import type { CrmWords } from "./words";

interface Product { id: string; name: string }

export function NewLeadDrawer({ w, marketId, onClose, onCreated }: {
  w: CrmWords;
  marketId: string | null;
  onClose: () => void;
  onCreated: (lead: { id: string; status: string; created_at: string }) => void;
}) {
  const { t } = w;
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [product, setProduct] = useState("");
  const [said, setSaid] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data } = useSWR<{ data: Product[] }>(
    marketId ? `/api/products?market_id=${marketId}&is_active=true&limit=200` : null,
    fetcher,
    { revalidateOnFocus: false },
  );
  const products = data?.data ?? [];

  const save = async () => {
    const digits = phone.replace(/\D/g, "");
    if (!digits) return setErr(t("nl.errPhone"));
    if (!name.trim()) return setErr(t("nl.errName"));
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_phone: digits,
          customer_name: name.trim(),
          source: "manual_call",
          product_interest_id: product || null,
          notes: said.trim() || null,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.data?.id) {
        const why = typeof json?.error === "string" ? json.error : null;
        setErr(why ? `${t("nl.errGeneric")} (${why})` : t("nl.errGeneric"));
        return;
      }
      onCreated(json.data);
    } catch {
      setErr(t("nl.errGeneric"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={t("nl.title")}>
        <div className="dr-top">
          <span className="dr-title"><b>{t("nl.title")}</b><small>{t("nl.sub")}</small></span>
          <button type="button" className="xbtn" onClick={onClose} aria-label={t("nl.close")}><Ic n="x" /></button>
        </div>
        <div className="dr-body" style={{ paddingBottom: 18 }}>
          <section className="fs">
            <div className="fld">
              <label htmlFor="nl-phone">{t("nl.phone")}<i>*</i></label>
              <div className="inp-pre">
                <span>+{MARKET_DIAL_CODE[w.code]}</span>
                <input id="nl-phone" className="inp" inputMode="tel" placeholder="91 234 5678" value={phone} onChange={(e) => setPhone(e.target.value)} autoFocus />
              </div>
            </div>
            <div className="fld">
              <label htmlFor="nl-name">{t("nl.name")}<i>*</i></label>
              <input id="nl-name" className="inp" dir="auto" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="fld">
              <label htmlFor="nl-product">{t("nl.product")}</label>
              <select id="nl-product" className="inp" value={product} onChange={(e) => setProduct(e.target.value)}>
                <option value="">{t("nl.noProduct")}</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="fld">
              <label htmlFor="nl-said">{t("nl.said")}</label>
              <textarea id="nl-said" className="inp" dir="auto" value={said} onChange={(e) => setSaid(e.target.value)} />
            </div>
            {err ? <p className="err" role="alert">{err}</p> : null}
          </section>
        </div>
        <div className="dr-foot">
          <button type="button" className="fa" onClick={onClose}>{t("nl.cancel")}</button>
          <button type="button" className="fa pri wide" disabled={busy} onClick={() => void save()}>
            <Ic n="check" /><span>{t("nl.create")}</span>
          </button>
        </div>
      </aside>
    </>
  );
}
