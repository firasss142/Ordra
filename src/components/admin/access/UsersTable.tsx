"use client";

import { useState, type MouseEvent } from "react";
import { useTranslations } from "next-intl";
import { Ban, Box, ChevronDown, ChevronRight, Mail } from "lucide-react";
import { marketIdToCode } from "@/lib/markets";
import { accessStatus, loginIdentifier, showsIdentifier } from "@/lib/users/access-view";
import { useWarehouseSites } from "@/hooks/useWarehouseSites";
import type { UserWithStats } from "@/types";
import { AccessAvatar, ActivityLabel, presenceOf, RoleChip, TONE } from "./parts";
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
    <span className={`tone-warehouse acx-wh${missing ? " missing" : ""}`}>
      <span className="acx-wh-box">
        <Box size={13} aria-hidden="true" />
        <select
          aria-label={t("of", { name: user.full_name })}
          value={user.warehouse_id ?? ""}
          disabled={!active || saving || isLoading}
          aria-invalid={missing || undefined}
          onChange={(e) => void choose(e.target.value)}
        >
          <option value="">{user.warehouse_id ? t("pick") : t("none")}</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <ChevronDown size={13} aria-hidden="true" />
      </span>
      {failed && (
        <span role="alert" className="acx-err">
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

  // Under 768px the row restacks (acces.css): the person and the menu on top,
  // role and activity beneath the name (`under`), the market dropped.
  return (
    <tr onClick={openFromRow} data-selected={selected || undefined} className={`${TONE[user.role]} acx-row${off ? " off" : ""}`}>
      <td>
        <button type="button" data-opener aria-label={t("openProfile", { name: user.full_name })} onClick={(e) => ctx.onOpen(user, e.currentTarget)} className="acx-person">
          <AccessAvatar user={user} presence={presenceOf(user.last_seen_at, status === "active", ctx.now)} muted={off} />
          <span>
            <b className="acx-name">
              <bdi>{user.full_name}</bdi>
            </b>
            {ctx.isSelf(user) && <span className="acx-you">{t("you")}</span>}
            {showsIdentifier(user) && (
              <small className="acx-id">
                <bdi>{loginIdentifier(user.email)}</bdi>
              </small>
            )}
          </span>
        </button>
      </td>
      <td className="under">
        <div className="acx-cellrole">
          <RoleChip role={user.role} muted={off} />
          {user.role === "warehouse_agent" && <WarehousePill user={user} onChange={(wid) => ctx.onSetWarehouse(user, wid)} />}
        </div>
      </td>
      {ctx.showMarket && (
        <td className="mkt">{code ? <span className="acx-mkt">{t(`market.${code}`)}</span> : <span className="acx-mkt none">{t("market.none")}</span>}</td>
      )}
      <td className="under">
        {status === "disabled" ? (
          <span className="acx-pill">
            <Ban size={13} aria-hidden="true" />
            {t("status.disabled")}
            {user.deactivation_reason ? ` · ${t(`reasons.${user.deactivation_reason}`)}` : ""}
          </span>
        ) : status === "invited" ? (
          <span className="acx-pill warn">
            <Mail size={13} aria-hidden="true" />
            {t("status.invited")}
          </span>
        ) : (
          <ActivityLabel lastSeenAt={user.last_seen_at} now={ctx.now} />
        )}
      </td>
      <td className="menu text-end">
        <RowMenu label={t("actionsFor", { name: user.full_name })} items={ctx.menuFor(user)} />
      </td>
    </tr>
  );
}

function Head({ showMarket, hidden = false }: { showMarket: boolean; hidden?: boolean }) {
  const t = useTranslations("users.columns");
  return (
    <>
      <colgroup>
        <col style={{ width: showMarket ? "31%" : "34%" }} />
        <col style={{ width: showMarket ? "31%" : "36%" }} />
        {showMarket && <col style={{ width: "13%" }} />}
        <col style={{ width: showMarket ? "25%" : "30%" }} />
        <col style={{ width: 62 }} />
      </colgroup>
      <thead className={hidden ? "sr-only" : undefined}>
        <tr>
          <th scope="col">{t("member")}</th>
          <th scope="col">{t("role")}</th>
          {showMarket && <th scope="col">{t("market")}</th>}
          <th scope="col">{t("activity")}</th>
          <th scope="col">
            <span className="sr-only">{t("actions")}</span>
          </th>
        </tr>
      </thead>
    </>
  );
}

export function UsersTable({ rows, ctx }: { rows: UserWithStats[]; ctx: RowContext }) {
  return (
    <table className="acx-tbl">
      <Head showMarket={ctx.showMarket} />
      <tbody>
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
    <div className="acx-fold">
      <button type="button" aria-expanded={open} onClick={onToggle}>
        {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" className="flip" />}
        {t("disabledFold", { count: rows.length })}
      </button>
      {open && (
        <table className="acx-tbl">
          <caption className="sr-only">{t("disabledFold", { count: rows.length })}</caption>
          <Head showMarket={ctx.showMarket} hidden />
          <tbody>
            {rows.map((u) => (
              <UserRow key={u.id} user={u} ctx={ctx} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
