import type {
  AnthropicContentBlock,
  AnthropicConversation,
  AnthropicMessage,
  ConvertOptions,
  OpenAIAssistantMessage,
  OpenAIContentPart,
  OpenAIMessage,
  OpenAIToolMessage,
} from '../types.js';
import {
  Reporter,
  createToolCallIdGenerator,
  isRecord,
  parseArguments,
  providerFunctionName,
  stringifyArgumentsObject,
  textOf,
} from '../util.js';
import { imageFromAnthropic, imageFromOpenAI, imageToAnthropic, imageToOpenAI } from '../image.js';
import { mediaFromAnthropic, mediaFromOpenAI, mediaToAnthropic, mediaToOpenAI } from '../media.js';
import { splitSystem } from './openai.js';

const nonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/* ------------------------------------------------------------------ */
/* OpenAI (canonical) -> Anthropic                                     */
/* ------------------------------------------------------------------ */

/**
 * Converts a canonical OpenAI conversation into an Anthropic request fragment
 * (`{ system, messages }`). System messages move to the top-level `system`
 * field, tool-call arguments are JSON parsed into `input` objects, tool results
 * are folded into `tool_result` blocks inside a user turn, and consecutive
 * same-role turns are merged to satisfy Anthropic's strict alternation.
 */
export function toAnthropic(messages: OpenAIMessage[], options: ConvertOptions = {}): AnthropicConversation {
  const reporter = new Reporter(options);
  const { system, rest } = splitSystem(messages, reporter);
  const out: AnthropicMessage[] = [];

  for (let i = 0; i < rest.length; i++) {
    const message = rest[i];

    if (message.role === 'tool') {
      const blocks: AnthropicContentBlock[] = [];
      let j = i;
      while (j < rest.length && rest[j].role === 'tool') {
        const tool = rest[j] as OpenAIToolMessage;
        if (typeof tool.name === 'string') {
          reporter.warn(
            'dropped-metadata',
            `Tool message name '${tool.name}' has no Anthropic tool_result equivalent; dropped.`,
          );
        }
        blocks.push({
          type: 'tool_result',
          tool_use_id: tool.tool_call_id,
          content: textOf(tool.content),
          ...(typeof tool.is_error === 'boolean' ? { is_error: tool.is_error } : {}),
        });
        j++;
      }
      out.push({ role: 'user', content: blocks });
      i = j - 1;
      continue;
    }

    if (message.role === 'user') {
      warnDroppedName('User', message.name, 'Anthropic', reporter);
      out.push({ role: 'user', content: userContent(message.content, reporter) });
      continue;
    }

    out.push({ role: 'assistant', content: assistantContent(message, reporter) });
  }

  const merged = mergeConsecutive(out, reporter);
  return system === undefined ? { messages: merged } : { system, messages: merged };
}

function userContent(content: string | OpenAIContentPart[], reporter: Reporter): string | AnthropicContentBlock[] {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return textOf(content);
  const blocks: AnthropicContentBlock[] = [];
  for (const part of content) {
    if (isRecord(part) && part.type === 'text' && typeof part.text === 'string') {
      blocks.push({ type: 'text', text: part.text });
      continue;
    }
    const image = imageFromOpenAI(part);
    if (image) {
      blocks.push(imageToAnthropic(image));
      continue;
    }
    const media = mediaFromOpenAI(part);
    if (media) {
      const block = mediaToAnthropic(media, reporter);
      if (block) blocks.push(block);
      continue;
    }
    reporter.warn('dropped-content', 'Dropped an unsupported user content part.');
  }
  return blocks.length > 0 ? blocks : '';
}

function assistantContent(message: OpenAIAssistantMessage, reporter: Reporter): string | AnthropicContentBlock[] {
  warnDroppedName('Assistant', message.name, 'Anthropic', reporter);
  const text = textOf(message.content ?? '');
  const toolCalls = message.tool_calls ?? [];
  if (toolCalls.length === 0) return text;

  const blocks: AnthropicContentBlock[] = [];
  if (text) blocks.push({ type: 'text', text });
  for (const call of toolCalls) {
    blocks.push({
      type: 'tool_use',
      id: call.id,
      name: call.function.name,
      input: parseArguments(call.function.arguments, reporter, call.function.name),
    });
  }
  return blocks;
}

function warnDroppedName(role: string, name: string | undefined, provider: string, reporter: Reporter): void {
  if (typeof name !== 'string') return;
  reporter.warn('dropped-metadata', `${role} message name '${name}' has no ${provider} equivalent; dropped.`);
}

/** Merges adjacent same-role messages by concatenating their content blocks. */
function mergeConsecutive(messages: AnthropicMessage[], reporter: Reporter): AnthropicMessage[] {
  const result: AnthropicMessage[] = [];
  for (const message of messages) {
    const previous = result[result.length - 1];
    if (previous && previous.role === message.role) {
      previous.content = [...asBlocks(previous.content), ...asBlocks(message.content)];
      reporter.warn(
        'merged-role',
        `Merged consecutive '${message.role}' turns (Anthropic requires alternating roles).`,
      );
    } else {
      result.push({ role: message.role, content: message.content });
    }
  }
  return result;
}

function asBlocks(content: unknown): AnthropicContentBlock[] {
  if (Array.isArray(content)) return content.filter(isRecord) as AnthropicContentBlock[];
  if (typeof content !== 'string') return [];
  return content ? [{ type: 'text', text: content }] : [];
}

function warnMalformedBlocks(content: unknown, reporter: Reporter): void {
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!isRecord(block)) {
        reporter.warn('dropped-content', 'Dropped a malformed Anthropic content block.');
      }
    }
    return;
  }
  if (typeof content !== 'string') {
    reporter.warn('dropped-content', 'Dropped malformed Anthropic message content.');
  }
}

function isSupportedUserBlock(block: AnthropicContentBlock): boolean {
  return (
    (block.type === 'text' && typeof block.text === 'string') ||
    block.type === 'tool_result' ||
    imageFromAnthropic(block) !== null ||
    mediaFromAnthropic(block) !== null
  );
}

function isSupportedAssistantBlock(block: AnthropicContentBlock): boolean {
  return (block.type === 'text' && typeof block.text === 'string') || block.type === 'tool_use';
}

function warnUnsupportedBlocks(blocks: AnthropicContentBlock[], role: 'user' | 'assistant', reporter: Reporter): void {
  const isSupported = role === 'user' ? isSupportedUserBlock : isSupportedAssistantBlock;
  for (const block of blocks) {
    if (isSupported(block)) continue;
    reporter.warn('dropped-content', `Dropped unsupported Anthropic ${role} content block '${String(block.type)}'.`);
  }
}

/* ------------------------------------------------------------------ */
/* Anthropic -> OpenAI (canonical)                                     */
/* ------------------------------------------------------------------ */

/**
 * Converts an Anthropic request fragment back into a canonical OpenAI message
 * array. The top-level `system` becomes a leading system message, `tool_use`
 * blocks become `tool_calls` (with `input` re-serialized to a JSON string), and
 * `tool_result` blocks become standalone `role: 'tool'` messages.
 */
export function fromAnthropic(conversation: AnthropicConversation, options: ConvertOptions = {}): OpenAIMessage[] {
  const reporter = new Reporter(options);
  const out: OpenAIMessage[] = [];
  const root: Record<string, unknown> = isRecord(conversation) ? conversation : {};
  const system = textOf(root.system);
  if (system) {
    out.push({ role: 'system', content: system });
  }
  const messages = Array.isArray(root.messages) ? root.messages : [];
  const ids = createToolCallIdGenerator(anthropicProviderIds(root));
  const pendingToolUseIds = new Map<string, string[]>();

  for (const message of messages) {
    if (!isRecord(message)) {
      reporter.warn('dropped-content', 'Dropped a malformed Anthropic message.');
      continue;
    }
    if (message.role !== 'user' && message.role !== 'assistant') {
      reporter.warn('dropped-content', `Dropped an Anthropic message with unsupported role '${String(message.role)}'.`);
      continue;
    }
    warnMalformedBlocks(message.content, reporter);
    const blocks = asBlocks(message.content);
    warnUnsupportedBlocks(blocks, message.role, reporter);

    if (message.role === 'user') {
      if (blocks.length === 0) {
        out.push({ role: 'user', content: '' });
        continue;
      }

      let contentBlocks: AnthropicContentBlock[] = [];
      const flushContent = (): void => {
        if (contentBlocks.length > 0) {
          out.push({ role: 'user', content: userContentToOpenAI(contentBlocks, reporter) });
          contentBlocks = [];
        }
      };

      for (const block of blocks) {
        if (block.type !== 'tool_result') {
          contentBlocks.push(block);
          continue;
        }

        flushContent();
        const rawToolUseId = (block as { tool_use_id?: unknown }).tool_use_id;
        const hasToolUseId = nonEmptyString(rawToolUseId);
        const matchedToolCallId = hasToolUseId ? takePendingToolUseId(pendingToolUseIds, rawToolUseId) : undefined;
        const toolCallId =
          matchedToolCallId ?? (hasToolUseId ? ids.claim(rawToolUseId, 'tool_result') : ids.generate('tool_result'));
        if (!hasToolUseId) {
          reporter.warn(
            'unmapped-tool-result',
            `Anthropic tool_result had no usable tool_use_id; generated '${toolCallId}'.`,
          );
        } else if (!matchedToolCallId) {
          const unmappedMessage =
            toolCallId === rawToolUseId
              ? `Anthropic tool_result '${rawToolUseId}' had no matching tool_use; kept the result id.`
              : `Anthropic tool_result '${rawToolUseId}' had no matching tool_use; generated '${toolCallId}'.`;
          reporter.warn('unmapped-tool-result', unmappedMessage);
          if (toolCallId !== rawToolUseId) {
            reporter.warn(
              'generated-id',
              `Anthropic tool_result '${rawToolUseId}' reused an existing id; generated '${toolCallId}'.`,
            );
          }
        }
        out.push({
          role: 'tool',
          tool_call_id: toolCallId,
          content: textOf((block as { content?: unknown }).content),
          ...(typeof (block as { is_error?: unknown }).is_error === 'boolean'
            ? { is_error: (block as { is_error: boolean }).is_error }
            : {}),
        });
      }
      flushContent();
      continue;
    }

    // assistant
    const text = textOf(blocks.filter((b) => b.type === 'text'));
    const toolUses = blocks.filter((b) => b.type === 'tool_use');
    const assistant: OpenAIAssistantMessage = { role: 'assistant', content: text || null };
    if (toolUses.length > 0) {
      assistant.tool_calls = toolUses.map((block) => {
        const b = block as { id?: unknown; name?: unknown; input?: unknown };
        const name = providerFunctionName(b.name, reporter, 'Anthropic', 'tool_use');
        const providedId = nonEmptyString(b.id) ? b.id : undefined;
        const id = providedId ? ids.claim(providedId, name) : ids.generate(name);
        if (!providedId) {
          reporter.warn('generated-id', `Anthropic tool_use '${name}' had no id; generated '${id}'.`);
        } else if (id !== providedId) {
          reporter.warn('generated-id', `Anthropic tool_use '${name}' reused id '${providedId}'; generated '${id}'.`);
        }
        if (providedId) pushPendingToolUseId(pendingToolUseIds, providedId, id);
        return {
          id,
          type: 'function',
          function: {
            name,
            arguments: stringifyArgumentsObject(b.input, reporter, 'Anthropic', 'tool_use', name),
          },
        };
      });
    }
    out.push(assistant);
  }

  return out;
}

function pushPendingToolUseId(pending: Map<string, string[]>, providerId: string, normalizedId: string): void {
  const ids = pending.get(providerId);
  if (ids) ids.push(normalizedId);
  else pending.set(providerId, [normalizedId]);
}

function takePendingToolUseId(pending: Map<string, string[]>, providerId: string): string | undefined {
  const ids = pending.get(providerId);
  const id = ids?.shift();
  if (ids?.length === 0) pending.delete(providerId);
  return id;
}

function anthropicProviderIds(conversation: unknown): string[] {
  const ids: string[] = [];
  const root: Record<string, unknown> = isRecord(conversation) ? conversation : {};
  const messages = Array.isArray(root.messages) ? root.messages : [];
  for (const message of messages) {
    if (!isRecord(message)) continue;
    for (const block of asBlocks(message.content)) {
      if (block.type === 'tool_use' && nonEmptyString((block as { id?: unknown }).id)) {
        ids.push((block as { id: string }).id);
      }
      if (block.type === 'tool_result' && nonEmptyString((block as { tool_use_id?: unknown }).tool_use_id)) {
        ids.push((block as { tool_use_id: string }).tool_use_id);
      }
    }
  }
  return ids;
}

/** Rebuilds OpenAI user content from Anthropic blocks, as a string unless media is present. */
function userContentToOpenAI(blocks: AnthropicContentBlock[], reporter: Reporter): string | OpenAIContentPart[] {
  const hasMedia = blocks.some((block) => imageFromAnthropic(block) !== null || mediaFromAnthropic(block) !== null);
  if (!hasMedia) return textOf(blocks);
  const parts: OpenAIContentPart[] = [];
  for (const block of blocks) {
    const image = imageFromAnthropic(block);
    if (image) {
      parts.push(imageToOpenAI(image));
      continue;
    }
    const media = mediaFromAnthropic(block);
    if (media) {
      const part = mediaToOpenAI(media);
      if (part) parts.push(part);
      else reporter.warn('dropped-content', 'A document URL has no OpenAI Chat Completions equivalent; dropped.');
      continue;
    }
    if (isRecord(block) && block.type === 'text' && typeof block.text === 'string') {
      parts.push({ type: 'text', text: block.text });
    }
  }
  return parts.length > 0 ? parts : '';
}
