"use client";

/**
 * A compact product multi-select (owner, round 5: « 50 products all at once
 * would be mad on the eye »): one button, a searchable scrolling list in a
 * popover, the chosen ones as rows under it. Used for « Qui ont reçu » (with a
 * per-product date window) and for the products a list proposes.
 */
import { useCallback, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { BookOpen, ChevronDown, Search, X } from "lucide-react";
import { CheckBox, Cover, useDismiss, type ProductOption } from "./parts";
import { fmtMoney } from "./format";

export function ProductPicker({ products, value, onChange, locale, marketId, renderExtra, emptyHelp }: {
  products: ProductOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  locale: string;
  marketId: string;
  /** Extra controls under a chosen product's row (its own dates). */
  renderExtra?: (id: string) => { button: ReactNode; panel: ReactNode } | null;
  emptyHelp: string;
}) {
  const t = useTranslations("prospects.desk.wizard.picker");
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const close = useCallback(() => { setOpen(false); setQ(""); }, []);
  const ref = useDismiss(open, close);
  const byId = new Map(products.map((p) => [p.id, p]));
  const needle = q.trim().toLowerCase();
  const list = needle ? products.filter((p) => p.name.toLowerCase().includes(needle)) : products;
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  return (
    <div className="pp">
      <div className="ppa" ref={ref}>
        <button type="button" className={`ppbtn${open ? " open" : ""}`} aria-haspopup="listbox" aria-expanded={open} onClick={() => (open ? close() : setOpen(true))}>
          <BookOpen className="ic" />
          <span>{value.length ? t("picked", { n: value.length }) : t("pick")}</span>
          <small>{t("of", { n: products.length })}</small>
          <ChevronDown className={`ic${open ? " rot" : ""}`} />
        </button>
        {open ? (
          <div className="pop ppop">
            <label className="pps"><Search className="ic" /><input autoFocus value={q} placeholder={t("search")} aria-label={t("search")} onChange={(e) => setQ(e.target.value)} autoComplete="off" /></label>
            <div className="ppl" role="listbox" aria-multiselectable="true">
              {list.length ? list.map((p) => {
                const on = value.includes(p.id);
                return (
                  <button key={p.id} type="button" role="option" aria-selected={on} className={`ppo${on ? " on" : ""}`} onClick={() => toggle(p.id)}>
                    <CheckBox on={on} /><Cover product={p} w={24} />
                    <span className="ppn"><bdi>{p.name}</bdi></span>
                    {p.price !== null ? <small className="num">{fmtMoney(p.price, locale, marketId)}</small> : null}
                  </button>
                );
              }) : <p className="ppe">{t("none")}</p>}
            </div>
            <div className="popf">
              <span className="ppc">{t("count", { n: value.length })}</span>
              <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button type="button" className="lnk" disabled={!value.length} onClick={() => onChange([])}>{t("clear")}</button>
                <button type="button" className="btn pri sm" onClick={close}>{t("done")}</button>
              </span>
            </div>
          </div>
        ) : null}
      </div>
      {value.length ? (
        <div className="pprs">
          {value.map((id) => {
            const p = byId.get(id);
            if (!p) return null;
            const extra = renderExtra?.(id) ?? null;
            return (
              <div key={id} className="ppr">
                <div className="pprh">
                  <Cover product={p} w={30} />
                  <span className="ppn"><b><bdi>{p.name}</bdi></b>{p.price !== null ? <small className="num">{fmtMoney(p.price, locale, marketId)}</small> : null}</span>
                  {extra?.button}
                  <button type="button" className="ib sm" aria-label={t("remove")} onClick={() => toggle(id)}><X className="ic" /></button>
                </div>
                {extra?.panel}
              </div>
            );
          })}
        </div>
      ) : <p className="help">{emptyHelp}</p>}
    </div>
  );
}

