"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  ReactNode,
} from "react";
import { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { getLocaleForMarket, getDirectionForLocale } from "@/lib/locale-routing";
import type { Role, AuthUser } from "@/types";

interface AuthContextValue {
  user: AuthUser | null;
  /** True while the initial session check is in flight */
  loading: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
});

export function AuthProvider({
  children,
  initialUser = null,
}: {
  children: ReactNode;
  initialUser?: AuthUser | null;
}) {
  const [user, setUser] = useState<AuthUser | null>(initialUser);
  const [loading, setLoading] = useState(initialUser === null);
  const initialUserIdRef = useRef(initialUser?.id ?? null);

  useEffect(() => {
    const supabase = createClient();
    let firstEvent = true;

    async function loadUser(authUser: User | null) {
      if (!authUser) {
        setUser(null);
        setLoading(false);
        return;
      }

      const { data } = await supabase
        .from("users")
        .select("full_name, avatar_url, role, market_id")
        .eq("id", authUser.id)
        .single();

      if (!data) {
        setUser(null);
        setLoading(false);
        return;
      }

      const marketCode =
        data.market_id === "00000000-0000-0000-0000-000000000002"
          ? "ly"
          : data.market_id
          ? "tn"
          : null;
      const locale = getLocaleForMarket(marketCode);
      const direction = getDirectionForLocale(locale);

      setUser({
        id: authUser.id,
        email: authUser.email ?? "",
        full_name: data.full_name,
        avatar_url: data.avatar_url ?? null,
        role: data.role as Role,
        market_id: data.market_id,
        locale,
        direction,
      });
      setLoading(false);
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      // First callback fires immediately with the current session. If the
      // server-resolved initialUser matches, skip the extra DB round trip.
      if (
        firstEvent &&
        session?.user?.id &&
        session.user.id === initialUserIdRef.current
      ) {
        firstEvent = false;
        setLoading(false);
        return;
      }
      firstEvent = false;
      loadUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
