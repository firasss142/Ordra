"use client";

// The five tabs (prototype `TABS`): `.at` in the desktop band, `.mtabs` at the bottom of a phone.

import { memo, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import useSWR, { preload } from "swr";
import { fetcher } from "@/lib/swr-config";
import { fetchAgentQueue } from "@/lib/agent-queue/fetch-queue";
import { Ic } from "@/components/agent/shared";
import type { AuthUser } from "@/types";

export type AgentTabKey = "orders" | "crm" | "delivery" | "commissions" | "voc";

interface TabDef {
  k: AgentTabKey;
  href: string;
  icon: string;
  prefetchKey: string;
}

const TABS: { k: AgentTabKey; path: string; icon: string; prefetchKey: string }[] = [
  { k: "orders", path: "queue", icon: "bag", prefetchKey: "/api/agent/queue" },
  { k: "crm", path: "leads", icon: "target", prefetchKey: "/api/agent/leads/queue" },
  { k: "delivery", path: "delivery", icon: "truck", prefetchKey: "/api/delivery/worklist" },
  { k: "commissions", path: "commissions", icon: "coins", prefetchKey: "/api/agent/commissions?days=60" },
  { k: "voc", path: "feedback", icon: "quote", prefetchKey: "/api/feedback/mine" },
];

/** Which tab a path belongs to; anything unknown is the queue (the agent's home). */
export function agentTabOf(pathname: string): AgentTabKey {
  if (pathname.includes("/leads")) return "crm";
  if (pathname.includes("/delivery")) return "delivery";
  if (pathname.includes("/commissions")) return "commissions";
  if (pathname.includes("/feedback")) return "voc";
  return "orders";
}

function useAgentTabs(user: AuthUser) {
  const pathname = usePathname() ?? "";
  // Parcels that need the agent now — « À traiter maintenant » + « Retours à sauver ». Same key as the
  // Livraison page, so the badge and the page share one request.
  const { data: delivery } = useSWR<{ rows: { bucket: string }[] }>(
    user.role === "agent" ? "/api/delivery/worklist" : null,
    { refreshInterval: 120_000, revalidateOnFocus: false },
  );
  const deliveryBadge = delivery?.rows?.filter((r) => r.bucket === "act_now" || r.bucket === "returning").length ?? 0;

  const tabs: TabDef[] = TABS.map((T) => ({ k: T.k, href: `/${user.locale}/${T.path}`, icon: T.icon, prefetchKey: T.prefetchKey }));
  const active = agentTabOf(pathname);

  // The queue key must be preloaded with its own fetcher: the wire sends `visibleIds` and
  // fetchAgentQueue rehydrates the `orders` array that cache-patch operates on.
  const warm = useCallback((key: string) => {
    preload(key, key === "/api/agent/queue" ? fetchAgentQueue : fetcher);
  }, []);

  return { tabs, active, badge: (k: AgentTabKey) => (k === "delivery" ? deliveryBadge : 0), warm };
}

function AgentNavInner({ user, variant }: { user: AuthUser; variant: "desk" | "phone" }) {
  const t = useTranslations("agent");
  const { tabs, active, badge, warm } = useAgentTabs(user);
  return (
    <nav className={variant === "desk" ? "at" : "mtabs"} aria-label={t("nav")}>
      {tabs.map((T) => {
        const n = badge(T.k);
        const on = T.k === active;
        return (
          <Link
            key={T.k}
            href={T.href}
            prefetch
            className={on ? "on" : ""}
            aria-current={on ? "page" : undefined}
            onMouseEnter={() => warm(T.prefetchKey)}
            onFocus={() => warm(T.prefetchKey)}
            onTouchStart={() => warm(T.prefetchKey)}
          >
            <Ic n={T.icon} />
            <span>{t(`tabs.${T.k}`)}</span>
            {n ? <em className="nb">{n}</em> : null}
          </Link>
        );
      })}
    </nav>
  );
}

export const AgentNav = memo(AgentNavInner);
