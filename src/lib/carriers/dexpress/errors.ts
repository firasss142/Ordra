export interface FieldError {
  field: string | null;
  message: string;
}

export interface ParsedFormErrors {
  errors: FieldError[];
}

// Tokenize the HTML into either a form-control name or an invalid-feedback message,
// in document order. Each error binds to the most recently seen name.
const TOKEN_RE =
  /<(?:input|select|textarea)\b[^>]*\bname="([^"]+)"|<div[^>]*class="[^"]*invalid-feedback[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;

// The live Dexpress portal runs Bootstrap 3, which flags an invalid field by
// adding `has-error` to its wrapping .form-group (no invalid-feedback div).
// Capture each such block: the field name comes from its first form control,
// the message from its <label> text (the only human-readable hint Bootstrap 3
// renders). Without this, a rejected phone surfaces only as "Validation error".
const HAS_ERROR_GROUP_RE =
  /<div\b[^>]*\bclass="[^"]*\bhas-error\b[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;

function parseHasErrorGroups(html: string): FieldError[] {
  const errors: FieldError[] = [];
  for (const m of html.matchAll(HAS_ERROR_GROUP_RE)) {
    const block = m[1];
    const field =
      block.match(/<(?:input|select|textarea)\b[^>]*\bname="([^"]+)"/i)?.[1] ??
      null;
    const message = (block.match(/<label\b[^>]*>([\s\S]*?)<\/label>/i)?.[1] ?? "")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (field || message) errors.push({ field, message });
  }
  return errors;
}

export function parseFormErrors(html: string): ParsedFormErrors {
  const errors: FieldError[] = [];
  let lastFieldName: string | null = null;

  for (const m of html.matchAll(TOKEN_RE)) {
    const fieldName = m[1];
    const feedbackInner = m[2];

    if (fieldName !== undefined) {
      lastFieldName = fieldName;
      continue;
    }

    if (feedbackInner !== undefined) {
      const text = feedbackInner.replace(/<[^>]+>/g, "").trim();
      if (text) errors.push({ field: lastFieldName, message: text });
    }
  }

  // Bootstrap-3 has-error groups are an independent signal; append any found.
  errors.push(...parseHasErrorGroups(html));

  return { errors };
}

export function isLogoutRedirect(location: string | null): boolean {
  if (!location) return false;
  return /\/login(\?.*)?$/.test(location);
}
