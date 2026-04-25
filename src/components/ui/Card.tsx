import type { HTMLAttributes, ReactNode } from "react";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ className = "", children, ...rest }: CardProps) {
  const base =
    "bg-surface-card border border-line-subtle rounded-card overflow-hidden";
  return (
    <div className={`${base} ${className}`.trim()} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({
  className = "",
  children,
  ...rest
}: CardProps) {
  const base = "px-5 py-4 border-b border-line-subtle";
  return (
    <div className={`${base} ${className}`.trim()} {...rest}>
      {children}
    </div>
  );
}

export function CardBody({
  className = "",
  children,
  ...rest
}: CardProps) {
  const base = "px-5 py-4";
  return (
    <div className={`${base} ${className}`.trim()} {...rest}>
      {children}
    </div>
  );
}
