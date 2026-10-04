"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronsUpDown, LogOut, UserRound } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import type { AuthUser } from "@/types";

/**
 * The person at the foot of the bar, and their menu: Mon profil (/profile had
 * no link anywhere) and Déconnexion. In the rail the avatar alone stands in,
 * and the menu opens beside it.
 */
export function SidebarUserMenu({ user, variant }: { user: AuthUser; variant: "full" | "rail" }) {
  const t = useTranslations("nav");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const logout = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Network failure — still leave, so no stale screen stays up.
    }
    router.replace(`/${user.locale}/login`);
  };

  const role = t(`roles.${user.role}`);

  return (
    <div ref={ref} className={variant === "rail" ? "sb-me-wrap sb-me-wrap-rail" : "sb-me-wrap"}>
      {variant === "rail" ? (
        <button type="button" className="sb-rbtn" aria-label={user.full_name} title={user.full_name}
          aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <Avatar user={user} size={30} />
        </button>
      ) : (
        <button type="button" className="sb-me" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <Avatar user={user} size={30} />
          <span className="sb-me-who">
            <span className="sb-me-name">{user.full_name}</span>
            <span className="sb-me-role">{role}</span>
          </span>
          <ChevronsUpDown size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}
      {open && (
        <div className={variant === "rail" ? "sb-menu sb-me-menu sb-me-menu-side" : "sb-menu sb-me-menu"} role="menu">
          <div className="sb-me-head">
            <b>{user.full_name}</b>
            <span dir="ltr">{user.email}</span>
          </div>
          <Link href={`/${user.locale}/profile`} role="menuitem" className="sb-menu-item" onClick={() => setOpen(false)}>
            <UserRound size={16} strokeWidth={1.75} aria-hidden="true" />
            {t("profile")}
          </Link>
          <button type="button" role="menuitem" className="sb-menu-item" onClick={logout} disabled={signingOut}>
            <LogOut size={16} strokeWidth={1.75} aria-hidden="true" className="sb-flip" />
            {t("logout")}
          </button>
        </div>
      )}
    </div>
  );
}
