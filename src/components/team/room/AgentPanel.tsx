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
import { stateLine, presenceOf } from "./AgentsTodayCard";
import { DayLane } from "./DayLane";
import { Avatar, CallButton, SectionLabel, WhatsAppButton } from "./parts";
import type { RoomFormat } from "./useRoomFormat";

export type PanelPeriod = "day" | "week";

interface Props {
  marketId: string;
  market: MarketCode;
  agentId: string | null;
  /** Name for an agent the day view does not list (an old account with a balance). */
  fallbackName: string | null;
  view: DayView | null;
  period: PanelPeriod;
  locale: string;
  fmt: RoomFormat;
  canPay: boolean;
  onPeriod: (p: PanelPeriod) => void;
  onPay: (agentId: string) => void;
  onClose: () => void;
}

const SEC = "rounded-[12px] border border-line-subtle px-[16px] py-[14px]";

/** One agent, read in a minute. prototypes/team-v5.html `renderDrawer()` */
export function AgentPanel({ marketId, market, agentId, fallbackName, view, period, locale, fmt, canPay, onPeriod, onPay, onClose }: Props) {
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
  const name = row?.name ?? dormant?.name ?? fallbackName ?? "";
  const phone = row?.phone ?? null;
  const lastAction = row?.lastActionAt ?? dormant?.lastActionAt ?? null;
  const line = row
    ? stateLine(row, ta, fmt)
    : lastAction && view
      ? ta("st.off", { d: fmt.dayNum(localDayMinute(lastAction, view.tz).day) })
      : ta("st.never");

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
      <div
        className={`fixed inset-0 z-[45] bg-[rgba(26,26,26,.32)] transition-opacity duration-[160ms] ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-hidden={!open}
        aria-label={name}
        className={`fixed bottom-0 end-0 top-0 z-[46] flex w-[560px] max-w-full flex-col border-s border-line-subtle bg-surface-card shadow-[0_4px_16px_rgba(16,24,40,.06)] transition-transform duration-200 ease-out max-[900px]:w-full ${open ? "translate-x-0" : "translate-x-[104%] rtl:-translate-x-[104%]"}`}
      >
        {open && view && (
          <>
            <div className="flex flex-none items-center gap-[12px] border-b border-line-subtle px-[18px] py-[14px] max-[900px]:flex-wrap">
              <Avatar name={name} presence={row ? presenceOf(row, view.live) : null} size={42} />
              <div className="min-w-0">
                <b className="block text-[16.5px] font-[650]">{name}</b>
                <span className={`text-[12.5px] ${row && ["idle", "late", "early"].includes(row.state) ? "font-medium text-room-amber-ink" : "text-room-ink-3"}`}>{line}</span>
              </div>
              <div className="ms-auto flex items-center gap-[6px]">
                <WhatsAppButton phone={phone} market={market} variant="labelled" />
                <CallButton phone={phone} />
                <button ref={closeRef} type="button" onClick={onClose} aria-label={t("close")} className="grid h-[32px] w-[32px] place-items-center rounded-[8px] text-room-ink-2 hover:bg-room-hover hover:text-ink-primary">
                  <X size={16} strokeWidth={1.8} aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="flex flex-1 flex-col gap-[12px] overflow-y-auto px-[18px] pb-[30px] pt-[16px]">
              <div className="flex items-center gap-[10px]">
                <div role="tablist" className="inline-flex rounded-[10px] border border-line-subtle bg-surface-sunken p-[2px]">
                  {(["day", "week"] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      role="tab"
                      aria-selected={period === p}
                      onClick={() => onPeriod(p)}
                      className={`h-[28px] rounded-[8px] px-[13px] text-[12.5px] ${period === p ? "bg-white font-semibold text-ink-primary shadow-[0_1px_2px_rgba(16,24,40,.08)]" : "font-medium text-room-ink-2"}`}
                    >
                      {p === "day" ? (isToday ? t("today") : fmt.dayShort(view.day)) : t("week")}
                    </button>
                  ))}
                </div>
                <span className="ms-auto text-[12px] text-room-ink-3 tabular-nums">
                  {period === "week" ? `${fmt.dayNum(from)} → ${fmt.dayNum(view.day)}` : fmt.dayLong(view.day)}
                </span>
              </div>

              {error && !panel && <p className="text-[13px] text-room-red">{t("loadError")}</p>}
              {isLoading && !pv && (
                <div className="flex flex-col gap-[12px]" role="status">
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

              {period === "day" && row && (
                <div className={SEC}>
                  <SectionLabel
                    icon={<Clock size={12} strokeWidth={1.8} aria-hidden="true" />}
                    end={
                      <span className="tabular-nums">
                        {view.work === false && !view.settings.overrides[row.agentId] ? ta("st.rest") : row.shift ? t("plan", { a: fmt.hm(row.shift[0]), b: fmt.hm(row.shift[1]) }) : t("noPlan")}
                      </span>
                    }
                  >
                    {t("day")}
                  </SectionLabel>
                  <DayLane r={row} view={view} fmt={fmt} />
                  <Facts r={row} view={view} fmt={fmt} />
                </div>
              )}

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

function Tile({ swatch, swatchStyle, label, value, sub }: { swatch?: string; swatchStyle?: string; label: string; value: number; sub: string }) {
  return (
    <div className="rounded-[11px] border border-line-subtle px-[11px] pb-[10px] pt-[11px]">
      <div className="flex items-center gap-[6px] whitespace-nowrap text-[12px] font-medium text-room-ink-2">
        <i className={`h-[8px] w-[8px] flex-none rounded-[2px] ${swatch ?? ""}`} style={swatchStyle ? { background: swatchStyle } : undefined} aria-hidden="true" />
        {label}
      </div>
      <div className="mt-[3px] text-[26px] font-[650] leading-[1.15] tracking-[-0.02em] tabular-nums">{value}</div>
      <div className="mt-[2px] overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-room-ink-3">{sub}</div>
    </div>
  );
}

function Tiles({ pv, fmt }: { pv: PanelView; fmt: RoomFormat }) {
  const t = useTranslations("team.room.panel");
  const { assigned, uploaded, rejected, attempts } = pv.totals;
  const decided = uploaded + rejected;
  return (
    <div className="grid grid-cols-4 gap-[8px] max-[900px]:grid-cols-2">
      <Tile swatchStyle="var(--room-bar)" label={t("kAssigned")} value={assigned} sub={t("kAssignedSub")} />
      <Tile swatch="bg-room-teal" label={t("kUploaded")} value={uploaded} sub={decided ? t("rate", { p: fmt.pct((uploaded / decided) * 100) }) : "—"} />
      <Tile swatch="bg-room-red" label={t("kRejected")} value={rejected} sub={decided ? t("rate", { p: fmt.pct((rejected / decided) * 100) }) : "—"} />
      <Tile swatch="bg-room-tick" label={t("kAttempts")} value={attempts} sub={t("kAttemptsSub")} />
    </div>
  );
}

function Delivered30({ pv }: { pv: PanelView }) {
  const t = useTranslations("team.room.panel");
  const d = pv.delivered30;
  if (!d.total) return null;
  const seg = (n: number, cls: string) => (n ? <span className={`block h-full rounded-[4px] ${cls}`} style={{ flex: n }} /> : null);
  const key = (n: number, cls: string, label: string) => (
    <span className="inline-flex items-center gap-[6px]">
      <i className={`h-[8px] w-[8px] rounded-[2px] ${cls}`} aria-hidden="true" />
      <b className="text-[14px] font-[650] text-ink-primary">{n}</b> {label}
    </span>
  );
  return (
    <div className={`${SEC} flex flex-col gap-[8px]`}>
      <div className="text-[12.5px] text-room-ink-2">{t("dlvTitle")}</div>
      <div className="flex h-[10px] gap-[2px]">
        {seg(d.delivered, "bg-room-green")}
        {seg(d.returned, "bg-room-red-soft")}
        {seg(d.enRoute, "bg-room-teal-soft")}
      </div>
      <div className="flex flex-wrap gap-[16px] text-[12.5px] text-room-ink-2 tabular-nums">
        {key(d.delivered, "bg-room-green", t("dlvD"))}
        {key(d.returned, "bg-room-red-soft", t("dlvR"))}
        {key(d.enRoute, "bg-room-teal-soft", t("dlvE"))}
      </div>
    </div>
  );
}

function Facts({ r, view, fmt }: { r: AgentDayRow; view: DayView; fmt: RoomFormat }) {
  const t = useTranslations("team.room.panel");
  const work = view.work ?? !!r.shift;
  const late = work && r.lateBy !== null && r.lateBy > view.lateMin;
  const fact = (label: string, value: string, note?: ReactNode) => (
    <div className="rounded-[9px] bg-surface-sunken px-[10px] py-[8px]">
      <small className="block text-[11px] text-room-ink-3">{label}</small>
      <b className="mt-px block text-[14px] font-[650]">{value}</b>
      {note}
    </div>
  );
  return (
    <div className="mt-[12px] grid grid-cols-3 gap-[8px] tabular-nums">
      {fact(
        t("start"),
        r.first !== null ? fmt.hm(r.first) : "—",
        r.first !== null && work && r.shift ? (
          <span className={`text-[11.5px] ${late ? "font-semibold text-room-amber-ink" : "text-room-ink-3"}`}>{late ? t("lateBy", { d: fmt.dur(r.lateBy!) }) : t("onTime")}</span>
        ) : undefined,
      )}
      {fact(
        t("active"),
        r.activeMin ? fmt.dur(r.activeMin) : "—",
        r.plannedMin ? <span className="text-[11.5px] text-room-ink-3">{t("actPct", { p: fmt.pct((r.activeMin / r.plannedMin) * 100) })}</span> : undefined,
      )}
      {fact(t("last"), r.last !== null ? fmt.hm(r.last) : "—")}
    </div>
  );
}

function Products({ pv, fmt }: { pv: PanelView; fmt: RoomFormat }) {
  const t = useTranslations("team.room.panel");
  const grid = "grid grid-cols-[40px_minmax(0,1fr)_46px_52px_46px_48px] items-center gap-[10px] max-[900px]:grid-cols-[36px_minmax(0,1fr)_34px_40px_34px_38px] max-[900px]:gap-[8px]";
  const nv = (n: number, color?: string) => (
    <span className={`text-end text-[14.5px] tabular-nums ${n ? `font-semibold ${color ?? ""}` : "font-medium text-room-ink-4"}`}>{n}</span>
  );
  return (
    <div className={SEC}>
      <SectionLabel icon={<Package size={12} strokeWidth={1.8} aria-hidden="true" />} end={<span className="tabular-nums">{pv.products.length}</span>}>
        {t("products")}
      </SectionLabel>
      {pv.products.length === 0 ? (
        <div className="text-[13px] text-room-ink-3">{t("productsNone")}</div>
      ) : (
        <>
          <div className={`${grid} pb-[6px] text-[11px] font-medium text-room-ink-3`}>
            <span />
            <span>{t("phProduct")}</span>
            <span className="text-end">{t("phAssigned")}</span>
            <span className="text-end">{t("phUploaded")}</span>
            <span className="text-end">{t("phRejected")}</span>
            <span className="text-end">{t("phAttempts")}</span>
          </div>
          {pv.products.map((p) => (
            <div key={p.key} className={`${grid} border-t border-room-line-faint py-[10px]`}>
              {p.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.imageUrl} alt="" loading="lazy" className="block h-[40px] w-[40px] rounded-[9px] border border-line-subtle bg-surface-sunken object-cover max-[900px]:h-[36px] max-[900px]:w-[36px]" />
              ) : (
                <span className="block h-[40px] w-[40px] rounded-[9px] border border-line-subtle bg-surface-sunken max-[900px]:h-[36px] max-[900px]:w-[36px]" />
              )}
              <div className="min-w-0">
                <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-[13.5px] font-medium [unicode-bidi:plaintext] ltr:text-left rtl:text-right" dir="auto">
                  {p.name ?? t("unknownProduct")}
                </span>
                <div className="mt-[6px] flex h-[6px] gap-[2px]" style={{ width: `${p.barPct}%` }}>
                  {p.uploaded > 0 && <span className="block h-full rounded-[3px] bg-room-teal" style={{ flex: p.uploaded }} />}
                  {p.rejected > 0 && <span className="block h-full rounded-[3px] bg-room-red" style={{ flex: p.rejected }} />}
                  {p.decided === 0 && <span className="block h-full flex-1 rounded-[3px] bg-room-line-faint" />}
                </div>
                <span className="mt-[3px] block text-[11px] text-room-ink-3 tabular-nums">{p.rate !== null ? t("pRate", { p: fmt.pct(p.rate) }) : t("pNoDecision")}</span>
              </div>
              {nv(p.assigned)}
              {nv(p.uploaded, "text-room-teal")}
              {nv(p.rejected, "text-room-red")}
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
    <div className={SEC}>
      <SectionLabel icon={<Ban size={12} strokeWidth={1.8} aria-hidden="true" />} end={<span className="tabular-nums">{pv.rejections.total}</span>}>
        {t("rejections")}
      </SectionLabel>
      {pv.rejections.rows.length === 0 && <div className="text-[13px] text-room-ink-3">{t("rejNone")}</div>}
      {pv.rejections.rows.map((r) => (
        <div key={r.group} className="grid grid-cols-[26px_minmax(0,150px)_1fr_34px_44px] items-center gap-[10px] py-[6px] max-[900px]:grid-cols-[26px_minmax(0,1fr)_70px_28px_38px]">
          <span className="grid h-[26px] w-[26px] place-items-center rounded-[7px] bg-room-red-bg text-room-red">
            <StatusIcon name={rejectionGroupIcon(r.group)} size={14} />
          </span>
          <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px]">{label(r.group)}</span>
          <span className="h-[8px] overflow-hidden rounded-[4px] bg-room-line-faint">
            <span className="block h-full rounded-[4px] bg-room-red opacity-85" style={{ width: `${r.barPct}%` }} />
          </span>
          <span className="text-end text-[14px] font-[650] tabular-nums">{r.n}</span>
          <span className="text-end text-[12px] text-room-ink-3 tabular-nums">{fmt.pct(r.pct)}</span>
        </div>
      ))}
    </div>
  );
}

function Commission({ pv, fmt, canPay, today, tz, onPay }: { pv: PanelView; fmt: RoomFormat; canPay: boolean; today: string; tz: string; onPay: () => void }) {
  const t = useTranslations("team.room.panel");
  const c = pv.commission;
  const b = (chunk: ReactNode) => <b className="font-semibold text-ink-primary">{chunk}</b>;
  if (c.off) {
    return (
      <div className={SEC}>
        <SectionLabel icon={<Wallet size={12} strokeWidth={1.8} aria-hidden="true" />}>{t("comm")}</SectionLabel>
        <div className="text-[13px] text-room-ink-3">{t("commOff")}</div>
      </div>
    );
  }
  const cell = (label: string, value: number, note: string) => (
    <div className="min-w-0 rounded-[10px] border border-room-line-faint bg-surface-sunken px-[11px] py-[9px]">
      <small className="block text-[11.5px] font-medium text-room-ink-2">{label}</small>
      <b className="mt-px block whitespace-nowrap text-[15.5px] font-[650] tabular-nums">{fmt.money(value)}</b>
      <span className="text-[11px] text-room-ink-3 tabular-nums">{note}</span>
    </div>
  );
  const op = <span className="text-[15px] font-semibold text-room-ink-3 max-[900px]:hidden">−</span>;
  return (
    <div className={SEC}>
      <SectionLabel
        icon={<Wallet size={12} strokeWidth={1.8} aria-hidden="true" />}
        end={c.enabled && c.rate > 0 ? `${t("commRate", { r: fmt.money(c.rate) })}${c.rate_since ? ` · ${t("commSince", { d: fmt.dayNum(c.rate_since) })}` : ""}` : undefined}
      >
        {t("comm")}
      </SectionLabel>
      <div className="flex items-end justify-between gap-[10px]">
        <div>
          <small className="block text-[12px] font-medium text-room-ink-2">{t("commBalance")}</small>
          <b className="mt-[2px] block text-[32px] font-bold leading-[1.1] tracking-[-0.025em] tabular-nums">{fmt.money(c.balance)}</b>
        </div>
        {canPay && c.balance > 0 && (
          <button type="button" onClick={onPay} className="inline-flex h-[32px] items-center rounded-[9px] border border-brand bg-brand px-[12px] text-[13px] font-medium text-white hover:bg-brand-hover">
            {t("pay")}
          </button>
        )}
      </div>
      <div className="mt-[14px] grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-[6px] max-[900px]:grid-cols-1">
        {cell(t("earned"), c.earned, t("nDlv", { n: c.earned_n }))}
        {op}
        {cell(t("back"), c.back, t("nBack", { n: c.back_n }))}
        {op}
        {cell(t("paid"), c.paid, t("nPay", { n: c.paid_n }))}
      </div>

      <div className="mt-[16px]">
        <SectionLabel end={<span className="tabular-nums">{t("c14Sum", { v: fmt.money(c.sum_14) })}</span>}>{t("c14")}</SectionLabel>
      </div>
      <div className="relative mt-[10px] flex h-[70px] items-end gap-[5px] border-b border-line">
        {c.bars.map((d) => (
          <div
            key={d.day}
            title={`${fmt.dayShort(d.day)} · ${fmt.money(d.net)}${d.payday ? ` · ${t("payday")} −${fmt.money(d.paid)}` : ""}`}
            className="group relative flex h-full flex-1 items-end justify-center"
          >
            <i className="block w-[72%] max-w-[18px] rounded-t-[4px] bg-room-bar group-hover:bg-ink-primary" style={{ height: `${d.heightPct}%` }} />
            {d.payday && <span className="absolute -bottom-[12px] h-[7px] w-[7px] rounded-full border-2 border-ink-primary bg-white" aria-hidden="true" />}
          </div>
        ))}
      </div>
      <div className="mt-[14px] flex gap-[5px]" aria-hidden="true">
        {c.bars.map((d, i) => (
          <span key={d.day} className="flex-1 text-center text-[10px] text-room-ink-3 tabular-nums">
            {i % 2 === 1 ? fmt.dayOfMonth(d.day) : ""}
          </span>
        ))}
      </div>

      <div className="mt-[9px] flex items-center gap-[8px] border-t border-room-line-faint pt-[9px] text-[12.5px] text-room-ink-2">
        <Truck size={14} strokeWidth={1.8} className="flex-none text-room-ink-3" aria-hidden="true" />
        <span>
          {c.coming > 0
            ? t.rich("coming", { v: fmt.money(c.coming), n: c.in_flight, late: c.in_flight_late, b })
            : t("comingNone")}
        </span>
      </div>
      <div className="mt-[9px] flex items-center gap-[8px] border-t border-room-line-faint pt-[9px] text-[12.5px] text-room-ink-2">
        <Clock size={14} strokeWidth={1.8} className="flex-none text-room-ink-3" aria-hidden="true" />
        <span>
          {c.last_payout
            ? t.rich("lastPay", { d: fmt.dayShort(localDayMinute(c.last_payout.at, tz).day), v: fmt.money(c.last_payout.amount), b })
            : t("neverPaid")}
        </span>
        <span className="ms-auto text-[11px] text-room-ink-3">{t("asOf", { d: fmt.dayNum(today) })}</span>
      </div>
    </div>
  );
}
