import { Package } from "lucide-react";

/**
 * Small pieces « Rentrer » draws on the phone and on the desk alike.
 * Sizes are the prototype's px (root font is 14px, so rem classes would shrink).
 */

const HOUR = 3_600_000;

/** Whole hours since `iso`; 0 for a missing or future date. */
export function hoursSince(iso: string | null | undefined, now = Date.now()): number {
  if (!iso) return 0;
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / HOUR));
}

/** The prototype's `age()`: now, hours under a day, then rounded days. */
export function ageParts(hours: number): { unit: "now" | "hours" | "days"; n: number } {
  if (hours === 0) return { unit: "now", n: 0 };
  if (hours < 24) return { unit: "hours", n: hours };
  return { unit: "days", n: Math.round(hours / 24) };
}

/** More than two days at Darb is worth a look (the prototype's warn chip). */
export function isLate(hours: number): boolean {
  return ageParts(hours).unit === "days" && ageParts(hours).n > 2;
}

/** The customer's first name — the prototype shows « Souad », not a full name. */
export function firstName(full: string | null | undefined): string {
  return (full ?? "").trim().split(/\s+/)[0] ?? "";
}

/** What is printed on the parcel: Darb's reference, else our sticker. */
export function parcelRef(o: { tracking_number: string | null; carrier_sticker_ref: string | null; id: string }): string {
  return o.tracking_number ?? o.carrier_sticker_ref ?? o.id.slice(0, 8).toUpperCase();
}

/** Product thumb in the job's tint: its picture when it has one, else a parcel. */
export function Thumb({ src, size, icon }: { src?: string | null; size: number; icon: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={`grid shrink-0 place-items-center overflow-hidden bg-job-bg text-job-ink ${size >= 40 ? "rounded-[10px]" : "rounded-[9px]"}`}
    >
      {src ? (
        // Raw <img>: the project configures no images.remotePatterns.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <Package size={icon} strokeWidth={2} />
      )}
    </span>
  );
}

const CHIP_TONE = {
  // #7A5B00 is the prototype's --warning-ink; Ordra has no token for it yet.
  warn: { chip: "bg-status-warningBg text-[#7A5B00]", dot: "bg-status-warning" },
  mute: { chip: "bg-wm-track text-wh-ink-2", dot: "bg-ink-muted" },
  ok: { chip: "bg-status-successBg text-status-success", dot: "bg-status-success" },
  bad: { chip: "bg-status-criticalBg text-status-critical", dot: "bg-status-critical" },
} as const;

/**
 * The prototype's `.chip` — a pill with a dot. The phone's is 3px tall of
 * padding, the desk's 2px (`dense`).
 */
export function AgeChip({
  tone,
  dense = false,
  children,
}: {
  tone: keyof typeof CHIP_TONE;
  dense?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      data-tone={tone}
      className={`inline-flex shrink-0 items-center gap-[6px] whitespace-nowrap rounded-pill px-[9px] text-[12px] font-semibold ${
        dense ? "py-[2px]" : "py-[3px]"
      } ${CHIP_TONE[tone].chip}`}
    >
      <i aria-hidden="true" className={`h-[6px] w-[6px] shrink-0 rounded-full ${CHIP_TONE[tone].dot}`} />
      {children}
    </span>
  );
}
