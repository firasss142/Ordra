"use client";

// The agent shell's band (prototype `headerHTML`): the word, the market, the five tabs, then
// search · availability · bell · me. On a phone (prototype `phoneHTML`) the band gives way to
// `.mtop` (availability, search, bell, me), the page title `.mtitle`, and the five tabs at the bottom.

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useBroadcastConnected } from "@/components/providers/RealtimeProvider";
import { ordersTopic } from "@/hooks/useOrdersRealtime";
import { createClient } from "@/lib/supabase/client";
import { marketIdToCode } from "@/lib/markets";
import { Ic } from "@/components/agent/shared";
import { AgentNav, agentTabOf } from "./AgentNav";
import { AgentAvail } from "./AgentAvail";
import { AgentBell } from "./AgentBell";
import { AgentMe } from "./AgentMe";
import { AgentSearchDesk, AgentSearchPhone } from "./AgentSearch";
import type { AuthUser } from "@/types";

function useMarketWord(user: AuthUser) {
  const t = useTranslations("agent.market");
  const code = marketIdToCode(user.market_id);
  return code ? t(code) : "";
}

function useSessionExpired() {
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const { data } = createClient().auth.onAuthStateChange((event, session) => {
      if (event === "TOKEN_REFRESHED" && !session) setExpired(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  return expired;
}

export function AgentHeader({ user }: { user: AuthUser }) {
  const t = useTranslations("agent");
  const pathname = usePathname() ?? "";
  const tab = agentTabOf(pathname);
  const market = useMarketWord(user);
  const live = useBroadcastConnected(user.market_id ? [ordersTopic(user.market_id)] : []);
  const expired = useSessionExpired();
  return (
    <>
      {expired ? <div className="err" role="alert" style={{ borderRadius: 0 }}>{t("me.sessionExpired")}</div> : null}
      <header className="ah">
        <span className="word">
          <i />
          Ordra
        </span>
        {market ? (
          <span className="mkt">
            <Ic n="pin" />
            {market}
          </span>
        ) : null}
        <AgentNav user={user} variant="desk" />
        <span className="sp" />
        {/* The queue has its own field, bound to the same query: one search on screen, not two. */}
        {tab === "orders" ? null : <AgentSearchDesk />}
        <AgentAvail live={live} variant="desk" />
        <AgentBell agentId={user.id} />
        <AgentMe user={user} marketWord={market} />
      </header>
    </>
  );
}

/** `.mtop` + `.mtitle` — the phone's top. */
export function AgentPhoneTop({ user }: { user: AuthUser }) {
  const t = useTranslations("agent");
  const pathname = usePathname() ?? "";
  const tab = agentTabOf(pathname);
  const market = useMarketWord(user);
  const live = useBroadcastConnected(user.market_id ? [ordersTopic(user.market_id)] : []);
  return (
    <>
      <div className="mtop">
        <AgentAvail live={live} variant="phone" />
        <span className="sp" />
        <AgentSearchPhone />
        <AgentBell agentId={user.id} variant="phone" />
        <AgentMe user={user} marketWord={market} variant="phone" />
      </div>
      <h1 className="mtitle">{t(`titles.${tab}`)}</h1>
    </>
  );
}
