"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

/**
 * The phone camera, decoding into a frame the caller draws.
 *
 * `QrScanner` brings its own frame (6:5, white hairlines, a close button
 * underneath); the run's viewfinder is the prototype's — 208px, the roll's
 * colour on the corners and the laser — so the camera is mounted INSIDE it
 * instead. Same library, same start/stop discipline and the same 2-second
 * de-duplication of a sticker held in front of the lens.
 */

type Scanner = {
  start: (
    src: { facingMode: "environment" | "user" },
    cfg: { fps: number; qrbox: { width: number; height: number } },
    ok: (text: string) => void,
    err: (m: string) => void,
  ) => Promise<void>;
  stop: () => Promise<void>;
  clear: () => void;
};

export function useQrCamera({
  readerId,
  active,
  onScan,
}: {
  /** The element html5-qrcode attaches its <video> to. */
  readerId: string;
  active: boolean;
  onScan: (text: string) => void;
}) {
  const t = useTranslations("warehouse.scanner");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const last = useRef<{ value: string; at: number }>({ value: "", at: 0 });

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let instance: Scanner | null = null;

    const handle = (text: string) => {
      const now = Date.now();
      if (last.current.value === text && now - last.current.at < 2000) return;
      last.current = { value: text, at: now };
      onScanRef.current(text);
    };

    setStarting(true);
    setError(null);
    import("html5-qrcode")
      .then(({ Html5Qrcode }) => {
        if (cancelled) return;
        if (!document.getElementById(readerId)) {
          setError(t("initFailed"));
          setStarting(false);
          return;
        }
        instance = new Html5Qrcode(readerId) as unknown as Scanner;
        return instance
          .start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 240, height: 160 } }, handle, () => {
            /* per-frame decode misses — ignore */
          })
          .then(() => {
            if (cancelled && instance) instance.stop().then(() => instance?.clear()).catch(() => {});
            setStarting(false);
          })
          .catch((err: Error) => {
            setError(
              err.message.includes("Permission") || err.message.includes("NotAllowed")
                ? t("permissionDenied")
                : t("initFailed"),
            );
            setStarting(false);
          });
      })
      .catch(() => {
        if (!cancelled) {
          setError(t("initFailed"));
          setStarting(false);
        }
      });

    return () => {
      cancelled = true;
      if (instance) {
        instance
          .stop()
          .then(() => instance?.clear())
          .catch(() => {
            /* already stopped */
          });
      }
    };
  }, [active, readerId, t]);

  return { starting: active && starting, error: active ? error : null };
}
