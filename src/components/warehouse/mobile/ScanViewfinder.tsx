"use client";

import { useTranslations } from "next-intl";
import { Check } from "lucide-react";

/**
 * The camera frame (mockup 02).
 *
 * Presentational only — html5-qrcode attaches its <video> to `readerId`. It is
 * split out from QrScanner so the chrome can be tested without a camera, and
 * so the frame can sit INSIDE the page rather than as a full-screen modal:
 * the modal hid the roll strip, which is the one thing the agent needs next to
 * the picture.
 */

const CORNER = "absolute h-7 w-7 border-white/90";
const CORNERS = [
  { pos: "start-3.5 top-3.5", edge: "border-s-[3px] border-t-[3px] rounded-ss-[10px]" },
  { pos: "end-3.5 top-3.5", edge: "border-e-[3px] border-t-[3px] rounded-se-[10px]" },
  { pos: "start-3.5 bottom-3.5", edge: "border-s-[3px] border-b-[3px] rounded-es-[10px]" },
  { pos: "end-3.5 bottom-3.5", edge: "border-e-[3px] border-b-[3px] rounded-ee-[10px]" },
];

export function ScanViewfinder({
  readerId,
  starting = false,
  error = null,
  success = null,
  children,
}: {
  /** Mount point id for the scanner library's video element. */
  readerId?: string;
  starting?: boolean;
  error?: string | null;
  /** The code that just bound. Drives the mockup's "Scan Successful" pill. */
  success?: string | null;
  children?: React.ReactNode;
}) {
  const t = useTranslations("warehouse.scan");

  return (
    <div
      data-testid="wm-viewfinder"
      // 6:5 — the frame in mockup 02 is ~405x340. (It holds a photograph, so
      // it cannot be found by scanning for a dark rectangle; measured by eye
      // off the PNG.) At 4:5 the frame alone filled two thirds of a 390px
      // screen and pushed the sticker field below the fold.
      className="relative aspect-[6/5] w-full overflow-hidden rounded-[12px] bg-wm-viewfinder"
    >
      {readerId ? <div id={readerId} className="h-full w-full [&_video]:h-full [&_video]:w-full [&_video]:object-cover" /> : null}

      {/* Rule-of-thirds hairlines, as in the mockup. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-40">
        <span className="absolute inset-y-0 start-1/3 w-px bg-white/60" />
        <span className="absolute inset-y-0 start-2/3 w-px bg-white/60" />
        <span className="absolute inset-x-0 top-1/3 h-px bg-white/60" />
        <span className="absolute inset-x-0 top-2/3 h-px bg-white/60" />
      </div>

      {CORNERS.map((c) => (
        <span
          key={c.pos}
          data-corner=""
          aria-hidden="true"
          className={`${CORNER} ${c.pos} ${c.edge}`}
        />
      ))}

      {starting ? (
        <p className="absolute inset-0 grid place-items-center text-[13px] font-semibold text-white/80">
          {t("starting")}
        </p>
      ) : null}

      {success ? (
        <p
          data-testid="wm-scan-success"
          role="status"
          className="absolute inset-x-0 top-5 mx-auto flex w-max items-center gap-2 rounded-pill bg-wm-accent px-4 py-2 text-[13px] font-bold text-white shadow-lg"
        >
          <Check size={16} aria-hidden="true" />
          {/* Short on purpose. The result tile below already spells out what
              bound and what the stock did; repeating that here put the same
              sentence on screen twice. */}
          {t("scanSuccess")} · {success}
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="absolute inset-x-4 bottom-4 rounded-[10px] bg-wh-bad px-3 py-2 text-center text-[12.5px] font-semibold text-white"
        >
          {error}
        </p>
      ) : null}

      {children}
    </div>
  );
}
