"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { LucideIcon } from "lucide-react";

interface NavItemProps {
  href: string;
  label: string;
  icon: LucideIcon;
  currentPath: string;
  badge?: number;
  /** Called once per mount on first hover — used to warm SWR data caches. */
  onPrefetch?: () => void;
}

export function NavItem({
  href,
  label,
  icon: Icon,
  currentPath,
  badge,
  onPrefetch,
}: NavItemProps) {
  const isActive = currentPath === href || currentPath.startsWith(href + "/");
  const [hovered, setHovered] = useState(false);
  const router = useRouter();
  const prefetchedRef = useRef(false);

  const handleMouseEnter = () => {
    setHovered(true);
    if (!prefetchedRef.current) {
      prefetchedRef.current = true;
      router.prefetch(href);
      onPrefetch?.();
    }
  };

  const iconColor = isActive
    ? "#FFFFFF"
    : hovered
      ? "var(--sidebar-text)"
      : "var(--sidebar-text-muted)";

  const background = isActive
    ? "var(--sidebar-active)"
    : hovered
      ? "var(--sidebar-hover)"
      : "transparent";

  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setHovered(false)}
      onFocus={handleMouseEnter}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        height: "36px",
        paddingInlineStart: "14px",
        paddingInlineEnd: "16px",
        fontSize: "0.875rem",
        fontWeight: isActive ? 500 : 400,
        color: "var(--sidebar-text)",
        textDecoration: "none",
        backgroundColor: background,
        borderInlineStart: isActive
          ? "2px solid #FFFFFF"
          : "2px solid transparent",
        transition: "background-color 120ms ease, color 120ms ease",
      }}
    >
      <Icon
        size={16}
        strokeWidth={1.5}
        aria-hidden="true"
        style={{
          color: iconColor,
          flexShrink: 0,
          transition: "color 120ms ease",
        }}
      />
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      {badge !== undefined && (
        <span
          style={{
            backgroundColor: "var(--neutral-bg)",
            color: "var(--neutral)",
            fontSize: "0.75rem",
            fontWeight: 500,
            padding: "2px 8px",
            borderRadius: "9999px",
            minWidth: "20px",
            textAlign: "center",
            flexShrink: 0,
          }}
        >
          {badge}
        </span>
      )}
    </Link>
  );
}
