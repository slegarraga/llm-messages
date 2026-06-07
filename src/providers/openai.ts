import type {
  OpenAIAssistantMessage,
  OpenAIMessage,
  OpenAISystemMessage,
  OpenAIToolMessage,
  OpenAIUserMessage,
} from '../types.js';
import { Reporter, textOf } from '../util.js';

/** Any canonical message other than a system/developer prompt. */
export type NonSystemMessage = OpenAIUserMessage | OpenAIAssistantMessage | OpenAIToolMessage;

function isSystem(message: OpenAIMessage): message is OpenAISystemMessage {
  return message.role === 'system' || message.role === 'developer';
}

/**
 * Splits a canonical OpenAI conversation into its system prompt and the
 * remaining messages. All `system` / `developer` messages are folded into a
 * single string (joined by blank lines) because Anthropic and Gemini carry the
 * system prompt as one top-level field. A system message that appears after the
 * conversation has started is still folded in, but reported as `system-midstream`.
 */
export function splitSystem(
  messages: OpenAIMessage[],
  reporter: Reporter,
): { system?: string; rest: NonSystemMessage[] } {
  const systemParts: string[] = [];
  const rest: NonSystemMessage[] = [];
  let started = false;

  for (const message of messages) {
    if (isSystem(message)) {
      if (typeof message.name === 'string') {
        reporter.warn(
          'dropped-metadata',
          `${message.role} message name '${message.name}' has no top-level system prompt equivalent; dropped.`,
        );
      }
      if (started) {
        reporter.warn(
          'system-midstream',
          'A system message appeared mid conversation; it was merged into the top-level system prompt.',
        );
      }
      systemParts.push(textOf(message.content));
      continue;
    }
    started = true;
    rest.push(message);
  }

  const system = systemParts.length > 0 ? systemParts.join('\n\n') : undefined;
  return system === undefined ? { rest } : { system, rest };
}
