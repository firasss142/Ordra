"use client";

// One product of the list — the prototype's rowHTML(), cell for cell.

import { useTranslations } from "next-intl";
import { Inbox } from "lucide-react";
import { numText, pctText, moneyText } from "@/lib/products/format";
import type { ProductOverviewRow } from "@/types/product-overview";
import { ActionMenu, type MenuAction } from "./ActionMenu";
import { Amount, Num, Pct, Spark, StackBar, Thumb, useUiLocale } from "./atoms";

export function ProductRowV6({
  row,
  currency,
  leadDays,
  actions,
  onOpen,
}: {
  row: ProductOverviewRow;
  currency: string;
  leadDays: number;
  actions: MenuAction[];
  onOpen: () => void;
}) {
  const t = useTranslations("products.v6");
  const locale = useUiLocale();
  const c = row.counts;
  const low = row.cover !== null && row.cover < leadDays;

  const productCell = (
    <div className="prod">
      <Thumb src={row.image_url} name={row.name} size={46} />
      <div className="pn">
        <span className="pname">
          <bdi>{row.name}</bdi>
        </span>
        <div className="pmeta">
          {row.sku ? (
            <code className="sku" dir="auto">
              {row.sku}
            </code>
          ) : null}
          {row.default_price !== null ? <Amount value={row.default_price} currency={currency} /> : null}
          {!row.is_active ? <span className="pill gone xs">{t("c_inactive")}</span> : null}
        </div>
      </div>
    </div>
  );

  const stockCell = (
    <>
      <span className="big">
        <Num value={row.current_stock} />
      </span>
      <span className="sub">
        {row.cover !== null ? t("c_cover", { d: numText(Math.round(row.cover)) }) : t("c_nomove")}
      </span>
      {row.cover !== null ? (
        <div className="meter">
          <i className={low ? "low" : ""} style={{ width: `${Math.min(100, (row.cover / 90) * 100).toFixed(0)}%` }} />
        </div>
      ) : null}
      {low ? (
        <span className="pill call xs" style={{ marginTop: 6 }}>
          {t("c_restock")}
        </span>
      ) : null}
    </>
  );

  const open = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen();
    }
  };

  const menu = (
    <div>
      <ActionMenu actions={actions} label={t("a_menu")} />
    </div>
  );

  if (c.received === 0) {
    return (
      <div className={`tr${row.is_active ? "" : " off"}`} role="link" tabIndex={0} onClick={onOpen} onKeyDown={open}>
        <div>{productCell}</div>
        <div>{stockCell}</div>
        <div className="span">
          <Inbox className="ic" aria-hidden />
          {t("c_noorders")}
        </div>
        {menu}
      </div>
    );
  }

  const conf =
    row.confirmation === null ? (
      <span className="muted">—</span>
    ) : (
      <>
        <div className="rate">
          <span className="big">
            <Pct value={row.confirmation} />
          </span>
        </div>
        <div className="bar">
          <i style={{ width: `${(row.confirmation * 100).toFixed(1)}%` }} />
        </div>
        <span className="sub">{t("c_dec", { u: numText(c.uploaded), t: numText(c.uploaded + c.rejected) })}</span>
      </>
    );

  const delivery =
    row.delivery === null ? (
      <>
        <span className="big muted">—</span>
        {c.withdrawn ? <span className="sub">{t("c_wd", { n: numText(c.withdrawn) })}</span> : null}
      </>
    ) : (
      <>
        <div className="rate">
          <span className="big">
            <Pct value={row.delivery} />
          </span>
          {row.provisional ? <span className="pill call xs">{t("c_prov")}</span> : null}
        </div>
        <div className="obar">
          <i className="ok" style={{ flex: c.delivered }} />
          <i className="bd" style={{ flex: c.failed }} />
          {c.in_flight ? <i className="go" style={{ flex: c.in_flight }} /> : null}
        </div>
        <span className="sub">
          {t("c_dlvs", { d: numText(c.delivered), f: numText(c.failed) })}
          {c.in_flight ? t("c_fly", { w: numText(c.in_flight) }) : ""}
        </span>
      </>
    );

  const money =
    row.money.paid > 0 ? (
      <>
        <span className="big">
          <Amount value={row.money.encaisse} currency={currency} />
        </span>
        <StackBar shares={row.shares} />
        <span className="sub">{t("c_enc")}</span>
      </>
    ) : (
      <>
        <span className="big muted">
          <Amount value={0} currency={currency} />
        </span>
        <span className="sub neg">{t("c_adsonly", { a: moneyText(row.money.ads, currency) })}</span>
      </>
    );

  const net = (
    <>
      <span className={`big ${row.money.net < 0 ? "neg" : "pos"}`}>
        <Amount value={row.money.net} currency={currency} signed />
      </span>
      {row.margin !== null ? <span className="sub">{t("c_margin", { m: pctText(row.margin, locale) })}</span> : null}
    </>
  );

  return (
    <div className={`tr${row.is_active ? "" : " off"}`} role="link" tabIndex={0} onClick={onOpen} onKeyDown={open}>
      <div>{productCell}</div>
      <div>{stockCell}</div>
      <div>
        <div className="ord">
          <div>
            <span className="big">
              <Num value={c.received} />
            </span>
            <span className="sub">{t("c_rec")}</span>
          </div>
          <Spark values={row.spark} />
        </div>
      </div>
      <div>{conf}</div>
      <div>{delivery}</div>
      <div>{money}</div>
      <div>{net}</div>
      {menu}
    </div>
  );
}
