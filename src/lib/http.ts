import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";

/** Normalises any thrown value into a JSON-safe payload. Never leaks stack traces to the client. */
export function errorBody(error: unknown): { status: number; body: { ok: false; error: string; details?: unknown } } {
  if (error instanceof ZodError) {
    return {
      status: 400,
      body: { ok: false, error: "Validation failed", details: error.issues },
    };
  }
  if (error && typeof error === "object" && "statusCode" in error && typeof (error as { statusCode?: unknown }).statusCode === "number") {
    const status = (error as { statusCode: number }).statusCode;
    const message = error instanceof Error ? error.message : "Upstream error";
    return { status, body: { ok: false, error: message } };
  }
  const message = error instanceof Error ? error.message : "Unexpected error";
  return { status: 500, body: { ok: false, error: message } };
}

export function ok<T>(body: T, init?: { status?: number }): NextResponse {
  return NextResponse.json({ ok: true, ...body }, { status: init?.status ?? 200 });
}

export function fail(error: unknown): NextResponse {
  const { status, body } = errorBody(error);
  return NextResponse.json(body, { status });
}

/** Reads the raw request JSON and validates it with the supplied schema. */
export async function readJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON"), { statusCode: 400 });
  }
  return schema.parse(raw);
}
