/**
 * @deprecated Moved to `src/lib/carriers/buckets.ts` — the bucket function is
 * now carrier-neutral (Dexpress + Darb Assabil). This file re-exports the new
 * location so existing imports keep working. Prefer importing from
 * `@/lib/carriers/buckets` directly.
 */
export { bucketFor, type Bucket, type BucketInput } from "../buckets";
