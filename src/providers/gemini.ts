import type {
  ConvertOptions,
  GeminiContent,
  GeminiConversation,
  GeminiPart,
  OpenAIAssistantMessage,
  OpenAIContentPart,
  OpenAIMessage,
  OpenAIToolCall,
  OpenAIToolMessage,
} from '../types.js';
import {
  Reporter,
  createToolCallIdGenerator,
  isProviderFunctionName,
  isRecord,
  parseArguments,
  providerFunctionName,
  stringifyArgumentsObject,
  textOf,
  unwrapResponse,
  wrapResponse,
} from '../util.js';
import { imageFromGemini, imageFromOpenAI, imageToGemini, imageToOpenAI } from '../image.js';
import { mediaFromGemini, mediaFromOpenAI, mediaToGemini, mediaToOpenAI } from '../media.js';
import { splitSystem } from './openai.js';

const nonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
type PendingFunctionCall = { id: string; name: string; providerId?: string };

/* ------------------------------------------------------------------ */
/* OpenAI (canonical) -> Gemini                                        */
/* ------------------------------------------------------------------ */

/**
 * Converts a canonical OpenAI conversation into a Gemini request fragment
 * (`{ systemInstruction, contents }`). The assistant role becomes `model`,
 * tool-call arguments are JSON parsed into `args` objects, tool results become
 * `functionResponse` parts whose `name` is recovered from the matching call, and
 * consecutive same-role turns are merged for Gemini's strict alternation.
 *
 * The OpenAI tool-call `id` is carried through as `functionCall.id` so that a
 * round trip (OpenAI -> Gemini -> OpenAI) preserves ids exactly.
 */
export function toGemini(messages: OpenAIMessage[], options: ConvertOptions = {}): GeminiConversation {
  const reporter = new Reporter(options);
  const { system, rest } = splitSystem(messages, reporter);

  const idToName = new Map<string, string>();
  for (const message of rest) {
    if (message.role === 'assistant' && message.tool_calls) {
      for (const call of message.tool_calls) idToName.set(call.id, call.function.name);
    }
  }

  const contents: GeminiContent[] = [];
  for (let i = 0; i < rest.length; i++) {
    const message = rest[i];

    if (message.role === 'tool') {
      const parts: GeminiPart[] = [];
      let j = i;
      while (j < rest.length && rest[j].role === 'tool') {
        const tool = rest[j] as OpenAIToolMessage;
        const matchingName = idToName.get(tool.tool_call_id);
        if (typeof tool.is_error === 'boolean') {
          reporter.warn(
            'dropped-metadata',
            `Tool message is_error=${tool.is_error} has no Gemini functionResponse equivalent; dropped.`,
          );
        }
        if (typeof tool.name === 'string' && matchingName && tool.name !== matchingName) {
          reporter.warn(
            'dropped-metadata',
            `Tool message name '${tool.name}' differs from matching tool call '${matchingName}'; used the tool-call function name for Gemini.`,
          );
        }
        const hasStandaloneName = nonEmptyString(tool.name);
        const name = matchingName ?? (hasStandaloneName ? tool.name : tool.tool_call_id);
        if (!matchingName && !hasStandaloneName) {
          reporter.warn(
            'unmapped-tool-result',
            `Tool result '${tool.tool_call_id}' has no matching call; used the id as the function name.`,
          );
        }
        parts.push({
          functionResponse: {
            id: tool.tool_call_id,
            name: name ?? tool.tool_call_id,
            response: wrapResponse(textOf(tool.content)),
          },
        });
        j++;
      }
      contents.push({ role: 'user', parts });
      i = j - 1;
      continue;
    }

    if (message.role === 'user') {
      warnDroppedName('User', message.name, 'Gemini', reporter);
      contents.push({ role: 'user', parts: userParts(message.content, reporter) });
      continue;
    }

    warnDroppedName('Assistant', message.name, 'Gemini', reporter);
    contents.push({ role: 'model', parts: assistantParts(message, reporter) });
  }

  const merged = mergeConsecutive(contents, reporter);
  return system === undefined
    ? { contents: merged }
    : { systemInstruction: { parts: [{ text: system }] }, contents: merged };
}

function userParts(content: string | OpenAIContentPart[], reporter: Reporter): GeminiPart[] {
  if (typeof content === 'string') return [{ text: content }];
  const parts: GeminiPart[] = [];
  for (const part of content) {
    if (isRecord(part) && part.type === 'text' && typeof part.text === 'string') {
      parts.push({ text: part.text });
      continue;
    }
    const image = imageFromOpenAI(part);
    if (image) {
      parts.push(imageToGemini(image, reporter));
      continue;
    }
    const media = mediaFromOpenAI(part);
    if (media) {
      const geminiPart = mediaToGemini(media, reporter);
      if (geminiPart) parts.push(geminiPart);
      continue;
    }
    reporter.warn('dropped-content', 'Dropped an unsupported user content part.');
  }
  return parts.length > 0 ? parts : [{ text: '' }];
}

function assistantParts(message: OpenAIAssistantMessage, reporter: Reporter): GeminiPart[] {
  const parts: GeminiPart[] = [];
  const text = textOf(message.content ?? '');
  if (text) parts.push({ text });
  for (const call of message.tool_calls ?? []) {
    parts.push({
      functionCall: {
        id: call.id,
        name: call.function.name,
        args: parseArguments(call.function.arguments, reporter, call.function.name),
      },
    });
  }
  return parts.length > 0 ? parts : [{ text: '' }];
}

function warnDroppedName(role: string, name: string | undefined, provider: string, reporter: Reporter): void {
  if (typeof name !== 'string') return;
  reporter.warn('dropped-metadata', `${role} message name '${name}' has no ${provider} equivalent; dropped.`);
}

/** Merges adjacent same-role contents by concatenating their `parts` arrays. */
function mergeConsecutive(contents: GeminiContent[], reporter: Reporter): GeminiContent[] {
  const result: GeminiContent[] = [];
  for (const content of contents) {
    const previous = result[result.length - 1];
    if (previous && previous.role === content.role) {
      previous.parts = [...previous.parts, ...content.parts];
      reporter.warn('merged-role', `Merged consecutive '${content.role}' turns (Gemini requires alternating roles).`);
    } else {
      result.push({ role: content.role, parts: [...content.parts] });
    }
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Gemini -> OpenAI (canonical)                                        */
/* ------------------------------------------------------------------ */

/**
 * Converts a Gemini request fragment back into a canonical OpenAI message array.
 * Because Gemini may omit ids and rely on function names, this maintains a
 * queue of pending calls and resolves each `functionResponse` by id when
 * present, otherwise by name in call order, generating a deterministic id as a
 * last resort.
 */
export function fromGemini(conversation: GeminiConversation, options: ConvertOptions = {}): OpenAIMessage[] {
  const reporter = new Reporter(options);
  const out: OpenAIMessage[] = [];
  const root: Record<string, unknown> = isRecord(conversation) ? conversation : {};

  const systemInstruction = isRecord(root.systemInstruction) ? root.systemInstruction : undefined;
  if (systemInstruction) {
    const text = textOf(systemInstruction.parts);
    if (text) out.push({ role: 'system', content: text });
  }

  const pending: PendingFunctionCall[] = [];
  const contents = Array.isArray(root.contents) ? root.contents : [];
  const ids = createToolCallIdGenerator(geminiProviderIds(root));

  for (const content of contents) {
    if (!isRecord(content)) {
      reporter.warn('dropped-content', 'Dropped a malformed Gemini content entry.');
      continue;
    }

    if (content.role === 'model') {
      const parts = geminiParts(content, reporter);
      const textPieces: string[] = [];
      const toolCalls: OpenAIToolCall[] = [];
      for (const part of parts) {
        if (isRecord(part) && isRecord(part.functionCall)) {
          const fc = part.functionCall as { id?: unknown; name?: unknown; args?: unknown };
          const name = providerFunctionName(fc.name, reporter, 'Gemini', 'functionCall');
          const providedId = nonEmptyString(fc.id) ? fc.id : undefined;
          const id = providedId ? ids.claim(providedId, name) : ids.generate(name);
          if (!providedId) {
            reporter.warn('generated-id', `Gemini functionCall '${name}' had no id; generated '${id}'.`);
          } else if (id !== providedId) {
            reporter.warn(
              'generated-id',
              `Gemini functionCall '${name}' reused id '${providedId}'; generated '${id}'.`,
            );
          }
          toolCalls.push({
            id,
            type: 'function',
            function: {
              name,
              arguments: stringifyArgumentsObject(fc.args, reporter, 'Gemini', 'functionCall', name),
            },
          });
          pending.push({ id, name, ...(providedId ? { providerId: providedId } : {}) });
        } else if (isRecord(part) && typeof part.text === 'string') {
          textPieces.push(part.text);
        } else {
          reporter.warn('dropped-content', 'Dropped an unsupported Gemini model content part.');
        }
      }
      const text = textPieces.join('');
      const assistant: OpenAIAssistantMessage = { role: 'assistant', content: text || null };
      if (toolCalls.length > 0) assistant.tool_calls = toolCalls;
      out.push(assistant);
      continue;
    }

    // role 'user' or unspecified
    if (content.role !== undefined && content.role !== 'user') {
      reporter.warn(
        'dropped-content',
        `Dropped a Gemini content entry with unsupported role '${String(content.role)}'.`,
      );
      continue;
    }
    const parts = geminiParts(content, reporter);
    let contentParts: OpenAIContentPart[] = [];
    let hasMedia = false;
    let sawUserContent = false;
    const flushContent = (): void => {
      if (!sawUserContent) return;
      if (contentParts.length === 0) {
        out.push({ role: 'user', content: '' });
      } else if (hasMedia) {
        out.push({ role: 'user', content: contentParts });
      } else {
        const text = textOf(contentParts);
        out.push({ role: 'user', content: text });
      }
      contentParts = [];
      hasMedia = false;
      sawUserContent = false;
    };

    for (const part of parts) {
      if (isRecord(part) && isRecord(part.functionResponse)) {
        const fr = part.functionResponse as { id?: unknown; name?: unknown; response?: unknown };
        const response = Object.prototype.hasOwnProperty.call(fr, 'response') ? fr.response : {};
        const responseId = nonEmptyString(fr.id) ? fr.id : undefined;
        const matchedName = responseId
          ? pending.find((pendingCall) => pendingCall.providerId === responseId || pendingCall.id === responseId)?.name
          : undefined;
        const name = geminiFunctionResponseName(fr.name, matchedName, reporter);
        const { id, matched } = resolveResponseId({ id: fr.id, name }, pending, reporter, ids);
        flushContent();
        out.push({
          role: 'tool',
          tool_call_id: id,
          content: unwrapResponse(response, reporter, 'Gemini', 'functionResponse'),
          ...(matched ? {} : { name }),
        });
        continue;
      }
      const image = imageFromGemini(part);
      if (image) {
        contentParts.push(imageToOpenAI(image));
        hasMedia = true;
        sawUserContent = true;
        continue;
      }
      const media = mediaFromGemini(part);
      if (media) {
        const openaiPart = mediaToOpenAI(media);
        if (openaiPart) {
          contentParts.push(openaiPart);
          hasMedia = true;
        } else {
          reporter.warn(
            'dropped-content',
            `A Gemini ${media.modality} ${media.source.kind} has no OpenAI Chat Completions equivalent; dropped.`,
          );
        }
        sawUserContent = true;
        continue;
      }
      if (isRecord(part) && typeof part.text === 'string') {
        contentParts.push({ type: 'text', text: part.text });
        sawUserContent = true;
        continue;
      }
      reporter.warn('dropped-content', 'Dropped an unsupported Gemini user content part.');
    }
    flushContent();
  }

  return out;
}

function geminiParts(content: Record<string, unknown>, reporter: Reporter): unknown[] {
  if (Array.isArray(content.parts)) return content.parts;
  reporter.warn('dropped-content', 'Dropped malformed Gemini content parts.');
  return [];
}

function geminiFunctionResponseName(value: unknown, matchedName: string | undefined, reporter: Reporter): string {
  if (matchedName && value === undefined) return matchedName;
  if (matchedName && !isProviderFunctionName(value)) {
    reporter.warn(
      'dropped-metadata',
      `Gemini functionResponse had a missing or invalid function name; used matching functionCall '${matchedName}'.`,
    );
    return matchedName;
  }
  return providerFunctionName(value, reporter, 'Gemini', 'functionResponse');
}

function resolveResponseId(
  response: { id?: unknown; name: string },
  pending: PendingFunctionCall[],
  reporter: Reporter,
  ids: ReturnType<typeof createToolCallIdGenerator>,
): { id: string; matched: boolean } {
  const responseId = nonEmptyString(response.id) ? response.id : undefined;
  if (response.id !== undefined && typeof response.id !== 'string') {
    reporter.warn(
      'dropped-metadata',
      `Gemini functionResponse for '${response.name}' had a non-string id; ignored it.`,
    );
  }

  if (responseId) {
    const index = pending.findIndex((p) => p.providerId === responseId || p.id === responseId);
    if (index >= 0) {
      const [match] = pending.splice(index, 1);
      if (response.name !== match.name) {
        reporter.warn(
          'dropped-metadata',
          `Gemini functionResponse '${responseId}' name '${response.name}' differed from matching functionCall '${match.name}'; used the call id mapping.`,
        );
      }
      return { id: match.id, matched: true };
    }
    reporter.warn(
      'unmapped-tool-result',
      `Gemini functionResponse '${responseId}' for '${response.name}' had no matching call; kept the response id.`,
    );
    const id = ids.claim(responseId, response.name);
    if (id !== responseId) {
      reporter.warn(
        'generated-id',
        `Gemini functionResponse '${responseId}' for '${response.name}' reused an existing id; generated '${id}'.`,
      );
    }
    return { id, matched: false };
  }
  const index = pending.findIndex((p) => p.name === response.name);
  if (index >= 0) {
    const { id } = pending[index];
    pending.splice(index, 1);
    return { id, matched: true };
  }
  const id = ids.generate(response.name);
  reporter.warn(
    'unmapped-tool-result',
    `Gemini functionResponse for '${response.name}' had no matching call; generated '${id}'.`,
  );
  return { id, matched: false };
}

function geminiProviderIds(conversation: unknown): string[] {
  const ids: string[] = [];
  const root: Record<string, unknown> = isRecord(conversation) ? conversation : {};
  const contents = Array.isArray(root.contents) ? root.contents : [];
  for (const content of contents) {
    if (!isRecord(content)) continue;
    const parts = Array.isArray(content.parts) ? content.parts : [];
    for (const part of parts) {
      if (isRecord(part) && isRecord(part.functionCall) && nonEmptyString(part.functionCall.id)) {
        ids.push(part.functionCall.id);
      }
      if (isRecord(part) && isRecord(part.functionResponse) && nonEmptyString(part.functionResponse.id)) {
        ids.push(part.functionResponse.id);
      }
    }
  }
  return ids;
}
