"use client";

// /products/[id] — Finances › Produits & marges › a product (prototypes/finances-produits-v1.html:
// sheetScreen, sankey, whyHTML, moneyHTML, stockCard, ficheCard), approved by the
// owner on 2026-10-04: the v6 sheet in Aurore. Figures come computed from
// /api/products/[id]/overview; the product itself from /api/products/[id], which
// every viewer may read.

import { useMemo, type CSSProperties } from "react";
import Link from "next/link";
import useSWR from "swr";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Ban,
  Box,
  Check,
  ChevronRight,
  CircleX,
  Clock,
  FileText,
  FileX,
  Inbox,
  Info,
  Megaphone,
  MessageSquareText,
  Pencil,
  Phone,
  PhoneOff,
  ScanLine,
  Target,
  ThumbsDown,
  TriangleAlert,
  Truck,
  TrendingUp,
  Wallet,
} from "lucide-react";
import type { Role } from "@/types";
import { fetcher } from "@/lib/swr-config";
import { marketIdToCode, marketTimezone } from "@/lib/markets";
import { localDay } from "@/lib/products/cohort";
import { resolvePeriod, type DayRange } from "@/lib/products/period";
import { dayLabel, dayTimeLabel, groupDigits, instantDayLabel, moneyText, numText, pctText, rangeLabel } from "@/lib/products/format";
import { useProductSheetOverview } from "@/hooks/useProductsOverview";
import { canArchiveProduct, canToggleProductActive } from "@/lib/product-permissions";
import type { ProductSheetOverviewResponse } from "@/types/product-overview";
import { useTip } from "@/components/finance/kit/ui";
import { ActionMenu, type MenuAction } from "./ActionMenu";
import { Amount, ConfBar, Kpi, Num, OutcomeBar, Pct, SHARE_CLASS, Spark, Thumb, orderedShares, useUiLocale } from "./atoms";
import { OutcomeFlow } from "./OutcomeFlow";
import { PeriodRow } from "./PeriodSeg";
import { purchaseHref } from "./ProductRowV6";
import { useProductActions } from "./useProductActions";
import { ProductSheetSkeleton } from "./skeletons";
import "@/components/finance/kit/finance-kit.css";
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

/** The agents' identity ramps (Salle de contrôle), handed out in table order. */
const AVATAR = [
  ["var(--id-indigo)", "#3538CD"],
  ["var(--id-pink)", "#C11574"],
  ["var(--id-cyan)", "#0E7090"],
  ["var(--id-gold)", "#A15C07"],
  ["var(--id-lime)", "#3B7C0F"],
] as const;

const d = (n: number): CSSProperties => ({ ["--d" as string]: n });

export function ProductSheetV6({ productId, role, locale }: { productId: string; role: Role; locale: string }) {
  const t = useTranslations("products.v6");
  const tReasons = useTranslations("orders.rejectionReasons");
  const ui = useUiLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tip = useTip();

  const { data: productRes, error: productError, mutate: mutateProduct } = useSWR<{ data: SheetProduct }>(
    `/api/products/${encodeURIComponent(productId)}`,
    fetcher,
  );
  const product = productRes?.data;
  const tz = marketTimezone(product?.market_id ?? null);
  const period: DayRange = useMemo(() => resolvePeriod(params.get("from"), params.get("to"), tz), [params, tz]);

  const canMoney = role === "super_admin" || role === "market_manager";
  const { data: o, error: overviewError, mutate: mutateOverview } = useProductSheetOverview(productId, period, canMoney && Boolean(product));
  const actions = useProductActions(async () => {
    await Promise.all([mutateProduct(), mutateOverview()]);
  });

  const shell = (children: React.ReactNode) => (
    <div className="fin prd" onMouseOver={tip.onOver} onMouseMove={tip.onMove} onMouseLeave={tip.onLeave}>
      <div className="page">
        {actions.modals}
        {children}
      </div>
      <div className="tip" ref={tip.ref} role="tooltip" />
    </div>
  );
  const loadError = (retry: () => void) => (
    <div className="notes">
      <div className="note bad" role="alert">
        <span className="nh">
          <Info className="ic" aria-hidden />
        </span>
        <span>{t("e_load")}</span>
        <button type="button" className="btn2 sm" onClick={retry}>
          {t("retry")}
        </button>
      </div>
    </div>
  );

  if (!product) {
    if (!productError) return <ProductSheetSkeleton money={canMoney} />;
    return shell(loadError(() => void mutateProduct()));
  }

  const currency = o?.currency ?? (marketIdToCode(product.market_id) === "ly" ? "LYD" : "TND");
  const invoiced = currency === "LYD";
  const canEdit = role === "super_admin" || role === "market_manager";
  const isSa = role === "super_admin";
  const listHref = `/${locale}/products?from=${period.from}&to=${period.to}`;

  const menu: MenuAction[] = [];
  if (canToggleProductActive(role))
    menu.push({
      key: "active",
      label: product.is_active ? t("a_deactivate") : t("a_activate"),
      onSelect: () => void actions.setActive(product.id, !product.is_active),
    });
  if (canArchiveProduct(role) && !product.is_active)
    menu.push({ key: "archive", label: t("a_archive"), danger: true, onSelect: () => actions.openArchive(product.id, product.name) });

  const setPeriod = (r: DayRange) => {
    const sp = new URLSearchParams(params.toString());
    sp.set("from", r.from);
    sp.set("to", r.to);
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  };

  const hero = (
    <>
      <nav className="crumb rise" style={d(0)} aria-label="breadcrumb">
        {t("crumb_fin")}
        <ChevronRight className="ic" aria-hidden />
        <Link href={listHref}>{t("crumb_products")}</Link>
        <ChevronRight className="ic" aria-hidden />
        <span dir="auto">{product.name}</span>
      </nav>
      <section className="card phero rise" style={d(0)}>
        <Thumb src={product.image_url} name={product.name} />
        <div className="grow">
          <h1>
            <bdi>{product.name}</bdi>
          </h1>
          <div className="chips">
            {product.is_active ? (
              <span className="pill good">
                <Check className="ic" aria-hidden />
                {t("ch_active")}
              </span>
            ) : (
              <span className="pill">{t("ch_inactive")}</span>
            )}
            {product.sku ? (
              <code className="sku" dir="auto">
                {product.sku}
              </code>
            ) : null}
            {product.default_price !== null ? (
              <span className="chip">
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
            <Link className="btn" href={`/${locale}/products/${product.id}/edit${isSa ? "" : "?tab=fiche"}`}>
              <Pencil className="ic" aria-hidden />
              {t("b_edit")}
            </Link>
          ) : null}
          {isSa ? (
            <button type="button" className="btn2" onClick={() => actions.openStock(product.id, product.name)}>
              <Box className="ic" aria-hidden />
              {t("b_adjust")}
            </button>
          ) : null}
          <ActionMenu actions={menu} label={t("a_menu")} variant="ibtn" />
        </div>
      </section>
    </>
  );

  const stockAndSheet = (
    <StockAndSheet
      product={product}
      o={o}
      currency={currency}
      locale={locale}
      role={role}
      tz={tz}
      onAdjust={() => actions.openStock(product.id, product.name)}
    />
  );

  if (!canMoney) return shell(<>{hero}{stockAndSheet}</>);

  const periodRow = (
    <PeriodRow
      period={period}
      tz={tz}
      onChange={setPeriod}
      extra={
        o?.final != null ? (
          <span className={`pill ${o.final >= 0.9 ? "good" : "warn"} end`}>
            <Check className="ic" aria-hidden />
            {t("final_pct", { p: pctText(o.final, ui) })}
          </span>
        ) : null
      }
    />
  );

  // One skeleton until the figures arrive too (first load only: SWR keeps the
  // previous period's while a new one loads) — never the hero over a blank page.
  if (!o) {
    if (!overviewError) return <ProductSheetSkeleton />;
    return shell(<>{hero}{periodRow}{loadError(() => void mutateOverview())}</>);
  }

  const c = o.counts;
  if (c.received === 0) {
    return shell(
      <>
        {hero}
        {periodRow}
        <section className="card rise" style={d(2)}>
          <div className="cbody" style={{ paddingTop: 24 }}>
            <div className="empty fe">
              <span className="tk k-src">
                <Inbox className="ic" aria-hidden />
              </span>
              <b>{t("c_noorders")}</b>
            </div>
          </div>
        </section>
        {stockAndSheet}
      </>,
    );
  }

  const net = o.money.net;
  const flySub = c.in_flight ? t("c_fly", { w: numText(c.in_flight) }) : "";
  return shell(
    <>
      {hero}
      {periodRow}

      <div className="kpis rise" style={{ ...d(2), ["--n" as string]: 5 }}>
        <Kpi
          icon={<Inbox className="ic" aria-hidden />}
          tone="k-src"
          label={t("k_rec")}
          value={
            <>
              <Num value={c.received} />
              <Spark
                values={o.trend.received}
                w={76}
                h={26}
                color="#64748B"
                tip={`${t("tip_spark")}\n${t("tr_max", { m: groupDigits(Math.max(0, ...o.trend.received)) })}`}
              />
            </>
          }
          sub={t("k_rec_p", { from: dayLabel(period.from, ui), to: dayLabel(period.to, ui) })}
        />
        <Kpi
          icon={<Phone className="ic" aria-hidden />}
          tone="k-up"
          label={t("k_conf")}
          value={o.confirmation === null ? <span className="zero">—</span> : <Pct value={o.confirmation} />}
          extra={o.confirmation === null ? null : <ConfBar rate={o.confirmation} />}
          sub={t("k_conf_s", { u: numText(c.uploaded), r: numText(c.rejected) })}
        />
        <Kpi
          icon={<Truck className="ic" aria-hidden />}
          tone="k-dlv"
          label={t("k_dlv")}
          value={
            o.delivery === null ? (
              <span className="zero">—</span>
            ) : (
              <>
                <Pct value={o.delivery} />
                {o.provisional ? (
                  <span className="tag warn" data-tip={t("tip_prov")}>
                    {t("c_prov")}
                  </span>
                ) : null}
              </>
            )
          }
          extra={o.delivery === null ? null : <OutcomeBar delivered={c.delivered} failed={c.failed} inFlight={c.in_flight} />}
          sub={t("k_dlv_s", { d: numText(c.delivered), f: numText(c.failed) }) + flySub}
        />
        <Kpi
          icon={<Wallet className="ic" aria-hidden />}
          tone="k-neu"
          label={t("k_enc")}
          value={<Amount value={o.money.encaisse} currency={currency} />}
          sub={t(invoiced ? "k_enc_s" : "k_enc_s_c", { p: moneyText(o.money.paid, currency), d: moneyText(o.money.carrier, currency) })}
        />
        <Kpi
          icon={<TrendingUp className="ic" aria-hidden />}
          tone={net < 0 ? "k-bad" : "k-profit"}
          label={t("k_net")}
          value={
            <span className={net < 0 ? "neg" : undefined}>
              <Amount value={net} currency={currency} signed />
            </span>
          }
          sub={
            <>
              {t("gross_s")}
              <br />
              {o.per_delivery && o.margin !== null
                ? t("k_net_p", { m: pctText(o.margin, ui), x: moneyText(o.per_delivery.net, currency, { decimals: 1, signed: true }) })
                : t("m_noSales", { a: moneyText(o.money.ads, currency) })}
            </>
          }
        />
      </div>

      <section className="card rise" style={d(3)}>
        <div className="chead">
          <div>
            <h2>{t("fl_title", { n: numText(c.received) })}</h2>
            <p className="q">{t("fl_sub")}</p>
          </div>
        </div>
        <div className="cbody pflow">
          <div>
            <OutcomeFlow counts={c} invoiced={invoiced} />
          </div>
          <Why o={o} invoiced={invoiced} reasonLabel={(g) => reasonLabel(t, tReasons, g)} />
        </div>
      </section>

      <section className="card rise" style={d(4)}>
        <Money o={o} currency={currency} invoiced={invoiced} />
      </section>

      <section className="card rise" style={d(5)}>
        <Trend o={o} currency={currency} period={period} tz={tz} />
      </section>

      <section className="card rise" style={d(6)}>
        <div className="chead">
          <div>
            <h2>{t("ag_title")}</h2>
            <p className="q">{t("ag_sub")}</p>
          </div>
        </div>
        <Agents o={o} />
        <div style={{ height: 12 }} />
      </section>

      {stockAndSheet}
    </>,
  );
}

type T = ReturnType<typeof useTranslations>;

/** The prototype's group names (rg_*), else the app's rejection catalogue. */
function reasonLabel(t: T, tReasons: T, group: string): string {
  const key = `rg_${group}`;
  return t.has(key) ? t(key) : tReasons.has(group) ? tReasons(group) : group;
}

function Why({ o, invoiced, reasonLabel: label }: { o: ProductSheetOverviewResponse; invoiced: boolean; reasonLabel: (g: string) => string }) {
  const t = useTranslations("products.v6");
  const maxR = o.why.rejections[0]?.count ?? 1;
  const maxF = o.why.failures[0]?.count ?? 1;
  const cause = (k: string) => (k === "unknown" ? t("fc_unknown") : t(`fc_${k}`));
  const w = (v: number, max: number) => ({ ["--w" as string]: `${((v / max) * 100).toFixed(0)}%` });
  return (
    <div className="glass why">
      <h3>{t("why_title")}</h3>
      {o.why.rejections.length ? (
        <div className="wg">
          <h4>
            {t("why_rej")}
            <span>
              <Num value={o.counts.rejected} />
            </span>
          </h4>
          {o.why.rejections.map((g) => {
            const Icon = GROUP_ICON[g.group] ?? MessageSquareText;
            return (
              <div className="wr" key={g.group}>
                <span className="wi">
                  <Icon className="ic" aria-hidden />
                </span>
                <span>{label(g.group)}</span>
                <b>{groupDigits(g.count)}</b>
                <div className="wb">
                  <i style={w(g.count, maxR)} />
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
      {o.why.failures.length ? (
        <div className="wg">
          <h4>
            {t("why_fail")}
            <span>
              <Num value={o.counts.failed} />
            </span>
          </h4>
          {o.why.failures.map((f) => (
            <div className="wr" key={f.cause}>
              <span className="wi">
                <CircleX className="ic" aria-hidden />
              </span>
              <span>{f.cause === "other" && !invoiced ? t("fc_unknown") : cause(f.cause)}</span>
              <b>{groupDigits(f.count)}</b>
              <div className="wb">
                <i style={w(f.count, maxF)} />
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <p className="whynote">
        <Info className="ic" aria-hidden />
        <span>{invoiced ? t("why_note") : t("why_note_c")}</span>
      </p>
    </div>
  );
}

const SHARE_LABEL = { carrier: "lg_ship", cogs: "lg_cogs", packing: "lg_pack", processing: "lg_proc", ads: "lg_ads", profit: "lg_profit" } as const;

function Money({ o, currency, invoiced }: { o: ProductSheetOverviewResponse; currency: string; invoiced: boolean }) {
  const t = useTranslations("products.v6");
  const ui = useUiLocale();
  const m = o.money;
  const head = (
    <div className="chead">
      <div>
        <h2>{t("m_title")}</h2>
        <p className="q">{t("m_sub", { n: numText(m.deliveries) })}</p>
      </div>
    </div>
  );
  if (!m.paid) {
    return (
      <>
        {head}
        <div className="cbody">
          <div className="empty">{t("m_noSales", { a: moneyText(m.ads, currency) })}</div>
        </div>
      </>
    );
  }
  const dl = m.deliveries;
  const row = (sw: string, label: string, sub: string, v: number, signed: boolean, sum = false) => (
    <tr className={sum ? "sum" : undefined} key={label}>
      <td>
        {sw ? <i className={`sw ${sw}`} /> : null}
        {label}
        {sub ? <small>{sub}</small> : null}
      </td>
      <td className={`v${sum && v < 0 ? " neg" : ""}`}>
        <Amount value={v} currency={currency} signed={signed} />
      </td>
      <td className="v">
        <Amount value={v / dl} currency={currency} d={1} signed={signed} />
      </td>
    </tr>
  );
  const unitCogs = m.units ? m.cogs / m.units : 0;
  const packEach = m.parcels ? m.packing / m.parcels : 0;
  const procEach = m.confirmed ? m.processing / m.confirmed : 0;
  const shares = orderedShares(o.shares);
  const shareTip = (key: keyof typeof SHARE_LABEL, amount: number, share: number) =>
    `${t(SHARE_LABEL[key])} · ${moneyText(amount, currency)}\n${t("tip_share", { s: groupDigits(share * 100) })}`;
  return (
    <>
      {head}
      <div className="cbody">
        <div className="mstrip">
          {shares.map((s) => (
            <i key={s.key} className={SHARE_CLASS[s.key]} style={{ flex: Math.round(s.share * 1000) }} data-tip={shareTip(s.key, s.amount, s.share)} />
          ))}
        </div>
        <div className="mcap">
          {shares.map((s) => (
            <span key={s.key}>
              <i className={`sw ${SHARE_CLASS[s.key]}`} />
              {t(SHARE_LABEL[s.key])} <b>{groupDigits(s.share * 100)}</b>
            </span>
          ))}
        </div>
        <div className="mgrd">
          <div className="glass ledger">
            <table>
              <thead>
                <tr>
                  <th />
                  <th>{t("m_col_period")}</th>
                  <th>{t("m_col_per")}</th>
                </tr>
              </thead>
              <tbody>
                {row("", t("m_paid"), "", m.paid, false)}
                {row("k-ship", invoiced ? t("m_darb") : t("m_carrier"), invoiced ? t("m_darb_s") : t("m_carrier_s"), -m.carrier, true)}
                {row("", t("m_enc"), "", m.encaisse, false, true)}
                {row("k-cogs", t("m_cogs"), t("m_cogs_d", { u: groupDigits(m.units), c: groupDigits(unitCogs, unitCogs % 1 ? 1 : 0) }), -m.cogs, true)}
                {m.ads > 0 ? row("k-ads", t("m_ads"), "", -m.ads, true) : null}
                {m.packing > 0 ? row("k-pack", t("m_pack"), t("m_pack_d", { n: groupDigits(m.parcels), c: groupDigits(packEach, 1) }), -m.packing, true) : null}
                {m.processing > 0 ? row("k-proc", t("m_proc"), t("m_proc_d", { n: groupDigits(m.confirmed), c: groupDigits(procEach, 1) }), -m.processing, true) : null}
                {row("k-profit", t("m_net"), t("gross_s"), m.net, true, true)}
              </tbody>
            </table>
            {m.carrier_estimated > 0 ? <p className="rnote">{t("m_est", { n: numText(m.carrier_estimated) })}</p> : null}
          </div>
          <div className="ins">
            {o.insight ? (
              <div className="glass in">
                <span className="tk k-ads">
                  <Megaphone className="ic" aria-hidden />
                </span>
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
              <div className="glass in">
                <span className="tk k-neu">
                  <Target className="ic" aria-hidden />
                </span>
                <span>{t("ins_be", { b: moneyText(o.break_even, currency, { decimals: 1 }) })}</span>
              </div>
            ) : null}
          </div>
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

/** One row of day columns (the prototype's colsRow): today striped while it is still running. */
function Cols({
  label,
  values,
  k,
  h,
  days,
  fmt,
  stopIndex,
  live,
}: {
  label: string;
  values: number[];
  k: string;
  h: number;
  days: string[];
  fmt: (v: number) => string;
  stopIndex: number | null;
  live: boolean;
}) {
  const t = useTranslations("products.v6");
  const ui = useUiLocale();
  const n = Math.max(values.length, 1);
  const max = Math.max(1, ...values);
  return (
    <div className="trow">
      <div className="tl">
        {label}
        <small>{t("tr_max", { m: fmt(Math.max(0, ...values)) })}</small>
      </div>
      <div className="cols" style={{ ["--h" as string]: `${h}px`, gridTemplateColumns: `repeat(${n},minmax(0,1fr))` }}>
        {values.map((v, i) => (
          <span className="cl" key={i} data-tip={`${days[i] ? dayLabel(days[i], ui) : ""} · ${fmt(v)}`}>
            <i
              className={`${k}${v ? "" : " z"}${live && v && i === n - 1 ? " live" : ""}`}
              style={{ ["--v" as string]: `${v ? Math.max(3, (v / max) * (h - 4)) : 2}px`, ["--i" as string]: i }}
            />
          </span>
        ))}
        {stopIndex !== null ? <span className="stopl" style={{ insetInlineStart: `${(((stopIndex + 1) / n) * 100).toFixed(2)}%` }} /> : null}
      </div>
    </div>
  );
}

function Trend({ o, currency, period, tz }: { o: ProductSheetOverviewResponse; currency: string; period: DayRange; tz: string }) {
  const t = useTranslations("products.v6");
  const ui = useUiLocale();
  const days = o.period.days;
  const n = days.length;
  const live = period.to === localDay(new Date().toISOString(), tz);
  const count = (v: number) => groupDigits(v);
  const money = (v: number) => moneyText(v, currency);
  return (
    <>
      <div className="chead">
        <div>
          <h2>{t("tr_title")}</h2>
          <p className="q">{rangeLabel(period.from, period.to, ui)}</p>
        </div>
        {o.trend.stop_at ? (
          <div className="rt">
            <span className="pill warn">
              <i className="dot" />
              {t("tr_stop", { d: instantDayLabel(o.trend.stop_at, tz, ui) })}
            </span>
          </div>
        ) : null}
      </div>
      <div className="cbody">
        <div className="trend">
          <Cols label={t("tr_rec")} values={o.trend.received} k="k-src" h={56} days={days} fmt={count} stopIndex={o.trend.stop_index} live={false} />
          <Cols label={t("tr_dlv")} values={o.trend.delivered} k="k-dlv" h={44} days={days} fmt={count} stopIndex={o.trend.stop_index} live={live} />
          {o.trend.ads.some((v) => v > 0) ? (
            <Cols label={t("tr_ads")} values={o.trend.ads} k="k-ads" h={44} days={days} fmt={money} stopIndex={o.trend.stop_index} live={live} />
          ) : null}
          <div className="axis">
            {axisTicks(days, ui).map((tick) => (
              <span key={tick.i} style={{ insetInlineStart: `${(((tick.i + 0.5) / n) * 100).toFixed(2)}%` }}>
                {tick.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function Agents({ o }: { o: ProductSheetOverviewResponse }) {
  const t = useTranslations("products.v6");
  return (
    <div className="atw">
      <table className="atbl">
        <thead>
          <tr>
            <th>{t("ag_agent")}</th>
            <th className="e">{t("ag_assigned")}</th>
            <th className="e">{t("ag_attempts")}</th>
            <th className="e">{t("ag_up")}</th>
            <th className="e">{t("ag_rej")}</th>
            <th>{t("ag_conf")}</th>
            <th>{t("ag_dlv")}</th>
          </tr>
        </thead>
        <tbody>
          {o.agents.rows.map((a, i) => {
            const dec = a.uploaded + a.rejected;
            const conf = dec ? a.uploaded / dec : null;
            const st = a.delivered + a.failed;
            const dr = st ? a.delivered / st : null;
            const [a5, a7] = AVATAR[i % AVATAR.length];
            return (
              <tr key={a.agent_id}>
                <td>
                  <span className="who">
                    <span className="av" style={{ ["--a5" as string]: a5, ["--a7" as string]: a7 }}>
                      {(a.name || "?").slice(0, 1).toUpperCase()}
                    </span>
                    <bdi>{a.name || "—"}</bdi>
                  </span>
                </td>
                <td className="e">{groupDigits(a.assigned)}</td>
                <td className="e">{groupDigits(a.attempts)}</td>
                <td className="e">{groupDigits(a.uploaded)}</td>
                <td className="e">{groupDigits(a.rejected)}</td>
                <td>
                  {conf === null ? (
                    <span className="zero">—</span>
                  ) : (
                    <>
                      <span className="fig">
                        <Pct value={conf} />
                      </span>
                      <ConfBar rate={conf} />
                    </>
                  )}
                </td>
                <td>
                  {dr === null ? (
                    <span className="zero">—</span>
                  ) : (
                    <>
                      <span className="fig">
                        <Pct value={dr} />
                        <span className="cs" style={{ margin: 0 }}>
                          {groupDigits(a.delivered)} · {groupDigits(a.failed)}
                          {a.in_flight ? ` · ${groupDigits(a.in_flight)}` : ""}
                        </span>
                      </span>
                      <OutcomeBar delivered={a.delivered} failed={a.failed} inFlight={a.in_flight} />
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
            <td className="e">{groupDigits(o.agents.unassigned.assigned)}</td>
            <td className="e zero">—</td>
            <td className="e">{groupDigits(o.agents.unassigned.uploaded)}</td>
            <td className="e zero">—</td>
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
  const canEdit = role === "super_admin" || role === "market_manager";
  // « Commander → » where « à réapprovisionner » was: the people who buy (super
  // admin, market manager) only, and only below the market's restock lead time.
  const low = canEdit && product.is_active && s?.cover != null && o != null && s.cover < o.lead_days;

  const stockCard = (
    <section className="card">
      <div className="chead">
        <div>
          <h2>{t("st_title")}</h2>
        </div>
        <div className="rt">
          {canCount ? (
            <Link className="btn2 sm" href={`/${locale}/warehouse/count?product=${product.id}`}>
              <ScanLine className="ic" aria-hidden />
              {t("b_count")}
            </Link>
          ) : null}
          {role === "super_admin" ? (
            <button type="button" className="btn2 sm" onClick={onAdjust}>
              {t("b_adjust")}
            </button>
          ) : null}
        </div>
      </div>
      <div className="cbody">
        <div className="sbig">
          <b>
            <Num value={stock} />
          </b>
          <span>{t("st_reg")}</span>
          <span className="plain">
            <ScanLine className="ic" aria-hidden />
            {counted ? t("st_counted", { d: instantDayLabel(counted, tz, ui) }) : t("st_never")}
          </span>
        </div>
        <div className="stats" style={{ ["--n" as string]: 4 }}>
          <div className="glass stat">
            <span>{t("st_cover")}</span>
            <b>{s?.cover != null ? t("st_cover_v", { d: numText(Math.round(s.cover)) }) : "—"}</b>
            {low ? (
              <a
                className="cmd"
                href={purchaseHref(locale, product.id)}
                data-tip={t("c_order_tip", { d: groupDigits(s?.cover ?? 0), l: groupDigits(o?.lead_days ?? 0) })}
              >
                {t("c_order")}
                <ChevronRight className="ic" aria-hidden />
              </a>
            ) : null}
          </div>
          <div className="glass stat">
            <span>{t("st_thr")}</span>
            <b>
              <Num value={Number(product.low_stock_threshold)} />
            </b>
          </div>
          <div className="glass stat">
            <span>{t("st_value")}</span>
            <b>
              <Amount value={stock * Number(product.unit_cogs)} currency={currency} />
            </b>
          </div>
          <div className="glass stat">
            <span>{t("st_damaged")}</span>
            <b>
              <Num value={Number(product.damaged_return_count)} />
            </b>
          </div>
        </div>
        {s && s.moves.length ? (
          <div className="moves">
            <h4>{t("st_moves")}</h4>
            {s.moves.map((m, i) => (
              <div className="mv" key={`${m.at}-${i}`}>
                <span>
                  {instantDayLabel(m.at, tz, ui)} · {moveLabel(m.reason)}
                </span>
                <span>
                  <b className="num">
                    {m.change < 0 ? "−" : "+"}
                    {Math.abs(m.change)}
                  </b>
                  {m.balance_after !== null ? ` → ${groupDigits(m.balance_after)}` : ""}
                </span>
              </div>
            ))}
            <div className="mv">
              <span>{t("mv_initial")}</span>
              <b className="num">{groupDigits(Number(product.initial_stock))}</b>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );

  const hasSheet = Boolean(
    product.agent_brief?.trim() || product.agent_composition?.trim() || product.agent_usage?.trim() || product.agent_contraindications?.trim(),
  );
  const tone = product.agent_brief_tone === "warning" || product.agent_brief_tone === "critical" ? product.agent_brief_tone : "info";

  const sheetCard = (
    <section className="card">
      <div className="chead">
        <div>
          <h2>{t("sh_title")}</h2>
        </div>
        {hasSheet && canEdit ? (
          <div className="rt">
            <Link className="btn2 sm" href={`/${locale}/products/${product.id}/edit?tab=fiche`}>
              <Pencil className="ic" aria-hidden />
              {t("sh_edit")}
            </Link>
          </div>
        ) : null}
      </div>
      <div className="cbody">
        {hasSheet ? (
          <div className="glass pv">
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
          <div className="empty fe">
            <span className="tk k-neu">
              <FileText className="ic" aria-hidden />
            </span>
            <b>{t("sh_emptyT")}</b>
            <p>{t("sh_emptyB")}</p>
            {canEdit ? (
              <Link className="btn sm" href={`/${locale}/products/${product.id}/edit?tab=fiche`}>
                <Pencil className="ic" aria-hidden />
                {t("sh_cta")}
              </Link>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );

  return (
    <div className="two rise" style={d(7)}>
      {stockCard}
      {sheetCard}
    </div>
  );
}
