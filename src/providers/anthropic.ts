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
import { Reporter, isRecord, parseArguments, textOf } from '../util.js';
import { imageFromAnthropic, imageFromOpenAI, imageToAnthropic, imageToOpenAI } from '../image.js';
import { mediaFromAnthropic, mediaFromOpenAI, mediaToAnthropic, mediaToOpenAI } from '../media.js';
import { splitSystem } from './openai.js';

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
        blocks.push({ type: 'tool_result', tool_use_id: tool.tool_call_id, content: textOf(tool.content) });
        j++;
      }
      out.push({ role: 'user', content: blocks });
      i = j - 1;
      continue;
    }

    if (message.role === 'user') {
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
  return blocks;
}

function assistantContent(message: OpenAIAssistantMessage, reporter: Reporter): string | AnthropicContentBlock[] {
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

function asBlocks(content: string | AnthropicContentBlock[]): AnthropicContentBlock[] {
  if (typeof content !== 'string') return content;
  return content ? [{ type: 'text', text: content }] : [];
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
  if (conversation.system) {
    out.push({ role: 'system', content: textOf(conversation.system) });
  }

  for (const message of conversation.messages) {
    const blocks = asBlocks(message.content);

    if (message.role === 'user') {
      const toolResults = blocks.filter((b) => b.type === 'tool_result');
      const contentBlocks = blocks.filter((b) => b.type !== 'tool_result');
      for (const block of toolResults) {
        out.push({
          role: 'tool',
          tool_call_id: String((block as { tool_use_id?: string }).tool_use_id ?? ''),
          content: textOf((block as { content?: unknown }).content),
        });
      }
      if (contentBlocks.length > 0) {
        out.push({ role: 'user', content: userContentToOpenAI(contentBlocks, reporter) });
      }
      continue;
    }

    // assistant
    const text = textOf(blocks.filter((b) => b.type === 'text'));
    const toolUses = blocks.filter((b) => b.type === 'tool_use');
    const assistant: OpenAIAssistantMessage = { role: 'assistant', content: text || null };
    if (toolUses.length > 0) {
      assistant.tool_calls = toolUses.map((block) => {
        const b = block as { id: string; name: string; input: Record<string, unknown> };
        return { id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } };
      });
    }
    out.push(assistant);
  }

  return out;
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
  return parts;
}
