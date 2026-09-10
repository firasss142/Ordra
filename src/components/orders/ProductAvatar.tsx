"use client";

import { useEffect, useRef, useState } from "react";
import { productThumbUrl } from "@/lib/images/thumb-url";
import { getProductInitial } from "@/lib/product-avatar";

interface Props {
  imageUrl: string | null;
  productName: string;
  size?: number;
}

/**
 * How far the image has fallen back.
 *  thumb    — the resized render URL (what we want, ~2 KB)
 *  original — the resize failed; the full upload still beats no picture
 *  initial  — both failed; show the letter
 */
type Stage = "thumb" | "original" | "initial";

export function ProductAvatar({ imageUrl, productName, size = 40 }: Props) {
  const [stage, setStage] = useState<Stage>("thumb");

  // Reset when the row is pointed at a different product. Without this, a
  // single broken image turned that avatar slot into initials for every product
  // that followed it — virtualised tables and realtime patches both reuse rows,
  // which is why "only some images appear" looked random.
  const lastUrlRef = useRef(imageUrl);
  useEffect(() => {
    if (lastUrlRef.current !== imageUrl) {
      lastUrlRef.current = imageUrl;
      setStage("thumb");
    }
  }, [imageUrl]);

  const baseClass =
    "flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-line-subtle bg-surface-page";

  if (imageUrl && stage !== "initial") {
    const src =
      stage === "thumb" ? productThumbUrl(imageUrl, size) ?? imageUrl : imageUrl;
    // Retina asks for 2× the CSS pixels; still a fraction of the original.
    const src2x = stage === "thumb" ? productThumbUrl(imageUrl, size * 2) : null;

    return (
      <span className={baseClass} style={{ width: size, height: size }}>
        <img
          src={src}
          {...(src2x && src2x !== src ? { srcSet: `${src} 1x, ${src2x} 2x` } : {})}
          alt={productName}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          fetchPriority="low"
          onError={() => setStage((s) => (s === "thumb" ? "original" : "initial"))}
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
      {getProductInitial(productName)}
    </span>
  );
}
