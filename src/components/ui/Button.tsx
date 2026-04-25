import { forwardRef, type ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-ink-primary text-white hover:bg-[#2A2A2A] disabled:bg-[#F3F4F6] disabled:text-ink-muted",
  secondary:
    "bg-surface-card text-ink-primary border border-line-strong hover:bg-surface-hover disabled:text-ink-muted",
  ghost:
    "bg-transparent text-ink-primary hover:bg-surface-hover disabled:text-ink-muted",
  destructive:
    "bg-status-critical text-white hover:opacity-90 disabled:opacity-50",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-10 px-4 text-[14px]",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "sm", className = "", type = "button", ...rest },
  ref,
) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-md font-medium tabular-nums transition-colors duration-fast disabled:cursor-not-allowed";
  return (
    <button
      ref={ref}
      type={type}
      className={`${base} ${VARIANTS[variant]} ${SIZES[size]} ${className}`.trim()}
      {...rest}
    />
  );
});
