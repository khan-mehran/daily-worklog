export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface Paginated<T> {
  data: T[];
  meta: { page: number; limit: number; total: number };
}

/** Fetches a JSON API route and returns the raw response body. Throws on an error response. */
export async function apiRequest<T>(path: string, init?: { method?: string; body?: unknown }) {
  const response = await fetch(path, {
    method: init?.method ?? "GET",
    headers: init?.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiClientError(
      response.status,
      payload?.error?.code ?? "UNKNOWN",
      payload?.error?.message ?? "Something went wrong. Please try again.",
    );
  }
  return payload as T;
}

/** The common case: returns the `data` field of the response. */
export async function api<T>(path: string, init?: { method?: string; body?: unknown }) {
  return (await apiRequest<{ data: T }>(path, init)).data;
}
