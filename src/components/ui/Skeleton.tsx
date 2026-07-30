"use client";

/**
 * Standard loading placeholder block. Sunken surface + pulse, per
 * design-system §4 (Skeleton loading). Size via className (h-*, w-*).
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`bg-surface-sunken rounded-[6px] animate-pulse ${className}`}
    />
  );
}
