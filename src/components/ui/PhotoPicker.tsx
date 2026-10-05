"use client";

import { useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Camera, Loader2 } from "lucide-react";
import { decodeImageFile, type AvatarDecodeError } from "@/lib/client/image";

/**
 * Makes any avatar or logo visual editable: the visual itself becomes the
 * button (with a camera badge on its corner), and beside it « Ajouter /
 * Changer » and « Retirer ». The image is downscaled in the browser before it
 * leaves, so `onChange` receives a small data URL — or `null` to remove.
 *
 * The caller owns the network call and the visual; this owns the file input,
 * the busy state and the error line.
 */
export function PhotoPicker({
  hasPhoto,
  onChange,
  children,
  kind = "photo",
  shape = "circle",
  readOnly = false,
  stacked = false,
  compact = false,
}: {
  hasPhoto: boolean;
  onChange: (dataUrl: string | null) => Promise<void>;
  /** The avatar / logo as it is shown today. */
  children: ReactNode;
  kind?: "photo" | "logo";
  shape?: "circle" | "tile";
  /** Show the visual only — for someone who may look but not change. */
  readOnly?: boolean;
  /** Actions under the visual instead of beside it. */
  stacked?: boolean;
  /** The visual alone is the control (tight spots, the phone): no text links. */
  compact?: boolean;
}) {
  const t = useTranslations("photo");
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AvatarDecodeError | "failed" | null>(null);

  if (readOnly) return <>{children}</>;

  const changeLabel = kind === "logo" ? t("changeLogo") : t("change");
  const addLabel = kind === "logo" ? t("addLogo") : t("add");

  async function send(value: string | null) {
    setBusy(true);
    try {
      await onChange(value);
    } catch {
      setError("failed");
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File | undefined) {
    if (input.current) input.current.value = "";
    if (!file || busy) return;
    setError(null);
    const decoded = await decodeImageFile(file, 512);
    if (!decoded.ok) {
      setError(decoded.error);
      return;
    }
    await send(decoded.dataUrl);
  }

  const round = shape === "circle" ? "rounded-full" : "rounded-[10px]";

  return (
    <div
      className={
        stacked || compact
          ? "flex flex-col items-start gap-[10px]"
          : "flex items-center gap-[14px]"
      }
    >
      <button
        type="button"
        aria-label={hasPhoto ? changeLabel : addLabel}
        disabled={busy}
        onClick={() => input.current?.click()}
        className={`group relative inline-flex flex-none ${round} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-wait`}
      >
        {children}
        {busy && (
          <span
            aria-hidden="true"
            className={`absolute inset-0 grid place-items-center bg-white/70 ${round}`}
          >
            <Loader2 size={18} className="animate-spin text-[#4F555B]" />
          </span>
        )}
        <span
          aria-hidden="true"
          className="absolute bottom-[-2px] end-[-2px] grid h-[22px] w-[22px] place-items-center rounded-full bg-white text-[#4F555B] shadow-[0_0_0_1px_#E3E5E8] transition-colors group-hover:bg-[#15803D] group-hover:text-white"
        >
          <Camera size={12} strokeWidth={2.2} />
        </span>
      </button>

      {compact ? (
        error && (
          <p
            role="alert"
            className="m-0 text-[12px] font-medium text-[#C0362C]"
          >
            {t(`errors.${error}`)}
          </p>
        )
      ) : (
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[4px]">
            <button
              type="button"
              disabled={busy}
              onClick={() => input.current?.click()}
              className="text-[13px] font-semibold text-[#15803D] hover:underline disabled:opacity-50"
            >
              {busy ? t("saving") : hasPhoto ? changeLabel : addLabel}
            </button>
            {hasPhoto && !busy && (
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  void send(null);
                }}
                className="text-[13px] font-semibold text-[#656B72] hover:text-[#C0362C] hover:underline"
              >
                {t("remove")}
              </button>
            )}
          </div>
          {error ? (
            <p
              role="alert"
              className="m-0 mt-[3px] text-[12px] font-medium text-[#C0362C]"
            >
              {t(`errors.${error}`)}
            </p>
          ) : (
            <p className="m-0 mt-[3px] text-[12px] text-[#656B72]">
              {t("hint")}
            </p>
          )}
        </div>
      )}

      <input
        ref={input}
        data-testid="photo-input"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
    </div>
  );
}
