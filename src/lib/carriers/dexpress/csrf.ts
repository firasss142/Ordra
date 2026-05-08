const TOKEN_RE = /name="_token"\s+value="([^"]+)"/;

export function scrapeCsrfToken(html: string): string | null {
  return html.match(TOKEN_RE)?.[1] ?? null;
}
