"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { jsonFetcher } from "@/lib/fetchers";
import type { WarehouseStockRow } from "@/app/api/warehouse/stock/route";
import type { WarehouseHistoryRow } from "@/app/api/warehouse/history/route";
import { DeskHeader, DeskPage, Drawer, Eb, Empty, Ic, LiveSub, Pill, SearchLine, Sec, SiteSeg, Thumb, Tile, Tiles, fnum, type Hue } from "./ui";
import type { IconName } from "./icons";
import { useDeskSite } from "./useDeskSite";

/**
 * Entrepôt › Stock, on the desk (prototypes/entrepot-desk-v1.html).
 *
 * How much is free, and where. Each product shows its split by building (a
 * star marks a figure no count has ever confirmed there), what is promised to
 * parcels, what is on its way, and what is left to sell. Compter and the
 * Journal live here; Recevoir has its own page now.
 */

/** Building colours on the split bar — categorical, never a status. */
const SITE_SW = ["#0E9384", "#7A5AF8", "#DD2590", "#F79009"];

type TileKey = "all" | "low" | "nc" | "neg";
type JournalKind = "all" | "scan" | "return" | "reception" | "count" | "adjust";
const JOURNAL_KINDS: JournalKind[] = ["all", "scan", "return", "reception", "count", "adjust"];
const KIND_STYLE: Record<WarehouseHistoryRow["kind"], { hue: Hue; icon: IconName }> = {
  scan: { hue: "h-neutral", icon: "out" },
  print: { hue: "h-neutral", icon: "file" },
  handover: { hue: "h-neutral", icon: "truck" },
  return: { hue: "j-ret", icon: "back" },
  reception: { hue: "j-rec", icon: "dock" },
  count: { hue: "j-cnt", icon: "count" },
  adjust: { hue: "h-amber", icon: "alert" },
  writeoff: { hue: "h-red", icon: "broken" },
};

export function StockDesk({ market, dateLabel }: { market: "ly" | "tn"; dateLabel: string }) {
  const t = useTranslations("warehouse.desk");
  const ts = useTranslations("warehouse.desk.stock");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const { sites, siteId, setSite, nameOf } = useDeskSite();
  const tab = search.get("tab") === "journal" ? "journal" : "products";
  const setTab = (next: "products" | "journal") => {
    const p = new URLSearchParams(search.toString());
    if (next === "journal") p.set("tab", "journal");
    else p.delete("tab");
    router.replace(`${pathname}${p.toString() ? `?${p}` : ""}`, { scroll: false });
  };

  const countHref = `/${locale}/warehouse/count${siteId ? `?warehouse_id=${siteId}` : ""}`;
  const tabs = (
    <div className="seg" role="tablist" aria-label={ts("tabs")}>
      {(["products", "journal"] as const).map((k) => (
        <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
          {ts(`tab.${k}`)}
        </button>
      ))}
    </div>
  );

  return tab === "journal" ? (
    <Journal market={market} dateLabel={dateLabel} tabs={tabs} sites={<SiteSeg sites={sites} value={siteId} onChange={setSite} />} />
  ) : (
    <Products
      market={market}
      dateLabel={dateLabel}
      tabs={tabs}
      siteSeg={<SiteSeg sites={sites} value={siteId} onChange={setSite} />}
      siteId={siteId}
      siteIds={sites.map((s) => s.id)}
      nameOf={nameOf}
      countHref={countHref}
      t={t}
    />
  );
}

function Products({
  market,
  dateLabel,
  tabs,
  siteSeg,
  siteId,
  siteIds,
  nameOf,
  countHref,
  t,
}: {
  market: "ly" | "tn";
  dateLabel: string;
  tabs: React.ReactNode;
  siteSeg: React.ReactNode;
  siteId: string | null;
  siteIds: string[];
  nameOf: (id: string | null | undefined) => string | null;
  countHref: string;
  t: ReturnType<typeof useTranslations>;
}) {
  const ts = useTranslations("warehouse.desk.stock");
  const { data, error } = useSWR<{ rows: WarehouseStockRow[] }>("/api/warehouse/stock", jsonFetcher, { revalidateOnFocus: true });
  const [tile, setTile] = useState<TileKey>("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<WarehouseStockRow | null>(null);

  const all = useMemo(() => data?.rows ?? [], [data]);
  const onShelf = (r: WarehouseStockRow) => (siteId ? r.sites.find((s) => s.warehouse_id === siteId)?.current_stock ?? 0 : r.current_stock);
  const neverHere = (r: WarehouseStockRow) =>
    siteId ? !r.sites.find((s) => s.warehouse_id === siteId)?.last_counted_at : r.last_counted_at === null;
  const neg = all.filter((r) => r.free < 0);
  const low = all.filter((r) => r.free >= 0 && r.current_stock <= r.low_stock_threshold);
  const nc = all.filter(neverHere);
  const pairs = siteIds.length > 1 ? all.reduce((s, r) => s + siteIds.filter((id) => !r.sites.find((x) => x.warehouse_id === id)?.last_counted_at).length, 0) : nc.length;

  const base = tile === "low" ? low : tile === "neg" ? neg : tile === "nc" ? nc : all;
  const needle = q.trim().toLowerCase();
  const rows = needle ? base.filter((r) => r.name.toLowerCase().includes(needle) || (r.sku ?? "").toLowerCase().includes(needle)) : base;
  const cols = "minmax(240px,1.5fr) 240px 90px 90px 110px 150px";

  return (
    <DeskPage overlay={open ? <ProductDrawer row={open} siteIds={siteIds} nameOf={nameOf} onClose={() => setOpen(null)} /> : null}>
      <DeskHeader
        title={ts("title")}
        sub={<LiveSub parts={[t(`market.${market}`), dateLabel]} />}
        acts={
          <>
            {tabs}
            {siteSeg}
            <Link href={countHref} className="btn"><Ic n="count" />{ts("count")}</Link>
          </>
        }
      />
      <Tiles n={4}>
        <Tile hue="h-neutral" icon="boxes" n={all.length} label={ts("tileAll")} small={ts("tileAllSub", { n: fnum(all.reduce((s, r) => s + onShelf(r), 0)) })} on={tile === "all"} onClick={() => setTile("all")} />
        <Tile hue="h-amber" icon="alert" n={low.length} label={ts("tileLow")} small={low.length ? <em className="w">{ts("tileLowSub")}</em> : ts("tileLowNone")} on={tile === "low"} onClick={() => setTile(tile === "low" ? "all" : "low")} />
        <Tile hue="j-cnt" icon="count" n={nc.length} label={ts("tileNc")} small={siteIds.length > 1 && !siteId ? ts("tileNcSub", { n: pairs }) : ts("tileNcSubOne")} on={tile === "nc"} onClick={() => setTile(tile === "nc" ? "all" : "nc")} />
        <Tile hue="h-red" icon="alert" n={neg.length} label={ts("tileNeg")} small={neg.length ? <em>{ts("tileNegSub")}</em> : ts("tileNegNone")} on={tile === "neg"} onClick={() => setTile(tile === "neg" ? "all" : "neg")} />
      </Tiles>
      <SearchLine value={q} onChange={setQ} placeholder={ts("search")} />
      <div className="list" style={{ "--cols": cols } as React.CSSProperties}>
        <div className="lh">
          <span>{ts("colProduct")}</span>
          <span>{ts("colWhere")}</span>
          <span className="e">{ts("colPromised")}</span>
          <span className="e">{ts("colIncoming")}</span>
          <span className="e">{ts("colFree")}</span>
          <span />
        </div>
        <div className="rows">
          {error ? (
            <Empty icon="alert">{t("loadError")}</Empty>
          ) : !data ? (
            <Empty icon="boxes">…</Empty>
          ) : rows.length === 0 ? (
            <Empty icon="check">{ts("empty")}</Empty>
          ) : (
            rows.map((r) => {
              const shown = siteId ? siteIds.filter((id) => id === siteId) : siteIds;
              const per = shown.map((id, i) => {
                const s = r.sites.find((x) => x.warehouse_id === id);
                return { id, n: Math.max(0, s?.current_stock ?? 0), counted: !!s?.last_counted_at, c: SITE_SW[siteIds.indexOf(id) % SITE_SW.length] ?? SITE_SW[i] };
              });
              const sum = Math.max(1, per.reduce((s, p) => s + p.n, 0) + (siteId ? 0 : Math.max(0, r.unallocated)));
              const stateHue: [Hue, IconName, string] =
                r.free < 0
                  ? ["h-red", "alert", ts("stNeg")]
                  : r.current_stock <= r.low_stock_threshold
                    ? ["h-amber", "alert", ts("stLow")]
                    : r.last_counted_at === null
                      ? ["j-cnt", "count", ts("stNever")]
                      : ["h-green", "check", ts("stOk")];
              return (
                <div className="row" key={r.product_id} data-testid="stock-row" onClick={() => setOpen(r)}>
                  <div className="lt">
                    <Thumb seed={r.product_id} image={r.image_url} />
                    <div>
                      <span className="nm"><bdi>{r.name}</bdi></span>
                      <span className="l2">{ts("threshold", { n: r.low_stock_threshold })}{r.sku ? ` · ${r.sku}` : ""}</span>
                    </div>
                  </div>
                  <div className="split">
                    {per.length ? (
                      <>
                        <div className="bar">
                          {per.map((p) => <i key={p.id} style={{ width: `${(p.n / sum) * 100}%`, background: p.c }} />)}
                        </div>
                        <small>
                          {per.map((p, i) => (
                            <span key={p.id}>
                              {i > 0 ? " · " : ""}
                              <span className="sw" style={{ background: p.c }} />
                              {nameOf(p.id)} <b>{fnum(p.n)}</b>
                              {p.counted ? "" : "*"}
                            </span>
                          ))}
                          {!siteId && r.unallocated > 0 ? ` · ${ts("unallocated", { n: fnum(r.unallocated) })}` : ""}
                        </small>
                      </>
                    ) : (
                      <small><b>{fnum(r.current_stock)}</b>{r.last_counted_at ? "" : "*"}</small>
                    )}
                  </div>
                  <span className="e num" style={{ fontWeight: 700, color: "var(--ink-2)" }}>{r.engaged ? fnum(r.engaged) : "—"}</span>
                  <span className="e num" style={{ fontWeight: 700, color: "var(--ink-2)" }}>{r.incoming ? `+${fnum(r.incoming)}` : "—"}</span>
                  <span className={`e free ${r.free <= 0 ? "zero" : ""}`} style={r.free < 0 ? { color: "var(--bad)" } : undefined}>{fnum(r.free)}</span>
                  <span style={{ justifySelf: "end" }}><Pill hue={stateHue[0]} icon={stateHue[1]}>{stateHue[2]}</Pill></span>
                </div>
              );
            })
          )}
        </div>
        <div className="lfoot"><Ic n="info" /><span>{ts("foot")}</span></div>
      </div>
    </DeskPage>
  );
}

function ProductDrawer({
  row,
  siteIds,
  nameOf,
  onClose,
}: {
  row: WarehouseStockRow;
  siteIds: string[];
  nameOf: (id: string | null | undefined) => string | null;
  onClose: () => void;
}) {
  const ts = useTranslations("warehouse.desk.stock");
  const locale = useLocale();
  const format = useFormatter();
  const { data } = useSWR<{ rows: WarehouseHistoryRow[] }>(`/api/warehouse/history?product_id=${row.product_id}&limit=12`, jsonFetcher);
  const moves = data?.rows ?? [];
  return (
    <Drawer
      onClose={onClose}
      label={row.name}
      head={<Thumb seed={row.product_id} image={row.image_url} />}
      title={<bdi>{row.name}</bdi>}
      sub={ts("drawerSub", { n: row.low_stock_threshold, sku: row.sku ?? "—" })}
      foot={
        <>
          <Link className="btn2" href={`/${locale}/warehouse/count?product=${row.product_id}`}><Ic n="count" />{ts("countThis")}</Link>
          <span className="grow" />
          <Link className="btn" href={`/${locale}/warehouse/receive`}><Ic n="dock" />{ts("recordArrival")}</Link>
        </>
      }
    >
      <Sec>
        <Eb icon="boxes">{ts("freeToSell")}</Eb>
        <div className="big" style={row.free < 0 ? { color: "var(--bad)" } : undefined}>{fnum(row.free)}</div>
        <div className="kv">
          <div><b>{fnum(row.current_stock)}</b><small>{ts("onShelves")}</small></div>
          <div><b>{fnum(row.engaged)}</b><small>{ts("promised")}</small></div>
          <div><b>{row.incoming ? `+${fnum(row.incoming)}` : "—"}</b><small>{ts("incoming")}</small></div>
        </div>
      </Sec>
      {siteIds.length > 0 ? (
        <Sec>
          <Eb icon="pin">{ts("bySite")}</Eb>
          {siteIds.map((id, i) => {
            const s = row.sites.find((x) => x.warehouse_id === id);
            return (
              <div className="mv" key={id}>
                <span className="sw" style={{ background: SITE_SW[i % SITE_SW.length], width: 12, height: 12 }} />
                <div>
                  <b>{nameOf(id)}</b>
                  <small>{s?.last_counted_at ? ts("countedOn", { date: format.dateTime(new Date(s.last_counted_at), { day: "numeric", month: "short" }) }) : ts("neverHere")}</small>
                </div>
                <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <b className="num" style={{ fontSize: 16 }}>{fnum(s?.current_stock ?? 0)}</b>
                  <Link className="btn2 sm" href={`/${locale}/warehouse/count?product=${row.product_id}&warehouse_id=${id}`}><Ic n="count" />{ts("count")}</Link>
                </span>
              </div>
            );
          })}
          {row.unallocated > 0 ? <div className="l2" style={{ whiteSpace: "normal" }}>{ts("unallocatedHint", { n: fnum(row.unallocated) })}</div> : null}
        </Sec>
      ) : null}
      <Sec>
        <Eb icon="list" aside={moves.length}>{ts("lastMoves")}</Eb>
        {moves.length === 0 ? (
          <div className="l2">{ts("noMoves")}</div>
        ) : (
          moves.map((m) => {
            const d = m.qty_change ?? 0;
            return (
              <div className="mv" key={m.id}>
                <span className={`d ${d > 0 ? "p" : "m"} num`}>{d > 0 ? "+" : d < 0 ? "−" : ""}{Math.abs(d)}</span>
                <div><b>{ts(`kind.${m.kind}`)}</b><small dir="auto">{m.detail}{m.actor?.full_name ? ` · ${m.actor.full_name}` : ""}</small></div>
                <small>{format.dateTime(new Date(m.at), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</small>
              </div>
            );
          })
        )}
      </Sec>
    </Drawer>
  );
}

function Journal({ market, dateLabel, tabs, sites }: { market: "ly" | "tn"; dateLabel: string; tabs: React.ReactNode; sites: React.ReactNode }) {
  const t = useTranslations("warehouse.desk");
  const ts = useTranslations("warehouse.desk.stock");
  const format = useFormatter();
  const [kind, setKind] = useState<JournalKind>("all");
  const { data, error } = useSWR<{ rows: WarehouseHistoryRow[] }>(`/api/warehouse/history?limit=100&kind=${kind}`, jsonFetcher);
  const rows = data?.rows ?? [];
  const cols = "150px minmax(240px,1.5fr) 90px minmax(180px,1fr) 140px";
  return (
    <DeskPage>
      <DeskHeader
        title={ts("title")}
        sub={<LiveSub parts={[t(`market.${market}`), dateLabel]} />}
        acts={
          <>
            {tabs}
            {sites}
            <a className="btn2" href={`/api/warehouse/history/export.csv?kind=${kind}`}><Ic n="file" />{ts("export")}</a>
          </>
        }
      />
      <div className="rolls">
        <span className="lab">{ts("movement")}</span>
        {JOURNAL_KINDS.map((k) => (
          <button key={k} type="button" className={`rc ${kind === k ? "on" : ""}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
            {ts(`filter.${k}`)}
          </button>
        ))}
        <span className="count">{ts.rich("lines", { n: rows.length, b: (c) => <b>{c}</b> })}</span>
      </div>
      <div className="list" style={{ "--cols": cols } as React.CSSProperties}>
        <div className="lh">
          <span>{ts("colWhen")}</span>
          <span>{ts("colProduct")}</span>
          <span className="e">{ts("colUnits")}</span>
          <span>{ts("colWhy")}</span>
          <span>{ts("colWho")}</span>
        </div>
        <div className="rows">
          {error ? (
            <Empty icon="alert">{t("loadError")}</Empty>
          ) : rows.length === 0 ? (
            <Empty icon="list">{data ? ts("journalEmpty") : "…"}</Empty>
          ) : (
            rows.map((j) => {
              const st = KIND_STYLE[j.kind];
              const d = j.qty_change ?? 0;
              return (
                <div className="row static" key={j.id} data-testid="journal-row">
                  <span className="age">{format.dateTime(new Date(j.at), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  <div className="lt">
                    <Thumb seed={j.product_id ?? j.id} />
                    <div>
                      <span className="nm"><bdi>{j.product_name ?? "—"}</bdi></span>
                      <span className="l2">{j.order_number ? `#${j.order_number}` : ""}</span>
                    </div>
                  </div>
                  <span className="e num" style={{ fontSize: 15, fontWeight: 800, color: d > 0 ? "var(--good)" : "var(--ink)" }}>
                    {j.qty_change === null ? "—" : `${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(d)}`}
                  </span>
                  <span style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
                    <Pill hue={j.is_damaged ? "h-red" : st.hue} icon={j.is_damaged ? "broken" : st.icon}>{ts(`kind.${j.kind}`)}</Pill>
                    <span className="l2" style={{ margin: 0 }} dir="auto">{j.note ?? j.detail}</span>
                  </span>
                  <span className="site">{j.actor?.full_name ?? "—"}</span>
                </div>
              );
            })
          )}
        </div>
        <div className="lfoot"><Ic n="info" /><span>{ts("journalFoot")}</span></div>
      </div>
    </DeskPage>
  );
}
