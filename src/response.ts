import type { ConvertOptions, OpenAIAssistantMessage, OpenAIToolCall, Provider } from './types.js';
import {
  Reporter,
  createToolCallIdGenerator,
  isRecord,
  providerFunctionName,
  stringifyArgumentsObject,
  tryParseJson,
} from './util.js';

/** A provider-neutral finish reason. */
export type FinishReason = 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'unknown';

/** Provider-neutral token usage. */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

/** A provider response normalized to the canonical OpenAI assistant shape. */
export interface NormalizedResponse {
  message: OpenAIAssistantMessage;
  finishReason: FinishReason;
  usage: Usage;
}

const num = (value: unknown): number => (typeof value === 'number' ? value : 0);
const nonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

function responseRoot(body: unknown, reporter: Reporter, provider: string): Record<string, unknown> {
  if (isRecord(body)) return body;
  reporter.warn('dropped-content', `Dropped malformed ${provider} response body; expected an object.`);
  return {};
}

function responseArrayField(
  root: Record<string, unknown>,
  field: string,
  reporter: Reporter,
  context: string,
  noun: string,
): unknown[] {
  const value = root[field];
  if (value === undefined) {
    reporter.warn('dropped-content', `${context} missing ${field} array; no ${noun} were read.`);
    return [];
  }
  if (!Array.isArray(value)) {
    reporter.warn('dropped-content', `Dropped malformed ${context} ${field}; expected an array.`);
    return [];
  }
  return value;
}

function firstResponseRecord(
  items: unknown[],
  reporter: Reporter,
  provider: string,
  noun: string,
): Record<string, unknown> {
  if (items.length === 0) return {};
  if (isRecord(items[0])) return items[0];
  reporter.warn('dropped-content', `Dropped malformed ${provider} response ${noun}; expected an object.`);
  return {};
}

function responseRecordField(
  root: Record<string, unknown>,
  field: string,
  reporter: Reporter,
  context: string,
  noun: string,
): Record<string, unknown> {
  const value = root[field];
  if (value === undefined) {
    reporter.warn('dropped-content', `${context} missing ${field} object; no ${noun} were read.`);
    return {};
  }
  if (!isRecord(value)) {
    reporter.warn('dropped-content', `Dropped malformed ${context} ${field}; expected an object.`);
    return {};
  }
  return value;
}

/** Builds the canonical message, setting `content` to null when only tool calls are present. */
function buildMessage(text: string, toolCalls: OpenAIToolCall[]): OpenAIAssistantMessage {
  const message: OpenAIAssistantMessage = { role: 'assistant', content: text ? text : null };
  if (toolCalls.length > 0) message.tool_calls = toolCalls;
  return message;
}

/** When tool calls are present the canonical finish reason is always `tool_calls`. */
function finalReason(mapped: FinishReason, toolCalls: OpenAIToolCall[]): FinishReason {
  return toolCalls.length > 0 ? 'tool_calls' : mapped;
}

function normalizeProviderArguments(
  value: unknown,
  reporter: Reporter,
  provider: string,
  part: string,
  fnName: string,
): string {
  if (typeof value !== 'string') return stringifyArgumentsObject(value, reporter, provider, part, fnName);

  const parsed = tryParseJson(value);
  if (parsed.ok && isRecord(parsed.value)) return value;

  reporter.warn(
    'invalid-json-arguments',
    `${provider} ${part} '${fnName}' had arguments that were not a JSON object string; used an empty object instead.`,
  );
  return '{}';
}

function normalizeOpenAIToolCalls(value: unknown, reporter: Reporter): OpenAIToolCall[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    reporter.warn('dropped-content', 'Dropped malformed OpenAI Chat Completions tool_calls; expected an array.');
    return [];
  }

  const toolCalls: OpenAIToolCall[] = [];
  const ids = createToolCallIdGenerator(
    value.flatMap((call) =>
      isRecord(call) && (call.type === undefined || call.type === 'function') && nonEmptyString(call.id)
        ? [call.id]
        : [],
    ),
  );
  for (const call of value) {
    if (!isRecord(call)) {
      reporter.warn('dropped-content', 'Dropped malformed OpenAI Chat Completions tool_call; expected an object.');
      continue;
    }
    if (call.type !== undefined && call.type !== 'function') {
      reporter.warn(
        'dropped-content',
        `OpenAI Chat Completions tool_call type '${String(call.type)}' is not supported; dropped.`,
      );
      continue;
    }
    const fn = isRecord(call.function) ? call.function : {};
    const name = providerFunctionName(fn.name, reporter, 'OpenAI Chat Completions', 'tool_call.function');
    const providedId = nonEmptyString(call.id) ? call.id : undefined;
    const id = providedId ? ids.claim(providedId, name) : ids.generate(name);
    if (!providedId) {
      reporter.warn('generated-id', `OpenAI Chat Completions tool_call '${name}' had no id; generated '${id}'.`);
    } else if (id !== providedId) {
      reporter.warn(
        'generated-id',
        `OpenAI Chat Completions tool_call '${name}' reused id '${providedId}'; generated '${id}'.`,
      );
    }
    const args = normalizeProviderArguments(
      fn.arguments,
      reporter,
      'OpenAI Chat Completions',
      'tool_call.function',
      name,
    );
    toolCalls.push({ id, type: 'function', function: { name, arguments: args } });
  }
  return toolCalls;
}

function normalizeOpenAIFunctionCall(value: unknown, reporter: Reporter): OpenAIToolCall[] {
  if (!isRecord(value)) return [];

  const name = providerFunctionName(value.name, reporter, 'OpenAI Chat Completions', 'function_call');
  const id = `call_${name.replace(/[^a-zA-Z0-9_-]/g, '_')}_0`;
  reporter.warn('generated-id', `OpenAI Chat Completions function_call '${name}' had no id; generated '${id}'.`);
  const args = normalizeProviderArguments(value.arguments, reporter, 'OpenAI Chat Completions', 'function_call', name);
  return [{ id, type: 'function', function: { name, arguments: args } }];
}

function openAIChatContentText(content: unknown, reporter: Reporter): string {
  if (typeof content === 'string') return content;
  if (content === null || content === undefined) return '';
  if (!Array.isArray(content)) {
    reporter.warn('dropped-content', 'Dropped malformed OpenAI Chat Completions response content.');
    return '';
  }

  const pieces: string[] = [];
  for (const part of content) {
    if (typeof part === 'string') {
      pieces.push(part);
    } else if (isRecord(part) && typeof part.text === 'string') {
      pieces.push(part.text);
    } else if (isRecord(part) && part.type === 'refusal' && typeof part.refusal === 'string') {
      pieces.push(part.refusal);
    } else {
      reporter.warn('dropped-content', 'Dropped unsupported OpenAI Chat Completions response content part.');
    }
  }
  return pieces.join('');
}

function openAIChatMessageText(message: Record<string, unknown>, reporter: Reporter): string {
  const content = openAIChatContentText(message.content, reporter);
  if (content) return content;
  return typeof message.refusal === 'string' ? message.refusal : content;
}

/* -------------------------------- OpenAI ------------------------------- */

const OPENAI_FINISH: Record<string, FinishReason> = {
  stop: 'stop',
  length: 'length',
  tool_calls: 'tool_calls',
  content_filter: 'content_filter',
  function_call: 'tool_calls',
};

/** Normalizes an OpenAI Chat Completions response body. */
export function responseFromOpenAI(body: unknown, options: ConvertOptions = {}): NormalizedResponse {
  const reporter = new Reporter(options);
  const isObjectBody = isRecord(body);
  const root = isObjectBody ? body : responseRoot(body, reporter, 'OpenAI Chat Completions');
  const choices = isObjectBody
    ? responseArrayField(root, 'choices', reporter, 'OpenAI Chat Completions response', 'choices')
    : [];
  const hasChoiceRecord = choices.length > 0 && isRecord(choices[0]);
  const choice = firstResponseRecord(choices, reporter, 'OpenAI Chat Completions', 'choice');
  const message = hasChoiceRecord
    ? responseRecordField(
        choice,
        'message',
        reporter,
        'OpenAI Chat Completions response choice',
        'message content or tool calls',
      )
    : {};

  const text = openAIChatMessageText(message, reporter);
  const toolCalls = normalizeOpenAIToolCalls(message.tool_calls, reporter);
  const normalizedToolCalls =
    toolCalls.length > 0 ? toolCalls : normalizeOpenAIFunctionCall(message.function_call, reporter);

  const usage = isRecord(root.usage) ? root.usage : {};
  return {
    message: buildMessage(text, normalizedToolCalls),
    finishReason: finalReason(OPENAI_FINISH[String(choice.finish_reason)] ?? 'unknown', normalizedToolCalls),
    usage: { inputTokens: num(usage.prompt_tokens), outputTokens: num(usage.completion_tokens) },
  };
}

const OPENAI_RESPONSES_INCOMPLETE: Record<string, FinishReason> = {
  max_output_tokens: 'length',
  content_filter: 'content_filter',
};

function openAIResponsesContentText(content: unknown, reporter: Reporter): string {
  if (content === undefined) return '';
  if (!Array.isArray(content)) {
    reporter.warn('dropped-content', 'Dropped malformed OpenAI Responses message content.');
    return '';
  }

  const pieces: string[] = [];
  for (const part of content) {
    if (!isRecord(part)) {
      reporter.warn('dropped-content', 'Dropped malformed OpenAI Responses message content part.');
    } else if (typeof part.text === 'string' && (part.type === 'output_text' || part.type === 'text')) {
      pieces.push(part.text);
    } else if (part.type === 'refusal' && typeof part.refusal === 'string') {
      pieces.push(part.refusal);
    } else {
      reporter.warn('dropped-content', 'Dropped unsupported OpenAI Responses message content part.');
    }
  }
  return pieces.join('');
}

function responseApiFinishReason(root: Record<string, unknown>): FinishReason {
  if (root.status === 'completed') return 'stop';
  if (root.status !== 'incomplete') return 'unknown';

  const details = isRecord(root.incomplete_details) ? root.incomplete_details : {};
  return OPENAI_RESPONSES_INCOMPLETE[String(details.reason)] ?? 'unknown';
}

function openAIResponsesOutput(root: Record<string, unknown>, reporter: Reporter): unknown[] {
  if (root.output === undefined) {
    reporter.warn(
      'dropped-content',
      'OpenAI Responses response missing top-level output array; no output items were read.',
    );
    return [];
  }
  if (!Array.isArray(root.output)) {
    reporter.warn('dropped-content', 'Dropped malformed OpenAI Responses top-level output; expected an array.');
    return [];
  }
  return root.output;
}

/** Normalizes an OpenAI Responses API response body. */
export function responseFromOpenAIResponses(body: unknown, options: ConvertOptions = {}): NormalizedResponse {
  const reporter = new Reporter(options);
  const isObjectBody = isRecord(body);
  const root = isObjectBody ? body : responseRoot(body, reporter, 'OpenAI Responses');
  const output = isObjectBody ? openAIResponsesOutput(root, reporter) : [];
  const textPieces: string[] = [];
  const toolCalls: OpenAIToolCall[] = [];
  const ids = createToolCallIdGenerator(
    output.flatMap((item) => {
      if (!isRecord(item) || item.type !== 'function_call') return [];
      if (nonEmptyString(item.call_id)) return [item.call_id];
      return nonEmptyString(item.id) ? [item.id] : [];
    }),
  );

  for (const item of output) {
    if (!isRecord(item)) {
      reporter.warn('dropped-content', 'Dropped malformed OpenAI Responses output item.');
      continue;
    }

    if (item.type === 'message') {
      textPieces.push(openAIResponsesContentText(item.content, reporter));
    } else if (item.type === 'function_call') {
      const name = providerFunctionName(item.name, reporter, 'OpenAI Responses', 'function_call');
      const callId = nonEmptyString(item.call_id) ? item.call_id : undefined;
      const itemId = nonEmptyString(item.id) ? item.id : undefined;
      const id = callId ?? itemId;
      const toolCallId = id ? ids.claim(id, name) : ids.generate(name);
      if (!callId && !itemId) {
        reporter.warn('generated-id', `OpenAI Responses function_call '${name}' had no id; generated '${toolCallId}'.`);
      } else if (toolCallId !== id) {
        reporter.warn(
          'generated-id',
          `OpenAI Responses function_call '${name}' reused id '${id}'; generated '${toolCallId}'.`,
        );
      }
      const args = normalizeProviderArguments(item.arguments, reporter, 'OpenAI Responses', 'function_call', name);
      toolCalls.push({ id: toolCallId, type: 'function', function: { name, arguments: args } });
    } else {
      reporter.warn('dropped-content', `Dropped unsupported OpenAI Responses output item '${String(item.type)}'.`);
    }
  }

  const usage = isRecord(root.usage) ? root.usage : {};
  return {
    message: buildMessage(textPieces.join(''), toolCalls),
    finishReason: finalReason(responseApiFinishReason(root), toolCalls),
    usage: { inputTokens: num(usage.input_tokens), outputTokens: num(usage.output_tokens) },
  };
}

export type ResponseProvider = Provider | 'openai-responses';

/* ------------------------------- Anthropic ----------------------------- */

const ANTHROPIC_FINISH: Record<string, FinishReason> = {
  end_turn: 'stop',
  stop_sequence: 'stop',
  tool_use: 'tool_calls',
  max_tokens: 'length',
  refusal: 'content_filter',
  pause_turn: 'unknown',
};

/** Normalizes an Anthropic Messages response body. */
export function responseFromAnthropic(body: unknown, options: ConvertOptions = {}): NormalizedResponse {
  const reporter = new Reporter(options);
  const isObjectBody = isRecord(body);
  const root = isObjectBody ? body : responseRoot(body, reporter, 'Anthropic');
  const blocks = isObjectBody
    ? responseArrayField(root, 'content', reporter, 'Anthropic response', 'content blocks')
    : [];

  const textPieces: string[] = [];
  const toolCalls: OpenAIToolCall[] = [];
  const ids = createToolCallIdGenerator(
    blocks.flatMap((block) =>
      isRecord(block) && block.type === 'tool_use' && nonEmptyString(block.id) ? [block.id] : [],
    ),
  );
  for (const block of blocks) {
    if (!isRecord(block)) {
      reporter.warn('dropped-content', 'Dropped a malformed Anthropic response content block.');
      continue;
    }
    if (block.type === 'text' && typeof block.text === 'string') {
      textPieces.push(block.text);
    } else if (block.type === 'tool_use') {
      const name = providerFunctionName(block.name, reporter, 'Anthropic', 'tool_use');
      const providedId = nonEmptyString(block.id) ? block.id : undefined;
      const id = providedId ? ids.claim(providedId, name) : ids.generate(name);
      if (!providedId) {
        reporter.warn('generated-id', `Anthropic tool_use '${name}' had no id; generated '${id}'.`);
      } else if (id !== providedId) {
        reporter.warn('generated-id', `Anthropic tool_use '${name}' reused id '${providedId}'; generated '${id}'.`);
      }
      toolCalls.push({
        id,
        type: 'function',
        function: {
          name,
          arguments: stringifyArgumentsObject(block.input, reporter, 'Anthropic', 'tool_use', name),
        },
      });
    } else {
      reporter.warn(
        'dropped-content',
        `Anthropic response content block '${String(block.type)}' is not supported; dropped.`,
      );
    }
  }

  const usage = isRecord(root.usage) ? root.usage : {};
  return {
    message: buildMessage(textPieces.join(''), toolCalls),
    finishReason: finalReason(ANTHROPIC_FINISH[String(root.stop_reason)] ?? 'unknown', toolCalls),
    usage: { inputTokens: num(usage.input_tokens), outputTokens: num(usage.output_tokens) },
  };
}

/* -------------------------------- Gemini ------------------------------- */

const GEMINI_FINISH: Record<string, FinishReason> = {
  STOP: 'stop',
  MAX_TOKENS: 'length',
  SAFETY: 'content_filter',
  RECITATION: 'content_filter',
  BLOCKLIST: 'content_filter',
  PROHIBITED_CONTENT: 'content_filter',
  SPII: 'content_filter',
  MALFORMED_FUNCTION_CALL: 'content_filter',
  MODEL_ARMOR: 'content_filter',
  IMAGE_SAFETY: 'content_filter',
  IMAGE_PROHIBITED_CONTENT: 'content_filter',
  IMAGE_RECITATION: 'content_filter',
};

/** Normalizes a Gemini generateContent response body. */
export function responseFromGemini(body: unknown, options: ConvertOptions = {}): NormalizedResponse {
  const reporter = new Reporter(options);
  const isObjectBody = isRecord(body);
  const root = isObjectBody ? body : responseRoot(body, reporter, 'Gemini');
  const candidates = isObjectBody
    ? responseArrayField(root, 'candidates', reporter, 'Gemini response', 'candidates')
    : [];
  const hasCandidateRecord = candidates.length > 0 && isRecord(candidates[0]);
  const candidate = firstResponseRecord(candidates, reporter, 'Gemini', 'candidate');
  const content = isRecord(candidate.content) ? candidate.content : {};
  if (hasCandidateRecord && !isRecord(candidate.content)) {
    reporter.warn('dropped-content', 'Dropped malformed Gemini response candidate content; expected an object.');
  }
  const parts =
    hasCandidateRecord && isRecord(candidate.content)
      ? responseArrayField(content, 'parts', reporter, 'Gemini response candidate content', 'content parts')
      : [];

  const textPieces: string[] = [];
  const toolCalls: OpenAIToolCall[] = [];
  const ids = createToolCallIdGenerator(
    parts.flatMap((part) =>
      isRecord(part) && isRecord(part.functionCall) && nonEmptyString(part.functionCall.id)
        ? [part.functionCall.id]
        : [],
    ),
  );
  for (const part of parts) {
    if (!isRecord(part)) {
      reporter.warn('dropped-content', 'Dropped a malformed Gemini response content part.');
      continue;
    }
    if (isRecord(part.functionCall)) {
      const call = part.functionCall as { id?: unknown; name?: unknown; args?: unknown };
      const name = providerFunctionName(call.name, reporter, 'Gemini', 'functionCall');
      const providedId = nonEmptyString(call.id) ? call.id : undefined;
      const id = providedId ? ids.claim(providedId, name) : ids.generate(name);
      if (!providedId) {
        reporter.warn('generated-id', `Gemini functionCall '${name}' had no id; generated '${id}'.`);
      } else if (id !== providedId) {
        reporter.warn('generated-id', `Gemini functionCall '${name}' reused id '${providedId}'; generated '${id}'.`);
      }
      toolCalls.push({
        id,
        type: 'function',
        function: {
          name,
          arguments: stringifyArgumentsObject(call.args, reporter, 'Gemini', 'functionCall', name),
        },
      });
    } else if (part.thought === true) {
      // Gemini marks thinking with a `thought` flag on an otherwise normal text
      // part. Reasoning is not part of the portable assistant message.
      reporter.warn('dropped-content', 'Dropped a Gemini thought (reasoning) response part.');
    } else if (typeof part.text === 'string') {
      textPieces.push(part.text);
    } else {
      reporter.warn('dropped-content', 'Dropped an unsupported Gemini response content part.');
    }
  }

  const usage = isRecord(root.usageMetadata) ? root.usageMetadata : {};
  return {
    message: buildMessage(textPieces.join(''), toolCalls),
    finishReason: finalReason(GEMINI_FINISH[String(candidate.finishReason)] ?? 'unknown', toolCalls),
    usage: { inputTokens: num(usage.promptTokenCount), outputTokens: num(usage.candidatesTokenCount) },
  };
}

/* ------------------------------ Dispatcher ----------------------------- */

/** Normalizes a provider response body into the canonical shape. */
export function normalizeResponse(
  body: unknown,
  route: { from: ResponseProvider },
  options: ConvertOptions = {},
): NormalizedResponse {
  switch (route.from) {
    case 'openai':
      return responseFromOpenAI(body, options);
    case 'openai-responses':
      return responseFromOpenAIResponses(body, options);
    case 'anthropic':
      return responseFromAnthropic(body, options);
    case 'gemini':
      return responseFromGemini(body, options);
    default:
      throw new Error(`Unknown source provider: ${String(route.from)}`);
  }
}
