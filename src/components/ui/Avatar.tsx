"use client";

import { useEffect, useState } from "react";
import { initialsOf } from "@/lib/user";

interface AvatarProps {
  user: {
    full_name?: string | null;
    email?: string | null;
    avatar_url?: string | null;
  };
  size?: number;
  title?: string;
}

export function Avatar({ user, size = 28, title }: AvatarProps) {
  const [errored, setErrored] = useState(false);
  useEffect(() => {
    setErrored(false);
  }, [user.avatar_url]);
  const initials = initialsOf(user);
  const hasImage = !!user.avatar_url && !errored;
  const fontSize = Math.max(10, Math.round(size * 0.38));

  return (
    <span
      aria-hidden="true"
      title={title ?? user.full_name ?? undefined}
      style={{
        width: size,
        height: size,
        borderRadius: "9999px",
        backgroundColor: "var(--bg-selected, #E1E3E5)",
        color: "var(--text-primary, #1A1A1A)",
        fontSize,
        fontWeight: 600,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        textTransform: "uppercase",
        overflow: "hidden",
      }}
    >
      {hasImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={user.avatar_url as string}
          alt=""
          width={size}
          height={size}
          style={{ width: size, height: size, objectFit: "cover", display: "block" }}
          onError={() => setErrored(true)}
        />
      ) : (
        initials
      )}
    </span>
  );
}
