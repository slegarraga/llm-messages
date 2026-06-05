import type { ConvertOptions, OpenAIAssistantMessage, OpenAIToolCall, Provider } from './types.js';
import { Reporter, isRecord, textOf } from './util.js';

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

/* -------------------------------- OpenAI ------------------------------- */

const OPENAI_FINISH: Record<string, FinishReason> = {
  stop: 'stop',
  length: 'length',
  tool_calls: 'tool_calls',
  content_filter: 'content_filter',
  function_call: 'tool_calls',
};

/** Normalizes an OpenAI Chat Completions response body. */
export function responseFromOpenAI(body: unknown): NormalizedResponse {
  const root = isRecord(body) ? body : {};
  const choice = Array.isArray(root.choices) && isRecord(root.choices[0]) ? root.choices[0] : {};
  const message = isRecord(choice.message) ? choice.message : {};

  const text = typeof message.content === 'string' ? message.content : textOf(message.content);
  const toolCalls = Array.isArray(message.tool_calls) ? (message.tool_calls as OpenAIToolCall[]) : [];

  const usage = isRecord(root.usage) ? root.usage : {};
  return {
    message: buildMessage(text, toolCalls),
    finishReason: finalReason(OPENAI_FINISH[String(choice.finish_reason)] ?? 'unknown', toolCalls),
    usage: { inputTokens: num(usage.prompt_tokens), outputTokens: num(usage.completion_tokens) },
  };
}

const OPENAI_RESPONSES_INCOMPLETE: Record<string, FinishReason> = {
  max_output_tokens: 'length',
  content_filter: 'content_filter',
};

function responseApiFinishReason(root: Record<string, unknown>): FinishReason {
  if (root.status === 'completed') return 'stop';
  if (root.status !== 'incomplete') return 'unknown';

  const details = isRecord(root.incomplete_details) ? root.incomplete_details : {};
  return OPENAI_RESPONSES_INCOMPLETE[String(details.reason)] ?? 'unknown';
}

/** Normalizes an OpenAI Responses API response body. */
export function responseFromOpenAIResponses(body: unknown): NormalizedResponse {
  const root = isRecord(body) ? body : {};
  const output = Array.isArray(root.output) ? root.output : [];
  const textPieces: string[] = [];
  const toolCalls: OpenAIToolCall[] = [];
  let counter = 0;

  for (const item of output) {
    if (!isRecord(item)) continue;

    if (item.type === 'message') {
      const content = Array.isArray(item.content) ? item.content : [];
      for (const part of content) {
        if (!isRecord(part)) continue;
        if (typeof part.text === 'string' && (part.type === 'output_text' || part.type === 'text')) {
          textPieces.push(part.text);
        } else if (part.type === 'refusal' && typeof part.refusal === 'string') {
          textPieces.push(part.refusal);
        }
      }
    } else if (item.type === 'function_call' && typeof item.name === 'string') {
      const name = item.name;
      const id =
        typeof item.call_id === 'string'
          ? item.call_id
          : typeof item.id === 'string'
            ? item.id
            : `call_${name.replace(/[^a-zA-Z0-9_-]/g, '_')}_${counter++}`;
      const args = typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments ?? {});
      toolCalls.push({ id, type: 'function', function: { name, arguments: args } });
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
export function responseFromAnthropic(body: unknown): NormalizedResponse {
  const root = isRecord(body) ? body : {};
  const blocks = Array.isArray(root.content) ? root.content : [];

  const textPieces: string[] = [];
  const toolCalls: OpenAIToolCall[] = [];
  for (const block of blocks) {
    if (!isRecord(block)) continue;
    if (block.type === 'text' && typeof block.text === 'string') {
      textPieces.push(block.text);
    } else if (block.type === 'tool_use' && typeof block.name === 'string') {
      toolCalls.push({
        id: typeof block.id === 'string' ? block.id : '',
        type: 'function',
        function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
      });
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
  MALFORMED_FUNCTION_CALL: 'content_filter',
};

/** Normalizes a Gemini generateContent response body. */
export function responseFromGemini(body: unknown, options: ConvertOptions = {}): NormalizedResponse {
  const reporter = new Reporter(options);
  const root = isRecord(body) ? body : {};
  const candidate = Array.isArray(root.candidates) && isRecord(root.candidates[0]) ? root.candidates[0] : {};
  const content = isRecord(candidate.content) ? candidate.content : {};
  const parts = Array.isArray(content.parts) ? content.parts : [];

  const textPieces: string[] = [];
  const toolCalls: OpenAIToolCall[] = [];
  let counter = 0;
  for (const part of parts) {
    if (!isRecord(part)) continue;
    if (isRecord(part.functionCall)) {
      const call = part.functionCall as { id?: string; name?: string; args?: Record<string, unknown> };
      const name = typeof call.name === 'string' ? call.name : 'function';
      let id = call.id;
      if (!id) {
        id = `call_${name.replace(/[^a-zA-Z0-9_-]/g, '_')}_${counter++}`;
        reporter.warn('generated-id', `Gemini functionCall '${name}' had no id; generated '${id}'.`);
      }
      toolCalls.push({ id, type: 'function', function: { name, arguments: JSON.stringify(call.args ?? {}) } });
    } else if (typeof part.text === 'string') {
      textPieces.push(part.text);
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
      return responseFromOpenAI(body);
    case 'openai-responses':
      return responseFromOpenAIResponses(body);
    case 'anthropic':
      return responseFromAnthropic(body);
    case 'gemini':
      return responseFromGemini(body, options);
    default:
      throw new Error(`Unknown source provider: ${String(route.from)}`);
  }
}
