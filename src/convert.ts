import type { AnthropicConversation, ConvertOptions, GeminiConversation, OpenAIMessage, Provider } from './types.js';
import { fromAnthropic, toAnthropic } from './providers/anthropic.js';
import { fromGemini, toGemini } from './providers/gemini.js';

/** Maps a provider to the conversation shape it accepts and returns. */
export type ConversationOf<P extends Provider> = P extends 'openai'
  ? OpenAIMessage[]
  : P extends 'anthropic'
    ? AnthropicConversation
    : P extends 'gemini'
      ? GeminiConversation
      : never;

/**
 * Converts a conversation from one provider format to another. Every conversion
 * routes through the canonical OpenAI representation, so any source/target pair
 * is supported, including same-provider normalization.
 *
 * @example
 * const gemini = convert(openaiMessages, { from: 'openai', to: 'gemini' });
 * const openai = convert(anthropicBody, { from: 'anthropic', to: 'openai' });
 */
export function convert<From extends Provider, To extends Provider>(
  conversation: ConversationOf<From>,
  route: { from: From; to: To },
  options: ConvertOptions = {},
): ConversationOf<To> {
  const canonical = toCanonical(conversation, route.from, options);
  return fromCanonical(canonical, route.to, options) as ConversationOf<To>;
}

function toCanonical(conversation: unknown, from: Provider, options: ConvertOptions): OpenAIMessage[] {
  switch (from) {
    case 'openai':
      return conversation as OpenAIMessage[];
    case 'anthropic':
      return fromAnthropic(conversation as AnthropicConversation, options);
    case 'gemini':
      return fromGemini(conversation as GeminiConversation, options);
    default:
      throw new Error(`Unknown source provider: ${String(from)}`);
  }
}

function fromCanonical(canonical: OpenAIMessage[], to: Provider, options: ConvertOptions): ConversationOf<Provider> {
  switch (to) {
    case 'openai':
      return canonical;
    case 'anthropic':
      return toAnthropic(canonical, options);
    case 'gemini':
      return toGemini(canonical, options);
    default:
      throw new Error(`Unknown target provider: ${String(to)}`);
  }
}
