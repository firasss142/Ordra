"use client";

import Link from "next/link";
import { ScanLine } from "lucide-react";

/**
 * The scan action, centred in the agent's bottom bar — prototype `.scanbtn`.
 *
 * Scanning is what a warehouse agent does all day, so it is not a tab among
 * four: it is the one filled green on the screen, a 64px circle raised out of
 * the bar (−26px) under the thumb, ringed in the page's own ground so it reads
 * as lifted, with « Scanner » under it. It used to float over the content
 * (ScanFab), where at 390px it covered the last card of every list.
 *
 * It opens the bench's scan sheet: with a parcel in hand it binds the sticker;
 * with nothing in hand it looks the sticker up and says what it is.
 */
export function ScanButton({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} prefetch aria-label={label} className="flex flex-col items-center no-underline">
      <span
        aria-hidden="true"
        className="-mt-[26px] grid h-[64px] w-[64px] place-items-center rounded-full border-[4px] border-wm-ground bg-brand text-white shadow-[0_8px_24px_rgba(16,24,40,.10)] transition-transform duration-fast active:scale-[.94]"
      >
        <ScanLine size={26} strokeWidth={2.2} />
      </span>
      <span className="mt-[2px] text-[11.5px] font-bold text-brand-hover">{label}</span>
    </Link>
  );
}
