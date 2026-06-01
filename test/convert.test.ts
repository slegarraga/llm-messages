import { describe, it, expect } from 'vitest';
import { convert } from '../src/index.ts';
import type { AnthropicConversation, GeminiConversation, OpenAIMessage } from '../src/index.ts';

const openai: OpenAIMessage[] = [
  { role: 'system', content: 'sys' },
  { role: 'user', content: 'hi' },
];

describe('convert', () => {
  it('routes OpenAI to Anthropic', () => {
    const out = convert(openai, { from: 'openai', to: 'anthropic' });
    expect(out).toEqual({ system: 'sys', messages: [{ role: 'user', content: 'hi' }] });
  });

  it('routes OpenAI to Gemini', () => {
    const out = convert(openai, { from: 'openai', to: 'gemini' });
    expect(out.systemInstruction).toEqual({ parts: [{ text: 'sys' }] });
    expect(out.contents[0]).toEqual({ role: 'user', parts: [{ text: 'hi' }] });
  });

  it('routes Anthropic to Gemini through the canonical hub', () => {
    const anthropic: AnthropicConversation = { system: 'sys', messages: [{ role: 'user', content: 'hi' }] };
    const out: GeminiConversation = convert(anthropic, { from: 'anthropic', to: 'gemini' });
    expect(out.systemInstruction).toEqual({ parts: [{ text: 'sys' }] });
    expect(out.contents).toEqual([{ role: 'user', parts: [{ text: 'hi' }] }]);
  });

  it('normalizes within the same provider (openai to openai)', () => {
    expect(convert(openai, { from: 'openai', to: 'openai' })).toEqual(openai);
  });
});
