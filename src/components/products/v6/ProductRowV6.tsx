"use client";

// One product of the list — the prototype's rowHTML() (prototypes/finances-produits-v1.html),
// cell for cell.

import { useTranslations } from "next-intl";
import { ChevronRight, Inbox } from "lucide-react";
import { groupDigits, numText, pctText, moneyText } from "@/lib/products/format";
import type { ProductOverviewRow } from "@/types/product-overview";
import { ActionMenu, type MenuAction } from "./ActionMenu";
import { Amount, ConfBar, Num, OutcomeBar, Pct, Spark, StackBar, Thumb, useUiLocale } from "./atoms";

/** « Commander » — a purchase order in Achats, pre-filled with this product. */
export function purchaseHref(locale: string, productId: string, siteId?: string | null): string {
  return `/${locale}/finance/purchases?new=po&product=${productId}${siteId ? `&site=${siteId}` : ""}`;
}

export function ProductRowV6({
  row,
  currency,
  leadDays,
  locale: appLocale,
  actions,
  onOpen,
  shareLabel,
}: {
  row: ProductOverviewRow;
  currency: string;
  leadDays: number;
  locale: string;
  actions: MenuAction[];
  onOpen: () => void;
  /** The legend's name for a share of the money (« Coût des produits », « Livraison »…). */
  shareLabel: (key: string) => string;
}) {
  const t = useTranslations("products.v6");
  const locale = useUiLocale();
  const c = row.counts;
  const low = row.is_active && row.cover !== null && row.cover < leadDays;

  const productCell = (
    <div className="pc">
      <Thumb src={row.image_url} name={row.name} />
      <div className="pn">
        <b>
          <bdi>{row.name}</bdi>
        </b>
        <div className="pm">
          {row.sku ? (
            <code className="sku" dir="auto">
              {row.sku}
            </code>
          ) : null}
          {row.default_price !== null ? <Amount value={row.default_price} currency={currency} /> : null}
          {!row.is_active ? <span className="tag">{t("c_inactive")}</span> : null}
        </div>
      </div>
    </div>
  );

  const stockCell = (
    <>
      <span className="fig">
        <Num value={row.current_stock} />
      </span>
      <span className="cs">
        {row.cover !== null ? t("c_cover", { d: numText(Math.round(row.cover)) }) : t("c_nomove")}
      </span>
      {row.cover !== null ? (
        <div className="bar1 mtr">
          <i className={low ? "low" : ""} style={{ ["--w" as string]: `${Math.min(100, (row.cover / 90) * 100).toFixed(0)}%` }} />
        </div>
      ) : null}
      {low ? (
        <span className="cellx">
          <a
            className="cmd"
            href={purchaseHref(appLocale, row.id)}
            data-tip={t("c_order_tip", { d: groupDigits(row.cover ?? 0), l: groupDigits(leadDays) })}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {t("c_order")}
            <ChevronRight className="ic" aria-hidden />
          </a>
        </span>
      ) : null}
    </>
  );

  const open = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
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

  const cls = `row${row.is_active ? "" : " off"}`;
  if (c.received === 0) {
    return (
      <div className={cls} role="link" tabIndex={0} onClick={onOpen} onKeyDown={open}>
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

  const decided = c.uploaded + c.rejected;
  const conf =
    row.confirmation === null ? (
      <span className="fig zero">—</span>
    ) : (
      <>
        <span className="fig">
          <Pct value={row.confirmation} />
        </span>
        <ConfBar rate={row.confirmation} tip={t("k_conf_s", { u: groupDigits(c.uploaded), r: groupDigits(c.rejected) })} />
        <span className="cs">{t("c_dec", { u: numText(c.uploaded), t: numText(decided) })}</span>
      </>
    );

  const delivery =
    row.delivery === null ? (
      <>
        <span className="fig zero">—</span>
        {c.withdrawn ? <span className="cs">{t("c_wd", { n: numText(c.withdrawn) })}</span> : null}
      </>
    ) : (
      <>
        <span className="fig">
          <Pct value={row.delivery} />
          {row.provisional ? (
            <span className="tag warn" data-tip={t("tip_prov")}>
              {t("c_prov")}
            </span>
          ) : null}
        </span>
        <OutcomeBar
          delivered={c.delivered}
          failed={c.failed}
          inFlight={c.in_flight}
          tips={{
            dlv: `${t("lg_dlv")} · ${groupDigits(c.delivered)}`,
            fail: `${t("lg_fail")} · ${groupDigits(c.failed)}`,
            fly: `${t("lg_fly")} · ${groupDigits(c.in_flight)}`,
          }}
        />
        <span className="cs">
          {t("c_dlvs", { d: numText(c.delivered), f: numText(c.failed) })}
          {c.in_flight ? t("c_fly", { w: numText(c.in_flight) }) : ""}
        </span>
      </>
    );

  const paid = row.money.paid;
  const money =
    paid > 0 ? (
      <>
        <span className="fig">
          <Amount value={row.money.encaisse} currency={currency} />
        </span>
        <StackBar
          shares={row.shares}
          tip={(s) => {
            const amount = row.shares.find((x) => x.key === s.key)?.amount ?? 0;
            return `${shareLabel(s.key)} · ${moneyText(amount, currency)}\n${t("tip_share", { s: groupDigits(s.share * 100) })}`;
          }}
        />
        <span className="cs">{t("c_enc")}</span>
      </>
    ) : (
      <>
        <span className="fig zero">
          <Amount value={0} currency={currency} />
        </span>
        <span className="cs neg">{t("c_adsonly", { a: moneyText(row.money.ads, currency) })}</span>
      </>
    );

  const net = (
    <>
      <span className={`fig${row.money.net < 0 ? " neg" : ""}`}>
        <Amount value={row.money.net} currency={currency} signed />
      </span>
      {row.margin !== null ? <span className="cs">{t("c_margin", { m: pctText(row.margin, locale) })}</span> : null}
    </>
  );

  return (
    <div className={cls} role="link" tabIndex={0} onClick={onOpen} onKeyDown={open}>
      <div>{productCell}</div>
      <div>{stockCell}</div>
      <div>
        <div className="ord">
          <div>
            <span className="fig">
              <Num value={c.received} />
            </span>
            <span className="cs">{t("c_rec")}</span>
          </div>
          <Spark values={row.spark} tip={`${t("tip_spark")}\n${t("tr_max", { m: groupDigits(Math.max(0, ...row.spark)) })}`} />
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
