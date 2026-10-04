"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Ban, Clock, Package, Truck, Wallet, X } from "lucide-react";
import { useTeamAgentPanel } from "@/hooks/useTeamRoom";
import { useRejectionReasons } from "@/hooks/useRejectionReasons";
import { buildPanelView, type PanelView } from "@/lib/team/room/panel-view";
import type { AgentDayRow, DayView } from "@/lib/team/room/day-view";
import { addDays, daysBetween, localDayMinute } from "@/lib/team/room/time";
import { rejectionGroupIcon } from "@/lib/orders/rejection-config";
import { StatusIcon } from "@/components/shared/StatusIcon";
import { Skeleton } from "@/components/ui/Skeleton";
import type { MarketCode } from "@/lib/markets";
import { stateLine, presenceOf } from "./agent-state";
import { DayLane } from "./DayLane";
import { Avatar, CallButton, SectionLabel, Swatch, WhatsAppButton, agentStyle } from "./parts";
import type { RoomFormat } from "./useRoomFormat";

export type PanelPeriod = "day" | "week";

interface Props {
  marketId: string;
  market: MarketCode;
  agentId: string | null;
  /** Name and colour for an agent the day view does not list (an old account with a balance). */
  fallback: { name: string; color: string | null } | null;
  view: DayView | null;
  period: PanelPeriod;
  locale: string;
  fmt: RoomFormat;
  canPay: boolean;
  onPeriod: (p: PanelPeriod) => void;
  onPay: (agentId: string) => void;
  onClose: () => void;
}

const ICON = { className: "r6-ic", "aria-hidden": true } as const;

/** Her drawer — frosted glass in her colour. prototypes/team-v6.html `renderDrawer()` */
export function AgentPanel({ marketId, market, agentId, fallback, view, period, locale, fmt, canPay, onPeriod, onPay, onClose }: Props) {
  const t = useTranslations("team.room.panel");
  const ta = useTranslations("team.room.agents");
  const closeRef = useRef<HTMLButtonElement>(null);
  const open = agentId !== null;
  const day = view?.day ?? "";
  const from = period === "week" ? addDays(day, -6) : day;
  const { panel, error, isLoading } = useTeamAgentPanel(marketId, open && day ? agentId : null, from, day);
  const pv = useMemo(() => (panel ? buildPanelView(panel) : null), [panel]);

  const row = view?.rows.find((r) => r.agentId === agentId) ?? null;
  const dormant = view?.dormant.find((d) => d.agentId === agentId) ?? null;
  const name = row?.name ?? dormant?.name ?? fallback?.name ?? "";
  const color = row?.color ?? dormant?.color ?? fallback?.color ?? null;
  const phone = row?.phone ?? null;
  const lastAction = row?.lastActionAt ?? dormant?.lastActionAt ?? null;
  const line = row ? stateLine(row, ta, fmt) : lastAction && view ? ta("st.off", { d: fmt.dayNum(localDayMinute(lastAction, view.tz).day) }) : ta("st.never");

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const isToday = view ? daysBetween(view.day, view.today) === 0 : false;

  return (
    <>
      <div className={`r6-scrim ${open ? "r6-show" : ""}`} onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-hidden={!open}
        aria-label={name}
        className={`r6-drawer ${open ? "r6-show" : ""}`}
        style={agentId ? agentStyle(color, agentId) : undefined}
      >
        {open && view && (
          <>
            <div className="r6-dh">
              <Avatar name={name} agentId={agentId!} color={color} presence={row ? presenceOf(row, view.live) : null} />
              <div style={{ minWidth: 0 }}>
                <b>{name}</b>
                <span className={`r6-st ${row ? `r6-${row.state}` : ""}`}>{line}</span>
              </div>
              <div className="r6-acts">
                <WhatsAppButton phone={phone} market={market} variant="labelled" />
                <CallButton phone={phone} />
                <button ref={closeRef} type="button" className="r6-xbtn" onClick={onClose} aria-label={t("close")}>
                  <X {...ICON} />
                </button>
              </div>
            </div>

            <div className="r6-db">
              <div className="r6-dseg">
                <div className="r6-seg" role="tablist">
                  {(["day", "week"] as const).map((p) => (
                    <button key={p} type="button" role="tab" aria-selected={period === p} className={period === p ? "r6-on" : ""} onClick={() => onPeriod(p)}>
                      {p === "day" ? (isToday ? t("today") : fmt.dayShort(view.day)) : t("week")}
                    </button>
                  ))}
                </div>
                <span className="r6-dr">{period === "week" ? `${fmt.dayNum(from)} → ${fmt.dayNum(view.day)}` : fmt.dayLong(view.day)}</span>
              </div>

              {error && !panel && <p className="r6-none" style={{ color: "var(--bad)" }}>{t("loadError")}</p>}
              {isLoading && !pv && (
                <div role="status" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <Skeleton className="h-[84px] w-full" />
                  <Skeleton className="h-[120px] w-full" />
                  <Skeleton className="h-[160px] w-full" />
                </div>
              )}

              {pv && (
                <>
                  <Tiles pv={pv} fmt={fmt} />
                  <Delivered30 pv={pv} />
                </>
              )}

              {period === "day" && row && <Day r={row} view={view} fmt={fmt} />}

              {pv && (
                <>
                  <Products pv={pv} fmt={fmt} />
                  <Rejections pv={pv} marketId={marketId} locale={locale} fmt={fmt} />
                  <Commission pv={pv} fmt={fmt} canPay={canPay} today={panel!.today} tz={panel!.tz} onPay={() => onPay(agentId!)} />
                </>
              )}
            </div>
          </>
        )}
      </aside>
    </>
  );
}

function Tiles({ pv, fmt }: { pv: PanelView; fmt: RoomFormat }) {
  const t = useTranslations("team.room.panel");
  const { assigned, uploaded, rejected, attempts } = pv.totals;
  const dec = uploaded + rejected;
  const tile = (sw: ReactNode, label: string, v: number, sub: string) => (
    <div className="r6-k">
      <div className="r6-l">
        {sw}
        {label}
      </div>
      <div className="r6-v">{v}</div>
      <div className="r6-s">{sub}</div>
    </div>
  );
  return (
    <div className="r6-kt">
      {tile(<Swatch style={{ background: "#475467" }} />, t("kAssigned"), assigned, t("kAssignedSub"))}
      {tile(<Swatch k="up" />, t("kUploaded"), uploaded, dec ? t("rate", { p: fmt.pct((uploaded / dec) * 100) }) : "—")}
      {tile(<Swatch k="rej" />, t("kRejected"), rejected, dec ? t("rate", { p: fmt.pct((rejected / dec) * 100) }) : "—")}
      {tile(<Swatch k="prog" />, t("kAttempts"), attempts, t("kAttemptsSub"))}
    </div>
  );
}

function Delivered30({ pv }: { pv: PanelView }) {
  const t = useTranslations("team.room.panel");
  const d = pv.delivered30;
  if (!d.total) return null;
  const seg = (n: number, k: string) => (n ? <span className={`r6-k-${k}`} style={{ flex: n }} /> : null);
  const key = (n: number, k: string, label: string) => (
    <span>
      <Swatch k={k} />
      <b>{n}</b> {label}
    </span>
  );
  return (
    <div className="r6-sec r6-dlv">
      <SectionLabel icon={<Truck {...ICON} />}>{t("dlvTitle")}</SectionLabel>
      <div className="r6-bar">
        {seg(d.delivered, "del")}
        {seg(d.returned, "ret")}
        {seg(d.enRoute, "road")}
      </div>
      <div className="r6-ks">
        {key(d.delivered, "del", t("dlvD"))}
        {key(d.returned, "ret", t("dlvR"))}
        {key(d.enRoute, "road", t("dlvE"))}
      </div>
    </div>
  );
}

function Day({ r, view, fmt }: { r: AgentDayRow; view: DayView; fmt: RoomFormat }) {
  const t = useTranslations("team.room.panel");
  const tl = useTranslations("team.room.lane");
  const ta = useTranslations("team.room.agents");
  const rest = view.work === false && !view.settings.overrides[r.agentId];
  const planned = !rest && !!r.shift;
  const late = planned && r.lateBy !== null && r.lateBy > view.lateMin;
  const fact = (label: string, value: string, note?: ReactNode) => (
    <div>
      <small>{label}</small>
      <b>{value}</b>
      {note}
    </div>
  );
  return (
    <div className="r6-sec">
      <SectionLabel icon={<Clock {...ICON} />} end={<span className="r6-num">{rest ? ta("st.rest") : r.shift ? t("plan", { a: fmt.hm(r.shift[0]), b: fmt.hm(r.shift[1]) }) : t("noPlan")}</span>}>
        {t("day")}
      </SectionLabel>
      <DayLane r={r} view={view} fmt={fmt} />
      <div className="r6-lkey">
        <span><i className="r6-p" />{tl("kShift")}</span>
        <span><i className="r6-t" style={{ background: "var(--w-up)" }} />{tl("kUp")}</span>
        <span><i className="r6-t" style={{ background: "var(--w-rej)" }} />{tl("kRej")}</span>
        <span>▼ {tl("kAs")}</span>
        {planned && (
          <span>
            <i style={{ width: 20, height: 8, borderRadius: 99, border: "1.5px dashed color-mix(in srgb,var(--a5) 45%,transparent)" }} />
            {tl("kPlan")}
          </span>
        )}
      </div>
      <div className="r6-facts r6-num">
        {fact(
          t("start"),
          r.first !== null ? fmt.hm(r.first) : "—",
          r.first !== null && planned ? <span className={late ? "r6-warn" : ""}>{late ? t("lateBy", { d: fmt.dur(r.lateBy!) }) : t("onTime")}</span> : undefined,
        )}
        {fact(t("onShift"), r.onShiftMin ? fmt.dur(r.onShiftMin) : "—", r.plannedMin && r.onShiftMin ? <span>{t("onShiftPct", { p: fmt.pct((r.onShiftMin / r.plannedMin) * 100) })}</span> : undefined)}
        {fact(t("last"), r.last !== null ? fmt.hm(r.last) : "—")}
      </div>
    </div>
  );
}

function Products({ pv, fmt }: { pv: PanelView; fmt: RoomFormat }) {
  const t = useTranslations("team.room.panel");
  const nv = (n: number, color?: string) => (
    <span className={`r6-nv ${n ? "" : "r6-z"}`} style={n && color ? { color } : undefined}>
      {n}
    </span>
  );
  return (
    <div className="r6-sec">
      <SectionLabel icon={<Package {...ICON} />} end={<span className="r6-num">{pv.products.length}</span>}>
        {t("products")}
      </SectionLabel>
      {pv.products.length === 0 ? (
        <div className="r6-none">{t("productsNone")}</div>
      ) : (
        <>
          <div className="r6-prow r6-ph">
            <span />
            <span>{t("phProduct")}</span>
            <span>{t("phAssigned")}</span>
            <span>{t("phUploaded")}</span>
            <span>{t("phRejected")}</span>
            <span>{t("phAttempts")}</span>
          </div>
          {pv.products.map((p) => (
            <div key={p.key} className="r6-prow">
              {p.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.imageUrl} alt="" loading="lazy" />
              ) : (
                <span className="r6-ph0" />
              )}
              <div className="r6-pm">
                <span className="r6-pn" dir="auto">{p.name ?? t("unknownProduct")}</span>
                <div className="r6-pbar2" style={{ width: `${p.barPct}%` }}>
                  {p.uploaded > 0 && <span className="r6-k-up" style={{ flex: p.uploaded }} />}
                  {p.rejected > 0 && <span className="r6-k-rej" style={{ flex: p.rejected }} />}
                  {p.decided === 0 && <span className="r6-k-todo" style={{ flex: 1 }} />}
                </div>
                <span className="r6-ps">{p.rate !== null ? t("pRate", { p: fmt.pct(p.rate) }) : t("pNoDecision")}</span>
              </div>
              {nv(p.assigned)}
              {nv(p.uploaded, "var(--w-up)")}
              {nv(p.rejected, "var(--w-rej)")}
              {nv(p.attempts)}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function Rejections({ pv, marketId, locale, fmt }: { pv: PanelView; marketId: string; locale: string; fmt: RoomFormat }) {
  const t = useTranslations("team.room.panel");
  const { rows: configs } = useRejectionReasons(marketId);
  const label = (group: string) => {
    if (group === "autre") return t("rejOther");
    const c = configs.find((x) => x.parent_key === null && x.key === group);
    return c ? (locale === "ar" ? c.label_ar : c.label_fr) : group;
  };
  return (
    <div className="r6-sec">
      <SectionLabel icon={<Ban {...ICON} />} end={<span className="r6-num">{pv.rejections.total}</span>}>
        {t("rejections")}
      </SectionLabel>
      {pv.rejections.rows.length === 0 && <div className="r6-none">{t("rejNone")}</div>}
      {pv.rejections.rows.map((r) => (
        <div key={r.group} className="r6-rgr">
          <span className="r6-gi">
            <StatusIcon name={rejectionGroupIcon(r.group)} size={15} />
          </span>
          <span className="r6-t">{label(r.group)}</span>
          <span className="r6-trk">
            <span style={{ width: `${r.barPct}%` }} />
          </span>
          <span className="r6-n">{r.n}</span>
          <span className="r6-p">{fmt.pct(r.pct)}</span>
        </div>
      ))}
    </div>
  );
}

function Commission({ pv, fmt, canPay, today, tz, onPay }: { pv: PanelView; fmt: RoomFormat; canPay: boolean; today: string; tz: string; onPay: () => void }) {
  const t = useTranslations("team.room.panel");
  const c = pv.commission;
  const b = (chunk: ReactNode) => <b>{chunk}</b>;
  if (c.off) {
    return (
      <div className="r6-sec">
        <SectionLabel icon={<Wallet {...ICON} />}>{t("comm")}</SectionLabel>
        <div className="r6-none">{t("commOff")}</div>
      </div>
    );
  }
  const cell = (label: string, value: number, note: string) => (
    <div className="r6-c">
      <small>{label}</small>
      <b>{fmt.money(value)}</b>
      <span>{note}</span>
    </div>
  );
  return (
    <div className="r6-sec">
      <SectionLabel icon={<Wallet {...ICON} />} end={c.enabled && c.rate > 0 ? `${t("commRate", { r: fmt.money(c.rate) })}${c.rate_since ? ` · ${t("commSince", { d: fmt.dayNum(c.rate_since) })}` : ""}` : undefined}>
        {t("comm")}
      </SectionLabel>
      <div className="r6-cm-top">
        <div>
          <small>{t("commBalance")}</small>
          <b>{fmt.money(c.balance)}</b>
        </div>
        {canPay && c.balance > 0 && (
          <button type="button" className="r6-btn r6-pri" onClick={onPay}>
            {t("pay")}
          </button>
        )}
      </div>
      <div className="r6-eq">
        {cell(t("earned"), c.earned, t("nDlv", { n: c.earned_n }))}
        <span className="r6-op">−</span>
        {cell(t("back"), c.back, t("nBack", { n: c.back_n }))}
        <span className="r6-op">−</span>
        {cell(t("paid"), c.paid, t("nPay", { n: c.paid_n }))}
      </div>

      <SectionLabel style={{ margin: "18px 0 0" }} end={<span className="r6-num">{t("c14Sum", { v: fmt.money(c.sum_14) })}</span>}>
        {t("c14")}
      </SectionLabel>
      <div className="r6-cbars">
        {c.bars.map((d, i) => (
          <div key={d.day} className={`r6-d ${d.payday ? "r6-pay" : ""}`} data-tip={`${fmt.dayShort(d.day)} · ${fmt.money(d.net)}${d.payday ? ` · ${t("payday")} −${fmt.money(d.paid)}` : ""}`}>
            <i style={{ height: `${Math.max(d.net > 0 ? 4 : 0, d.heightPct)}%`, animationDelay: `${i * 30}ms` }} />
          </div>
        ))}
      </div>
      <div className="r6-clab" aria-hidden="true">
        {c.bars.map((d, i) => (
          <span key={d.day}>{i % 2 === 1 ? fmt.dayOfMonth(d.day) : ""}</span>
        ))}
      </div>
      <div className="r6-cline">
        <Truck {...ICON} />
        <span>{c.coming > 0 ? t.rich("coming", { v: fmt.money(c.coming), n: c.in_flight, late: c.in_flight_late, b }) : t("comingNone")}</span>
      </div>
      <div className="r6-cline">
        <Clock {...ICON} />
        <span>{c.last_payout ? t.rich("lastPay", { d: fmt.dayShort(localDayMinute(c.last_payout.at, tz).day), v: fmt.money(c.last_payout.amount), b }) : t("neverPaid")}</span>
        <span className="r6-asof">{t("asOf", { d: fmt.dayNum(today) })}</span>
      </div>
    </div>
  );
}
