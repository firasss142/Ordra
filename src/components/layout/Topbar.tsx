"use client";

import { memo, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Menu, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "@/components/ui/Avatar";
import { decodeAvatarFile, avatarErrorMessage } from "@/lib/client/image";
import type { AuthUser } from "@/types";

const ROLE_LABEL: Record<"fr" | "ar", Record<string, string>> = {
  fr: {
    super_admin: "Super admin",
    market_manager: "Manager",
    agent: "Agent",
    warehouse_agent: "Entrepôt",
  },
  ar: {
    super_admin: "مدير عام",
    market_manager: "مدير سوق",
    agent: "وكيل",
    warehouse_agent: "مخزن",
  },
};

interface TopbarProps {
  user: AuthUser;
  marketName: string;
  actions?: React.ReactNode;
  /** Centered slot in the agent navbar — used for the queue search bar. */
  searchSlot?: React.ReactNode;
  /** When provided, renders a hamburger button on mobile that calls this. */
  onMenuClick?: () => void;
  /**
   * "agent" enables the agent-only premium header: emerald New Order pill,
   * inline online presence, larger avatar group, and Cairo typography.
   * Manager/admin views use the default Shopify-style topbar.
   */
  variant?: "default" | "agent";
}

const SESSION_EXPIRY_MSG: Record<"fr" | "ar", string> = {
  fr: "Session expirée — veuillez vous reconnecter.",
  ar: "انتهت الجلسة — يرجى تسجيل الدخول مجددًا.",
};

const LOGOUT_LABEL: Record<"fr" | "ar", string> = {
  fr: "Déconnexion",
  ar: "تسجيل خروج",
};

const CHANGE_AVATAR_LABEL: Record<"fr" | "ar", string> = {
  fr: "Changer la photo",
  ar: "تغيير الصورة",
};

const ONLINE_NOW_LABEL: Record<"fr" | "ar", string> = {
  fr: "En ligne",
  ar: "متصل الآن",
};

function TopbarInner({ user, marketName, actions, searchSlot, onMenuClick, variant = "default" }: TopbarProps) {
  const router = useRouter();
  const [sessionExpired, setSessionExpired] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const isRtl = user.direction === "rtl";

  const handleSelfAvatar = async (file: File | undefined) => {
    if (!file || uploadingAvatar) return;
    setUploadingAvatar(true);
    try {
      const decoded = await decodeAvatarFile(file);
      if (!decoded.ok) {
        console.error("[Topbar] avatar decode failed:", avatarErrorMessage(decoded.error));
        return;
      }
      const res = await fetch("/api/me/avatar", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatar: decoded.dataUrl }),
      });
      if (res.ok) router.refresh();
    } finally {
      setUploadingAvatar(false);
      setMenuOpen(false);
    }
  };

  useEffect(() => {
    const supabase = createClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === "TOKEN_REFRESHED" && !session) {
          setSessionExpired(true);
        }
      },
    );
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

  const handleLogout = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // network failure — still redirect to clear stale UI
    }
    router.replace(`/${user.locale}/login`);
  };

  // ── Agent variant — premium emerald header ─────────────────
  if (variant === "agent") {
    return (
      <>
        {sessionExpired && (
          <div
            role="alert"
            className="px-6 py-2 text-[13px] font-medium bg-agent-error-container text-agent-error border-b border-agent-error/20"
            style={{
              textAlign: isRtl ? "right" : "left",
              direction: isRtl ? "rtl" : "ltr",
            }}
          >
            {SESSION_EXPIRY_MSG[user.locale]}
          </div>
        )}
        <header
          className="flex items-center justify-between gap-4 px-8 bg-agent-surface border-b border-agent-outline-variant"
          style={{
            height: 64,
            direction: isRtl ? "rtl" : "ltr",
            fontFamily: "var(--font-cairo)",
          }}
        >
          {/* Identity block — the rich avatar IS the menu trigger.
              Clicking it opens the dropdown (avatar / logout). */}
          <div ref={menuRef} className="relative flex items-center gap-2 min-w-0">
            {onMenuClick && (
              <button
                type="button"
                onClick={onMenuClick}
                aria-label="Menu"
                className="md:hidden inline-flex items-center justify-center w-9 h-9 rounded-xl border border-agent-outline-variant text-agent-on-surface hover:bg-agent-surface-low transition-colors duration-fast"
              >
                <Menu size={16} aria-hidden="true" />
              </button>
            )}

            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={user.full_name}
              className="inline-flex items-center gap-3 min-w-0 ps-1 pe-3 py-1 rounded-xl border border-transparent hover:border-agent-outline-variant hover:bg-agent-surface-low transition-colors duration-fast"
            >
              <Avatar user={user} size={40} />
              <div className="min-w-0 hidden sm:block text-start">
                <div className="text-[14px] font-bold text-agent-on-surface leading-tight truncate">
                  {user.full_name}
                </div>
                <div className="text-[11.5px] font-semibold text-agent-primary flex items-center gap-1.5 mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-agent-primary-container inline-block" />
                  {ONLINE_NOW_LABEL[user.locale]}
                </div>
              </div>
              <span
                aria-hidden="true"
                className="text-[10px] text-agent-on-surface-variant ms-1"
              >
                ▾
              </span>
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="absolute z-30 top-full mt-2 min-w-[220px] bg-agent-surface border border-agent-outline-variant rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.06)] py-1 overflow-hidden"
                style={isRtl ? { right: 0 } : { left: 0 }}
              >
                <div className="px-4 py-2.5 text-[11.5px] text-agent-on-surface-variant border-b border-agent-outline-variant break-all">
                  {user.email}
                </div>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={uploadingAvatar}
                  className="block w-full px-4 py-2.5 text-[13px] font-medium text-agent-on-surface hover:bg-agent-surface-low transition-colors duration-fast disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ textAlign: isRtl ? "right" : "left" }}
                >
                  {uploadingAvatar ? "…" : CHANGE_AVATAR_LABEL[user.locale]}
                </button>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => handleSelfAvatar(e.target.files?.[0])}
                />
                {/* Sidebar-style logout row */}
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleLogout}
                  disabled={signingOut}
                  className="flex items-center gap-3 w-full px-4 py-2.5 text-[13px] font-semibold text-agent-on-surface-variant hover:bg-agent-surface-low hover:text-agent-on-surface transition-colors duration-fast disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ textAlign: isRtl ? "right" : "left" }}
                >
                  <LogOut size={15} strokeWidth={2} aria-hidden="true" />
                  <span>{LOGOUT_LABEL[user.locale]}</span>
                </button>
              </div>
            )}
          </div>

          {/* Centered search slot — grows to fill the space between identity
              and the trailing cluster. */}
          {searchSlot && (
            <div className="flex-1 min-w-0 flex justify-center px-2 md:px-6">
              {searchSlot}
            </div>
          )}

          {/* Trailing cluster — notification bell only */}
          <div className="flex items-center gap-2">
            {actions && (
              <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl text-agent-on-surface-variant hover:bg-agent-surface-low hover:text-agent-on-surface transition-colors duration-fast">
                {actions}
              </div>
            )}
          </div>
        </header>
      </>
    );
  }

  // ── Default variant — manager / admin Shopify-style header ──
  return (
    <>
      {sessionExpired && (
        <div
          role="alert"
          style={{
            backgroundColor: "#FEF2F2",
            borderBottom: "1px solid #FECACA",
            color: "#991B1B",
            fontSize: "0.875rem",
            fontWeight: 500,
            padding: "8px 24px",
            textAlign: isRtl ? "right" : "left",
            direction: isRtl ? "rtl" : "ltr",
          }}
        >
          {SESSION_EXPIRY_MSG[user.locale]}
        </div>
      )}
      <header
        className="px-4 md:px-6"
        style={{
          height: "48px",
          backgroundColor: "var(--bg-card)",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          direction: isRtl ? "rtl" : "ltr",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          {onMenuClick && (
            <button
              type="button"
              onClick={onMenuClick}
              aria-label="Menu"
              className="md:hidden"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 32,
                height: 32,
                borderRadius: 6,
                border: "1px solid var(--border)",
                background: "var(--bg-card)",
                color: "var(--text-primary)",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              <Menu size={16} aria-hidden="true" />
            </button>
          )}
          {marketName && (
            <span
              style={{
                fontSize: "0.75rem",
                color: "var(--text-secondary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {marketName}
            </span>
          )}
        </div>

        <div
          ref={menuRef}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            position: "relative",
          }}
        >
          {actions}

          {/* Divider */}
          <span
            aria-hidden="true"
            style={{
              width: 1,
              height: 16,
              backgroundColor: "var(--border)",
              flexShrink: 0,
            }}
          />

          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={user.full_name}
            style={{
              all: "unset",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              cursor: "pointer",
              padding: "4px 10px 4px 4px",
              borderRadius: "8px",
              border: "1px solid transparent",
              transition: "border-color 120ms ease, background 120ms ease",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border)";
              (e.currentTarget as HTMLButtonElement).style.background = "var(--bg-hover)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = "transparent";
              (e.currentTarget as HTMLButtonElement).style.background = "transparent";
            }}
          >
            <Avatar user={user} size={30} />
            <span
              style={{
                fontSize: "0.875rem",
                fontWeight: 500,
                color: "var(--text-primary)",
              }}
            >
              {user.full_name}
            </span>
            {/* Role pill */}
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                fontSize: "0.75rem",
                fontWeight: 500,
                color: "var(--text-secondary)",
                backgroundColor: "var(--bg-selected, #F2F2F2)",
                border: "1px solid var(--border)",
                borderRadius: 9999,
                padding: "2px 9px",
                lineHeight: 1.6,
                flexShrink: 0,
              }}
            >
              {ROLE_LABEL[user.locale]?.[user.role] ?? user.role}
            </span>
            <span
              aria-hidden="true"
              style={{ fontSize: "0.625rem", color: "var(--text-secondary)", marginInlineStart: 1 }}
            >
              ▾
            </span>
          </button>

          {menuOpen && (
            <div
              role="menu"
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                ...(isRtl ? { left: 0 } : { right: 0 }),
                minWidth: "180px",
                backgroundColor: "var(--bg-card)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                padding: "4px 0",
                boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
                zIndex: 20,
              }}
            >
              <div
                style={{
                  padding: "8px 12px",
                  fontSize: "0.75rem",
                  color: "var(--text-secondary)",
                  borderBottom: "1px solid var(--border)",
                  wordBreak: "break-all",
                }}
              >
                {user.email}
              </div>
              <button
                type="button"
                role="menuitem"
                onClick={() => avatarInputRef.current?.click()}
                disabled={uploadingAvatar}
                style={{
                  all: "unset",
                  display: "block",
                  width: "100%",
                  padding: "8px 12px",
                  cursor: uploadingAvatar ? "not-allowed" : "pointer",
                  color: "var(--text-primary)",
                  fontSize: "0.8125rem",
                  boxSizing: "border-box",
                  textAlign: isRtl ? "right" : "left",
                }}
              >
                {uploadingAvatar ? "…" : CHANGE_AVATAR_LABEL[user.locale]}
              </button>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => handleSelfAvatar(e.target.files?.[0])}
              />
              <button
                type="button"
                role="menuitem"
                onClick={handleLogout}
                disabled={signingOut}
                style={{
                  all: "unset",
                  display: "block",
                  width: "100%",
                  padding: "8px 12px",
                  cursor: signingOut ? "not-allowed" : "pointer",
                  color: "var(--text-primary)",
                  fontSize: "0.8125rem",
                  boxSizing: "border-box",
                  textAlign: isRtl ? "right" : "left",
                }}
              >
                {LOGOUT_LABEL[user.locale]}
              </button>
            </div>
          )}
        </div>
      </header>
    </>
  );
}

export const Topbar = memo(TopbarInner);
