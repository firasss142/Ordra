"use client";

import { memo, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Bell, X } from "lucide-react";
import { useAgentNotifications } from "@/hooks/useAgentNotifications";
import type { AgentNotification } from "@/hooks/useAgentNotifications";

interface NotificationBellProps {
  agentId: string;
  onOpenOrder?: (orderId: string) => void;
}

function NotificationBellInner({ agentId, onOpenOrder }: NotificationBellProps) {
  const t = useTranslations("notifications");
  const { notifications, unreadCount, markRead, markAllRead } = useAgentNotifications(agentId);
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [toastNotif, setToastNotif] = useState<AgentNotification | null>(null);
  const prevUnreadRef = useRef(unreadCount);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (unreadCount > prevUnreadRef.current) {
      const newest = notifications.find((n) => !n.read_at) ?? null;
      setToastNotif(newest);
      const timer = setTimeout(() => setToastNotif(null), 5000);
      prevUnreadRef.current = unreadCount;
      return () => clearTimeout(timer);
    }
    prevUnreadRef.current = unreadCount;
  }, [unreadCount, notifications]);

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

  return (
    <>
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
            color: hovered ? "var(--sidebar-text)" : "var(--sidebar-text-muted)",
            transition: "background-color 120ms ease, color 120ms ease",
          }}
        >
          <Bell size={22} strokeWidth={1.75} aria-hidden="true" />
          {unreadCount > 0 && (
            <span
              style={{
                position: "absolute",
                top: 4,
                insetInlineEnd: 4,
                backgroundColor: "var(--text-primary)",
                color: "#FFFFFF",
                fontSize: 10,
                fontWeight: 600,
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
              width: 320,
              backgroundColor: "var(--bg-card)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              zIndex: 100,
              overflow: "hidden",
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

            <div style={{ maxHeight: 320, overflowY: "auto" }}>
              {notifications.length === 0 ? (
                <div
                  style={{
                    padding: 20,
                    textAlign: "center",
                    fontSize: 13,
                    color: "var(--text-secondary)",
                  }}
                >
                  {t("empty")}
                </div>
              ) : (
                notifications.map((notif) => (
                  <NotificationRow
                    key={notif.id}
                    notif={notif}
                    kindLabel={t(notif.kind as "callback_due" | "attempt_due")}
                    viewLabel={t("viewOrder")}
                    onView={() => {
                      markRead(notif.id);
                      setOpen(false);
                      onOpenOrder?.(notif.order_id);
                    }}
                  />
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {toastNotif && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            insetInlineEnd: 24,
            backgroundColor: "var(--text-primary)",
            color: "#FFFFFF",
            borderRadius: 6,
            padding: "12px 16px",
            fontSize: 13,
            zIndex: 200,
            display: "flex",
            gap: 12,
            alignItems: "center",
          }}
        >
          <span>{t(toastNotif.kind as "callback_due" | "attempt_due")}</span>
          <button
            type="button"
            onClick={() => {
              markRead(toastNotif.id);
              setToastNotif(null);
              onOpenOrder?.(toastNotif.order_id);
            }}
            style={{
              background: "none",
              border: "1px solid rgba(255,255,255,0.3)",
              borderRadius: 4,
              color: "#FFFFFF",
              fontSize: 12,
              cursor: "pointer",
              padding: "3px 8px",
            }}
          >
            {t("viewOrder")}
          </button>
          <button
            type="button"
            onClick={() => setToastNotif(null)}
            style={{
              background: "none",
              border: "none",
              color: "rgba(255,255,255,0.6)",
              cursor: "pointer",
              padding: 0,
              display: "flex",
              alignItems: "center",
            }}
          >
            <X size={14} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
      )}
    </>
  );
}

function NotificationRow({
  notif,
  kindLabel,
  viewLabel,
  onView,
}: {
  notif: AgentNotification;
  kindLabel: string;
  viewLabel: string;
  onView: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const isUnread = !notif.read_at;
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "10px 14px",
        borderBottom: "1px solid var(--border)",
        backgroundColor: isUnread ? "var(--bg-page)" : "var(--bg-card)",
      }}
    >
      <div>
        <div
          style={{
            fontSize: 13,
            fontWeight: isUnread ? 600 : 400,
            color: "var(--text-primary)",
          }}
        >
          {kindLabel}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>
          {new Date(notif.due_at).toLocaleString(undefined, {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      </div>
      <button
        type="button"
        onClick={onView}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          background: hovered ? "var(--bg-page)" : "none",
          border: "1px solid var(--border)",
          borderRadius: 4,
          fontSize: 12,
          color: "var(--text-primary)",
          cursor: "pointer",
          padding: "4px 10px",
          whiteSpace: "nowrap",
          transition: "background-color 120ms ease",
        }}
      >
        {viewLabel}
      </button>
    </div>
  );
}

export const NotificationBell = memo(NotificationBellInner);
