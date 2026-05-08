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

  return { errors };
}

export function isLogoutRedirect(location: string | null): boolean {
  if (!location) return false;
  return /\/login(\?.*)?$/.test(location);
}
