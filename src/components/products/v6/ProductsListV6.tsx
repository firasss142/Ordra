"use client";

// /products — Finances › Produits & marges, the list (prototypes/finances-produits-v1.html:
// listScreen + rowHTML), approved by the owner on 2026-10-04: the v6 list,
// restyled in Aurore, plus « Bénéfice brut », no « stock pas encore compté »
// banner, « Commander → » into Achats, and the basis chip beside the period.
//
// Every figure arrives computed from /api/products/overview. This component
// filters, searches and sorts the rows it was given, counts them for the tabs
// and chips, and formats — it derives no money.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowUpDown, ChevronDown, ChevronRight, ChevronUp, Clock, Download, Inbox, Info, Phone, Plus, Search, Truck, TrendingUp, Wallet } from "lucide-react";
import type { Role } from "@/types";
import { useProductsOverview } from "@/hooks/useProductsOverview";
import { useMarketScope } from "@/context/market-scope";
import { marketIdToCode, marketTimezone } from "@/lib/markets";
import { localDay } from "@/lib/products/cohort";
import { resolvePeriod, type DayRange } from "@/lib/products/period";
import { dayLabel, dayTimeLabel, groupDigits, moneyText, numText, pctText } from "@/lib/products/format";
import { canArchiveProduct, canManageProducts, canToggleProductActive } from "@/lib/product-permissions";
import type { ProductOverviewRow, ProductSignal } from "@/types/product-overview";
import { useTip } from "@/components/finance/kit/ui";
import { Amount, ConfBar, Kpi, Num, OutcomeBar, Pct, Spark, useUiLocale } from "./atoms";
import { PeriodRow } from "./PeriodSeg";
import { ProductRowV6 } from "./ProductRowV6";
import { useProductActions } from "./useProductActions";
import type { MenuAction } from "./ActionMenu";
import { ProductsListSkeleton } from "./skeletons";
import "@/components/finance/kit/finance-kit.css";
import "./products-v6.css";

type Filter = "active" | "inactive" | "all";
type SortKey = "name" | "cover" | "rec" | "conf" | "dlv" | "enc" | "net";
type Hl = "dlv" | "fail" | "fly" | "cogs" | "ship" | "ads" | "pack" | "profit";
const SORTS: SortKey[] = ["name", "cover", "rec", "conf", "dlv", "enc", "net"];
const SIGNALS: ProductSignal[] = ["restock", "loss", "nosales"];
const SIG: Record<ProductSignal, string> = { restock: "warn", loss: "bad", nosales: "flat" };
/** The legend's money names, in the section's fixed order. */
const MONEY_LEGEND: { hl: Hl; key: string; label: string }[] = [
  { hl: "cogs", key: "cogs", label: "lg_cogs" },
  { hl: "ship", key: "carrier", label: "lg_ship" },
  { hl: "ads", key: "ads", label: "lg_ads" },
  { hl: "pack", key: "packing", label: "lg_pack" },
  { hl: "profit", key: "profit", label: "lg_profit" },
];

function sortValue(r: ProductOverviewRow, key: SortKey): number | string {
  switch (key) {
    case "name":
      return r.name;
    case "cover":
      return r.cover ?? -1;
    case "conf":
      return r.confirmation ?? -1;
    case "dlv":
      return r.delivery ?? -1;
    case "enc":
      return r.money.encaisse;
    case "net":
      return r.counts.received ? r.money.net : -1e9;
    case "rec":
    default:
      return r.counts.received;
  }
}

const b = (c: ReactNode) => <b>{c}</b>;

export function ProductsListV6({
  role,
  userMarketId,
  locale,
}: {
  role: Role;
  /** The user's own market; a super_admin reads the market picked in the scope switcher. */
  userMarketId: string | null;
  locale: string;
}) {
  const { marketId: scopeMarketId } = useMarketScope();
  const marketId = role === "super_admin" ? (scopeMarketId ?? null) : userMarketId;
  const t = useTranslations("products.v6");
  const tp = useTranslations("products");
  const tNav = useTranslations("nav");
  const ui = useUiLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tip = useTip();
  const tz = marketTimezone(marketId);
  const marketCode = marketIdToCode(marketId);
  const [hl, setHl] = useState<Hl | null>(null);

  // ── URL state: shareable, survives a reload, carried into the sheet ──
  const period: DayRange = useMemo(() => resolvePeriod(params.get("from"), params.get("to"), tz), [params, tz]);
  const filter: Filter = (["active", "inactive", "all"] as const).find((f) => f === params.get("filter")) ?? "active";
  const sig = SIGNALS.find((s) => s === params.get("sig")) ?? null;
  const sort: SortKey = SORTS.find((s) => s === params.get("sort")) ?? "rec";
  const dir = params.get("dir") === "asc" ? 1 : params.get("dir") === "desc" ? -1 : sort === "name" ? 1 : -1;
  const q = params.get("q") ?? "";

  const patch = useCallback(
    (next: Record<string, string | null>) => {
      const sp = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(next)) {
        if (v === null || v === "") sp.delete(k);
        else sp.set(k, v);
      }
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const enabled = Boolean(marketId);
  const { data, error, mutate } = useProductsOverview(marketId, period, enabled);
  const actions = useProductActions(() => mutate());

  const canAdd = canManageProducts(role, marketId ?? "", marketId ?? "");
  const canEdit = role === "super_admin" || role === "market_manager";
  const canStock = role === "super_admin";
  const canToggle = canToggleProductActive(role);
  const canArchive = canArchiveProduct(role);

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const lead = data?.lead_days ?? 14;
  const currency = data?.currency ?? "LYD";
  // Libya ships with Darb only, and Darb invoices every parcel; Tunisia's
  // carriers keep a flat fee. The labels follow.
  const invoiced = currency === "LYD";

  // Links from the drawer era carry ?open=<id>: forward them to the sheet.
  const openId = params.get("open");
  useEffect(() => {
    if (openId) router.replace(`/${locale}/products/${openId}`);
  }, [openId, locale, router]);

  const counts = useMemo(
    () => ({
      active: rows.filter((r) => r.is_active).length,
      inactive: rows.filter((r) => !r.is_active).length,
      all: rows.length,
    }),
    [rows],
  );
  const signals = useMemo(() => {
    const s: Record<ProductSignal, number> = { restock: 0, loss: 0, nosales: 0 };
    for (const r of rows) if (r.signal) s[r.signal] += 1;
    return s;
  }, [rows]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = rows
      .filter((r) => filter === "all" || (filter === "active") === r.is_active)
      .filter((r) => !needle || r.name.toLowerCase().includes(needle) || (r.sku ?? "").toLowerCase().includes(needle))
      .filter((r) => !sig || r.signal === sig);
    return [...list].sort((a, z) => {
      const x = sortValue(a, sort);
      const y = sortValue(z, sort);
      if (typeof x === "string" && typeof y === "string") return dir * x.localeCompare(y);
      return dir * ((x as number) - (y as number)) || a.name.localeCompare(z.name);
    });
  }, [rows, filter, q, sig, sort, dir]);

  const sheetHref = (id: string) => `/${locale}/products/${id}?from=${period.from}&to=${period.to}`;

  const menuFor = (r: ProductOverviewRow): MenuAction[] => {
    const list: MenuAction[] = [{ key: "open", label: t("a_open"), onSelect: () => router.push(sheetHref(r.id)) }];
    if (canEdit) list.push({ key: "edit", label: t("b_edit"), onSelect: () => router.push(`/${locale}/products/${r.id}/edit`) });
    if (canStock) list.push({ key: "stock", label: t("b_adjust"), onSelect: () => actions.openStock(r.id, r.name) });
    if (canToggle)
      list.push({
        key: "active",
        label: r.is_active ? t("a_deactivate") : t("a_activate"),
        onSelect: () => void actions.setActive(r.id, !r.is_active),
      });
    if (canArchive && !r.is_active)
      list.push({ key: "archive", label: t("a_archive"), danger: true, onSelect: () => actions.openArchive(r.id, r.name) });
    return list;
  };

  const shareLabel = (key: string) => {
    if (key === "processing") return t("lg_proc");
    const l = MONEY_LEGEND.find((m) => m.key === key);
    return l ? t(l.label) : key;
  };

  const exportCsv = () => {
    const header = [
      t("h_prod"), t("csv_sku"), t("csv_active"), t("h_stock"), t("csv_cover"), t("k_rec"), t("nd_rej"),
      t("nd_up"), t("nd_dlv"), t("nd_fail"), t("lg_fly"), t("k_conf"), t("k_dlv"), t("m_paid"),
      invoiced ? t("m_darb") : t("m_carrier"), t("m_enc"), t("m_cogs"), t("m_pack"), t("m_ads"), t("m_net"),
    ];
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const lines = visible.map((r) => [
      r.name, r.sku ?? "", r.is_active ? "1" : "0", r.current_stock, r.cover === null ? "" : Math.round(r.cover),
      r.counts.received, r.counts.rejected, r.counts.uploaded, r.counts.delivered, r.counts.failed, r.counts.in_flight,
      r.confirmation === null ? "" : r2(r.confirmation * 100), r.delivery === null ? "" : r2(r.delivery * 100),
      r2(r.money.paid), r2(r.money.carrier), r2(r.money.encaisse), r2(r.money.cogs), r2(r.money.packing),
      r2(r.money.ads), r2(r.money.net),
    ]);
    const csv = [header, ...lines].map((cells) => cells.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    // BOM so Excel opens the Arabic product names as UTF-8.
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `produits-${period.from}_${period.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const head = (key: SortKey, label: string, tipText?: string) => {
    const on = sort === key;
    const Icon = on ? (dir < 0 ? ChevronDown : ChevronUp) : ArrowUpDown;
    return (
      <div>
        <button
          type="button"
          className={on ? "on" : undefined}
          aria-sort={on ? (dir < 0 ? "descending" : "ascending") : undefined}
          data-tip={tipText}
          onClick={() => (on ? patch({ dir: dir < 0 ? "asc" : "desc" }) : patch({ sort: key === "rec" ? null : key, dir: null }))}
        >
          {label}
          <Icon className="ic" aria-hidden />
        </button>
      </div>
    );
  };

  const header = (
    <header className="ph rise" style={{ ["--d" as string]: 0 }}>
      <div>
        <div className="crumb">
          {t("crumb_fin")} <ChevronRight className="ic" aria-hidden /> {t("l_title")}
        </div>
        <h1>{t("l_title")}</h1>
        <div className="sub">
          {marketCode ? (
            <>
              {tNav(`markets.${marketCode}`)} <span className="sep" />{" "}
            </>
          ) : null}
          {t("l_sub")}
        </div>
      </div>
      <div className="acts">
        <button type="button" className="btn2" onClick={exportCsv} disabled={visible.length === 0}>
          <Download className="ic" aria-hidden />
          {t("b_export")}
        </button>
        {canAdd ? (
          <Link className="btn" href={`/${locale}/products/new`}>
            <Plus className="ic" aria-hidden />
            {t("b_add")}
          </Link>
        ) : null}
      </div>
    </header>
  );

  // ── empty and gated states ──
  if (role === "super_admin" && !marketId) {
    return (
      <div className="fin prd">
        <div className="page">
          <section className="card empty">{tp("selectMarketPrompt")}</section>
        </div>
      </div>
    );
  }
  // First load only (SWR keeps the previous figures while a new period loads).
  if (!data && !error) return <ProductsListSkeleton />;

  const tot = data?.totals;
  const market = data?.market;
  const silent = market?.last_order_at && Date.now() - Date.parse(market.last_order_at) > 24 * 60 * 60 * 1000;
  const adsStopped = silent && (!market?.last_ad_day || market.last_ad_day <= localDay(market.last_order_at as string, tz));
  const net = tot?.net ?? 0;

  return (
    <div className="fin prd" onMouseOver={tip.onOver} onMouseMove={tip.onMove} onMouseLeave={tip.onLeave}>
      <div className="page">
        {actions.modals}
        {header}

        <PeriodRow period={period} tz={tz} onChange={(r) => patch({ from: r.from, to: r.to })} />

        {error && !data ? (
          <div className="notes">
            <div className="note bad" role="alert">
              <span className="nh">
                <Info className="ic" aria-hidden />
              </span>
              <span>{t("e_load")}</span>
              <button type="button" className="btn2 sm" onClick={() => void mutate()}>
                {t("retry")}
              </button>
            </div>
          </div>
        ) : null}

        <div className="kpis rise" style={{ ["--d" as string]: 2, ["--n" as string]: 5 }}>
          <Kpi
            icon={<Inbox className="ic" aria-hidden />}
            tone="k-src"
            label={t("k_rec")}
            value={
              <>
                <Num value={tot?.received ?? 0} />
                <Spark
                  values={tot?.spark ?? []}
                  w={76}
                  h={26}
                  color="#64748B"
                  tip={`${t("tip_spark")}\n${t("tr_max", { m: groupDigits(Math.max(0, ...(tot?.spark ?? []))) })}`}
                />
              </>
            }
            sub={t("k_rec_s", { n: numText(tot?.active ?? 0) })}
          />
          <Kpi
            icon={<Phone className="ic" aria-hidden />}
            tone="k-up"
            label={t("k_conf")}
            value={tot?.confirmation != null ? <Pct value={tot.confirmation} /> : <span className="zero">—</span>}
            extra={tot?.confirmation != null ? <ConfBar rate={tot.confirmation} /> : null}
            sub={t("k_conf_s", { u: numText(tot?.uploaded ?? 0), r: numText(tot?.rejected ?? 0) })}
          />
          <Kpi
            icon={<Truck className="ic" aria-hidden />}
            tone="k-dlv"
            label={t("k_dlv")}
            value={tot?.delivery != null ? <Pct value={tot.delivery} /> : <span className="zero">—</span>}
            extra={tot?.delivery != null ? <OutcomeBar delivered={tot.delivered} failed={tot.failed} inFlight={tot.in_flight} /> : null}
            sub={t("k_dlv_s", { d: numText(tot?.delivered ?? 0), f: numText(tot?.failed ?? 0) })}
          />
          <Kpi
            icon={<Wallet className="ic" aria-hidden />}
            tone="k-neu"
            label={t("k_enc")}
            value={<Amount value={tot?.encaisse ?? 0} currency={currency} />}
            sub={t(invoiced ? "k_enc_s" : "k_enc_s_c", { p: moneyText(tot?.paid ?? 0, currency), d: moneyText(tot?.carrier ?? 0, currency) })}
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
                {t("k_net_s", { m: tot?.margin != null ? pctText(tot.margin, ui) : "—", a: moneyText(tot?.ads ?? 0, currency) })}
              </>
            }
          />
        </div>

        {silent ? (
          <div className="notes rise" style={{ ["--d" as string]: 3 }}>
            <div className="note warn">
              <span className="nh">
                <Clock className="ic" aria-hidden />
              </span>
              <span>
                {t.rich("n_intake", { b, at: dayTimeLabel(market!.last_order_at as string, tz, ui) })}
                {adsStopped ? ` ${t("n_intake_ads")}` : ""}
              </span>
            </div>
          </div>
        ) : null}

        <div className="tools rise" style={{ ["--d" as string]: 3 }}>
          <div className="seg" role="group">
            {(["active", "inactive", "all"] as const).map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                className={filter === f ? "on" : undefined}
                onClick={() => patch({ filter: f === "active" ? null : f, sig: null })}
              >
                {t(`f_${f}`)}
                <em>{counts[f]}</em>
              </button>
            ))}
          </div>
          {SIGNALS.filter((s) => signals[s] > 0).map((s) => (
            <button
              key={s}
              type="button"
              className={`sig ${SIG[s]}${sig === s ? " on" : ""}`}
              aria-pressed={sig === s}
              onClick={() => patch(sig === s ? { sig: null } : { sig: s, filter: null })}
            >
              <i />
              {t(`sg_${s}`, { n: signals[s] })}
            </button>
          ))}
          <span className="grow" />
          <label className="srch">
            <Search className="ic" aria-hidden />
            <input
              type="search"
              autoComplete="off"
              placeholder={t("q_ph")}
              aria-label={t("q_ph")}
              defaultValue={q}
              onChange={(e) => patch({ q: e.target.value })}
            />
          </label>
        </div>

        <section className="card tblc rise" style={{ ["--d" as string]: 4 }} data-hl={hl ?? undefined}>
          <div className="tscroll">
            <div className="tg">
              <div className="thd">
                {head("name", t("h_prod"))}
                {head("cover", t("h_stock"), t("tip_stock", { l: groupDigits(lead) }))}
                {head("rec", t("h_orders"))}
                {head("conf", t("h_conf"), t("tip_conf"))}
                {head("dlv", t("h_dlv"), t("tip_dlv"))}
                {head("enc", t("h_money"), t("tip_money"))}
                {head("net", t("h_net"), t("gross_s"))}
                <div />
              </div>
              <div className="rows">
                {visible.length === 0 ? (
                  <div style={{ padding: "18px 20px" }}>
                    <div className="empty">{t("empty_q")}</div>
                  </div>
                ) : (
                  visible.map((r) => (
                    <ProductRowV6
                      key={r.id}
                      row={r}
                      currency={currency}
                      leadDays={lead}
                      locale={locale}
                      actions={menuFor(r)}
                      onOpen={() => router.push(sheetHref(r.id))}
                      shareLabel={shareLabel}
                    />
                  ))
                )}
              </div>
            </div>
          </div>
          <div className="lgd" onMouseLeave={() => setHl(null)}>
            {(
              [
                ["dlv", "k-dlv", t("lg_dlv")],
                ["fail", "k-fail", t("lg_fail")],
                ["fly", "k-fly", t("lg_fly")],
              ] as [Hl, string, string][]
            ).map(([k, cls, label]) => (
              <span key={k} onMouseEnter={() => setHl(k)}>
                <i className={`sw ${cls}`} />
                {label}
              </span>
            ))}
            <span className="sep" />
            {MONEY_LEGEND.map((m) => (
              <span key={m.hl} onMouseEnter={() => setHl(m.hl)}>
                <i className={`sw k-${m.hl}`} />
                {t(m.label)}
              </span>
            ))}
            {rows.some((r) => r.money.processing > 0) ? (
              <span>
                <i className="sw k-proc" />
                {t("lg_proc")}
              </span>
            ) : null}
          </div>
        </section>

        {tot?.final != null ? (
          <p className="foot rise" style={{ ["--d" as string]: 5 }}>
            <Info className="ic" aria-hidden />
            <span>
              {t("foot", { from: dayLabel(period.from, ui), to: dayLabel(period.to, ui), p: pctText(tot.final, ui) })}
            </span>
          </p>
        ) : null}
      </div>
      <div className="tip" ref={tip.ref} role="tooltip" />
    </div>
  );
}
