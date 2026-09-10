/**
 * Point a Supabase Storage image at the render (resizing) endpoint, so a 40 px
 * avatar downloads a 40 px image.
 *
 * WHY: product images are uploaded at full camera/scan resolution and rendered
 * into a 40 px table cell. Measured on production, one real product PNG:
 *
 *   /object/public/…                     1,101,417 bytes
 *   /render/image/public/… 80×80            15,786 bytes
 *   …the same, with Accept: image/webp        2,088 bytes   (527× smaller)
 *
 * Browsers send `Accept: image/webp` on their own, so the WebP figure is what
 * users actually pay. A 25-row page was pulling tens of megabytes of PNG through
 * a 40 px hole; that is the "images load slowly and only some appear" complaint.
 *
 * Only Supabase *public object* URLs are rewritten. Storefront-hosted images and
 * signed URLs are returned untouched — rewriting those would 404.
 */
const PUBLIC_OBJECT_SEGMENT = "/storage/v1/object/public/";
const RENDER_SEGMENT = "/storage/v1/render/image/public/";

export function productThumbUrl(
  imageUrl: string | null | undefined,
  sizePx: number,
): string | null {
  if (!imageUrl) return null;
  // Already a render URL: rewriting again would double the query params.
  if (imageUrl.includes(RENDER_SEGMENT)) return imageUrl;
  if (!imageUrl.includes(PUBLIC_OBJECT_SEGMENT)) return imageUrl;

  try {
    const url = new URL(imageUrl);
    url.pathname = url.pathname.replace(
      PUBLIC_OBJECT_SEGMENT,
      RENDER_SEGMENT,
    );
    const px = String(Math.round(sizePx));
    url.searchParams.set("width", px);
    url.searchParams.set("height", px);
    url.searchParams.set("resize", "cover");
    url.searchParams.set("quality", "70");
    return url.toString();
  } catch {
    // A malformed URL is the product row's problem, not this helper's — hand it
    // back and let the <img> fall back to the initial.
    return imageUrl;
  }
}
