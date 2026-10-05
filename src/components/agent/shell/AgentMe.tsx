"use client";

// « me » (prototype `.me` + its menu): the photo, the name and « Agent · Libye »; the menu carries
// the e-mail, « Changer la photo » and « Déconnexion ». The upload and logout are the old Topbar's.

import { useCallback, useRef, useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { decodeAvatarFile, avatarErrorMessage } from "@/lib/client/image";
import { agentHex } from "@/components/orders/commandes/ui";
import { Ic } from "@/components/agent/shared";
import { useOutside } from "./useOutside";
import type { AuthUser } from "@/types";

export function AgentFace({ user, className = "av" }: { user: AuthUser; className?: string }) {
  if (user.avatar_url) return <img className={className} src={user.avatar_url} alt="" />;
  return (
    <span className={className} style={{ "--h": agentHex(user.id) } as CSSProperties}>
      {(user.full_name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

export function AgentMe({ user, marketWord, variant = "desk" }: { user: AuthUser; marketWord: string; variant?: "desk" | "phone" }) {
  const t = useTranslations("agent");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useOutside(ref, open, close);

  async function upload(f: File | undefined) {
    if (!f || busy) return;
    setBusy(true);
    try {
      const decoded = await decodeAvatarFile(f);
      if (!decoded.ok) {
        console.error("[AgentMe] avatar decode failed:", avatarErrorMessage(decoded.error));
        return;
      }
      const res = await fetch("/api/me/avatar", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatar: decoded.dataUrl }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }

  async function logout() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* network failure — still leave */
    }
    router.replace(`/${user.locale}/login`);
  }

  const first = user.full_name.trim().split(/\s+/)[0] || user.full_name;
  return (
    <div className="fbw" ref={ref}>
      <button type="button" className={variant === "phone" ? "me" : "me"} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} style={variant === "phone" ? { padding: 0 } : undefined}>
        <AgentFace user={user} className={variant === "phone" ? "av mav" : "av"} />
        {variant === "desk" ? (
          <span>
            {first}
            <small>{t("role", { market: marketWord })}</small>
          </span>
        ) : (
          <span className="sr-only">{first}</span>
        )}
      </button>
      {open ? (
        <div className="menu end" role="menu">
          <div className="mehead">
            <b>{user.full_name}</b>
            <small>{user.email}</small>
          </div>
          <div className="msep" />
          <button type="button" role="menuitem" className="mi act" onClick={() => file.current?.click()} disabled={busy}>
            <Ic n="user" />
            <span className="ml">{t("me.changePhoto")}</span>
          </button>
          <button type="button" role="menuitem" className="mi act neg" onClick={logout} disabled={busy}>
            <Ic n="ext" className="flip" />
            <span className="ml">{t("me.logout")}</span>
          </button>
          <input ref={file} type="file" accept="image/*" hidden onChange={(e) => void upload(e.target.files?.[0])} />
        </div>
      ) : null}
    </div>
  );
}
