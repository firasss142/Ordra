"use client";

interface FooterLinksProps {
  items: Array<{
    key: string;
    label: string;
    value: string;
    href?: string;
  }>;
}

export function FooterLinks({ items }: FooterLinksProps) {
  if (items.length === 0) return null;
  return (
    <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-3">
      {items.map((it) => (
        <FooterCard key={it.key} label={it.label} value={it.value} href={it.href} />
      ))}
    </div>
  );
}

function FooterCard({ label, value, href }: { label: string; value: string; href?: string }) {
  const baseClasses =
    "bg-surface-card border border-line-subtle rounded-[8px] px-4 py-3 flex items-center justify-between gap-3 sm:min-w-[180px]";
  const content = (
    <>
      <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-secondary">
        {label}
      </span>
      <span className="text-[16px] font-bold tabular-nums text-ink-primary">{value}</span>
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        className={`${baseClasses} no-underline hover:bg-surface-hover hover:shadow-hover-row transition-all duration-fast`}
      >
        {content}
      </a>
    );
  }
  return <span className={baseClasses}>{content}</span>;
}
