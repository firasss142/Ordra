"use client";

// The edit page's form vocabulary (the prototype's field(), group(), photo
// block and save bar), shared by /products/[id]/edit and /products/new so the
// two pages cannot drift apart.

import { useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Image as ImageIcon } from "lucide-react";
import { decodeImageFile, type AvatarDecodeError } from "@/lib/client/image";
import { Thumb } from "./atoms";

/** A decimal typed the French way or not: "0,5" and "0.5" are the same. */
export function num(v: string): number {
  const x = parseFloat(String(v).replace(",", "."));
  return Number.isFinite(x) ? x : 0;
}

/** A non-negative decimal, or empty when allowed. */
export function validAmount(v: string, allowEmpty: boolean): boolean {
  if (v.trim() === "") return allowEmpty;
  const x = Number(v.replace(",", "."));
  return Number.isFinite(x) && x >= 0;
}

/** A non-negative whole number. */
export function validCount(v: string): boolean {
  return /^\d+$/.test(v.trim());
}

export function Group({ title, sub, children }: { title: string; sub?: string | null; children: ReactNode }) {
  return (
    <div className="fg">
      <div>
        <div className="gt">{title}</div>
        {sub ? <div className="gs">{sub}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function Field({
  id,
  label,
  required,
  error,
  hint,
  after,
  children,
}: {
  id?: string;
  label: string;
  required?: boolean;
  error?: string | null;
  hint?: string;
  after?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required ? <span className="req"> *</span> : null}
      </label>
      {children}
      {error ? <div className="errmsg">{error}</div> : null}
      {after}
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

/** An input with its currency (or unit) inside, at the end. */
export function Unit({ unit, children }: { unit?: string; children: ReactNode }) {
  if (!unit) return <>{children}</>;
  return (
    <div className="unit">
      {children}
      <span className="u">{unit}</span>
    </div>
  );
}

const IMAGE_ERROR: Record<AvatarDecodeError, string> = {
  "not-image": "errors.notImage",
  "too-large": "errors.tooLarge",
  "decode-failed": "errors.decodeFailed",
};

/**
 * Photo picker: decodes and downsizes in the browser (768px), hands the data URL
 * up, never uploads — the page uploads when it saves. `uploadError` is the
 * page's own failure, shown in the same place.
 */
export function PhotoField({
  image,
  name,
  onChange,
  uploadError,
}: {
  image: string | null;
  name: string;
  onChange: (dataUrl: string | null) => void;
  uploadError?: string | null;
}) {
  const t = useTranslations("products.v6");
  const tImage = useTranslations("products.image");
  const fileRef = useRef<HTMLInputElement>(null);
  const [decodeError, setDecodeError] = useState<string | null>(null);

  async function pick(file: File) {
    setDecodeError(null);
    const result = await decodeImageFile(file, 768);
    if (!result.ok) {
      setDecodeError(tImage(IMAGE_ERROR[result.error]));
      return;
    }
    onChange(result.dataUrl);
  }

  const error = decodeError ?? uploadError ?? null;
  return (
    <div className="field">
      <label>{t("f_photo")}</label>
      <div className="photo">
        <Thumb src={image} name={name} size={72} radius={14} />
        <div className="acts">
          <button type="button" className="btn sm" onClick={() => fileRef.current?.click()}>
            <ImageIcon className="ic" aria-hidden />
            {image ? t("f_replace") : t("n_pick")}
          </button>
          {image ? (
            <button type="button" className="btn sm" onClick={() => onChange(null)}>
              {t("f_remove")}
            </button>
          ) : null}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void pick(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>
      {error ? <div className="errmsg">{error}</div> : null}
      <div className="hint">{t("f_photo_h")}</div>
    </div>
  );
}

/** The floating dark bar at the bottom of the screen while there is something to save. */
export function SaveBar({ children }: { children: ReactNode }) {
  return (
    <div className="savebar" role="region" aria-label="save">
      {children}
    </div>
  );
}
