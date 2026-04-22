/**
 * Resolves a dot-separated translation key from a messages object,
 * with optional {param} interpolation.
 *
 * Exported for use inside vi.hoisted() factory functions to avoid
 * Vitest hoisting constraints.
 */
export function resolveTranslation(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages: any,
  ns: string,
  key: string,
  params?: Record<string, unknown>
): string {
  // Support dotted namespaces (e.g. "orders.detail") and dotted keys.
  const nsParts = ns ? ns.split(".") : [];
  const keyParts = key.split(".");
  let val: unknown = messages;
  for (const part of [...nsParts, ...keyParts]) {
    val = (val as Record<string, unknown>)?.[part];
  }
  if (typeof val !== "string") return key;
  if (params) {
    return val.replace(
      /\{(\w+)\}/g,
      (_: string, k: string) => String(params[k] ?? `{${k}}`)
    );
  }
  return val;
}
