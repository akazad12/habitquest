import { ZodError } from "zod";
let csrfToken: string | null = null;
export function setCsrfToken(token: string | null) {
  csrfToken = token;
}
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    signal?: AbortSignal;
    headers?: Record<string, string>;
  } = {},
): Promise<T> {
  const base = import.meta.env.VITE_API_URL || "http://localhost:3001";
  const method = options.method ?? "GET";
  let response: Response;
  try {
    response = await fetch(`${base}/api${path}`, {
      method,
      credentials: "include",
      signal: options.signal,
      headers: {
        ...options.headers,
        ...(options.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
        ...(csrfToken && method !== "GET" ? { "X-CSRF-Token": csrfToken } : {}),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw error;
    throw new Error(
      "Could not reach HabitQuest. Check your connection and try again.",
    );
  }
  if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    if (
      response.status === 401 &&
      !["/auth/login", "/auth/register"].includes(path)
    )
      window.dispatchEvent(new Event("habitquest:unauthenticated"));
    const issue = data?.error?.issues?.[0];
    throw new HttpError(
      response.status,
      issue
        ? `${issue.path.join(" · ") || "Input"}: ${issue.message}`
        : data?.error?.message || "The request failed. Please try again.",
      data?.error?.code,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export const messageOf = (error: unknown) =>
  error instanceof ZodError
    ? error.issues[0]?.message || "Please check your input."
    : error instanceof Error
      ? error.message
      : "Something went wrong. Please try again.";
