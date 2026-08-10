"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { Bell, BellRing, X } from "lucide-react";
import { useAgentNotifications } from "@/hooks/useAgentNotifications";
import type { AgentNotification } from "@/hooks/useAgentNotifications";

interface NotificationBellProps {
  agentId: string;
}

type Kind = "callback_due" | "attempt_due" | "dispatch_due";

// Semantic palette, ordered by what the agent owes and to whom: a callback is a
// promise made to a customer for a specific time; an attempt is a softer
// reminder to try again; a dispatch is a delivery the agent scheduled for
// themselves, so it is the quietest of the three.
const KIND_STYLE: Record<
  Kind,
  { dot: string; badgeBg: string; barBg: string; toastAccent: string }
> = {
  callback_due: {
    dot: "#D72C0D",
    badgeBg: "#D72C0D",
    barBg: "rgba(215, 44, 13, 0.08)",
    toastAccent: "#FF8A75",
  },
  attempt_due: {
    dot: "#B98900",
    badgeBg: "#B98900",
    barBg: "rgba(185, 137, 0, 0.10)",
    toastAccent: "#FFC857",
  },
  dispatch_due: {
    dot: "#6E56CF",
    badgeBg: "#6E56CF",
    barBg: "rgba(110, 86, 207, 0.10)",
    toastAccent: "#B5A3F5",
  },
};

// Pick the most-urgent unread to drive the badge color and shake.
// callback_due > attempt_due > dispatch_due > (no unread).
function pickHighestKind(notifs: AgentNotification[]): Kind | null {
  let hasAttempt = false;
  let hasDispatch = false;
  for (const n of notifs) {
    if (n.read_at) continue;
    if (n.kind === "callback_due") return "callback_due";
    if (n.kind === "attempt_due") hasAttempt = true;
    if (n.kind === "dispatch_due") hasDispatch = true;
  }
  if (hasAttempt) return "attempt_due";
  return hasDispatch ? "dispatch_due" : null;
}

interface RelativeTimeParts {
  key: "dueNow" | "dueInMinutes" | "dueInHours" | "overdueMinutes" | "overdueHours" | "overdueDays";
  values: Record<string, number>;
  overdue: boolean;
}

function relativeDue(dueAtIso: string, now: number): RelativeTimeParts {
  const due = new Date(dueAtIso).getTime();
  const diffMs = due - now; // positive = future, negative = past
  const absMin = Math.round(Math.abs(diffMs) / 60_000);

  if (absMin < 1) return { key: "dueNow", values: {}, overdue: diffMs <= 0 };

  if (diffMs > 0) {
    if (absMin < 60) return { key: "dueInMinutes", values: { minutes: absMin }, overdue: false };
    const hours = Math.round(absMin / 60);
    return { key: "dueInHours", values: { hours }, overdue: false };
  }

  // overdue
  if (absMin < 60) return { key: "overdueMinutes", values: { minutes: absMin }, overdue: true };
  if (absMin < 60 * 24) {
    const hours = Math.round(absMin / 60);
    return { key: "overdueHours", values: { hours }, overdue: true };
  }
  const days = Math.round(absMin / (60 * 24));
  return { key: "overdueDays", values: { days }, overdue: true };
}

function NotificationBellInner({ agentId }: NotificationBellProps) {
  const t = useTranslations("notifications");
  const locale = useLocale();
  const router = useRouter();
  const { notifications, unreadCount, markRead, markAllRead } = useAgentNotifications(agentId);

  const openOrder = useCallback(
    (orderId: string) => {
      router.push(`/${locale}/queue?openOrderId=${orderId}`);
    },
    [router, locale],
  );

  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [toastNotif, setToastNotif] = useState<AgentNotification | null>(null);
  const [shakeKey, setShakeKey] = useState(0); // bump to retrigger CSS animation

  // History fetch — only when the panel is open AND the user has expanded "Show all".
  // Disabled otherwise to keep the bell cheap.
  const { data: allData } = useSWR<{ data: AgentNotification[] }>(
    open && showAll ? "/api/notifications?include=all" : null,
    { revalidateOnFocus: false, dedupingInterval: 5000 },
  );
  const allNotifications = allData?.data ?? notifications;
  const displayNotifications = showAll ? allNotifications : notifications;
  // Start at 0 so the very first render with any unread fires the "new arrival"
  // branch — this shakes the bell once on page load when the user lands on a
  // page that already has unread notifications.
  const prevUnreadRef = useRef(0);
  // Tracks whether we've completed the initial pass. Used to suppress the
  // toast on first load (we still shake, but we don't pop a toast for stale
  // notifications the user already had).
  const initializedRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Drive the badge color and shake from the highest-priority unread kind.
  const dominantKind = useMemo(() => pickHighestKind(notifications), [notifications]);

  // Re-tick once a minute so relative timestamps don't go stale while the
  // dropdown is open. Only ticks when the dropdown is open to avoid waking
  // up React for nothing.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setNowTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, [open]);

  // New-arrival side effects: shake + (toast only for true Realtime arrivals).
  useEffect(() => {
    if (unreadCount > prevUnreadRef.current) {
      setShakeKey((k) => k + 1);
      // Only pop a toast for genuinely new arrivals, not for notifications
      // the user already had when they landed on the page.
      if (initializedRef.current) {
        const newest = notifications.find((n) => !n.read_at) ?? null;
        setToastNotif(newest);
        const timer = setTimeout(() => setToastNotif(null), 5000);
        prevUnreadRef.current = unreadCount;
        initializedRef.current = true;
        return () => clearTimeout(timer);
      }
      initializedRef.current = true;
    }
    prevUnreadRef.current = unreadCount;
    if (!initializedRef.current && unreadCount === 0) {
      // SWR resolved to "no unread" — still counts as initialized.
      initializedRef.current = true;
    }
  }, [unreadCount, notifications]);

  // Click-outside closes the panel.
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const badgeColor = dominantKind ? KIND_STYLE[dominantKind].badgeBg : "var(--text-primary)";

  return (
    <>
      {/* Scoped keyframes — only injected once per mount; class names are
          unique enough that they won't collide with sibling components. */}
      <style>{`
        @keyframes notif-shake {
          0%, 100% { transform: rotate(0deg); }
          15% { transform: rotate(-12deg); }
          30% { transform: rotate(10deg); }
          45% { transform: rotate(-8deg); }
          60% { transform: rotate(6deg); }
          75% { transform: rotate(-3deg); }
        }
        @keyframes notif-pulse {
          0%, 100% { box-shadow: 0 0 0 0 currentColor; opacity: 1; }
          50% { box-shadow: 0 0 0 6px transparent; opacity: 0.85; }
        }
        .notif-bell-shake { animation: notif-shake 600ms ease-in-out; transform-origin: 50% 8%; }
        .notif-badge-pulse { animation: notif-pulse 1.8s ease-in-out infinite; }
      `}</style>

      <div ref={panelRef} style={{ position: "relative" }}>
        <button
          type="button"
          aria-label={t("bell")}
          onClick={() => setOpen((v) => !v)}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            all: "unset",
            cursor: "pointer",
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 44,
            height: 44,
            borderRadius: 8,
            backgroundColor: hovered ? "var(--sidebar-hover)" : "transparent",
            // When there's an unread, paint the bell in the dominant urgency
            // color. When read, fall back to the muted sidebar color.
            color: dominantKind
              ? KIND_STYLE[dominantKind].dot
              : hovered
                ? "var(--sidebar-text)"
                : "var(--sidebar-text-muted)",
            transition: "background-color 120ms ease, color 120ms ease",
          }}
        >
          <span
            // keyed so React remounts on each shake, retriggering the animation
            key={shakeKey}
            className={shakeKey > 0 ? "notif-bell-shake" : undefined}
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}
          >
            {unreadCount > 0 ? (
              <BellRing
                size={22}
                strokeWidth={2}
                fill="currentColor"
                fillOpacity={0.18}
                aria-hidden="true"
              />
            ) : (
              <Bell size={22} strokeWidth={1.75} aria-hidden="true" />
            )}
          </span>
          {unreadCount > 0 && (
            <span
              className={dominantKind ? "notif-badge-pulse" : undefined}
              style={{
                position: "absolute",
                top: 4,
                insetInlineEnd: 4,
                backgroundColor: badgeColor,
                color: "#FFFFFF",
                fontSize: 10,
                fontWeight: 700,
                borderRadius: 9999,
                minWidth: 18,
                height: 18,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "0 4px",
                lineHeight: 1,
              }}
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>

        {open && (
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 8px)",
              insetInlineEnd: 0,
              width: 360,
              backgroundColor: "var(--bg-card)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              zIndex: 100,
              overflow: "hidden",
              boxShadow: "0 8px 24px rgba(0, 0, 0, 0.08)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "10px 14px",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                {t("bell")}
                {unreadCount > 0 && (
                  <span style={{ marginInlineStart: 6, color: "var(--text-secondary)", fontWeight: 400 }}>
                    ({unreadCount})
                  </span>
                )}
              </span>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={markAllRead}
                  style={{
                    background: "none",
                    border: "none",
                    fontSize: 12,
                    color: "var(--text-secondary)",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  {t("markAllRead")}
                </button>
              )}
            </div>

            <div style={{ maxHeight: 480, overflowY: "auto" }}>
              {displayNotifications.length === 0 ? (
                <div
                  style={{
                    padding: 20,
                    textAlign: "center",
                    fontSize: 13,
                    color: "var(--text-secondary)",
                  }}
                >
                  {t(showAll ? "emptyAll" : "empty")}
                </div>
              ) : (
                displayNotifications.map((notif) => (
                  <NotificationRow
                    key={notif.id}
                    notif={notif}
                    onView={() => {
                      if (!notif.read_at) markRead(notif.id);
                      setOpen(false);
                      openOrder(notif.order_id);
                    }}
                  />
                ))
              )}
            </div>

            <div
              style={{
                borderTop: "1px solid var(--border)",
                padding: "8px 14px",
                textAlign: "center",
              }}
            >
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: 12,
                  color: "var(--text-secondary)",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                {showAll ? t("showUnreadOnly") : t("showAll")}
              </button>
            </div>
          </div>
        )}
      </div>

      {toastNotif && (
        <ToastBanner
          notif={toastNotif}
          onView={() => {
            markRead(toastNotif.id);
            const orderId = toastNotif.order_id;
            setToastNotif(null);
            openOrder(orderId);
          }}
          onClose={() => setToastNotif(null)}
        />
      )}
    </>
  );
}

function formatProduct(notif: AgentNotification, fallback: string): string {
  const name = notif.order?.product_name?.trim();
  const variant = notif.order?.variant_label?.trim();
  if (name && variant) return `${name} · ${variant}`;
  if (name) return name;
  return fallback;
}

function NotificationRow({
  notif,
  onView,
}: {
  notif: AgentNotification;
  onView: () => void;
}) {
  const t = useTranslations("notifications");
  const [hovered, setHovered] = useState(false);
  const isUnread = !notif.read_at;
  const kind = notif.kind as Kind;
  const style = KIND_STYLE[kind];
  const customer = notif.order?.customer_name?.trim() || t("unknownCustomer");
  const productLine = formatProduct(notif, t("noProduct"));
  const rel = relativeDue(notif.due_at, Date.now());

  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        padding: "8px 12px",
        borderBottom: "1px solid var(--border)",
        backgroundColor: isUnread ? style.barBg : "transparent",
        borderInlineStart: isUnread ? `3px solid ${style.dot}` : "3px solid transparent",
        alignItems: "center",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          flexShrink: 0,
          width: 7,
          height: 7,
          borderRadius: 9999,
          backgroundColor: style.dot,
          opacity: isUnread ? 1 : 0.35,
        }}
      />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: 8,
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontWeight: isUnread ? 600 : 500,
              color: "var(--text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={customer}
          >
            {customer}
          </span>
          <span
            style={{
              fontSize: 10,
              color: rel.overdue ? style.dot : "var(--text-secondary)",
              fontWeight: rel.overdue ? 600 : 400,
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {t(rel.key, rel.values)}
          </span>
        </div>

        <div
          style={{
            fontSize: 11,
            color: "var(--text-secondary)",
            marginTop: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={`${t(kind)} — ${productLine}`}
        >
          <span style={{ color: style.dot, fontWeight: 500 }}>{t(kind)}</span>
          <span style={{ opacity: 0.5, margin: "0 4px" }}>·</span>
          {productLine}
        </div>
      </div>

      <button
        type="button"
        onClick={onView}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          flexShrink: 0,
          background: hovered ? "var(--bg-page)" : "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: 4,
          fontSize: 11,
          fontWeight: 500,
          color: "var(--text-primary)",
          cursor: "pointer",
          padding: "3px 8px",
          transition: "background-color 120ms ease",
          whiteSpace: "nowrap",
        }}
      >
        {t("viewOrder")}
      </button>
    </div>
  );
}

function ToastBanner({
  notif,
  onView,
  onClose,
}: {
  notif: AgentNotification;
  onView: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("notifications");
  const kind = notif.kind as Kind;
  const style = KIND_STYLE[kind];
  const customer = notif.order?.customer_name?.trim() || t("unknownCustomer");
  const productLine = formatProduct(notif, t("noProduct"));

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: 24,
        insetInlineEnd: 24,
        backgroundColor: "#1A1A1A",
        color: "#FFFFFF",
        borderRadius: 8,
        padding: 0,
        minWidth: 280,
        maxWidth: 360,
        fontSize: 13,
        zIndex: 200,
        display: "flex",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.25)",
        overflow: "hidden",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 4,
          backgroundColor: style.toastAccent,
        }}
      />
      <div style={{ flex: 1, padding: "12px 14px", minWidth: 0 }}>
        <div style={{ fontSize: 11, color: style.toastAccent, fontWeight: 600, letterSpacing: 0.3 }}>
          {t(kind).toUpperCase()}
        </div>
        <div
          style={{
            marginTop: 4,
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={customer}
        >
          {customer}
        </div>
        <div
          style={{
            fontSize: 12,
            color: "rgba(255,255,255,0.7)",
            marginTop: 2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={productLine}
        >
          {productLine}
        </div>
        <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={onView}
            style={{
              background: "rgba(255,255,255,0.15)",
              border: "none",
              borderRadius: 4,
              color: "#FFFFFF",
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
              padding: "4px 10px",
            }}
          >
            {t("viewOrder")}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "none",
              border: "none",
              color: "rgba(255,255,255,0.6)",
              cursor: "pointer",
              padding: "4px 6px",
              display: "flex",
              alignItems: "center",
            }}
          >
            <X size={14} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

export const NotificationBell = memo(NotificationBellInner);
