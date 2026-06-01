import { describe, it, expect } from 'vitest';
import { toGemini, fromGemini } from '../src/index.ts';
import type { GeminiContent, GeminiFunctionCallPart, OpenAIMessage, Warning } from '../src/index.ts';

describe('toGemini', () => {
  it('maps the assistant role to model and lifts the system instruction', () => {
    const { systemInstruction, contents } = toGemini([
      { role: 'system', content: 'Be nice.' },
      { role: 'assistant', content: 'Hello' },
    ]);
    expect(systemInstruction).toEqual({ parts: [{ text: 'Be nice.' }] });
    expect(contents[0].role).toBe('model');
  });

  it('carries the tool-call id and parses args, recovering the name for responses', () => {
    const { contents } = toGemini([
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_weather', arguments: '{"q":"x"}' } }],
      },
      { role: 'tool', tool_call_id: 'c1', content: 'sunny' },
    ]);
    const call = (contents[0].parts[0] as GeminiFunctionCallPart).functionCall;
    expect(call).toEqual({ id: 'c1', name: 'get_weather', args: { q: 'x' } });
    expect(contents[1].parts[0]).toEqual({
      functionResponse: { id: 'c1', name: 'get_weather', response: { result: 'sunny' } },
    });
  });

  it('merges consecutive same-role turns', () => {
    const warnings: Warning[] = [];
    const { contents } = toGemini(
      [
        { role: 'user', content: 'a' },
        { role: 'user', content: 'b' },
      ],
      { onWarning: (w) => warnings.push(w) },
    );
    expect(contents).toHaveLength(1);
    expect((contents[0] as GeminiContent).parts).toEqual([{ text: 'a' }, { text: 'b' }]);
    expect(warnings.some((w) => w.code === 'merged-role')).toBe(true);
  });
});

describe('fromGemini', () => {
  it('generates a deterministic id when a functionCall has none', () => {
    const warnings: Warning[] = [];
    const out = fromGemini(
      {
        contents: [{ role: 'model', parts: [{ functionCall: { name: 'search', args: { q: 'x' } } }] }],
      },
      { onWarning: (w) => warnings.push(w) },
    );
    const assistant = out[0] as Extract<OpenAIMessage, { role: 'assistant' }>;
    expect(assistant.tool_calls?.[0].id).toBe('call_search_0');
    expect(warnings.some((w) => w.code === 'generated-id')).toBe(true);
  });

  it('matches a functionResponse to its call by name when no id is present', () => {
    const out = fromGemini({
      contents: [
        { role: 'model', parts: [{ functionCall: { name: 'search', args: {} } }] },
        { role: 'user', parts: [{ functionResponse: { name: 'search', response: { result: 'done' } } }] },
      ],
    });
    const call = out.find((m) => m.role === 'assistant') as Extract<OpenAIMessage, { role: 'assistant' }>;
    const result = out.find((m) => m.role === 'tool') as Extract<OpenAIMessage, { role: 'tool' }>;
    expect(result.tool_call_id).toBe(call.tool_calls?.[0].id);
    expect(result.content).toBe('done');
  });
});
