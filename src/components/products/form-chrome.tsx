/* Field chrome left for ProductVariantsEditor, the one pre-v6 product form
   still embedded in the edit page (its Variantes tab). The rest of this file
   served the old create form, replaced by v6/ProductCreateV6 on 2026-10-04. */

/* 12px radius, green focus ring, logical padding throughout. */
export const CONTROL =
  "w-full rounded-xl border border-line bg-surface-card px-3.5 py-2.5 text-[13.5px] text-ink-primary " +
  "transition-colors duration-fast placeholder:text-ink-muted hover:border-line-strong " +
  "focus:border-prod-brand focus:outline-none focus:ring-[3px] focus:ring-prod-brand-soft " +
  "disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-muted";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
