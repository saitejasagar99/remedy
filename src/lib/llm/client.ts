/**
 * LLM client — any OpenAI-compatible endpoint (Ollama locally by default).
 *
 * Kept deliberately small: one function, one retry, hard timeout, and a strict
 * parse-and-validate step. The model only ever returns structured JSON that is
 * validated by a Zod schema; its output is never executed.
 */
import type { JsonSchema } from './json';

import { llmConfig } from '../config';
import { parseLLMJson } from './json';

export type LlmResult<T> =
  | { ok: true; data: T; model: string }
  | { ok: false; error: string; model: string };

export interface ChatOptions<T> {
  system: string;
  user: string;
  /** Validated against this schema after parsing. */
  schema: JsonSchema<T>;
  /** Lower = more deterministic. Defaults to the env-configured value. */
  temperature?: number;
  maxTokens?: number;
  /** Total attempts including the first. */
  attempts?: number;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
}

/** Single attempt against the OpenAI-compatible chat completions endpoint. */
async function complete(
  system: string,
  user: string,
  temperature: number,
  maxTokens: number,
  signal: AbortSignal,
): Promise<string> {
  const url = `${llmConfig.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const response = await fetch(url, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${llmConfig.apiKey}`,
    },
    body: JSON.stringify({
      model: llmConfig.model,
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`LLM request failed (HTTP ${response.status}): ${body.slice(0, 300)}`);
  }

  const payload = (await response.json()) as ChatCompletionResponse;
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('LLM returned no message content');
  }
  return content;
}

/**
 * Call the LLM and return validated structured output.
 *
 * Never throws — a failure is an `{ok:false}` result so the pipeline can fall
 * back to memory-only reasoning and label it, rather than failing the request.
 */
export async function chatJSON<T>(options: ChatOptions<T>): Promise<LlmResult<T>> {
  const temperature = options.temperature ?? llmConfig.temperature;
  const maxTokens = options.maxTokens ?? 4096;
  const attempts = options.attempts ?? 2;
  let lastError = 'unknown error';

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), llmConfig.timeoutMs);
    try {
      const raw = await complete(
        options.system,
        options.user,
        temperature,
        maxTokens,
        controller.signal,
      );
      const parsed = parseLLMJson(raw, options.schema);
      if (parsed.ok) return { ok: true, data: parsed.data, model: llmConfig.model };
      lastError = parsed.error;
    } catch (error) {
      lastError =
        error instanceof Error
          ? error.name === 'AbortError'
            ? `LLM timed out after ${llmConfig.timeoutMs}ms`
            : error.message
          : 'unknown LLM error';
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: false, error: lastError, model: llmConfig.model };
}

/** Cheap reachability probe for the status endpoint. */
export async function llmAvailable(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const url = `${llmConfig.baseUrl.replace(/\/$/, '')}/models`;
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { authorization: `Bearer ${llmConfig.apiKey}` },
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
