import { describe, it, expect } from 'vitest';
import { toAnthropic, fromAnthropic } from '../src/index.ts';
import type { AnthropicContentBlock, OpenAIMessage, Warning } from '../src/index.ts';

describe('toAnthropic', () => {
  it('lifts system messages to the top-level system field', () => {
    const { system, messages } = toAnthropic([
      { role: 'system', content: 'Be concise.' },
      { role: 'user', content: 'Hi' },
    ]);
    expect(system).toBe('Be concise.');
    expect(messages).toEqual([{ role: 'user', content: 'Hi' }]);
  });

  it('parses tool-call arguments into an input object', () => {
    const { messages } = toAnthropic([
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 't1', type: 'function', function: { name: 'f', arguments: '{"a":1}' } }],
      },
    ]);
    const block = (messages[0].content as AnthropicContentBlock[])[0];
    expect(block).toEqual({ type: 'tool_use', id: 't1', name: 'f', input: { a: 1 } });
  });

  it('groups consecutive tool results into a single user turn', () => {
    const { messages } = toAnthropic([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 't1', type: 'function', function: { name: 'f', arguments: '{}' } },
          { id: 't2', type: 'function', function: { name: 'g', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: 't1', content: 'one' },
      { role: 'tool', tool_call_id: 't2', content: 'two' },
    ]);
    const userTurn = messages[messages.length - 1];
    expect(userTurn.role).toBe('user');
    expect((userTurn.content as AnthropicContentBlock[]).map((b) => b.type)).toEqual(['tool_result', 'tool_result']);
  });

  it('reports invalid tool-call arguments instead of throwing', () => {
    const warnings: Warning[] = [];
    toAnthropic(
      [
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 't1', type: 'function', function: { name: 'f', arguments: 'not json' } }],
        },
      ],
      { onWarning: (w) => warnings.push(w) },
    );
    expect(warnings.some((w) => w.code === 'invalid-json-arguments')).toBe(true);
  });
});

describe('fromAnthropic', () => {
  it('serializes tool_use input back into a JSON string', () => {
    const out = fromAnthropic({
      messages: [{ role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'f', input: { a: 1 } }] }],
    });
    const assistant = out[0] as Extract<OpenAIMessage, { role: 'assistant' }>;
    expect(assistant.tool_calls?.[0].function.arguments).toBe('{"a":1}');
  });

  it('turns tool_result blocks into standalone tool messages', () => {
    const out = fromAnthropic({
      messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'result' }] }],
    });
    expect(out).toEqual([{ role: 'tool', tool_call_id: 't1', content: 'result' }]);
  });
});
