"use client";

import React, { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { decodeImageFile, type AvatarDecodeError } from "@/lib/client/image";

interface Props {
  /** Current image: a remote URL, a freshly-picked data URL, or null. */
  value: string | null;
  /** Emits the new data URL on pick, or null on remove. */
  onChange: (dataUrl: string | null) => void;
}

const MUTED = "#6D7175";
const BORDER = "#E1E3E5";
const LINK = "#2C6ECB";

const ERROR_KEY: Record<AvatarDecodeError, string> = {
  "not-image": "errors.notImage",
  "too-large": "errors.tooLarge",
  "decode-failed": "errors.decodeFailed",
};

export function ProductImagePicker({ value, onChange }: Props) {
  const t = useTranslations("products.image");
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  async function handlePick(file: File) {
    setError(null);
    const result = await decodeImageFile(file, 768);
    if (!result.ok) {
      setError(t(ERROR_KEY[result.error]));
      return;
    }
    onChange(result.dataUrl);
  }

  return (
    <div>
      <label
        style={{ fontSize: 13, color: MUTED, display: "block", marginBottom: 4, fontWeight: 500 }}
      >
        {t("label")}
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value}
            alt=""
            style={{ height: 56, width: 56, objectFit: "cover", borderRadius: 4, border: `1px solid ${BORDER}` }}
          />
        ) : (
          <div
            style={{
              height: 56,
              width: 56,
              borderRadius: 4,
              border: `1px dashed ${BORDER}`,
              background: "#F6F6F7",
            }}
          />
        )}
        <label style={{ fontSize: 13, color: LINK, cursor: "pointer" }}>
          {value ? t("change") : t("add")}
          <input
            ref={inputRef}
            data-testid="product-image-input"
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handlePick(f);
            }}
          />
        </label>
        {value && (
          <button
            type="button"
            onClick={() => {
              onChange(null);
              if (inputRef.current) inputRef.current.value = "";
            }}
            style={{ background: "none", border: "none", color: MUTED, fontSize: 13, cursor: "pointer", padding: 0 }}
          >
            {t("remove")}
          </button>
        )}
      </div>
      {error && <p style={{ color: "#D72C0D", fontSize: 13, marginTop: 6 }}>{error}</p>}
    </div>
  );
}
