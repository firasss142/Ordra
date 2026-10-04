import type { ReactNode } from "react";

/**
 * The prototype's <main> around every products page and its loading state:
 * 24px 28px 120px, 16px on a phone. One definition, so a page and its skeleton
 * can never sit at different offsets.
 */
export function ProductsFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-surface-page px-[16px] pb-[120px] pt-[16px] md:px-[28px] md:pt-[24px]">
      {children}
    </div>
  );
}
