export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const unauthorized = () => new ApiError(401, "UNAUTHORIZED", "Please sign in.");
export const forbidden = (message = "You do not have access to this action.") =>
  new ApiError(403, "FORBIDDEN", message);
/** Also used for other departments' records, so that their existence is not revealed. */
export const notFound = (message = "Not found.") => new ApiError(404, "NOT_FOUND", message);
export const badRequest = (message: string, code = "BAD_REQUEST") =>
  new ApiError(400, code, message);
export const conflict = (message: string, code = "CONFLICT") => new ApiError(409, code, message);
export const tooManyRequests = (message = "Too many requests. Please try again later.") =>
  new ApiError(429, "RATE_LIMITED", message);
