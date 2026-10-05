"use client";

// The bell (prototype `bellDrop`): what is due, by kind, the late ones in red. A WhatsApp reply
// opens the order on its Messages tab. A new arrival shows the agent toast (the old bell's banner).

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { useAgentNotifications, type AgentNotification } from "@/hooks/useAgentNotifications";
import { Ic, useAgentToast } from "@/components/agent/shared";
import { useOutside } from "./useOutside";

type T = ReturnType<typeof useTranslations>;

/** « dans 12 min » · « dû il y a 47 min » — late when the time has passed. */
export function dueWords(t: T, dueIso: string, now: number): { text: string; late: boolean } {
  const d = Math.round((Date.parse(dueIso) - now) / 60000);
  if (Math.abs(d) < 2) return { text: t("due.now"), late: false };
  if (d > 0) return { text: d < 60 ? t("due.inMin", { n: d }) : t("due.inH", { n: Math.round(d / 60) }), late: false };
  const a = -d;
  return {
    text: a < 60 ? t("due.agoMin", { n: a }) : a < 1440 ? t("due.agoH", { n: Math.round(a / 60) }) : t("due.agoD", { n: Math.round(a / 1440) }),
    late: true,
  };
}

function agoWords(t: T, iso: string, now: number) {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (m < 1) return t("ago.now");
  if (m < 60) return t("ago.min", { n: m });
  if (m < 1440) return t("ago.h", { n: Math.round(m / 60) });
  return t("ago.d", { n: Math.round(m / 1440) });
}

const KIND: Record<Exclude<AgentNotification["kind"], "whatsapp_inbound">, { hue: string; icon: string }> = {
  callback_due: { hue: "violet", icon: "clock" },
  attempt_due: { hue: "amber", icon: "phone" },
  dispatch_due: { hue: "violet", icon: "truck" },
};

export function AgentBell({ agentId, variant = "desk" }: { agentId: string; variant?: "desk" | "phone" }) {
  const t = useTranslations("agent.bell");
  const locale = useLocale();
  const router = useRouter();
  const toast = useAgentToast();
  const { notifications, unreadCount, markRead, markAllRead } = useAgentNotifications(agentId);
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useOutside(ref, open, close);

  const { data: allData } = useSWR<{ data: AgentNotification[] }>(open && all ? "/api/notifications?include=all" : null, {
    revalidateOnFocus: false,
  });
  const list = all ? allData?.data ?? notifications : notifications;

  // A genuinely new arrival says so once — never what was already waiting when the page opened.
  const mountedAt = useRef(Date.now());
  const toasted = useRef(new Set<string>());
  useEffect(() => {
    const n = notifications.find((x) => !x.read_at && Date.parse(x.created_at) > mountedAt.current && !toasted.current.has(x.id));
    if (!n) return;
    toasted.current.add(n.id);
    const who = n.order?.customer_name ?? t("unknown");
    toast(n.kind === "whatsapp_inbound" ? t("waReplied", { name: who }) : `${who} · ${t(`kind.${n.kind}`)}`);
  }, [notifications, toast, t]);

  const view = (n: AgentNotification) => {
    if (!n.read_at) void markRead(n.id);
    setOpen(false);
    router.push(`/${locale}/queue?openOrderId=${n.order_id}${n.kind === "whatsapp_inbound" ? "&tab=messages" : ""}`);
  };

  const now = Date.now();
  return (
    <div className="fbw" ref={ref}>
      <button
        type="button"
        className={variant === "phone" ? "mic" : "bell"}
        aria-label={t("aria")}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={variant === "phone" ? { position: "relative" } : undefined}
      >
        <Ic n="bell" />
        {unreadCount ? (
          <em
            className="nb red"
            style={variant === "phone" ? { position: "absolute", top: -5, insetInlineEnd: -5, height: 17, minWidth: 17, fontSize: 10 } : undefined}
          >
            {unreadCount}
          </em>
        ) : null}
      </button>
      {open ? (
        <div className="menu end bdrop" style={variant === "phone" ? { width: "min(360px, calc(100vw - 24px))" } : undefined}>
          <div className="bhead">
            <b>{t("title", { n: unreadCount })}</b>
            {unreadCount ? (
              <button type="button" className="lnkb" onClick={() => void markAllRead()}>
                {t("allRead")}
              </button>
            ) : null}
          </div>
          {list.length === 0 ? <div className="empty" style={{ padding: 24 }}>{t("empty")}</div> : null}
          {list.map((n) => {
            const who = n.order?.customer_name?.trim() || t("unknown");
            if (n.kind === "whatsapp_inbound") {
              return (
                <button key={n.id} type="button" className={`bn${n.read_at ? " rd" : ""}`} onClick={() => view(n)}>
                  <span className="hold h-green">
                    <Ic n="wa" />
                  </span>
                  <span className="st">
                    <b>{t("waReplied", { name: who })}</b>
                    {n.excerpt ? <small dir="auto">« {n.excerpt} »</small> : null}
                    <small>{agoWords(t, n.created_at, now)}</small>
                  </span>
                </button>
              );
            }
            const due = dueWords(t, n.due_at, now);
            const k = KIND[n.kind];
            const hue = n.kind === "callback_due" && due.late ? "red" : k.hue;
            const product = [n.order?.product_name, n.order?.variant_label].filter(Boolean).join(" · ");
            return (
              <button key={n.id} type="button" className={`bn${n.read_at ? " rd" : ""}`} onClick={() => view(n)}>
                <span className={`hold h-${hue}`}>
                  <Ic n={k.icon} />
                </span>
                <span className="st">
                  <b dir="auto">{who}</b>
                  <small>
                    {t(`kind.${n.kind}`)} · <span className={due.late ? "late" : ""}>{due.text}</span>
                  </small>
                  {product ? <small dir="auto">{product}</small> : null}
                </span>
                <span className="lnk">{t("viewOrder")}</span>
              </button>
            );
          })}
          <div className="bfoot">
            <button type="button" className="lnkb" onClick={() => setAll((v) => !v)}>
              {all ? t("seeLess") : t("seeAll")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
