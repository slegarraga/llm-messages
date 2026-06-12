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
        if (isRecord(part) && part.type === 'refusal' && typeof part.refusal === 'string') return part.refusal;
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

/** Serializes provider-native argument objects into the canonical OpenAI JSON string. */
export function stringifyArgumentsObject(
  value: unknown,
  reporter: Reporter,
  provider: string,
  part: string,
  fnName: string,
): string {
  if (value === undefined) return '{}';
  if (isRecord(value)) {
    try {
      return JSON.stringify(value);
    } catch {
      reporter.warn(
        'invalid-json-arguments',
        `${provider} ${part} '${fnName}' had arguments that could not be serialized as JSON; used an empty object instead.`,
      );
      return '{}';
    }
  }
  reporter.warn(
    'invalid-json-arguments',
    `${provider} ${part} '${fnName}' had arguments that were not an object; used an empty object instead.`,
  );
  return '{}';
}

const OPENAI_FUNCTION_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

export function isProviderFunctionName(value: unknown): value is string {
  return typeof value === 'string' && OPENAI_FUNCTION_NAME.test(value);
}

/** Returns a canonical function name for malformed provider tool-call payloads. */
export function providerFunctionName(value: unknown, reporter: Reporter, provider: string, part: string): string {
  if (isProviderFunctionName(value)) return value;
  reporter.warn(
    'dropped-metadata',
    `${provider} ${part} had a missing or invalid function name; used 'unknown_function'.`,
  );
  return 'unknown_function';
}

/** Generates deterministic OpenAI tool-call ids without reusing seen ids. */
export function createToolCallIdGenerator(reservedIds: Iterable<string> = []): {
  claim: (id: string, name: string) => string;
  generate: (name: string) => string;
} {
  const reserved = new Set(reservedIds);
  const used = new Set<string>();
  let counter = 0;

  const generate = (name: string): string => {
    let id: string;
    do {
      id = `call_${name.replace(/[^a-zA-Z0-9_-]/g, '_')}_${counter++}`;
    } while (used.has(id) || reserved.has(id));
    used.add(id);
    return id;
  };

  return {
    claim(id: string, name: string): string {
      if (used.has(id)) return generate(name);
      used.add(id);
      reserved.delete(id);
      return id;
    },
    generate(name: string): string {
      return generate(name);
    },
  };
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
export function unwrapResponse(
  response: unknown,
  reporter?: Reporter,
  provider = 'Provider',
  part = 'response',
): string {
  if (response === undefined) return '{}';
  if (isRecord(response)) {
    const keys = Object.keys(response);
    if (keys.length === 1 && keys[0] === 'result' && typeof response.result === 'string') {
      return response.result;
    }
  }
  try {
    return JSON.stringify(response) ?? '{}';
  } catch {
    reporter?.warn(
      'dropped-content',
      `${provider} ${part} response could not be serialized as JSON; used an empty object instead.`,
    );
    return '{}';
  }
}
