"use client";

import { useTranslations } from "next-intl";
import FocusTrap from "focus-trap-react";
import { X } from "lucide-react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import { Avatar } from "@/components/ui/Avatar";
import type { UserAuditEvent } from "@/types";

interface Props {
  userId: string;
  open: boolean;
  onClose: () => void;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function UserAuditLog({ userId, open, onClose }: Props) {
  const t = useTranslations("users");
  const { data, isLoading } = useSWR<{ data: UserAuditEvent[] }>(
    open ? `/api/admin/audit-log?target_id=${userId}&limit=50` : null,
    fetcher
  );

  if (!open) return null;

  const events = data?.data ?? [];

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 150 }}
      />
      <FocusTrap>
        <aside
          role="dialog"
          aria-modal="true"
          aria-label={t("auditLog.title")}
          style={{
            position: "fixed",
            top: 0,
            insetInlineEnd: 0,
            width: 420,
            height: "100vh",
            background: "white",
            boxShadow: "-4px 0 24px rgba(0,0,0,0.08)",
            zIndex: 151,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "16px 20px",
              borderBottom: "1px solid #E1E3E5",
            }}
          >
            <span style={{ fontSize: 16, fontWeight: 600, color: "#1A1A1A" }}>
              {t("auditLog.title")}
            </span>
            <button
              onClick={onClose}
              aria-label="Fermer"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 32,
                height: 32,
                borderRadius: "50%",
                border: "1px solid #E1E3E5",
                background: "white",
                cursor: "pointer",
              }}
            >
              <X size={16} />
            </button>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
            {isLoading && (
              <div style={{ textAlign: "center", color: "#9CA3AF", fontSize: 14 }}>
                Chargement…
              </div>
            )}

            {!isLoading && events.length === 0 && (
              <div style={{ textAlign: "center", color: "#9CA3AF", fontSize: 14 }}>
                {t("auditLog.empty")}
              </div>
            )}

            {events.map((ev, i) => {
              const eventKey = `auditLog.events.${ev.event_type}` as Parameters<typeof t>[0];
              const meta = ev.meta ?? {};
              return (
                <div
                  key={ev.id}
                  style={{
                    display: "flex",
                    gap: 12,
                    paddingBottom: 16,
                    marginBottom: i < events.length - 1 ? 16 : 0,
                    borderBottom: i < events.length - 1 ? "1px solid #F4F4F4" : "none",
                  }}
                >
                  {/* Actor avatar */}
                  <div style={{ flexShrink: 0 }}>
                    <Avatar
                      user={{
                        full_name: ev.actor_name ?? "Système",
                        avatar_url: null,
                        email: "",
                      }}
                      size={28}
                    />
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "#1A1A1A" }}>
                      {ev.actor_name ?? "Système"}
                    </div>
                    <div style={{ fontSize: 13, color: "#374151" }}>
                      {t(eventKey)}
                      {typeof meta.reason === "string" && meta.reason && (
                        <span style={{ color: "#6D7175" }}>
                          {" · "}
                          {t(`reasons.${meta.reason}` as Parameters<typeof t>[0])}
                        </span>
                      )}
                      {typeof meta.orders_returned === "number" && meta.orders_returned > 0 && (
                        <span style={{ color: "#6D7175" }}>
                          {" · "}{meta.orders_returned} commande(s) retournée(s)
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: "#9CA3AF", marginTop: 2 }}>
                      {fmtDate(ev.created_at)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>
      </FocusTrap>
    </>
  );
}
