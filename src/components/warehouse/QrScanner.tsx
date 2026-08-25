"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ScanViewfinder } from "@/components/warehouse/mobile/ScanViewfinder";

interface Props {
  active: boolean;
  onScan: (value: string) => void;
  onClose: () => void;
  /** The code that just bound, shown as the mockup's success pill. */
  success?: string | null;
}

const READER_ID = "oms-qr-reader";

/**
 * The camera scanner.
 *
 * It used to render as a full-screen black modal over the page. On a phone
 * that covered the roll strip — which colour of sticker to reach for — and
 * that strip is the one thing the agent must read WHILE aiming. The frame
 * therefore sits inline in the page now; ScanViewfinder owns the chrome.
 */
export function QrScanner({ active, onScan, onClose, success = null }: Props) {
  const t = useTranslations("warehouse.scanner");
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const lastValueRef = useRef<{ value: string; at: number }>({ value: "", at: 0 });
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    type Scanner = {
      start: (
        src: { facingMode: "environment" | "user" },
        cfg: { fps: number; qrbox: { width: number; height: number } },
        ok: (text: string) => void,
        err: (m: string) => void
      ) => Promise<void>;
      stop: () => Promise<void>;
      clear: () => void;
    };
    let instance: Scanner | null = null;

    const handleScan = (text: string) => {
      const now = Date.now();
      if (lastValueRef.current.value === text && now - lastValueRef.current.at < 2000) {
        return;
      }
      lastValueRef.current = { value: text, at: now };
      onScanRef.current(text);
    };

    setStarting(true);
    setError(null);

    import("html5-qrcode")
      .then(({ Html5Qrcode }) => {
        if (cancelled) return;
        const el = document.getElementById(READER_ID);
        if (!el) {
          setError(t("initFailed"));
          setStarting(false);
          return;
        }
        instance = new Html5Qrcode(READER_ID) as unknown as Scanner;
        return instance
          .start(
            { facingMode: "environment" },
            { fps: 10, qrbox: { width: 240, height: 240 } },
            handleScan,
            () => {
              /* per-frame decode errors — ignore */
            }
          )
          .then(() => {
            if (cancelled && instance) {
              instance.stop().then(() => instance?.clear()).catch(() => {});
            }
            setStarting(false);
          })
          .catch((err: Error) => {
            setError(
              err.message.includes("Permission") || err.message.includes("NotAllowed")
                ? t("permissionDenied")
                : t("initFailed")
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
            /* stop can throw if already stopped — ignore */
          });
      }
    };
  }, [active, t]);

  if (!active) return null;

  return (
    <div>
      <ScanViewfinder
        readerId={READER_ID}
        starting={starting}
        error={error}
        success={success}
      />
      <button
        type="button"
        onClick={onClose}
        className="mt-2.5 inline-flex min-h-[48px] w-full items-center justify-center gap-2.5 rounded-pill border border-wm-accent px-5 text-[14px] font-bold text-wm-accent active:bg-wm-accent-soft"
      >
        {t("close")}
      </button>
    </div>
  );
}
