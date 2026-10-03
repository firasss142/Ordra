"use client";

import { useState, type MouseEvent } from "react";
import { useTranslations } from "next-intl";
import { Ban, Box, ChevronDown, ChevronRight, Mail } from "lucide-react";
import { marketIdToCode } from "@/lib/markets";
import { accessStatus, loginIdentifier, showsIdentifier } from "@/lib/users/access-view";
import { useWarehouseSites } from "@/hooks/useWarehouseSites";
import type { UserWithStats } from "@/types";
import { AccessAvatar, ActivityLabel, presenceOf, RoleChip } from "./parts";
import { RowMenu, type RowMenuItem } from "./RowMenu";

export interface RowContext {
  now: Date;
  showMarket: boolean;
  selectedId: string | null;
  isSelf: (u: UserWithStats) => boolean;
  onOpen: (u: UserWithStats, opener: HTMLElement) => void;
  menuFor: (u: UserWithStats) => RowMenuItem[];
  onSetWarehouse: (u: UserWithStats, warehouseId: string | null) => Promise<void>;
}

/**
 * Which building a warehouse agent works out of, as an orange pill in the row.
 * Libya's two buildings are one Darb Assabil account each and a parcel booked
 * on one cannot be handed to the other, so this decides which parcels the
 * agent may touch at all. Still a native <select>: only its skin changed.
 */
export function WarehousePill({ user, onChange }: { user: UserWithStats; onChange: (warehouseId: string | null) => Promise<void> }) {
  const t = useTranslations("users.warehouse");
  const { sites, isLoading } = useWarehouseSites(user.market_id);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const active = accessStatus(user) === "active";
  const missing = active && !user.warehouse_id;

  async function choose(value: string) {
    setFailed(false);
    setSaving(true);
    try {
      // An empty option means « no building », which is null — never "".
      await onChange(value === "" ? null : value);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-[3px]">
      <span className="tone-warehouse relative inline-flex items-center">
        <Box size={13} aria-hidden="true" className={`pointer-events-none absolute start-[9px] ${missing ? "text-[#C0362C]" : "text-tone"}`} />
        <select
          aria-label={t("of", { name: user.full_name })}
          value={user.warehouse_id ?? ""}
          disabled={!active || saving || isLoading}
          aria-invalid={missing || undefined}
          onChange={(e) => void choose(e.target.value)}
          className={`h-[26px] max-w-[170px] cursor-pointer appearance-none rounded-full border pe-[26px] ps-[27px] text-[12.5px] font-semibold transition-colors disabled:cursor-default ${
            missing
              ? "border-[#F3B4AE] bg-[#FFF1F0] text-[#C0362C]"
              : "border-tone-edge bg-white text-tone-ink hover:border-tone hover:bg-tone-bg disabled:border-[#F3F4F6] disabled:bg-[#F3F4F6] disabled:text-[#656B72]"
          }`}
        >
          <option value="">{user.warehouse_id ? t("pick") : t("none")}</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <ChevronDown size={13} aria-hidden="true" className={`pointer-events-none absolute end-[8px] ${missing ? "text-[#C0362C]" : "text-tone-ink"}`} />
      </span>
      {failed && (
        <span role="alert" className="text-[12px] font-medium text-[#C0362C]">
          {t("error")}
        </span>
      )}
    </span>
  );
}

function UserRow({ user, ctx }: { user: UserWithStats; ctx: RowContext }) {
  const t = useTranslations("users");
  const status = accessStatus(user);
  const off = status === "disabled";
  const code = marketIdToCode(user.market_id);

  const openFromRow = (e: MouseEvent<HTMLTableRowElement>) => {
    if ((e.target as HTMLElement).closest("button, select, label, a, input")) return;
    const opener = e.currentTarget.querySelector<HTMLElement>("[data-opener]");
    if (opener) ctx.onOpen(user, opener);
  };

  const selected = ctx.selectedId === user.id;
  const ground = selected ? "bg-brand-tint" : off ? "bg-[#F7F8F9]" : "bg-white group-hover:bg-[#FAFBFC]";
  const cell = `border-b border-[#F2F3F5] py-[11px] transition-colors max-md:block max-md:border-0 max-md:py-[3px] ${ground}`;
  // Under md the row restacks: the person and the menu on top, role and activity beneath the name.
  const under = "max-md:col-start-1 max-md:ps-[68px]";

  return (
    <tr onClick={openFromRow} data-selected={selected || undefined} className="group cursor-pointer max-md:grid max-md:grid-cols-[1fr_auto] max-md:border-b max-md:border-[#F2F3F5] max-md:py-[9px]">
      <td className={`${cell} pe-[16px] ps-[20px] ${selected ? "shadow-[inset_3px_0_0_var(--brand)] rtl:shadow-[inset_-3px_0_0_var(--brand)]" : ""}`}>
        <button
          type="button"
          data-opener
          aria-label={t("openProfile", { name: user.full_name })}
          onClick={(e) => ctx.onOpen(user, e.currentTarget)}
          className="flex min-w-0 max-w-full items-center gap-[12px] rounded-[10px] text-start"
        >
          <AccessAvatar user={user} presence={presenceOf(user.last_seen_at, status === "active", ctx.now)} muted={off} />
          <span className="min-w-0">
            <b className={`text-[14px] font-semibold ${off ? "text-[#4F555B]" : "text-[#15171A]"}`}>
              <bdi>{user.full_name}</bdi>
            </b>
            {ctx.isSelf(user) && <span className="ms-[6px] rounded-full bg-[#F3F4F6] px-[7px] py-[1px] align-[1px] text-[11px] font-semibold text-[#4F555B]">{t("you")}</span>}
            {showsIdentifier(user) && (
              <small className="mt-[1px] block truncate text-[12.5px] text-[#656B72]">
                <bdi>{loginIdentifier(user.email)}</bdi>
              </small>
            )}
          </span>
        </button>
      </td>
      <td className={`${cell} ${under} px-[16px]`}>
        <div className="flex flex-wrap items-center gap-[8px]">
          <RoleChip role={user.role} muted={off} />
          {user.role === "warehouse_agent" && <WarehousePill user={user} onChange={(wid) => ctx.onSetWarehouse(user, wid)} />}
        </div>
      </td>
      {ctx.showMarket && (
        <td className={`${cell} px-[16px] text-[13.5px] text-[#4F555B] max-md:hidden`}>
          {code ? t(`market.${code}`) : <span className="text-[#656B72]">{t("market.none")}</span>}
        </td>
      )}
      <td className={`${cell} ${under} px-[16px]`}>
        {status === "disabled" ? (
          <span className="inline-flex h-[26px] items-center gap-[6px] whitespace-nowrap rounded-full bg-[#F3F4F6] px-[10px] text-[12.5px] font-semibold text-[#4F555B]">
            <Ban size={13} aria-hidden="true" />
            {t("status.disabled")}
            {user.deactivation_reason ? ` · ${t(`reasons.${user.deactivation_reason}`)}` : ""}
          </span>
        ) : status === "invited" ? (
          <span className="inline-flex h-[26px] items-center gap-[6px] whitespace-nowrap rounded-full bg-[#FFF6E5] px-[10px] text-[12.5px] font-semibold text-[#B45309]">
            <Mail size={13} aria-hidden="true" />
            {t("status.invited")}
          </span>
        ) : (
          <ActivityLabel lastSeenAt={user.last_seen_at} now={ctx.now} />
        )}
      </td>
      <td className={`${cell} pe-[14px] ps-[16px] text-end max-md:col-start-2 max-md:row-start-1`}>
        <RowMenu label={t("actionsFor", { name: user.full_name })} items={ctx.menuFor(user)} />
      </td>
    </tr>
  );
}

function Head({ showMarket, hidden = false }: { showMarket: boolean; hidden?: boolean }) {
  const t = useTranslations("users.columns");
  const th = "whitespace-nowrap border-b border-[#ECEEF0] bg-white px-[16px] py-[11px] text-start text-[11.5px] font-semibold uppercase tracking-[.06em] text-[#656B72] rtl:text-[12.5px] rtl:tracking-normal";
  return (
    <>
      <colgroup className="max-md:hidden">
        <col className={showMarket ? "w-[31%]" : "w-[34%]"} />
        <col className={showMarket ? "w-[31%]" : "w-[36%]"} />
        {showMarket && <col className="w-[13%] max-md:hidden" />}
        <col className={showMarket ? "w-[25%]" : "w-[30%]"} />
        <col className="w-[60px]" />
      </colgroup>
      <thead className={hidden ? "sr-only" : "max-md:sr-only"}>
        <tr>
          <th scope="col" className={`${th} ps-[20px]`}>{t("member")}</th>
          <th scope="col" className={th}>{t("role")}</th>
          {showMarket && <th scope="col" className={`${th} max-md:hidden`}>{t("market")}</th>}
          <th scope="col" className={th}>{t("activity")}</th>
          <th scope="col" className={th}>
            <span className="sr-only">{t("actions")}</span>
          </th>
        </tr>
      </thead>
    </>
  );
}

export function UsersTable({ rows, ctx }: { rows: UserWithStats[]; ctx: RowContext }) {
  return (
    <table className="w-full table-fixed border-collapse max-md:block [&>tbody]:max-md:block">
      <Head showMarket={ctx.showMarket} />
      <tbody className="[&>tr:last-child>td]:border-b-0">
        {rows.map((u) => (
          <UserRow key={u.id} user={u} ctx={ctx} />
        ))}
      </tbody>
    </table>
  );
}

/** Disabled accounts need no daily attention: folded under the list, reason shown. */
export function DisabledFold({ rows, ctx, open, onToggle }: { rows: UserWithStats[]; ctx: RowContext; open: boolean; onToggle: () => void }) {
  const t = useTranslations("users");
  if (rows.length === 0) return null;
  return (
    <div className="border-t border-[#ECEEF0] bg-[#F7F8F9]">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center gap-[8px] px-[20px] py-[12px] text-start text-[13px] font-semibold text-[#4F555B] hover:text-[#15171A]"
      >
        {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" className="rtl:-scale-x-100" />}
        {t("disabledFold", { count: rows.length })}
      </button>
      {open && (
        <table className="w-full table-fixed border-collapse max-md:block [&>tbody]:max-md:block">
          <caption className="sr-only">{t("disabledFold", { count: rows.length })}</caption>
          <Head showMarket={ctx.showMarket} hidden />
          <tbody className="[&>tr:last-child>td]:border-b-0">
            {rows.map((u) => (
              <UserRow key={u.id} user={u} ctx={ctx} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
