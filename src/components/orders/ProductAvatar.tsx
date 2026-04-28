"use client";

import { useState } from "react";

interface Props {
  imageUrl: string | null;
  productName: string;
  size?: number;
}

export function ProductAvatar({ imageUrl, productName, size = 40 }: Props) {
  const [errored, setErrored] = useState(false);
  const initial = productName.trim()[0]?.toUpperCase() ?? "?";

  const baseClass =
    "flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-line-subtle bg-surface-page";

  if (imageUrl && !errored) {
    return (
      <span
        className={baseClass}
        style={{ width: size, height: size }}
      >
        <img
          src={imageUrl}
          alt={productName}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          onError={() => setErrored(true)}
          className="h-full w-full object-cover"
        />
      </span>
    );
  }

  return (
    <span
      aria-hidden
      className={`${baseClass} font-bold text-ink-primary`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {initial}
    </span>
  );
}
