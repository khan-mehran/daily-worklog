import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { userFromBearer } from "@/lib/auth/api-token";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/session";
import { DEPARTMENT_FILTER_COOKIE, seesAllDepartments } from "@/lib/constants";
import { isUniqueViolation } from "@/lib/db/prisma";
import { scopeFor, type DepartmentScope } from "@/lib/permissions";
import { isId } from "@/validators/common";
import { ApiError, badRequest, forbidden, notFound, unauthorized } from "./errors";

export interface RouteContext<P> {
  req: NextRequest;
  params: P;
}

export interface AuthedContext<P> extends RouteContext<P> {
  user: CurrentUser;
  /** The department filter from the switcher the CEO and Super Admin have. Null for other roles. */
  selectedDepartmentId: string | null;
  /** The department filter for this request. Use it in every query. */
  scope: DepartmentScope;
}

type Segment<P> = { params: Promise<P> };

function errorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  if (error instanceof ZodError) {
    const first = error.issues[0];
    const message = first
      ? `${first.path.join(".") || "Input"}: ${first.message}`
      : "Invalid input.";
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message } }, { status: 400 });
  }
  if (isUniqueViolation(error)) {
    return NextResponse.json(
      { error: { code: "DUPLICATE", message: "A record with these details already exists." } },
      { status: 409 },
    );
  }
  console.error("[api] unhandled error", error);
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." } },
    { status: 500 },
  );
}

/** Cookie-authenticated writes must come from our own origin. */
function assertSameOrigin(req: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const origin = req.headers.get("origin");
  if (!origin) return;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  let originHost: string | null = null;
  try {
    originHost = new URL(origin).host;
  } catch {
    // Handled by the comparison below.
  }
  if (originHost !== host) throw forbidden("Cross-origin request rejected.");
}

/** Wraps a route handler that needs no session, such as accepting an invite. */
export function publicRoute<P = Record<string, never>>(
  handler: (ctx: RouteContext<P>) => Promise<Response>,
) {
  return async (req: NextRequest, segment: Segment<P>) => {
    try {
      assertSameOrigin(req);
      return await handler({ req, params: await segment.params });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

/** Wraps a route handler: same-origin check, session, department scope and the error shape. */
export function authedRoute<P = Record<string, never>>(
  handler: (ctx: AuthedContext<P>) => Promise<Response>,
) {
  return async (req: NextRequest, segment: Segment<P>) => {
    try {
      assertSameOrigin(req);
      const user = await getCurrentUser();
      if (!user) throw unauthorized();
      const cookie = req.cookies.get(DEPARTMENT_FILTER_COOKIE)?.value ?? null;
      const selectedDepartmentId =
        seesAllDepartments(user.role) && isId(cookie) ? cookie : null;
      return await handler({
        req,
        params: await segment.params,
        user,
        selectedDepartmentId,
        scope: scopeFor(user, selectedDepartmentId),
      });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

/**
 * Wraps a route handler for tools outside the browser, such as the VS Code daily sync. It accepts
 * only a personal API token, never the session cookie, so a token reaches just these routes and
 * the same-origin check isn't needed. Scope is always the caller's own department.
 */
export function tokenRoute<P = Record<string, never>>(
  handler: (ctx: AuthedContext<P>) => Promise<Response>,
) {
  return async (req: NextRequest, segment: Segment<P>) => {
    try {
      const user = await userFromBearer(req.headers.get("authorization"));
      if (!user) throw new ApiError(401, "UNAUTHORIZED", "Missing, invalid or revoked API token.");
      return await handler({
        req,
        params: await segment.params,
        user,
        selectedDepartmentId: null,
        scope: scopeFor(user, null),
      });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export async function parseBody<T>(req: NextRequest, schema: ZodType<T, unknown>) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw badRequest("Request body must be valid JSON.");
  }
  return schema.parse(body);
}

export function parseQuery<T>(req: NextRequest, schema: ZodType<T, unknown>) {
  return schema.parse(Object.fromEntries(req.nextUrl.searchParams));
}

/** A malformed id can't match a record, so it gets the same 404 as a missing one. */
export function idParam(id: string) {
  if (!isId(id)) throw notFound();
  return id;
}
