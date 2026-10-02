import { forwardRef, type ButtonHTMLAttributes } from "react";

/**
 * Réglages buttons, sized like the prototype (`.btn`: 36px, 8px radius; `.sm`
 * 32px). Written in px because the app's root font is 14px and rem sizes would
 * shrink them by 12.5 %.
 */
export type RgButtonVariant = "secondary" | "primary" | "quiet" | "danger";

const VARIANTS: Record<RgButtonVariant, string> = {
  secondary: "border border-[#D2D5D9] bg-white text-ink-primary hover:bg-surface-hover font-medium",
  primary: "border border-brand bg-brand text-white hover:bg-brand-hover font-semibold",
  quiet: "border border-transparent bg-transparent text-ink-secondary hover:bg-surface-selected hover:text-ink-primary font-medium",
  danger: "border border-[#F2C1B8] bg-white text-status-critical hover:bg-status-criticalBg font-medium",
};

export const RgButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: RgButtonVariant; size?: "md" | "sm" }
>(function RgButton({ variant = "secondary", size = "md", className = "", type = "button", ...rest }, ref) {
  const sizing = size === "sm" ? "h-[32px] px-[10px] text-[13px]" : "h-[36px] px-[13px] text-[13.5px]";
  return (
    <button
      ref={ref}
      type={type}
      className={`inline-flex items-center justify-center gap-[7px] whitespace-nowrap rounded-[8px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:h-[15px] [&_svg]:w-[15px] ${sizing} ${VARIANTS[variant]} ${className}`.trim()}
      {...rest}
    />
  );
});
