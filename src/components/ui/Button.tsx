import { forwardRef, type ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const VARIANTS: Record<ButtonVariant, string> = {
  // Green, not black. The agent shell already force-mapped this to emerald via
  // `.agent-theme` overrides in globals.css, so the app shipped two different
  // primary buttons depending on which half you were in. See the doc's
  // §4 Buttons note.
  //
  // --brand, not --agent-primary: the latter is a second green (#006C49 against
  // #15803D), and the two met on the same screen — "Nouvelle commande" opens a
  // modal whose submit button was a visibly different shade. One primary green,
  // defined once. `.agent-theme [data-agent-cta="primary"]` is still the hook
  // for anything that genuinely needs the agent surface's own tone.
  primary:
    "bg-brand text-white hover:bg-brand-hover disabled:bg-[#F3F4F6] disabled:text-ink-muted",
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
    "inline-flex items-center justify-center gap-2 rounded-lg font-semibold tabular-nums transition-colors duration-fast disabled:cursor-not-allowed";
  return (
    <button
      ref={ref}
      type={type}
      className={`${base} ${VARIANTS[variant]} ${SIZES[size]} ${className}`.trim()}
      {...rest}
    />
  );
});
