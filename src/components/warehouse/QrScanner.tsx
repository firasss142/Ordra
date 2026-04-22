"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

interface Props {
  active: boolean;
  onScan: (value: string) => void;
  onClose: () => void;
}

const READER_ID = "oms-qr-reader";

export function QrScanner({ active, onScan, onClose }: Props) {
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
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.85)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        padding: 16,
      }}
      role="dialog"
      aria-modal="true"
      aria-label={t("dialogLabel")}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 480,
          backgroundColor: "#000",
          borderRadius: 8,
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div id={READER_ID} style={{ width: "100%" }} />
        {starting && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#FFFFFF",
              fontSize: 14,
            }}
          >
            {t("starting")}
          </div>
        )}
      </div>

      {error && (
        <div
          role="alert"
          style={{
            marginTop: 16,
            padding: "10px 14px",
            backgroundColor: "#FEF2F2",
            border: "1px solid #FECACA",
            borderRadius: 6,
            color: "#DC2626",
            fontSize: 13,
            maxWidth: 480,
            width: "100%",
            textAlign: "center",
          }}
        >
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={onClose}
        style={{
          marginTop: 16,
          padding: "12px 24px",
          backgroundColor: "#FFFFFF",
          color: "#1A1A1A",
          border: "none",
          borderRadius: 6,
          fontSize: 14,
          fontWeight: 600,
          cursor: "pointer",
          minWidth: 160,
        }}
      >
        {t("close")}
      </button>
    </div>
  );
}
