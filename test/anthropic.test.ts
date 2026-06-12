import { describe, it, expect } from 'vitest';
import { toAnthropic, fromAnthropic } from '../src/index.ts';
import type { AnthropicContentBlock, AnthropicConversation, OpenAIMessage, Warning } from '../src/index.ts';

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

  it('preserves tool_result error flags from canonical tool messages', () => {
    const { messages } = toAnthropic([
      { role: 'tool', tool_call_id: 't1', content: 'failed', is_error: true },
      { role: 'tool', tool_call_id: 't2', content: 'ok', is_error: false },
    ]);
    const content = messages[0].content as AnthropicContentBlock[];
    expect(content).toEqual([
      { type: 'tool_result', tool_use_id: 't1', content: 'failed', is_error: true },
      { type: 'tool_result', tool_use_id: 't2', content: 'ok', is_error: false },
    ]);
  });

  it('reports OpenAI message metadata that Anthropic cannot represent', () => {
    const warnings: Warning[] = [];
    toAnthropic(
      [
        { role: 'system', name: 'policy', content: 'Be concise.' },
        { role: 'user', name: 'customer', content: 'Hi' },
        { role: 'assistant', name: 'planner', content: null },
        { role: 'tool', tool_call_id: 'orphan', name: 'lookup_order', content: 'done' },
      ],
      { onWarning: (w) => warnings.push(w) },
    );

    const messages = warnings.filter((w) => w.code === 'dropped-metadata').map((w) => w.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining("system message name 'policy'"),
        expect.stringContaining("User message name 'customer'"),
        expect.stringContaining("Assistant message name 'planner'"),
        expect.stringContaining("Tool message name 'lookup_order'"),
      ]),
    );
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
  it('returns an empty canonical conversation for malformed top-level bodies', () => {
    expect(fromAnthropic(null as unknown as AnthropicConversation)).toEqual([]);
    expect(fromAnthropic({} as AnthropicConversation)).toEqual([]);
    expect(fromAnthropic({ messages: 'not an array' } as unknown as AnthropicConversation)).toEqual([]);
  });

  it('drops malformed message entries without losing valid Anthropic turns', () => {
    const warnings: Warning[] = [];
    const out = fromAnthropic(
      {
        system: 'Be concise.',
        messages: [
          null,
          { role: 'other', content: 'bad role' },
          { role: 'assistant', content: [{ type: 'text', text: 'ready' }] },
        ],
      } as unknown as AnthropicConversation,
      { onWarning: (warning) => warnings.push(warning) },
    );

    expect(out).toEqual([
      { role: 'system', content: 'Be concise.' },
      { role: 'assistant', content: 'ready' },
    ]);
    expect(warnings.map((warning) => warning.code)).toEqual(['dropped-content', 'dropped-content']);
  });

  it('warns when dropping malformed content blocks without losing valid Anthropic content', () => {
    const warnings: Warning[] = [];
    const out = fromAnthropic(
      {
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Hello' }, null, 'bad block', { type: 'text', text: ' world' }],
          },
        ],
      } as unknown as AnthropicConversation,
      { onWarning: (warning) => warnings.push(warning) },
    );

    expect(out).toEqual([{ role: 'user', content: 'Hello world' }]);
    expect(warnings.map((warning) => warning.code)).toEqual(['dropped-content', 'dropped-content']);
  });

  it('warns when dropping unsupported role-specific content blocks', () => {
    const warnings: Warning[] = [];
    const out = fromAnthropic(
      {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'kept' },
              { type: 'unknown_block', value: true } as unknown as AnthropicContentBlock,
              { type: 'image', source: { type: 'url' } } as unknown as AnthropicContentBlock,
            ],
          },
          {
            role: 'assistant',
            content: [
              { type: 'text', text: 'ready' },
              { type: 'tool_result', tool_use_id: 't1', content: 'wrong side' },
            ],
          },
        ],
      },
      { onWarning: (warning) => warnings.push(warning) },
    );

    expect(out).toEqual([
      { role: 'user', content: 'kept' },
      { role: 'assistant', content: 'ready' },
    ]);
    expect(warnings.map((warning) => warning.code)).toEqual(['dropped-content', 'dropped-content', 'dropped-content']);
  });

  it('serializes tool_use input back into a JSON string', () => {
    const out = fromAnthropic({
      messages: [{ role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'f', input: { a: 1 } }] }],
    });
    const assistant = out[0] as Extract<OpenAIMessage, { role: 'assistant' }>;
    expect(assistant.tool_calls?.[0].function.arguments).toBe('{"a":1}');
  });

  it('warns and falls back when tool_use input is not an object', () => {
    const warnings: Warning[] = [];
    const out = fromAnthropic(
      {
        messages: [
          {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 't1',
                name: 'f',
                input: ['not', 'an', 'object'],
              } as unknown as AnthropicContentBlock,
            ],
          },
        ],
      },
      { onWarning: (warning) => warnings.push(warning) },
    );

    const assistant = out[0] as Extract<OpenAIMessage, { role: 'assistant' }>;
    expect(assistant.tool_calls?.[0].function.arguments).toBe('{}');
    expect(warnings.map((warning) => warning.code)).toEqual(['invalid-json-arguments']);
  });

  it('generates deterministic ids for tool_use blocks without usable ids', () => {
    const warnings: Warning[] = [];
    const out = fromAnthropic(
      {
        messages: [
          {
            role: 'assistant',
            content: [
              { type: 'tool_use', name: 'lookup', input: { q: 'one' } } as AnthropicContentBlock,
              { type: 'tool_use', id: '', name: 'lookup', input: { q: 'two' } } as AnthropicContentBlock,
            ],
          },
        ],
      },
      { onWarning: (warning) => warnings.push(warning) },
    );

    const assistant = out[0] as Extract<OpenAIMessage, { role: 'assistant' }>;
    expect(assistant.tool_calls?.map((call) => call.id)).toEqual(['call_lookup_0', 'call_lookup_1']);
    expect(warnings.map((warning) => warning.code)).toEqual(['generated-id', 'generated-id']);
  });

  it('preserves a later tool_use id when an earlier fallback would collide', () => {
    const warnings: Warning[] = [];
    const out = fromAnthropic(
      {
        messages: [
          {
            role: 'assistant',
            content: [
              { type: 'tool_use', name: 'lookup', input: { q: 'generated' } } as AnthropicContentBlock,
              {
                type: 'tool_use',
                id: 'call_lookup_0',
                name: 'lookup',
                input: { q: 'provided' },
              } as AnthropicContentBlock,
            ],
          },
        ],
      },
      { onWarning: (warning) => warnings.push(warning) },
    );

    const assistant = out[0] as Extract<OpenAIMessage, { role: 'assistant' }>;
    expect(assistant.tool_calls?.map((call) => call.id)).toEqual(['call_lookup_1', 'call_lookup_0']);
    expect(warnings.map((warning) => warning.code)).toEqual(['generated-id']);
  });

  it('preserves an explicit tool_result tool_use_id when an earlier fallback would collide', () => {
    const warnings: Warning[] = [];
    const out = fromAnthropic(
      {
        messages: [
          {
            role: 'assistant',
            content: [{ type: 'tool_use', name: 'lookup', input: { q: 'generated' } } as AnthropicContentBlock],
          },
          {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'call_lookup_0', content: 'provided result' }],
          },
        ],
      },
      { onWarning: (warning) => warnings.push(warning) },
    );

    const assistant = out[0] as Extract<OpenAIMessage, { role: 'assistant' }>;
    expect(assistant.tool_calls?.[0].id).toBe('call_lookup_1');
    expect(out[1]).toEqual({ role: 'tool', tool_call_id: 'call_lookup_0', content: 'provided result' });
    expect(warnings.map((warning) => warning.code)).toEqual(['generated-id', 'unmapped-tool-result']);
  });

  it('regenerates duplicate tool_use ids', () => {
    const warnings: Warning[] = [];
    const out = fromAnthropic(
      {
        messages: [
          {
            role: 'assistant',
            content: [
              { type: 'tool_use', id: 'call_lookup_0', name: 'lookup', input: { q: 'one' } } as AnthropicContentBlock,
              { type: 'tool_use', id: 'call_lookup_0', name: 'lookup', input: { q: 'two' } } as AnthropicContentBlock,
            ],
          },
        ],
      },
      { onWarning: (warning) => warnings.push(warning) },
    );

    const assistant = out[0] as Extract<OpenAIMessage, { role: 'assistant' }>;
    expect(assistant.tool_calls?.map((call) => call.id)).toEqual(['call_lookup_0', 'call_lookup_1']);
    expect(warnings.map((warning) => warning.code)).toEqual(['generated-id']);
    expect(warnings[0]?.message).toContain("reused id 'call_lookup_0'");
  });

  it('maps duplicate tool_result ids to regenerated tool_use ids in order', () => {
    const warnings: Warning[] = [];
    const out = fromAnthropic(
      {
        messages: [
          {
            role: 'assistant',
            content: [
              { type: 'tool_use', id: 'call_lookup_0', name: 'lookup', input: { q: 'one' } } as AnthropicContentBlock,
              { type: 'tool_use', id: 'call_lookup_0', name: 'lookup', input: { q: 'two' } } as AnthropicContentBlock,
            ],
          },
          {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'call_lookup_0', content: 'first' },
              { type: 'tool_result', tool_use_id: 'call_lookup_0', content: 'second' },
            ],
          },
        ],
      },
      { onWarning: (warning) => warnings.push(warning) },
    );

    const assistant = out[0] as Extract<OpenAIMessage, { role: 'assistant' }>;
    const results = out.filter(
      (message): message is Extract<OpenAIMessage, { role: 'tool' }> => message.role === 'tool',
    );
    expect(assistant.tool_calls?.map((call) => call.id)).toEqual(['call_lookup_0', 'call_lookup_1']);
    expect(results.map((message) => message.tool_call_id)).toEqual(['call_lookup_0', 'call_lookup_1']);
    expect(warnings.map((warning) => warning.code)).toEqual(['generated-id']);
  });

  it('uses a fallback name when a tool_use name is malformed', () => {
    const warnings: Warning[] = [];
    const out = fromAnthropic(
      {
        messages: [
          {
            role: 'assistant',
            content: [{ type: 'tool_use', name: 123, input: {} } as unknown as AnthropicContentBlock],
          },
        ],
      },
      { onWarning: (warning) => warnings.push(warning) },
    );

    const assistant = out[0] as Extract<OpenAIMessage, { role: 'assistant' }>;
    expect(assistant.tool_calls?.[0]).toEqual({
      id: 'call_unknown_function_0',
      type: 'function',
      function: { name: 'unknown_function', arguments: '{}' },
    });
    expect(warnings.map((warning) => warning.code)).toEqual(['dropped-metadata', 'generated-id']);
  });

  it('turns tool_result blocks into standalone tool messages', () => {
    const out = fromAnthropic({
      messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'result' }] }],
    });
    expect(out).toEqual([{ role: 'tool', tool_call_id: 't1', content: 'result' }]);
  });

  it('warns when a tool_result id does not match a prior tool_use', () => {
    const warnings: Warning[] = [];
    const out = fromAnthropic(
      {
        messages: [
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'call_lookup', name: 'lookup', input: {} }],
          },
          {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'external_call', content: 'external' }],
          },
        ],
      },
      { onWarning: (warning) => warnings.push(warning) },
    );

    expect(out).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call_lookup', type: 'function', function: { name: 'lookup', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: 'external_call', content: 'external' },
    ]);
    expect(warnings.map((warning) => warning.code)).toEqual(['unmapped-tool-result']);
    expect(warnings[0]?.message).toContain("'external_call'");
  });

  it('regenerates duplicate unmapped tool_result ids', () => {
    const warnings: Warning[] = [];
    const out = fromAnthropic(
      {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'external_call', content: 'first' },
              { type: 'tool_result', tool_use_id: 'external_call', content: 'second' },
            ],
          },
        ],
      },
      { onWarning: (warning) => warnings.push(warning) },
    );

    expect(out).toEqual([
      { role: 'tool', tool_call_id: 'external_call', content: 'first' },
      { role: 'tool', tool_call_id: 'call_tool_result_0', content: 'second' },
    ]);
    expect(warnings.map((warning) => warning.code)).toEqual([
      'unmapped-tool-result',
      'unmapped-tool-result',
      'generated-id',
    ]);
  });

  it('warns and generates an id for tool_result blocks without usable tool_use_id', () => {
    const warnings: Warning[] = [];
    const out = fromAnthropic(
      {
        messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: '', content: 'result' }] }],
      },
      { onWarning: (warning) => warnings.push(warning) },
    );

    expect(out).toEqual([{ role: 'tool', tool_call_id: 'call_tool_result_0', content: 'result' }]);
    expect(warnings.map((warning) => warning.code)).toEqual(['unmapped-tool-result']);
  });

  it('preserves mixed user text, tool_result errors and block order', () => {
    const out = fromAnthropic({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'before' },
            { type: 'tool_result', tool_use_id: 't1', content: 'failed', is_error: true },
            { type: 'text', text: 'after' },
          ],
        },
      ],
    });
    expect(out).toEqual([
      { role: 'user', content: 'before' },
      { role: 'tool', tool_call_id: 't1', content: 'failed', is_error: true },
      { role: 'user', content: 'after' },
    ]);
  });

  it('round trips mixed text and tool_result blocks back to one Anthropic user turn', () => {
    const conversation = {
      messages: [
        {
          role: 'user' as const,
          content: [
            { type: 'text' as const, text: 'before' },
            { type: 'tool_result' as const, tool_use_id: 't1', content: 'failed', is_error: true },
            { type: 'text' as const, text: 'after' },
          ],
        },
      ],
    };

    expect(toAnthropic(fromAnthropic(conversation)).messages).toEqual(conversation.messages);
  });
});
