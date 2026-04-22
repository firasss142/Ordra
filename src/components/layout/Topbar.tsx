"use client";

import { memo, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "@/components/ui/Avatar";
import { decodeAvatarFile, avatarErrorMessage } from "@/lib/client/image";
import type { AuthUser } from "@/types";

interface TopbarProps {
  user: AuthUser;
  marketName: string;
  actions?: React.ReactNode;
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

function TopbarInner({ user, marketName, actions }: TopbarProps) {
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
        style={{
          height: "56px",
          backgroundColor: "var(--bg-card)",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px",
          direction: isRtl ? "rtl" : "ltr",
        }}
      >
        <span
          style={{
            fontSize: "0.8125rem",
            color: "var(--text-secondary)",
          }}
        >
          {marketName}
        </span>

        <div
          ref={menuRef}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            position: "relative",
          }}
        >
          {actions}
          <span
            style={{
              fontSize: "0.75rem",
              color: "var(--text-secondary)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            {user.role}
          </span>
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
              fontSize: "0.875rem",
              fontWeight: 500,
              color: "var(--text-primary)",
              padding: "4px 8px 4px 4px",
              borderRadius: "6px",
            }}
          >
            <Avatar user={user} size={28} />
            <span>{user.full_name}</span>
            <span
              aria-hidden="true"
              style={{ fontSize: "0.625rem", color: "var(--text-secondary)" }}
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
                borderRadius: "6px",
                padding: "4px 0",
                boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
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
                  fontSize: "0.875rem",
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
                  fontSize: "0.875rem",
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
