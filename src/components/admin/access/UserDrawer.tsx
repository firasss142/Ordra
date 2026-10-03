"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, Ban, Box, Check, History, KeyRound, Mail, MapPin, Minus, Shield, Trash2, UserCheck, UserX } from "lucide-react";
import { fetcher } from "@/lib/swr-config";
import { marketIdToCode } from "@/lib/markets";
import { getPermissionsForRole } from "@/lib/user-permissions";
import { accessStatus, loginIdentifier } from "@/lib/users/access-view";
import { useWarehouseSites } from "@/hooks/useWarehouseSites";
import type { Role, UserAuditEvent, UserWithStats } from "@/types";
import { AccessAvatar, ActivityLabel, buttonClass, dateLocale, Dot, presenceOf, RoleChip, TONE } from "./parts";
import { CloseButton, SidePanel } from "./layers";

export type DrawerAction = "reset" | "deactivate" | "reactivate" | "delete";

/** The journal's own colours: created green, building orange, password indigo, deactivated red. */
const EVENT_TONE: Record<string, string> = {
  user_created: "tone-all",
  user_reactivated: "tone-all",
  warehouse_assigned: "tone-warehouse",
  password_reset: "tone-manager",
  avatar_updated: "tone-agent",
  user_deactivated: "[--tone:#DC2626] [--tone-bg:#FEF0EE]",
  user_deleted: "[--tone:#DC2626] [--tone-bg:#FEF0EE]",
  user_invited: "[--tone:#D97706] [--tone-bg:#FFF6E5]",
};
const KNOWN_EVENTS = Object.keys(EVENT_TONE);

const section = "m-0 mb-[12px] flex items-center gap-[7px] text-[12px] font-semibold uppercase tracking-[.06em] text-[#656B72] rtl:text-[13px] rtl:tracking-normal";

/**
 * One person's file: the account in three facts, the building (warehouse
 * agents), what the role allows — `PermissionsList` never reached the screen
 * before — the journal (super admin) and the actions.
 */
export function UserDrawer({
  user,
  actorRole,
  isSelf,
  now,
  journalFirst,
  onClose,
  onAction,
  onSetWarehouse,
}: {
  user: UserWithStats;
  actorRole: Role;
  isSelf: boolean;
  now: Date;
  /** Opened from « Journal d'activité »: scroll straight to it. */
  journalFirst: boolean;
  onClose: () => void;
  onAction: (action: DrawerAction) => void;
  onSetWarehouse: (warehouseId: string | null) => Promise<void>;
}) {
  const t = useTranslations("users");
  const tp = useTranslations("permissions");
  const locale = useLocale();
  const admin = actorRole === "super_admin";
  const status = accessStatus(user);
  const active = status === "active";
  const code = marketIdToCode(user.market_id);
  const { sites } = useWarehouseSites(user.role === "warehouse_agent" || admin ? user.market_id : null);
  const { data: journal } = useSWR<{ data: UserAuditEvent[] }>(admin ? `/api/admin/audit-log?target_id=${encodeURIComponent(user.id)}&limit=50` : null, fetcher);
  const [whError, setWhError] = useState(false);
  const journalRef = useRef<HTMLElement>(null);
  const titleId = `access-file-${user.id}`;

  useEffect(() => {
    if (journalFirst) journalRef.current?.scrollIntoView?.({ block: "start" });
  }, [journalFirst, journal]);

  const fmt = (iso: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(dateLocale(locale), o).format(new Date(iso));
  const siteName = (id: unknown) => sites.find((s) => s.id === id)?.name ?? t("warehouse.none");

  async function chooseSite(id: string | null) {
    setWhError(false);
    try {
      await onSetWarehouse(id);
    } catch {
      setWhError(true);
    }
  }

  return (
    <SidePanel labelledBy={titleId} onClose={onClose}>
      <div className={`${TONE[user.role]} relative border-b border-tone-edge bg-tone-bg px-[22px] pb-[18px] pt-[22px]`}>
        <CloseButton label={t("drawer.close")} onClick={onClose} className="absolute end-[14px] top-[14px] bg-white shadow-[inset_0_0_0_1px_var(--tone-edge)]" />
        <AccessAvatar user={user} size="xl" presence={presenceOf(user.last_seen_at, active, now)} muted={status === "disabled"} />
        <h2 id={titleId} className="m-0 mt-[12px] text-[19px] font-bold tracking-[-.01em] text-[#15171A]">
          <bdi>{user.full_name}</bdi>
          {isSelf && <span className="ms-[6px] rounded-full bg-white px-[7px] py-[1px] align-[2px] text-[11px] font-semibold text-[#4F555B]">{t("you")}</span>}
        </h2>
        <div className="mt-[9px] flex flex-wrap gap-[6px]">
          <RoleChip role={user.role} onWhite />
          {admin && (
            <span className="inline-flex h-[26px] items-center gap-[5px] rounded-full bg-white px-[10px] text-[12.5px] font-semibold text-[#4F555B] shadow-[inset_0_0_0_1px_#E3E5E8]">
              <MapPin size={13} aria-hidden="true" className="text-[#656B72]" />
              {code ? t(`market.${code}`) : t("market.none")}
            </span>
          )}
          {status === "active" ? (
            <span className="inline-flex h-[26px] items-center gap-[6px] rounded-full bg-white px-[10px] text-[12.5px] font-semibold text-[#15803D] shadow-[inset_0_0_0_1px_#A9DDBC]">
              <Dot tone="on" size={7} />
              {t("status.active")}
            </span>
          ) : status === "invited" ? (
            <span className="inline-flex h-[26px] items-center gap-[6px] rounded-full bg-[#FFF6E5] px-[10px] text-[12.5px] font-semibold text-[#B45309]">
              <Mail size={13} aria-hidden="true" />
              {t("status.invited")}
            </span>
          ) : (
            <span className="inline-flex h-[26px] items-center gap-[6px] rounded-full bg-white px-[10px] text-[12.5px] font-semibold text-[#4F555B] shadow-[inset_0_0_0_1px_#E3E5E8]">
              <Ban size={13} aria-hidden="true" />
              {t("status.disabled")}
              {user.deactivation_reason ? ` · ${t(`reasons.${user.deactivation_reason}`)}` : ""}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-[22px] overflow-y-auto px-[22px] py-[20px]">
        <div className="grid grid-cols-1 gap-[8px] sm:grid-cols-3">
          <div className="min-w-0 rounded-[12px] border border-[#F2F3F5] bg-[#F7F8F9] px-[12px] py-[10px]">
            <span className="block text-[11.5px] font-medium text-[#656B72]">{t("drawer.activity")}</span>
            <span className="mt-[4px] block text-[13px] [&>span]:whitespace-normal">
              <ActivityLabel lastSeenAt={user.last_seen_at} now={now} />
            </span>
            {user.last_seen_at && (
              <small className="mt-[2px] block truncate text-[11.5px] text-[#656B72]">
                {fmt(user.last_seen_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })}
              </small>
            )}
          </div>
          <div className="min-w-0 rounded-[12px] border border-[#F2F3F5] bg-[#F7F8F9] px-[12px] py-[10px]">
            <span className="block text-[11.5px] font-medium text-[#656B72]">{t("drawer.identifier")}</span>
            <b className="mt-[4px] block truncate text-[13.5px] font-semibold text-[#15171A]">
              <bdi>{loginIdentifier(user.email)}</bdi>
            </b>
            {loginIdentifier(user.email) !== user.email && (
              <small className="mt-[2px] block truncate text-[11.5px] text-[#656B72]">
                <bdi>{user.email}</bdi>
              </small>
            )}
          </div>
          <div className="min-w-0 rounded-[12px] border border-[#F2F3F5] bg-[#F7F8F9] px-[12px] py-[10px]">
            <span className="block text-[11.5px] font-medium text-[#656B72]">{t("drawer.created")}</span>
            <b className="mt-[4px] block text-[13.5px] font-semibold text-[#15171A]">{fmt(user.created_at, { day: "numeric", month: "long", year: "numeric" })}</b>
          </div>
        </div>

        {user.role === "warehouse_agent" && (
          <section aria-labelledby={`${titleId}-wh`}>
            <h3 id={`${titleId}-wh`} className={section}>
              <Box size={14} aria-hidden="true" className="text-[#9AA0A6]" />
              {t("warehouse.label")}
              <span className="flex-1" />
              {user.warehouse_id && active && (
                <button type="button" onClick={() => void chooseSite(null)} className="rounded-[6px] px-[6px] py-[2px] text-[12px] font-semibold normal-case tracking-normal text-[#C0362C] hover:bg-[#FDECEA]">
                  {t("warehouse.remove")}
                </button>
              )}
            </h3>
            <div role="radiogroup" aria-labelledby={`${titleId}-wh`} className="tone-warehouse grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-[8px]">
              {sites.map((s) => {
                const on = user.warehouse_id === s.id;
                return (
                  <label
                    key={s.id}
                    className={`relative flex cursor-pointer items-center gap-[10px] rounded-[12px] border px-[12px] py-[10px] text-[13.5px] font-semibold transition-colors has-[:disabled]:cursor-default has-[:disabled]:opacity-55 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand ${
                      on ? "border-tone bg-tone-bg text-tone-ink shadow-[inset_0_0_0_1px_var(--tone)]" : "border-[#E3E5E8] text-[#15171A] hover:border-tone-edge"
                    }`}
                  >
                    <input type="radio" name={`${titleId}-site`} value={s.id} checked={on} disabled={!active} onChange={() => void chooseSite(s.id)} className="absolute opacity-0" />
                    <span aria-hidden="true" className={`grid h-[30px] w-[30px] place-items-center rounded-[8px] text-tone ${on ? "bg-white" : "bg-tone-bg"}`}>
                      <Box size={15} />
                    </span>
                    {s.name}
                  </label>
                );
              })}
            </div>
            {whError ? (
              <p role="alert" className="m-0 mt-[8px] text-[12.5px] font-medium text-[#C0362C]">{t("warehouse.error")}</p>
            ) : active && !user.warehouse_id ? (
              <div className="mt-[10px] flex items-start gap-[8px] rounded-[10px] border border-[#F8D9A6] bg-[#FFF6E5] px-[12px] py-[9px] text-[12.5px] text-[#8F4A06]">
                <AlertTriangle size={14} aria-hidden="true" className="mt-[1px] flex-none text-[#D97706]" />
                {t("warehouse.warn")}
              </div>
            ) : (
              <p className="m-0 mt-[8px] text-[12.5px] leading-[1.45] text-[#656B72]">{t("warehouse.hint")}</p>
            )}
          </section>
        )}

        <section aria-labelledby={`${titleId}-perms`}>
          <h3 id={`${titleId}-perms`} className={section}>
            <Shield size={14} aria-hidden="true" className="text-[#9AA0A6]" />
            {t("drawer.permissions")}
          </h3>
          <ul aria-labelledby={`${titleId}-perms`} className="m-0 grid list-none grid-cols-1 gap-x-[16px] gap-y-[9px] p-0 text-[13px] sm:grid-cols-2">
            {getPermissionsForRole(user.role).map((p) => (
              <li key={p.key} data-allowed={p.allowed} className={`flex items-center gap-[9px] ${p.allowed ? "font-medium text-[#15171A]" : "text-[#656B72]"}`}>
                <span aria-hidden="true" className={`grid h-[22px] w-[22px] flex-none place-items-center rounded-full ${p.allowed ? "bg-brand-bg text-brand" : "bg-[#F3F4F6] text-[#9AA0A6]"}`}>
                  {p.allowed ? <Check size={13} strokeWidth={2.4} /> : <Minus size={13} strokeWidth={2.4} />}
                </span>
                {tp(p.key as Parameters<typeof tp>[0])}
              </li>
            ))}
          </ul>
          <p className="m-0 mt-[12px] text-[12px] text-[#656B72]">{t("drawer.permissionsNote")}</p>
        </section>

        {admin && (
          <section ref={journalRef} aria-labelledby={`${titleId}-journal`}>
            <h3 id={`${titleId}-journal`} className={section}>
              <History size={14} aria-hidden="true" className="text-[#9AA0A6]" />
              {t("drawer.journal")}
            </h3>
            {journal && journal.data.length === 0 && <p className="m-0 text-[13px] text-[#656B72]">{t("drawer.journalEmpty")}</p>}
            {journal && journal.data.length > 0 && (
              <ol className="m-0 list-none p-0">
                {journal.data.map((ev, i) => {
                  const meta = ev.meta ?? {};
                  const known = KNOWN_EVENTS.includes(ev.event_type);
                  const extras: string[] = [];
                  if (ev.event_type === "warehouse_assigned") extras.push(meta.warehouse_id ? siteName(meta.warehouse_id) : t("warehouse.none"));
                  if (typeof meta.reason === "string" && ["on-leave", "off-boarded", "terminated"].includes(meta.reason)) extras.push(t(`reasons.${meta.reason as "on-leave"}`));
                  if (typeof meta.orders_returned === "number" && meta.orders_returned > 0) extras.push(t("drawer.returned", { count: meta.orders_returned }));
                  return (
                    <li key={ev.id} className={`${EVENT_TONE[ev.event_type] ?? "tone-admin"} relative pb-[16px] ps-[26px] text-[13px] last:pb-0`}>
                      {i < journal.data.length - 1 && <span aria-hidden="true" className="absolute bottom-0 start-[5px] top-[16px] w-[2px] rounded-[2px] bg-[#ECEEF0]" />}
                      <span aria-hidden="true" className="absolute start-0 top-[3px] h-[12px] w-[12px] rounded-full bg-tone shadow-[0_0_0_3px_var(--tone-bg)]" />
                      <span className="font-semibold text-[#15171A]">{known ? t(`events.${ev.event_type as "user_created"}`) : ev.event_type}</span>
                      {extras.length > 0 && <span className="text-[#15171A]">{` · ${extras.join(" · ")}`}</span>}
                      <small className="mt-[2px] block text-[12px] text-[#656B72]">
                        {t("drawer.by", { name: ev.actor?.full_name ?? t("drawer.system") })} · {fmt(ev.created_at, { day: "numeric", month: "short", year: "numeric" })} ·{" "}
                        <bdi>{fmt(ev.created_at, { hour: "2-digit", minute: "2-digit", hour12: false })}</bdi>
                      </small>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-[8px] border-t border-[#ECEEF0] bg-white px-[22px] py-[14px]">
        {active ? (
          <>
            <button type="button" onClick={() => onAction("reset")} className={buttonClass("neutral")}>
              <KeyRound size={16} aria-hidden="true" />
              {t("menu.reset")}
            </button>
            <button type="button" onClick={() => onAction("deactivate")} className={buttonClass("softCritical")}>
              <UserX size={16} aria-hidden="true" />
              {t("menu.deactivate")}
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => onAction("reactivate")} className={buttonClass("primary")}>
              <UserCheck size={16} aria-hidden="true" />
              {t("menu.reactivate")}
            </button>
            <button type="button" onClick={() => onAction("reset")} className={buttonClass("neutral")}>
              <KeyRound size={16} aria-hidden="true" />
              {t("menu.reset")}
            </button>
          </>
        )}
        {admin && !isSelf && (
          <>
            <span className="flex-1" />
            <button type="button" aria-label={t("menu.delete")} title={t("menu.delete")} onClick={() => onAction("delete")} className={buttonClass("ghostCritical")}>
              <Trash2 size={16} aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    </SidePanel>
  );
}
