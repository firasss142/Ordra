"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ScanBarcode } from "lucide-react";

/**
 * The scan button.
 *
 * Scanning is the one thing a warehouse agent does continuously, so it does
 * not share a quarter of the tab bar with four other destinations. It floats
 * in the corner a thumb reaches without regripping the phone — the "Quick
 * Scan" affordance from the mockups.
 *
 * It hides on the scan screen itself: a button that navigates to where you
 * already are is noise, and at 390px it would sit on top of the viewfinder.
 */
export function ScanFab({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  if (pathname === href || pathname.startsWith(href + "/")) return null;

  return (
    <Link
      href={href}
      prefetch
      data-testid="wh-scan-fab"
      aria-label={label}
      className={[
        // 56px bar + the home indicator + 16px of air.
        "fixed bottom-[calc(56px+env(safe-area-inset-bottom,0px)+16px)] end-4 z-50",
        "inline-flex min-h-[52px] items-center gap-2.5 rounded-pill",
        "bg-wm-accent px-5 text-[14px] font-bold text-white no-underline",
        "shadow-[0_6px_20px_rgba(20,122,71,.38)] transition-transform active:scale-[0.97]",
      ].join(" ")}
    >
      <ScanBarcode size={20} strokeWidth={2} aria-hidden="true" />
      <span>{label}</span>
    </Link>
  );
}
