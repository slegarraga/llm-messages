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

  it('uses a canonical tool message name for standalone function responses', () => {
    const warnings: Warning[] = [];
    const { contents } = toGemini(
      [{ role: 'tool', tool_call_id: 'orphan_result', name: 'lookup_order', content: '{"status":"ready"}' }],
      { onWarning: (w) => warnings.push(w) },
    );
    expect(contents[0].parts[0]).toEqual({
      functionResponse: { id: 'orphan_result', name: 'lookup_order', response: { status: 'ready' } },
    });
    expect(warnings.some((w) => w.code === 'unmapped-tool-result')).toBe(false);
    expect(warnings.some((w) => w.code === 'dropped-metadata')).toBe(false);
  });

  it('reports OpenAI message metadata that Gemini cannot represent', () => {
    const warnings: Warning[] = [];
    toGemini(
      [
        { role: 'system', name: 'policy', content: 'Be concise.' },
        { role: 'user', name: 'customer', content: 'Hi' },
        {
          role: 'assistant',
          name: 'planner',
          content: null,
          tool_calls: [{ id: 'c1', type: 'function', function: { name: 'lookup_order', arguments: '{}' } }],
        },
        { role: 'tool', tool_call_id: 'c1', name: 'wrong_name', content: 'failed', is_error: true },
      ],
      { onWarning: (w) => warnings.push(w) },
    );

    const messages = warnings.filter((w) => w.code === 'dropped-metadata').map((w) => w.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining("system message name 'policy'"),
        expect.stringContaining("User message name 'customer'"),
        expect.stringContaining("Assistant message name 'planner'"),
        expect.stringContaining('is_error=true'),
        expect.stringContaining("Tool message name 'wrong_name'"),
      ]),
    );
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

  it('preserves empty user text parts as empty canonical user messages', () => {
    const out = fromGemini({ contents: [{ role: 'user', parts: [{ text: '' }] }] });
    expect(out).toEqual([{ role: 'user', content: '' }]);
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

  it('keeps standalone functionResponse names available for the next Gemini conversion', () => {
    const warnings: Warning[] = [];
    const out = fromGemini(
      {
        contents: [
          { role: 'user', parts: [{ functionResponse: { name: 'lookup_order', response: { result: 'done' } } }] },
        ],
      },
      { onWarning: (w) => warnings.push(w) },
    );
    const result = out[0] as Extract<OpenAIMessage, { role: 'tool' }>;
    expect(result.name).toBe('lookup_order');
    expect(warnings.some((w) => w.code === 'unmapped-tool-result')).toBe(true);
    expect(toGemini(out).contents[0].parts[0]).toEqual({
      functionResponse: { id: result.tool_call_id, name: 'lookup_order', response: { result: 'done' } },
    });
  });
});
