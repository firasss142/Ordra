"use client";

import { useId, useRef } from "react";
import { useTranslations } from "next-intl";
import { Camera } from "lucide-react";
import { useQrCamera } from "./useQrCamera";
import { LASER, useMotion } from "./motion";

/**
 * The viewfinder (`.viewfinder`): 208px of dark glass, four 34px corners and a
 * laser in the ROLL's colour, so the agent aims inside the colour they must
 * peel from. White when no roll applies (the lookup sheet).
 *
 * The real camera runs inside it: a tap opens it (or it opens by itself when
 * the device is set to "camera first"), and the video fills the frame under
 * the corners.
 */

const CORNERS = [
  "top-[22px] start-[22px] border-e-0 border-b-0 rounded-ss-[10px]",
  "top-[22px] end-[22px] border-s-0 border-b-0 rounded-se-[10px]",
  "bottom-[22px] start-[22px] border-e-0 border-t-0 rounded-es-[10px]",
  "bottom-[22px] end-[22px] border-s-0 border-t-0 rounded-ee-[10px]",
];

export function RunViewfinder({
  hex,
  camera,
  onToggle,
  onScan,
  busyLabel = null,
  className = "mt-[14px]",
  testId = "wh-run-viewfinder",
}: {
  hex: string | null;
  camera: boolean;
  onToggle: () => void;
  onScan: (text: string) => void;
  /** Shown over the glass while a bind is in flight. */
  busyLabel?: string | null;
  className?: string;
  testId?: string;
}) {
  const t = useTranslations("warehouse.run");
  const ts = useTranslations("warehouse.scan");
  const readerId = `wh-cam-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const { starting, error } = useQrCamera({ readerId, active: camera && !busyLabel, onScan });
  const laser = useRef<HTMLSpanElement>(null);
  useMotion(laser, ...LASER, hex ?? "white");
  const colour = hex ?? "#fff";

  const label = busyLabel ?? (camera ? (starting ? ts("starting") : error) : null);

  return (
    <button
      type="button"
      data-testid={testId}
      data-frame={hex ?? ""}
      aria-pressed={camera}
      aria-label={camera ? ts("cameraStop") : t("tapCam")}
      onClick={onToggle}
      disabled={!!busyLabel}
      className={`relative grid h-[208px] w-full place-items-center overflow-hidden rounded-[16px] bg-[#1C1F22] text-[#C9CCCF] ${className}`}
    >
      {camera ? (
        <div
          id={readerId}
          aria-hidden="true"
          className="absolute inset-0 [&_video]:h-full [&_video]:w-full [&_video]:object-cover"
        />
      ) : null}
      {CORNERS.map((pos) => (
        <span
          key={pos}
          aria-hidden="true"
          className={`pointer-events-none absolute h-[34px] w-[34px] border-[4px] ${pos}`}
          style={{ borderColor: colour }}
        />
      ))}
      <span
        ref={laser}
        aria-hidden="true"
        className="pointer-events-none absolute end-[40px] start-[40px] h-[2px] opacity-[.85]"
        style={{ background: colour, top: 46 }}
      />
      {label ? (
        <span role="status" className="relative z-[1] rounded-[8px] bg-[rgba(28,31,34,.7)] px-[10px] py-[4px] text-[12.5px] font-semibold text-white">
          {label}
        </span>
      ) : !camera ? (
        <span className="relative flex items-center gap-[8px] text-[12.5px]">
          <Camera size={18} strokeWidth={2} aria-hidden="true" />
          {t("tapCam")}
        </span>
      ) : null}
    </button>
  );
}
