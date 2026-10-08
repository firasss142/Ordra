import { forwardRef, type ButtonHTMLAttributes } from "react";

/**
 * Réglages buttons (reglages.css `.rg-btn`). `soft` is the calm green used for
 * an action repeated on every row; `primary` is kept for the one main action.
 */
export type RgButtonVariant = "secondary" | "primary" | "soft" | "quiet" | "danger";

export const RgButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: RgButtonVariant; size?: "md" | "sm" }
>(function RgButton({ variant = "secondary", size = "md", className = "", type = "button", ...rest }, ref) {
  return <button ref={ref} type={type} className={`rg-btn ${variant}${size === "sm" ? " sm" : ""} ${className}`.trim()} {...rest} />;
});
