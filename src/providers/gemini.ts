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
import { Reporter, isRecord, parseArguments, textOf, unwrapResponse, wrapResponse } from '../util.js';
import { imageFromGemini, imageFromOpenAI, imageToGemini, imageToOpenAI } from '../image.js';
import { mediaFromGemini, mediaFromOpenAI, mediaToGemini, mediaToOpenAI } from '../media.js';
import { splitSystem } from './openai.js';

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
        const name = matchingName ?? tool.name;
        if (!name) {
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
 * Because Gemini matches tool calls and responses by function name (the `id`
 * field is optional), this maintains a queue of pending calls and resolves each
 * `functionResponse` by id when present, otherwise by name in call order,
 * generating a deterministic id as a last resort.
 */
export function fromGemini(conversation: GeminiConversation, options: ConvertOptions = {}): OpenAIMessage[] {
  const reporter = new Reporter(options);
  const out: OpenAIMessage[] = [];

  if (conversation.systemInstruction) {
    const text = textOf(conversation.systemInstruction.parts);
    if (text) out.push({ role: 'system', content: text });
  }

  const pending: { id: string; name: string }[] = [];
  let counter = 0;
  const generateId = (name: string): string => `call_${name.replace(/[^a-zA-Z0-9_-]/g, '_')}_${counter++}`;

  for (const content of conversation.contents) {
    const parts = Array.isArray(content.parts) ? content.parts : [];

    if (content.role === 'model') {
      const textPieces: string[] = [];
      const toolCalls: OpenAIToolCall[] = [];
      for (const part of parts) {
        if (isRecord(part) && isRecord(part.functionCall)) {
          const fc = part.functionCall as { id?: string; name: string; args?: Record<string, unknown> };
          const id = fc.id ?? generateId(fc.name);
          if (!fc.id) reporter.warn('generated-id', `Gemini functionCall '${fc.name}' had no id; generated '${id}'.`);
          toolCalls.push({
            id,
            type: 'function',
            function: { name: fc.name, arguments: JSON.stringify(fc.args ?? {}) },
          });
          pending.push({ id, name: fc.name });
        } else if (isRecord(part) && typeof part.text === 'string') {
          textPieces.push(part.text);
        }
      }
      const text = textPieces.join('');
      const assistant: OpenAIAssistantMessage = { role: 'assistant', content: text || null };
      if (toolCalls.length > 0) assistant.tool_calls = toolCalls;
      out.push(assistant);
      continue;
    }

    // role 'user' or unspecified
    const contentParts: OpenAIContentPart[] = [];
    let hasMedia = false;
    for (const part of parts) {
      if (isRecord(part) && isRecord(part.functionResponse)) {
        const fr = part.functionResponse as { id?: string; name: string; response?: Record<string, unknown> };
        const { id, matched } = resolveResponseId(fr, pending, reporter, generateId);
        out.push({
          role: 'tool',
          tool_call_id: id,
          content: unwrapResponse(fr.response ?? {}),
          ...(matched ? {} : { name: fr.name }),
        });
        continue;
      }
      const image = imageFromGemini(part);
      if (image) {
        contentParts.push(imageToOpenAI(image));
        hasMedia = true;
        continue;
      }
      const media = mediaFromGemini(part);
      if (media) {
        const openaiPart = mediaToOpenAI(media);
        if (openaiPart) {
          contentParts.push(openaiPart);
          hasMedia = true;
        }
        continue;
      }
      if (isRecord(part) && typeof part.text === 'string') {
        contentParts.push({ type: 'text', text: part.text });
      }
    }
    if (contentParts.length > 0) {
      if (hasMedia) {
        out.push({ role: 'user', content: contentParts });
      } else {
        const text = textOf(contentParts);
        out.push({ role: 'user', content: text });
      }
    }
  }

  return out;
}

function resolveResponseId(
  response: { id?: string; name: string },
  pending: { id: string; name: string }[],
  reporter: Reporter,
  generateId: (name: string) => string,
): { id: string; matched: boolean } {
  if (response.id) {
    const index = pending.findIndex((p) => p.id === response.id);
    if (index >= 0) pending.splice(index, 1);
    return { id: response.id, matched: index >= 0 };
  }
  const index = pending.findIndex((p) => p.name === response.name);
  if (index >= 0) {
    const { id } = pending[index];
    pending.splice(index, 1);
    return { id, matched: true };
  }
  const id = generateId(response.name);
  reporter.warn(
    'unmapped-tool-result',
    `Gemini functionResponse for '${response.name}' had no matching call; generated '${id}'.`,
  );
  return { id, matched: false };
}
