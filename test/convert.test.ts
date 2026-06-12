import { describe, it, expect } from 'vitest';
import { convert } from '../src/index.ts';
import type { AnthropicConversation, GeminiConversation, OpenAIMessage, Warning } from '../src/index.ts';

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

  it('warns when a system message appears after the conversation starts', () => {
    const warnings: Warning[] = [];
    const out = convert(
      [
        { role: 'system', content: 'first' },
        { role: 'user', content: 'hi' },
        { role: 'system', content: 'late' },
      ],
      { from: 'openai', to: 'anthropic' },
      { onWarning: (warning) => warnings.push(warning) },
    );

    expect(out).toEqual({ system: 'first\n\nlate', messages: [{ role: 'user', content: 'hi' }] });
    expect(warnings).toEqual([
      {
        code: 'system-midstream',
        message: expect.stringContaining('mid conversation'),
      },
    ]);
  });

  it('folds developer messages into target system prompts', () => {
    const warnings: Warning[] = [];
    const out: GeminiConversation = convert(
      [
        { role: 'developer', content: 'Use JSON.' },
        { role: 'user', content: 'hi' },
        { role: 'developer', content: [{ type: 'text', text: 'Later rule.' }] },
      ],
      { from: 'openai', to: 'gemini' },
      { onWarning: (warning) => warnings.push(warning) },
    );

    expect(out.systemInstruction).toEqual({ parts: [{ text: 'Use JSON.\n\nLater rule.' }] });
    expect(out.contents).toEqual([{ role: 'user', parts: [{ text: 'hi' }] }]);
    expect(warnings.map((warning) => warning.code)).toEqual(['system-midstream']);
  });

  it('routes Anthropic to Gemini through the canonical hub', () => {
    const anthropic: AnthropicConversation = { system: 'sys', messages: [{ role: 'user', content: 'hi' }] };
    const out: GeminiConversation = convert(anthropic, { from: 'anthropic', to: 'gemini' });
    expect(out.systemInstruction).toEqual({ parts: [{ text: 'sys' }] });
    expect(out.contents).toEqual([{ role: 'user', parts: [{ text: 'hi' }] }]);
  });

  it('passes warning options to source-provider normalization', () => {
    const warnings: Warning[] = [];
    const anthropic: AnthropicConversation = {
      messages: [
        {
          role: 'user',
          content: [{ type: 'document', source: { type: 'url', url: 'https://example.com/report.pdf' } }],
        },
      ],
    };

    const out: GeminiConversation = convert(
      anthropic,
      { from: 'anthropic', to: 'gemini' },
      { onWarning: (warning) => warnings.push(warning) },
    );

    expect(out.contents).toEqual([{ role: 'user', parts: [{ text: '' }] }]);
    expect(warnings).toEqual([
      {
        code: 'dropped-content',
        message: expect.stringContaining('no OpenAI Chat Completions equivalent'),
      },
    ]);
  });

  it('normalizes within the same provider (openai to openai)', () => {
    expect(convert(openai, { from: 'openai', to: 'openai' })).toEqual(openai);
  });
});
