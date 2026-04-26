"use client";

import { memo, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Menu } from "lucide-react";
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
  /** When provided, renders a hamburger button on mobile that calls this. */
  onMenuClick?: () => void;
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

function TopbarInner({ user, marketName, actions, onMenuClick }: TopbarProps) {
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
