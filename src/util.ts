import type { ConvertOptions, OpenAITextPart, Warning, WarningCode } from './types.js';

/** Thin wrapper around the optional `onWarning` callback. */
export class Reporter {
  constructor(private readonly options: ConvertOptions = {}) {}

  warn(code: WarningCode, message: string): void {
    this.options.onWarning?.({ code, message } satisfies Warning);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Flattens any supported text content (a plain string or an array of text
 * parts/blocks) into a single string. Non text parts are ignored.
 */
export function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (isRecord(part) && typeof part.text === 'string') return part.text;
        return '';
      })
      .join('');
  }
  return '';
}

/** Wraps a string as a single OpenAI/Anthropic text part array. */
export function textPart(text: string): OpenAITextPart[] {
  return [{ type: 'text', text }];
}

/** Safely parses a JSON string, returning a discriminated result. */
export function tryParseJson(input: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(input) };
  } catch {
    return { ok: false };
  }
}

/**
 * Parses an OpenAI tool-call `arguments` JSON string into an object. Reports and
 * returns `{}` when the string is not valid JSON object syntax.
 */
export function parseArguments(args: string, reporter: Reporter, fnName: string): Record<string, unknown> {
  const parsed = tryParseJson(args);
  if (parsed.ok && isRecord(parsed.value)) return parsed.value;
  reporter.warn(
    'invalid-json-arguments',
    `Tool call '${fnName}' had arguments that were not a JSON object; used an empty object instead.`,
  );
  return {};
}

/**
 * Converts an OpenAI tool result string into a Gemini `functionResponse.response`
 * object. A JSON object string is used directly; anything else is wrapped as
 * `{ result: <text> }`, which {@link unwrapResponse} reverses.
 */
export function wrapResponse(content: string): Record<string, unknown> {
  const parsed = tryParseJson(content);
  if (parsed.ok && isRecord(parsed.value)) return parsed.value;
  return { result: content };
}

/** Reverses {@link wrapResponse}: a lone `{ result: string }` becomes that string. */
export function unwrapResponse(response: Record<string, unknown>): string {
  const keys = Object.keys(response);
  if (keys.length === 1 && keys[0] === 'result' && typeof response.result === 'string') {
    return response.result;
  }
  return JSON.stringify(response);
}
