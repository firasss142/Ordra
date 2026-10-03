"use client";

// /products/[id] — the prototype's product sheet (prototypes/products-v6.html:
// detailScreen, whyHTML, moneyHTML, agentsHTML, stockAndSheet), approved by the
// owner on 2026-10-03. Figures come computed from /api/products/[id]/overview;
// the product itself from /api/products/[id], which every viewer may read.

import { useMemo } from "react";
import Link from "next/link";
import useSWR from "swr";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Box,
  Check,
  ChevronRight,
  CircleX,
  Clock,
  FileText,
  FileX,
  Inbox,
  Info,
  MessageSquareText,
  Pencil,
  Phone,
  PhoneOff,
  ScanLine,
  ThumbsDown,
  TriangleAlert,
  Truck,
  TrendingUp,
  Wallet,
  Ban,
} from "lucide-react";
import type { Role } from "@/types";
import { fetcher } from "@/lib/swr-config";
import { marketIdToCode, marketTimezone } from "@/lib/markets";
import { resolvePeriod, type DayRange } from "@/lib/products/period";
import {
  dayLabel,
  dayTimeLabel,
  groupDigits,
  instantDayLabel,
  moneyText,
  numText,
  pctText,
  rangeLabel,
} from "@/lib/products/format";
import { useProductSheetOverview } from "@/hooks/useProductsOverview";
import { canArchiveProduct, canToggleProductActive } from "@/lib/product-permissions";
import type { ProductSheetOverviewResponse } from "@/types/product-overview";
import { ActionMenu, type MenuAction } from "./ActionMenu";
import { Amount, Bars, Kpi, Num, Pct, SHARE_CLASS, Spark, Thumb, useUiLocale } from "./atoms";
import { OutcomeFlow } from "./OutcomeFlow";
import { PeriodSeg } from "./PeriodSeg";
import { useProductActions } from "./useProductActions";
import "./products-v6.css";

/** The product row as GET /api/products/[id] returns it. */
export interface SheetProduct {
  id: string;
  market_id: string;
  name: string;
  sku: string | null;
  image_url: string | null;
  is_active: boolean;
  default_price: number | null;
  current_stock: number;
  low_stock_threshold: number;
  unit_cogs: number;
  damaged_return_count: number;
  initial_stock: number;
  agent_brief: string | null;
  agent_brief_tone: string | null;
  agent_composition: string | null;
  agent_usage: string | null;
  agent_contraindications: string | null;
}

const GROUP_ICON: Record<string, typeof FileX> = {
  commande_invalide: FileX,
  autre: MessageSquareText,
  refus_client: ThumbsDown,
  injoignable: PhoneOff,
  livraison_impossible: Ban,
};

export function ProductSheetV6({ productId, role, locale }: { productId: string; role: Role; locale: string }) {
  const t = useTranslations("products.v6");
  const tReasons = useTranslations("orders.rejectionReasons");
  const ui = useUiLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const { data: productRes, mutate: mutateProduct } = useSWR<{ data: SheetProduct }>(
    `/api/products/${encodeURIComponent(productId)}`,
    fetcher,
  );
  const product = productRes?.data;
  const tz = marketTimezone(product?.market_id ?? null);
  const period: DayRange = useMemo(() => resolvePeriod(params.get("from"), params.get("to"), tz), [params, tz]);

  const canMoney = role === "super_admin" || role === "market_manager";
  const { data: o, mutate: mutateOverview } = useProductSheetOverview(productId, period, canMoney && Boolean(product));
  const actions = useProductActions(async () => {
    await Promise.all([mutateProduct(), mutateOverview()]);
  });

  if (!product) {
    return (
      <div className="pv6 page">
        <div className="card empty-q">{t("loading")}</div>
      </div>
    );
  }

  const currency = o?.currency ?? (marketIdToCode(product.market_id) === "ly" ? "LYD" : "TND");
  const invoiced = currency === "LYD";
  const canEdit = role === "super_admin" || role === "market_manager";
  const isSa = role === "super_admin";

  const menu: MenuAction[] = [];
  if (canToggleProductActive(role))
    menu.push({
      key: "active",
      label: product.is_active ? t("a_deactivate") : t("a_activate"),
      onSelect: () => void actions.setActive(product.id, !product.is_active),
    });
  if (canArchiveProduct(role) && !product.is_active)
    menu.push({
      key: "archive",
      label: t("a_archive"),
      danger: true,
      onSelect: async () => {
        actions.openArchive(product.id, product.name);
      },
    });

  const setPeriod = (r: DayRange) => {
    const sp = new URLSearchParams(params.toString());
    sp.set("from", r.from);
    sp.set("to", r.to);
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  };

  const hero = (
    <>
      <nav className="crumb" aria-label="breadcrumb">
        <Link href={`/${locale}/products?from=${period.from}&to=${period.to}`}>
          <span>{t("crumb_products")}</span>
        </Link>
        <ChevronRight className="ic chev" aria-hidden />
        <span dir="auto">{product.name}</span>
      </nav>
      <div className="hero">
        <Thumb src={product.image_url} name={product.name} size={84} radius={16} />
        <div className="grow">
          <h1>
            <bdi>{product.name}</bdi>
          </h1>
          <div className="chips">
            {product.is_active ? (
              <span className="pill ok">
                <Check className="ic" aria-hidden />
                {t("ch_active")}
              </span>
            ) : (
              <span className="pill gone">{t("ch_inactive")}</span>
            )}
            {product.sku ? (
              <code className="sku" dir="auto">
                {product.sku}
              </code>
            ) : null}
            {product.default_price !== null ? (
              <span className="pill line">
                <Amount value={Number(product.default_price)} currency={currency} /> · {t("ch_price")}
              </span>
            ) : null}
          </div>
          {o?.last_order_at ? (
            <div className="meta">
              <Clock className="ic" aria-hidden />
              {t("last_order", { d: dayTimeLabel(o.last_order_at, tz, ui) })}
            </div>
          ) : null}
        </div>
        <div className="acts">
          {canEdit ? (
            <Link className="btn pri" href={`/${locale}/products/${product.id}/edit${isSa ? "" : "?tab=fiche"}`}>
              <Pencil className="ic" aria-hidden />
              {t("b_edit")}
            </Link>
          ) : null}
          {isSa ? (
            <button type="button" className="btn" onClick={() => actions.openStock(product.id, product.name)}>
              <Box className="ic" aria-hidden />
              {t("b_adjust")}
            </button>
          ) : null}
          <ActionMenu actions={menu} label={t("a_menu")} />
        </div>
      </div>
    </>
  );

  const stockAndSheet = <StockAndSheet product={product} o={o} currency={currency} locale={locale} role={role} tz={tz} onAdjust={() => actions.openStock(product.id, product.name)} />;

  if (!canMoney) {
    return (
      <div className="pv6 page">
        {actions.modals}
        {hero}
        {stockAndSheet}
      </div>
    );
  }

  const periodBar = (
    <div className="pbar2">
      <PeriodSeg period={period} tz={tz} onChange={setPeriod} />
      <span className="rng">
        <Clock className="ic" aria-hidden />
        {rangeLabel(period.from, period.to, ui)}
        {o?.final != null ? (
          <>
            {" · "}
            <span className={`pill ${o.final >= 0.9 ? "ok" : "call"} xs`}>{t("final_pct", { p: pctText(o.final, ui) })}</span>
          </>
        ) : null}
      </span>
    </div>
  );

  if (!o) {
    return (
      <div className="pv6 page">
        {actions.modals}
        {hero}
        {periodBar}
        <div className="card empty-q">{t("loading")}</div>
      </div>
    );
  }

  const c = o.counts;
  if (c.received === 0) {
    return (
      <div className="pv6 page">
        {actions.modals}
        {hero}
        {periodBar}
        <div className="card">
          <div className="empty">
            <span className="ih t-slate">
              <Inbox className="ic" aria-hidden />
            </span>
            <b>{t("c_noorders")}</b>
          </div>
        </div>
        {stockAndSheet}
      </div>
    );
  }

  const net = o.money.net;
  return (
    <div className="pv6 page">
      {actions.modals}
      {hero}
      {periodBar}

      <div className="kpis">
        <Kpi
          icon={<Inbox className="ic" aria-hidden />}
          tone="t-slate"
          label={t("k_rec")}
          value={
            <>
              <Num value={c.received} />
              <span className="kspark">
                <Spark values={o.trend.received} w={76} h={26} color="var(--slate)" />
              </span>
            </>
          }
          sub={t("k_rec_p", { from: dayLabel(period.from, ui), to: dayLabel(period.to, ui) })}
        />
        <Kpi
          icon={<Phone className="ic" aria-hidden />}
          tone="t-conf"
          label={t("k_conf")}
          value={o.confirmation === null ? "—" : <Pct value={o.confirmation} />}
          sub={t("k_conf_s", { u: numText(c.uploaded), r: numText(c.rejected) })}
        />
        <Kpi
          icon={<Truck className="ic" aria-hidden />}
          tone="t-ok"
          label={t("k_dlv")}
          value={
            o.delivery === null ? (
              "—"
            ) : (
              <>
                <Pct value={o.delivery} />
                {o.provisional ? <span className="pill call xs">{t("c_prov")}</span> : null}
              </>
            )
          }
          sub={
            t("k_dlv_s", { d: numText(c.delivered), f: numText(c.failed) }) +
            (c.in_flight ? t("c_fly", { w: numText(c.in_flight) }) : "")
          }
        />
        <Kpi
          icon={<Wallet className="ic" aria-hidden />}
          tone="t-gold"
          label={t("k_enc")}
          value={<Amount value={o.money.encaisse} currency={currency} />}
          sub={t(invoiced ? "k_enc_s" : "k_enc_s_c", {
            p: moneyText(o.money.paid, currency),
            d: moneyText(o.money.carrier, currency),
          })}
        />
        <Kpi
          icon={<TrendingUp className="ic" aria-hidden />}
          tone={net < 0 ? "t-bad" : "t-ok"}
          label={t("k_net")}
          value={
            <span className={net < 0 ? "neg" : "pos"}>
              <Amount value={net} currency={currency} signed />
            </span>
          }
          sub={
            o.per_delivery && o.margin !== null
              ? t("k_net_p", {
                  m: pctText(o.margin, ui),
                  x: moneyText(o.per_delivery.net, currency, { decimals: 1, signed: true }),
                })
              : t("m_noSales", { a: moneyText(o.money.ads, currency) })
          }
        />
      </div>

      <section className="card">
        <div className="chead">
          <div>
            <h2>{t("fl_title", { n: numText(c.received) })}</h2>
            <p className="cs">{t("fl_sub")}</p>
          </div>
        </div>
        <div className="flowwrap">
          <div>
            <OutcomeFlow counts={c} invoiced={invoiced} />
          </div>
          <div className="why">
            <Why o={o} invoiced={invoiced} reasonLabel={(g) => reasonLabel(t, tReasons, g)} />
          </div>
        </div>
      </section>

      <section className="card">
        <Money o={o} currency={currency} invoiced={invoiced} />
      </section>

      <section className="card">
        <Trend o={o} currency={currency} period={period} tz={tz} />
      </section>

      <section className="card">
        <div className="chead">
          <div>
            <h2>{t("ag_title")}</h2>
            <p className="cs">{t("ag_sub")}</p>
          </div>
        </div>
        <Agents o={o} />
      </section>

      {stockAndSheet}
    </div>
  );
}

type T = ReturnType<typeof useTranslations>;

/** The prototype's group names (rg_*), else the app's rejection catalogue. */
function reasonLabel(t: T, tReasons: T, group: string): string {
  const key = `rg_${group}`;
  return t.has(key) ? t(key) : tReasons.has(group) ? tReasons(group) : group;
}

function Why({
  o,
  invoiced,
  reasonLabel: label,
}: {
  o: ProductSheetOverviewResponse;
  invoiced: boolean;
  reasonLabel: (g: string) => string;
}) {
  const t = useTranslations("products.v6");
  const maxR = o.why.rejections[0]?.count ?? 1;
  const maxF = o.why.failures[0]?.count ?? 1;
  const cause = (k: string) => (k === "unknown" ? t("fc_unknown") : t(`fc_${k}`));
  return (
    <>
      <h2 style={{ fontSize: "14.5px" }}>{t("why_title")}</h2>
      {o.why.rejections.length ? (
        <div>
          <h3>
            {t("why_rej")}
            <span>
              <Num value={o.counts.rejected} />
            </span>
          </h3>
          {o.why.rejections.map((g) => {
            const Icon = GROUP_ICON[g.group] ?? MessageSquareText;
            return (
              <div className="wr" key={g.group}>
                <Icon className="ic" aria-hidden />
                <span>{label(g.group)}</span>
                <b className="num">{groupDigits(g.count)}</b>
                <div className="wb">
                  <i style={{ width: `${((g.count / maxR) * 100).toFixed(0)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
      {o.why.failures.length ? (
        <div>
          <h3>
            {t("why_fail")}
            <span>
              <Num value={o.counts.failed} />
            </span>
          </h3>
          {o.why.failures.map((f) => (
            <div className="wr" key={f.cause}>
              <CircleX className="ic" aria-hidden />
              <span>{f.cause === "other" && !invoiced ? t("fc_unknown") : cause(f.cause)}</span>
              <b className="num">{groupDigits(f.count)}</b>
              <div className="wb">
                <i style={{ width: `${((f.count / maxF) * 100).toFixed(0)}%` }} />
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <p className="whynote">
        <Info className="ic" aria-hidden />
        <span>{invoiced ? t("why_note") : t("why_note_c")}</span>
      </p>
    </>
  );
}

const LEDGER_LABEL = { carrier: "lg_darb", cogs: "lg_cogs", packing: "lg_pack", processing: "lg_proc", ads: "lg_ads", profit: "lg_profit" } as const;

function Money({ o, currency, invoiced }: { o: ProductSheetOverviewResponse; currency: string; invoiced: boolean }) {
  const t = useTranslations("products.v6");
  const ui = useUiLocale();
  const m = o.money;
  const head = (
    <div className="chead">
      <div>
        <h2>{t("m_title")}</h2>
        <p className="cs">{t("m_sub", { n: numText(m.deliveries) })}</p>
      </div>
    </div>
  );
  if (!m.paid) {
    return (
      <>
        {head}
        <div className="ins bad" style={{ marginTop: 12 }}>
          <TriangleAlert className="ic" aria-hidden />
          <span>{t("m_noSales", { a: moneyText(m.ads, currency) })}</span>
        </div>
      </>
    );
  }
  const d = m.deliveries;
  const row = (sw: string, label: string, sub: string, v: number, signed: boolean, sum = false) => (
    <tr className={sum ? "sum" : undefined} key={label}>
      <td>
        {sw ? <span className={`sw ${sw}`} /> : null}
        {label}
        {sub ? <small>{sub}</small> : null}
      </td>
      <td className="v">
        <Amount value={v} currency={currency} signed={signed} />
      </td>
      <td className="v">
        <Amount value={v / d} currency={currency} d={1} signed={signed} />
      </td>
    </tr>
  );
  const unitCogs = m.units ? m.cogs / m.units : 0;
  const packEach = m.parcels ? m.packing / m.parcels : 0;
  const procEach = m.confirmed ? m.processing / m.confirmed : 0;
  return (
    <>
      {head}
      <div className="hbar">
        {o.shares
          .filter((s) => s.share > 0)
          .map((s) => (
            <div
              key={s.key}
              className={SHARE_CLASS[s.key]}
              style={{ flex: Math.round(s.share * 1000) }}
              title={s.key === "carrier" && !invoiced ? t("lg_carrier") : t(LEDGER_LABEL[s.key])}
            >
              {s.share >= 0.07 ? (
                <span className="num">{groupDigits(s.share * 100, s.share < 0.1 ? 1 : 0)}</span>
              ) : null}
            </div>
          ))}
      </div>
      <div className="moneygrid">
        <div>
          <table className="ledger">
            <thead>
              <tr>
                <th />
                <th>{t("m_col_period")}</th>
                <th>{t("m_col_per")}</th>
              </tr>
            </thead>
            <tbody>
              {row("", t("m_paid"), "", m.paid, false)}
              {row("s-darb", invoiced ? t("m_darb") : t("m_carrier"), "", -m.carrier, true)}
              {row("", t("m_enc"), "", m.encaisse, false, true)}
              {row("s-cogs", t("m_cogs"), t("m_cogs_d", { u: groupDigits(m.units), c: groupDigits(unitCogs, unitCogs % 1 ? 1 : 0) }), -m.cogs, true)}
              {m.packing > 0 ? row("s-pack", t("m_pack"), t("m_pack_d", { n: groupDigits(m.parcels), c: groupDigits(packEach, 1) }), -m.packing, true) : null}
              {m.processing > 0 ? row("s-proc", t("m_proc"), t("m_proc_d", { n: groupDigits(m.confirmed), c: groupDigits(procEach, 1) }), -m.processing, true) : null}
              {row("s-ads", t("m_ads"), "", -m.ads, true)}
              {row("s-profit", t("m_net"), "", m.net, true, true)}
            </tbody>
          </table>
          {m.carrier_estimated > 0 ? <p className="rnote">{t("m_est", { n: numText(m.carrier_estimated) })}</p> : null}
        </div>
        <div className="insights">
          {o.insight ? (
            <div className="ins ads">
              <TriangleAlert className="ic" aria-hidden />
              <span>
                {t("ins_ads", {
                  a: moneyText(o.insight.ads_per_delivery, currency, { decimals: 1 }),
                  p: pctText(o.insight.ads_share_of_paid, ui),
                })}
                {o.insight.ads_per_delivery > o.insight.other_per_delivery
                  ? ` ${t("ins_more", { o: moneyText(o.insight.other_per_delivery, currency, { decimals: 1 }) })}`
                  : ""}
              </span>
            </div>
          ) : null}
          {o.break_even !== null ? (
            <div className="ins be">
              <Info className="ic" aria-hidden />
              <span>{t("ins_be", { b: moneyText(o.break_even, currency, { decimals: 1 }) })}</span>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

/** Ticks every 7 days on a month, every 3 on a fortnight, daily on a week; month named when it changes. */
function axisTicks(days: string[], locale: "fr" | "ar"): { i: number; label: string }[] {
  const n = days.length;
  const step = n <= 10 ? 1 : n <= 21 ? 3 : 7;
  const out: { i: number; label: string }[] = [];
  let lastMonth = "";
  for (let i = 0; i < n; i += step) {
    const month = days[i].slice(0, 7);
    const day = String(Number(days[i].slice(8, 10)));
    out.push({ i, label: month !== lastMonth ? dayLabel(days[i], locale) : day });
    lastMonth = month;
  }
  return out;
}

function Trend({
  o,
  currency,
  period,
  tz,
}: {
  o: ProductSheetOverviewResponse;
  currency: string;
  period: DayRange;
  tz: string;
}) {
  const t = useTranslations("products.v6");
  const ui = useUiLocale();
  const n = o.period.days.length;
  const max = (a: number[]) => Math.max(0, ...a);
  return (
    <>
      <div className="chead">
        <div>
          <h2>{t("tr_title")}</h2>
          <p className="cs">{rangeLabel(period.from, period.to, ui)}</p>
        </div>
        {o.trend.stop_at ? (
          <span className="stopnote">
            <Clock className="ic" aria-hidden />
            {t("tr_stop", { d: instantDayLabel(o.trend.stop_at, tz, ui) })}
          </span>
        ) : null}
      </div>
      <div className="trend">
        <div className="trow">
          <div className="tl">
            {t("tr_rec")}
            <small>{t("tr_max", { m: numText(max(o.trend.received)) })}</small>
          </div>
          <Bars values={o.trend.received} color="var(--slate)" h={52} stopIndex={o.trend.stop_index} />
        </div>
        <div className="trow">
          <div className="tl">
            {t("tr_dlv")}
            <small>{t("tr_max", { m: numText(max(o.trend.delivered)) })}</small>
          </div>
          <Bars values={o.trend.delivered} color="var(--ok)" h={40} stopIndex={o.trend.stop_index} />
        </div>
        <div className="trow">
          <div className="tl">
            {t("tr_ads")}
            <small>{t("tr_max", { m: moneyText(max(o.trend.ads), currency) })}</small>
          </div>
          <Bars values={o.trend.ads} color="var(--m-ads)" h={40} stopIndex={o.trend.stop_index} />
        </div>
        <div className="axis">
          {axisTicks(o.period.days, ui).map((tick) => (
            <span key={tick.i} style={{ insetInlineStart: `${(((tick.i + 0.5) / n) * 100).toFixed(2)}%` }}>
              {tick.label}
            </span>
          ))}
        </div>
      </div>
    </>
  );
}

function Agents({ o }: { o: ProductSheetOverviewResponse }) {
  const t = useTranslations("products.v6");
  return (
    <div className="atscroll">
      <table className="atbl">
        <thead>
          <tr>
            <th>{t("ag_agent")}</th>
            <th>{t("ag_assigned")}</th>
            <th>{t("ag_attempts")}</th>
            <th>{t("ag_up")}</th>
            <th>{t("ag_rej")}</th>
            <th>{t("ag_conf")}</th>
            <th>{t("ag_dlv")}</th>
          </tr>
        </thead>
        <tbody>
          {o.agents.rows.map((a) => {
            const dec = a.uploaded + a.rejected;
            const conf = dec ? a.uploaded / dec : null;
            const st = a.delivered + a.failed;
            const dr = st ? a.delivered / st : null;
            return (
              <tr key={a.agent_id}>
                <td>
                  <span className="who">
                    <span className="av">{(a.name || "?").slice(0, 2)}</span>
                    {a.name || "—"}
                  </span>
                </td>
                <td className="num">{groupDigits(a.assigned)}</td>
                <td className="num">{groupDigits(a.attempts)}</td>
                <td className="num">{groupDigits(a.uploaded)}</td>
                <td className="num">{groupDigits(a.rejected)}</td>
                <td>
                  {conf === null ? (
                    <span className="muted">—</span>
                  ) : (
                    <>
                      <div className="rate">
                        <b>
                          <Pct value={conf} />
                        </b>
                      </div>
                      <div className="bar" style={{ width: 110 }}>
                        <i style={{ width: `${(conf * 100).toFixed(1)}%` }} />
                      </div>
                    </>
                  )}
                </td>
                <td>
                  {dr === null ? (
                    <span className="muted">—</span>
                  ) : (
                    <>
                      <div className="rate">
                        <b>
                          <Pct value={dr} />
                        </b>
                        <span className="sub" style={{ margin: 0 }}>
                          {groupDigits(a.delivered)} · {groupDigits(a.failed)}
                          {a.in_flight ? ` · ${groupDigits(a.in_flight)}` : ""}
                        </span>
                      </div>
                      <div className="obar" style={{ width: 130 }}>
                        <i className="ok" style={{ flex: a.delivered }} />
                        <i className="bd" style={{ flex: a.failed }} />
                        {a.in_flight ? <i className="go" style={{ flex: a.in_flight }} /> : null}
                      </div>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
          <tr>
            <td>
              <span className="who">
                <span className="av none">—</span>
                {t("ag_unassigned")}
              </span>
            </td>
            <td className="num">{groupDigits(o.agents.unassigned.assigned)}</td>
            <td className="muted">—</td>
            <td className="num">{groupDigits(o.agents.unassigned.uploaded)}</td>
            <td className="muted">—</td>
            <td />
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function StockAndSheet({
  product,
  o,
  currency,
  locale,
  role,
  tz,
  onAdjust,
}: {
  product: SheetProduct;
  o: ProductSheetOverviewResponse | undefined;
  currency: string;
  locale: string;
  role: Role;
  tz: string;
  onAdjust: () => void;
}) {
  const t = useTranslations("products.v6");
  const ui = useUiLocale();
  const s = o?.stock;
  const counted = s?.counted_at ?? null;
  const stock = Number(product.current_stock);
  const moveLabel = (reason: string) => (t.has(`mv_${reason}`) ? t(`mv_${reason}`) : reason);
  const canCount = role === "super_admin" || role === "market_manager" || role === "warehouse_agent";

  const stockCard = (
    <section className="card">
      <div className="chead">
        <div>
          <h2>{t("st_title")}</h2>
        </div>
        <div className="acts">
          {canCount ? (
            <Link className="btn sm" href={`/${locale}/warehouse/count?product=${product.id}`}>
              <ScanLine className="ic" aria-hidden />
              {t("b_count")}
            </Link>
          ) : null}
          {role === "super_admin" ? (
            <button type="button" className="btn sm" onClick={onAdjust}>
              {t("b_adjust")}
            </button>
          ) : null}
        </div>
      </div>
      <div className="stockhead">
        <span className="big xl">
          <Num value={stock} />
        </span>
        <span className="sub" style={{ margin: 0 }}>
          {t("st_reg")}
        </span>
        {counted ? (
          <span className="pill ok">
            <Check className="ic" aria-hidden />
            {t("st_counted", { d: instantDayLabel(counted, tz, ui) })}
          </span>
        ) : (
          <span className="pill call">
            <TriangleAlert className="ic" aria-hidden />
            {t("st_never")}
          </span>
        )}
      </div>
      {!counted ? (
        <div className="warn">
          <Info className="ic" aria-hidden />
          <span>
            {s
              ? s.returned_30d > 0
                ? t("st_warn_r", { l: numText(s.units_left_30d), s: numText(s.scanned_30d), r: numText(s.returned_30d) })
                : t("st_warn", { l: numText(s.units_left_30d), s: numText(s.scanned_30d) })
              : t("st_warn_g")}
          </span>
        </div>
      ) : null}
      <div className="stats">
        <div className="stat">
          <span>{t("st_cover")}</span>
          <b>{s?.cover != null ? t("st_cover_v", { d: numText(Math.round(s.cover)) }) : "—"}</b>
        </div>
        <div className="stat">
          <span>{t("st_thr")}</span>
          <b>
            <Num value={Number(product.low_stock_threshold)} />
          </b>
        </div>
        <div className="stat">
          <span>{t("st_value")}</span>
          <b>
            <Amount value={stock * Number(product.unit_cogs)} currency={currency} />
          </b>
        </div>
        <div className="stat">
          <span>{t("st_damaged")}</span>
          <b>
            <Num value={Number(product.damaged_return_count)} />
          </b>
        </div>
      </div>
      {s && s.moves.length ? (
        <div className="moves">
          <div className="mh">{t("st_moves")}</div>
          {s.moves.map((m, i) => (
            <div className="mv" key={`${m.at}-${i}`}>
              <span>
                {instantDayLabel(m.at, tz, ui)} · {moveLabel(m.reason)}
              </span>
              <span className="num">
                {m.change < 0 ? "−" : "+"}
                {Math.abs(m.change)}
                {m.balance_after !== null ? ` → ${groupDigits(m.balance_after)}` : ""}
              </span>
            </div>
          ))}
          <div className="mv">
            <span>{t("mv_initial")}</span>
            <span className="num">{groupDigits(Number(product.initial_stock))}</span>
          </div>
        </div>
      ) : null}
    </section>
  );

  const hasSheet = Boolean(
    product.agent_brief?.trim() ||
      product.agent_composition?.trim() ||
      product.agent_usage?.trim() ||
      product.agent_contraindications?.trim(),
  );
  const tone = product.agent_brief_tone === "warning" || product.agent_brief_tone === "critical" ? product.agent_brief_tone : "info";
  const canEdit = role === "super_admin" || role === "market_manager";

  const sheetCard = (
    <section className="card">
      <div className="chead">
        <h2>{t("sh_title")}</h2>
        {hasSheet && canEdit ? (
          <Link className="btn sm" href={`/${locale}/products/${product.id}/edit?tab=fiche`}>
            <Pencil className="ic" aria-hidden />
            {t("sh_edit")}
          </Link>
        ) : null}
      </div>
      {hasSheet ? (
        <div className="pv">
          <div className="pvn">
            <bdi>{product.name}</bdi>
          </div>
          {product.agent_brief?.trim() ? (
            <div className={`pvb ${tone}`} dir="auto">
              {tone === "info" ? <Info className="ic" aria-hidden /> : <TriangleAlert className="ic" aria-hidden />}
              <span>{product.agent_brief}</span>
            </div>
          ) : null}
          {product.agent_composition?.trim() ? (
            <div className="pvl" dir="auto">
              <b>{t("f_comp")}</b>
              {product.agent_composition}
            </div>
          ) : null}
          {product.agent_usage?.trim() ? (
            <div className="pvl" dir="auto">
              <b>{t("f_usage")}</b>
              {product.agent_usage}
            </div>
          ) : null}
          {product.agent_contraindications?.trim() ? (
            <div className="pvl crit" dir="auto">
              <b>{t("f_contra")}</b>
              {product.agent_contraindications}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="empty">
          <span className="ih t-info">
            <FileText className="ic" aria-hidden />
          </span>
          <b>{t("sh_emptyT")}</b>
          <p>{t("sh_emptyB")}</p>
          {canEdit ? (
            <Link className="btn pri sm" href={`/${locale}/products/${product.id}/edit?tab=fiche`}>
              <Pencil className="ic" aria-hidden />
              {t("sh_cta")}
            </Link>
          ) : null}
        </div>
      )}
    </section>
  );

  return (
    <div className="two">
      {stockCard}
      {sheetCard}
    </div>
  );
}
