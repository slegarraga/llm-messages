import { describe, it, expect } from 'vitest';
import { toAnthropic, fromAnthropic, toGemini, fromGemini } from '../src/index.ts';
import type { OpenAIMessage } from '../src/index.ts';

/**
 * The headline correctness guarantee: a canonical conversation that contains
 * every interesting shape (system, user, an assistant tool call, a tool result)
 * survives a full round trip through each provider format unchanged.
 */
const canonical: OpenAIMessage[] = [
  { role: 'system', content: 'You are a weather assistant.' },
  { role: 'user', content: "What's the weather in Paris?" },
  {
    role: 'assistant',
    content: null,
    tool_calls: [
      { id: 'call_abc', type: 'function', function: { name: 'get_weather', arguments: '{"location":"Paris"}' } },
    ],
  },
  { role: 'tool', tool_call_id: 'call_abc', content: '15C partly cloudy' },
];

describe('round trip', () => {
  it('OpenAI -> Anthropic -> OpenAI is identity', () => {
    expect(fromAnthropic(toAnthropic(canonical))).toEqual(canonical);
  });

  it('OpenAI -> Gemini -> OpenAI is identity', () => {
    expect(fromGemini(toGemini(canonical))).toEqual(canonical);
  });

  it('preserves tool-call ids across a Gemini round trip', () => {
    const back = fromGemini(toGemini(canonical));
    const assistant = back.find((m) => m.role === 'assistant');
    expect(assistant && 'tool_calls' in assistant && assistant.tool_calls?.[0].id).toBe('call_abc');
  });
});
