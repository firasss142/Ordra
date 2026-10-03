"use client";

import Link from "next/link";
import { ScanBarcode } from "lucide-react";

/**
 * The scan action, centred in the agent's bottom bar.
 *
 * Scanning is what a warehouse agent does all day, so it is not a tab among
 * four: it is the one filled green on the screen, raised out of the bar under
 * the thumb. It used to float over the content (ScanFab), where at 390px it
 * covered the last card of every list.
 *
 * It opens the bench's scan sheet: with a parcel in hand it binds the sticker;
 * with nothing in hand it looks the sticker up and says what it is.
 */
export function ScanButton({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      prefetch
      aria-label={label}
      className="flex flex-col items-center gap-1 no-underline"
    >
      <span
        aria-hidden="true"
        className={[
          "-mt-7 grid h-[60px] w-[60px] place-items-center rounded-full bg-wm-accent text-white",
          // The ring is the bar's own ground, so the button reads as lifted out
          // of it; the shadow is the floating one the design system allows.
          "shadow-[0_0_0_5px_var(--wm-ground),0_8px_24px_rgba(16,24,40,.12)] transition-transform active:scale-95",
        ].join(" ")}
      >
        <ScanBarcode size={25} strokeWidth={2.1} />
      </span>
      <span className="text-[10.5px] font-bold text-wm-accent-deep">{label}</span>
    </Link>
  );
}
