/**
 * Minimal typed fetch wrapper for the client.
 *
 * Every response carries an `ok` flag; anything else is surfaced as a readable
 * message rather than thrown stack traces.
 */
import type { ApiError } from "@/app/types";

export class ApiRequestError extends Error {
  readonly status: number;
  readonly details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.details = details;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
    });
  } catch {
    throw new ApiRequestError(0, "Network error — is the dev server running?");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiRequestError(response.status, `Unexpected response (HTTP ${response.status})`);
  }

  if (!response.ok) {
    const error = payload as ApiError;
    const detail =
      error.details && Array.isArray(error.details)
        ? `: ${error.details
            .map((d) => ("path" in d && "message" in d ? `${d.path}: ${d.message}` : ""))
            .filter(Boolean)
            .join("; ")}`
        : "";
    throw new ApiRequestError(response.status, `${error.error ?? "Request failed"}${detail}`);
  }

  return payload as T;
}

export const api = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, body?: unknown) =>
    request<T>(url, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
};
