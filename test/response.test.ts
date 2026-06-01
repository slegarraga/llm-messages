import { describe, it, expect } from 'vitest';
import { responseFromOpenAI, responseFromAnthropic, responseFromGemini, normalizeResponse } from '../src/index.ts';
import type { Warning } from '../src/index.ts';

describe('responseFromOpenAI', () => {
  it('passes the assistant message through and reads usage', () => {
    const r = responseFromOpenAI({
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'hi',
            tool_calls: [{ id: 'c1', type: 'function', function: { name: 'f', arguments: '{"a":1}' } }],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    expect(r.message).toEqual({
      role: 'assistant',
      content: 'hi',
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'f', arguments: '{"a":1}' } }],
    });
    expect(r.finishReason).toBe('tool_calls');
    expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });
});

describe('responseFromAnthropic', () => {
  it('collects text, serializes tool input, maps stop_reason and usage', () => {
    const r = responseFromAnthropic({
      type: 'message',
      role: 'assistant',
      content: [
        { type: 'text', text: 'sure' },
        { type: 'tool_use', id: 't1', name: 'get', input: { x: 1 } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 30, output_tokens: 12 },
    });
    expect(r.message.content).toBe('sure');
    expect(r.message.tool_calls).toEqual([
      { id: 't1', type: 'function', function: { name: 'get', arguments: '{"x":1}' } },
    ]);
    expect(r.finishReason).toBe('tool_calls');
    expect(r.usage).toEqual({ inputTokens: 30, outputTokens: 12 });
  });

  it('returns null content and stop for a text-only end_turn', () => {
    const r = responseFromAnthropic({
      content: [{ type: 'text', text: 'hello' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 2 },
    });
    expect(r.message).toEqual({ role: 'assistant', content: 'hello' });
    expect(r.finishReason).toBe('stop');
  });
});

describe('responseFromGemini', () => {
  it('normalizes model parts, overrides finish reason to tool_calls, generates ids', () => {
    const warnings: Warning[] = [];
    const r = responseFromGemini(
      {
        candidates: [
          {
            content: { role: 'model', parts: [{ text: 'ok' }, { functionCall: { name: 'search', args: { q: 'x' } } }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3, totalTokenCount: 10 },
      },
      { onWarning: (w) => warnings.push(w) },
    );
    expect(r.message.content).toBe('ok');
    expect(r.message.tool_calls).toEqual([
      { id: 'call_search_0', type: 'function', function: { name: 'search', arguments: '{"q":"x"}' } },
    ]);
    expect(r.finishReason).toBe('tool_calls');
    expect(r.usage).toEqual({ inputTokens: 7, outputTokens: 3 });
    expect(warnings.some((w) => w.code === 'generated-id')).toBe(true);
  });

  it('keeps an existing functionCall id', () => {
    const r = responseFromGemini({
      candidates: [{ content: { parts: [{ functionCall: { id: 'g1', name: 'f', args: {} } }] }, finishReason: 'STOP' }],
    });
    expect(r.message.tool_calls?.[0].id).toBe('g1');
  });
});

describe('normalizeResponse', () => {
  it('dispatches by source provider', () => {
    const r = normalizeResponse(
      { choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }] },
      { from: 'openai' },
    );
    expect(r.message.content).toBe('hi');
    expect(r.finishReason).toBe('stop');
  });
});
