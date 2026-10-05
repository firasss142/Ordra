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
import { PhotoPicker } from "@/components/ui/PhotoPicker";

export type DrawerAction = "reset" | "deactivate" | "reactivate" | "delete";

/** The journal's own colours: created green, building orange, password indigo, deactivated red. */
const EVENT_TONE: Record<string, string> = {
  user_created: "tone-all",
  user_reactivated: "tone-all",
  warehouse_assigned: "tone-warehouse",
  password_reset: "tone-manager",
  avatar_updated: "tone-agent",
  user_deactivated: "bad",
  user_deleted: "bad",
  user_invited: "warn",
};
const KNOWN_EVENTS = Object.keys(EVENT_TONE);

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
  onSetPhoto,
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
  /** A downscaled data URL, or null to go back to the initials. Throws on failure. */
  onSetPhoto: (dataUrl: string | null) => Promise<void>;
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
    <SidePanel labelledBy={titleId} onClose={onClose} tone={TONE[user.role]}>
      <div className="acx-dh">
        <CloseButton label={t("drawer.close")} onClick={onClose} />
        <PhotoPicker hasPhoto={!!user.avatar_url} onChange={onSetPhoto}>
          <AccessAvatar user={user} size="xl" presence={presenceOf(user.last_seen_at, active, now)} muted={status === "disabled"} />
        </PhotoPicker>
        <h2 id={titleId}>
          <bdi>{user.full_name}</bdi>
          {isSelf && <span className="acx-you">{t("you")}</span>}
        </h2>
        <div className="acx-dh-tags">
          <RoleChip role={user.role} onWhite />
          {admin && (
            <span className="acx-pill white">
              <MapPin size={13} aria-hidden="true" />
              {code ? t(`market.${code}`) : t("market.none")}
            </span>
          )}
          {status === "active" ? (
            <span className="acx-pill good">
              <Dot tone="on" size={7} />
              {t("status.active")}
            </span>
          ) : status === "invited" ? (
            <span className="acx-pill warn">
              <Mail size={13} aria-hidden="true" />
              {t("status.invited")}
            </span>
          ) : (
            <span className="acx-pill white">
              <Ban size={13} aria-hidden="true" />
              {t("status.disabled")}
              {user.deactivation_reason ? ` · ${t(`reasons.${user.deactivation_reason}`)}` : ""}
            </span>
          )}
        </div>
      </div>

      <div className="acx-db">
        <div className="acx-sec acx-facts">
          <div className="acx-fact">
            <span>{t("drawer.activity")}</span>
            <div>
              <ActivityLabel lastSeenAt={user.last_seen_at} now={now} />
            </div>
            {user.last_seen_at && <small>{fmt(user.last_seen_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })}</small>}
          </div>
          <div className="acx-fact">
            <span>{t("drawer.identifier")}</span>
            <b>
              <bdi>{loginIdentifier(user.email)}</bdi>
            </b>
            {loginIdentifier(user.email) !== user.email && (
              <small>
                <bdi>{user.email}</bdi>
              </small>
            )}
          </div>
          <div className="acx-fact">
            <span>{t("drawer.created")}</span>
            <b>{fmt(user.created_at, { day: "numeric", month: "long", year: "numeric" })}</b>
          </div>
        </div>

        {user.role === "warehouse_agent" && (
          <section aria-labelledby={`${titleId}-wh`} className="acx-sec">
            <h3 id={`${titleId}-wh`} className="acx-eyebrow">
              <Box size={14} aria-hidden="true" />
              {t("warehouse.label")}
              <span className="grow" />
              {user.warehouse_id && active && (
                <button type="button" onClick={() => void chooseSite(null)} className="acx-eyebrow-act">
                  {t("warehouse.remove")}
                </button>
              )}
            </h3>
            <div role="radiogroup" aria-labelledby={`${titleId}-wh`} className="tone-warehouse acx-sites">
              {sites.map((s) => (
                <label key={s.id} className="acx-opt">
                  <input type="radio" name={`${titleId}-site`} value={s.id} checked={user.warehouse_id === s.id} disabled={!active} onChange={() => void chooseSite(s.id)} />
                  <span aria-hidden="true" className="acx-opt-ic">
                    <Box size={15} />
                  </span>
                  {s.name}
                </label>
              ))}
            </div>
            {whError ? (
              <p role="alert" className="acx-hint acx-err">{t("warehouse.error")}</p>
            ) : active && !user.warehouse_id ? (
              <div className="acx-warnline">
                <AlertTriangle size={14} aria-hidden="true" />
                {t("warehouse.warn")}
              </div>
            ) : (
              <p className="acx-hint">{t("warehouse.hint")}</p>
            )}
          </section>
        )}

        <section aria-labelledby={`${titleId}-perms`} className="acx-sec">
          <h3 id={`${titleId}-perms`} className="acx-eyebrow">
            <Shield size={14} aria-hidden="true" />
            {t("drawer.permissions")}
          </h3>
          <ul aria-labelledby={`${titleId}-perms`} className="acx-perms">
            {getPermissionsForRole(user.role).map((p) => (
              <li key={p.key} data-allowed={p.allowed}>
                <span aria-hidden="true" className="acx-tick">
                  {p.allowed ? <Check size={13} strokeWidth={2.4} /> : <Minus size={13} strokeWidth={2.4} />}
                </span>
                {tp(p.key as Parameters<typeof tp>[0])}
              </li>
            ))}
          </ul>
          <p className="acx-note">{t("drawer.permissionsNote")}</p>
        </section>

        {admin && (
          <section ref={journalRef} aria-labelledby={`${titleId}-journal`} className="acx-sec">
            <h3 id={`${titleId}-journal`} className="acx-eyebrow">
              <History size={14} aria-hidden="true" />
              {t("drawer.journal")}
            </h3>
            {journal && journal.data.length === 0 && <p className="acx-hint">{t("drawer.journalEmpty")}</p>}
            {journal && journal.data.length > 0 && (
              <ol className="acx-journal">
                {journal.data.map((ev) => {
                  const meta = ev.meta ?? {};
                  const known = KNOWN_EVENTS.includes(ev.event_type);
                  const extras: string[] = [];
                  if (ev.event_type === "warehouse_assigned") extras.push(meta.warehouse_id ? siteName(meta.warehouse_id) : t("warehouse.none"));
                  if (typeof meta.reason === "string" && ["on-leave", "off-boarded", "terminated"].includes(meta.reason)) extras.push(t(`reasons.${meta.reason as "on-leave"}`));
                  if (typeof meta.orders_returned === "number" && meta.orders_returned > 0) extras.push(t("drawer.returned", { count: meta.orders_returned }));
                  return (
                    <li key={ev.id} className={EVENT_TONE[ev.event_type] ?? "tone-admin"}>
                      <b>{known ? t(`events.${ev.event_type as "user_created"}`) : ev.event_type}</b>
                      {extras.length > 0 && <span>{` · ${extras.join(" · ")}`}</span>}
                      <small>
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

      <div className="acx-df">
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
            <span className="grow" />
            <button type="button" aria-label={t("menu.delete")} title={t("menu.delete")} onClick={() => onAction("delete")} className={buttonClass("ghostCritical")}>
              <Trash2 size={16} aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    </SidePanel>
  );
}
