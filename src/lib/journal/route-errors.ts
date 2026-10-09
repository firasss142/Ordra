import { recordAppError, actorFromCookieHeader } from "./app-errors";
import { runWithCauses, currentCauses, pickCause, installConsoleCapture, type Cause } from "./request-context";

installConsoleCapture();

/**
 * Wraps an App Router handler so that every answer ≥ 500, and every throw, is
 * written to public.app_errors (« Ordra — erreurs et sécurité » in Journaux).
 *
 * Deactivating a user answered 500 for nine days (2026-09-24 → PR #59) and only
 * Vercel's logs knew. The wrapper changes nothing a caller sees: the response
 * is returned as is, a throw is re-thrown, and a recorder that fails is
 * swallowed. Applied to every `src/app/api/**\/route.ts` export.
 *
 * The handler runs inside a request context (./request-context.ts) so the row
 * also carries the CAUSE — the database, outside-service or logged error that
 * sits behind the generic « Internal server error » most routes answer.
 */
export function withRouteErrors<A extends unknown[], R extends Response>(
  route: string,
  method: string,
  handler: (...args: A) => Promise<R> | R,
): (...args: A) => Promise<R> {
  return (...args: A): Promise<R> => runWithCauses(() => run(route, method, handler, args));
}

async function run<A extends unknown[], R extends Response>(
  route: string,
  method: string,
  handler: (...args: A) => Promise<R> | R,
  args: A,
): Promise<R> {
  {
    const actor = () => actorFromCookieHeader((args[0] as Request | undefined)?.headers?.get?.("cookie"));
    let res: R;
    try {
      res = await handler(...args);
    } catch (err) {
      await safely({
        route,
        method,
        status: 500,
        errorCode: (err as { code?: string } | null)?.code ?? null,
        message: err instanceof Error ? err.message : String(err),
        actorId: actor(),
        cause: pickCause(currentCauses()) ?? thrownCause(err),
      });
      throw err;
    }
    if (res && res.status >= 500) {
      const body = await readError(res);
      await safely({ route, method, status: res.status, errorCode: body.code, message: body.message, actorId: actor(), cause: pickCause(currentCauses()) });
    }
    return res;
  }
}

function thrownCause(err: unknown): Cause {
  if (err instanceof Error) return { kind: "code", code: err.name || null, detail: err.message, target: null };
  return { kind: "code", code: null, detail: String(err), target: null };
}

async function readError(res: Response): Promise<{ code: string | null; message: string | null }> {
  try {
    const body = (await res.clone().json()) as { error?: unknown; message?: unknown; code?: unknown; errorCode?: unknown };
    const message = typeof body.error === "string" ? body.error : typeof body.message === "string" ? body.message : null;
    const code = body.code ?? body.errorCode;
    return { code: typeof code === "string" || typeof code === "number" ? String(code) : null, message };
  } catch {
    return { code: null, message: null };
  }
}

async function safely(e: Parameters<typeof recordAppError>[0]) {
  try {
    await recordAppError(e);
  } catch {
    // The journal must never turn an answer into another error.
  }
}
