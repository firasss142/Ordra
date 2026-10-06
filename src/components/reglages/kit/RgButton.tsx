import { forwardRef, type ButtonHTMLAttributes } from "react";

/**
 * Réglages buttons, drawn as Commandes draws them (`.btn` / `.btn2`: 36px, 11px
 * radius, weight 700; `.sm` 32px). Written in px because the app's root font is 14px and rem sizes would
 * shrink them by 12.5 %.
 */
export type RgButtonVariant = "secondary" | "primary" | "quiet" | "danger";

const VARIANTS: Record<RgButtonVariant, string> = {
  secondary: "border border-[rgba(15,23,40,.09)] bg-[rgba(255,255,255,.88)] text-ink-primary hover:bg-white hover:shadow-[0_4px_14px_rgba(42,52,110,.12)] font-bold",
  primary: "border border-brand bg-brand text-white hover:bg-brand-hover font-bold",
  quiet: "border border-transparent bg-transparent text-ink-secondary hover:bg-[rgba(15,23,40,.05)] hover:text-ink-primary font-bold",
  danger: "border border-[#FECDCA] bg-white text-[#B42318] hover:bg-[#FEF3F2] font-bold",
};

export const RgButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: RgButtonVariant; size?: "md" | "sm" }
>(function RgButton({ variant = "secondary", size = "md", className = "", type = "button", ...rest }, ref) {
  const sizing = size === "sm" ? "h-[32px] px-[11px] text-[12.5px] rounded-[9px]" : "h-[36px] px-[14px] text-[13px] rounded-[11px]";
  return (
    <button
      ref={ref}
      type={type}
      className={`inline-flex items-center justify-center gap-[7px] whitespace-nowrap transition-[background,box-shadow] disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:h-[15px] [&_svg]:w-[15px] ${sizing} ${VARIANTS[variant]} ${className}`.trim()}
      {...rest}
    />
  );
});
