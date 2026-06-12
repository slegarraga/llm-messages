import { describe, it, expect } from 'vitest';
import { toGemini, fromGemini } from '../src/index.ts';
import type {
  GeminiContent,
  GeminiConversation,
  GeminiFunctionCallPart,
  OpenAIMessage,
  Warning,
} from '../src/index.ts';

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

  it('uses the tool-call id for standalone function responses with empty names', () => {
    const warnings: Warning[] = [];
    const { contents } = toGemini([{ role: 'tool', tool_call_id: 'orphan_result', name: '', content: 'ready' }], {
      onWarning: (w) => warnings.push(w),
    });
    expect(contents[0].parts[0]).toEqual({
      functionResponse: { id: 'orphan_result', name: 'orphan_result', response: { result: 'ready' } },
    });
    expect(warnings.some((w) => w.code === 'unmapped-tool-result')).toBe(true);
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
  it('returns an empty canonical conversation for malformed top-level bodies', () => {
    expect(fromGemini(null as unknown as GeminiConversation)).toEqual([]);
    expect(fromGemini({} as GeminiConversation)).toEqual([]);
    expect(fromGemini({ contents: 'not an array' } as unknown as GeminiConversation)).toEqual([]);
  });

  it('drops malformed content entries without losing valid Gemini turns', () => {
    const warnings: Warning[] = [];
    const out = fromGemini(
      {
        systemInstruction: { parts: [{ text: 'Be concise.' }] },
        contents: [
          null,
          { role: 'assistant', parts: [{ text: 'bad role' }] },
          { role: 'model', parts: [{ text: 'ready' }] },
        ],
      } as unknown as GeminiConversation,
      { onWarning: (warning) => warnings.push(warning) },
    );

    expect(out).toEqual([
      { role: 'system', content: 'Be concise.' },
      { role: 'assistant', content: 'ready' },
    ]);
    expect(warnings.map((warning) => warning.code)).toEqual(['dropped-content', 'dropped-content']);
  });

  it('warns when dropping malformed parts without losing valid Gemini content', () => {
    const warnings: Warning[] = [];
    const out = fromGemini(
      {
        contents: [
          { role: 'model', parts: [null, { text: 'ready' }, { unsupported: true }] },
          { role: 'user', parts: [{ text: 'ok' }, null, { unsupported: true }] },
        ],
      } as unknown as GeminiConversation,
      { onWarning: (warning) => warnings.push(warning) },
    );

    expect(out).toEqual([
      { role: 'assistant', content: 'ready' },
      { role: 'user', content: 'ok' },
    ]);
    expect(warnings.map((warning) => warning.code)).toEqual([
      'dropped-content',
      'dropped-content',
      'dropped-content',
      'dropped-content',
    ]);
  });

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

  it('generates a deterministic id when a functionCall id is empty', () => {
    const warnings: Warning[] = [];
    const out = fromGemini(
      {
        contents: [{ role: 'model', parts: [{ functionCall: { id: '', name: 'search', args: { q: 'x' } } }] }],
      },
      { onWarning: (w) => warnings.push(w) },
    );
    const assistant = out[0] as Extract<OpenAIMessage, { role: 'assistant' }>;
    expect(assistant.tool_calls?.[0].id).toBe('call_search_0');
    expect(warnings.some((w) => w.code === 'generated-id')).toBe(true);
  });

  it('does not generate a functionCall id that collides with a provider id', () => {
    const warnings: Warning[] = [];
    const out = fromGemini(
      {
        contents: [
          {
            role: 'model',
            parts: [
              { functionCall: { id: 'call_search_0', name: 'search', args: { q: 'provided' } } },
              { functionCall: { name: 'search', args: { q: 'generated' } } },
            ],
          },
        ],
      },
      { onWarning: (w) => warnings.push(w) },
    );
    const assistant = out[0] as Extract<OpenAIMessage, { role: 'assistant' }>;

    expect(assistant.tool_calls?.map((call) => call.id)).toEqual(['call_search_0', 'call_search_1']);
    expect(warnings.map((w) => w.code)).toEqual(['generated-id']);
  });

  it('preserves a later functionCall id when an earlier fallback would collide', () => {
    const warnings: Warning[] = [];
    const out = fromGemini(
      {
        contents: [
          {
            role: 'model',
            parts: [
              { functionCall: { name: 'search', args: { q: 'generated' } } },
              { functionCall: { id: 'call_search_0', name: 'search', args: { q: 'provided' } } },
            ],
          },
        ],
      },
      { onWarning: (w) => warnings.push(w) },
    );
    const assistant = out[0] as Extract<OpenAIMessage, { role: 'assistant' }>;

    expect(assistant.tool_calls?.map((call) => call.id)).toEqual(['call_search_1', 'call_search_0']);
    expect(warnings.map((w) => w.code)).toEqual(['generated-id']);
  });

  it('regenerates duplicate functionCall ids', () => {
    const warnings: Warning[] = [];
    const out = fromGemini(
      {
        contents: [
          {
            role: 'model',
            parts: [
              { functionCall: { id: 'call_search_0', name: 'search', args: { q: 'one' } } },
              { functionCall: { id: 'call_search_0', name: 'search', args: { q: 'two' } } },
            ],
          },
        ],
      },
      { onWarning: (w) => warnings.push(w) },
    );
    const assistant = out[0] as Extract<OpenAIMessage, { role: 'assistant' }>;

    expect(assistant.tool_calls?.map((call) => call.id)).toEqual(['call_search_0', 'call_search_1']);
    expect(warnings.map((w) => w.code)).toEqual(['generated-id']);
    expect(warnings[0]?.message).toContain("reused id 'call_search_0'");
  });

  it('maps duplicate functionResponse ids to regenerated functionCall ids in order', () => {
    const warnings: Warning[] = [];
    const out = fromGemini(
      {
        contents: [
          {
            role: 'model',
            parts: [
              { functionCall: { id: 'call_search_0', name: 'search', args: { q: 'one' } } },
              { functionCall: { id: 'call_search_0', name: 'search', args: { q: 'two' } } },
            ],
          },
          {
            role: 'user',
            parts: [
              { functionResponse: { id: 'call_search_0', name: 'search', response: { result: 'first' } } },
              { functionResponse: { id: 'call_search_0', name: 'search', response: { result: 'second' } } },
            ],
          },
        ],
      },
      { onWarning: (w) => warnings.push(w) },
    );

    const assistant = out[0] as Extract<OpenAIMessage, { role: 'assistant' }>;
    const results = out.filter(
      (message): message is Extract<OpenAIMessage, { role: 'tool' }> => message.role === 'tool',
    );
    expect(assistant.tool_calls?.map((call) => call.id)).toEqual(['call_search_0', 'call_search_1']);
    expect(results.map((message) => message.tool_call_id)).toEqual(['call_search_0', 'call_search_1']);
    expect(warnings.map((w) => w.code)).toEqual(['generated-id']);
  });

  it('uses a fallback name when a functionCall name is malformed', () => {
    const warnings: Warning[] = [];
    const contents = [
      { role: 'model', parts: [{ functionCall: { name: 'lookup.order', args: {} } }] },
    ] as unknown as GeminiContent[];

    const out = fromGemini({ contents }, { onWarning: (w) => warnings.push(w) });

    const assistant = out[0] as Extract<OpenAIMessage, { role: 'assistant' }>;
    expect(assistant.tool_calls?.[0]).toEqual({
      id: 'call_unknown_function_0',
      type: 'function',
      function: { name: 'unknown_function', arguments: '{}' },
    });
    expect(warnings.map((w) => w.code)).toEqual(['dropped-metadata', 'generated-id']);
  });

  it('warns and falls back when functionCall args are not an object', () => {
    const warnings: Warning[] = [];
    const contents = [
      { role: 'model', parts: [{ functionCall: { id: 'call_search', name: 'search', args: null } }] },
    ] as unknown as GeminiContent[];

    const out = fromGemini({ contents }, { onWarning: (w) => warnings.push(w) });

    const assistant = out[0] as Extract<OpenAIMessage, { role: 'assistant' }>;
    expect(assistant.tool_calls?.[0].function.arguments).toBe('{}');
    expect(warnings.map((w) => w.code)).toEqual(['invalid-json-arguments']);
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

  it('preserves mixed user text and functionResponse order', () => {
    const out = fromGemini({
      contents: [
        {
          role: 'model',
          parts: [{ functionCall: { id: 'call_lookup', name: 'lookup_order', args: {} } }],
        },
        {
          role: 'user',
          parts: [
            { text: 'before' },
            { functionResponse: { id: 'call_lookup', name: 'lookup_order', response: { result: 'done' } } },
            { text: 'after' },
          ],
        },
      ],
    });

    expect(out).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call_lookup', type: 'function', function: { name: 'lookup_order', arguments: '{}' } }],
      },
      { role: 'user', content: 'before' },
      { role: 'tool', tool_call_id: 'call_lookup', content: 'done' },
      { role: 'user', content: 'after' },
    ]);
  });

  it('matches a functionResponse to its call by name when the id is empty', () => {
    const out = fromGemini({
      contents: [
        { role: 'model', parts: [{ functionCall: { id: 'call_search', name: 'search', args: {} } }] },
        { role: 'user', parts: [{ functionResponse: { id: '', name: 'search', response: { result: 'done' } } }] },
      ],
    });
    const result = out.find((m) => m.role === 'tool') as Extract<OpenAIMessage, { role: 'tool' }>;
    expect(result).toEqual({ role: 'tool', tool_call_id: 'call_search', content: 'done' });
  });

  it('matches a functionResponse to its call by id when the name is omitted', () => {
    const warnings: Warning[] = [];
    const contents = [
      { role: 'model', parts: [{ functionCall: { id: 'call_search', name: 'search', args: {} } }] },
      { role: 'user', parts: [{ functionResponse: { id: 'call_search', response: { result: 'done' } } }] },
    ] as unknown as GeminiContent[];

    const out = fromGemini({ contents }, { onWarning: (w) => warnings.push(w) });

    const result = out.find((m) => m.role === 'tool') as Extract<OpenAIMessage, { role: 'tool' }>;
    expect(result).toEqual({ role: 'tool', tool_call_id: 'call_search', content: 'done' });
    expect(warnings).toEqual([]);
  });

  it('ignores a non-string functionResponse id and matches by name', () => {
    const warnings: Warning[] = [];
    const contents = [
      { role: 'model', parts: [{ functionCall: { id: 'call_search', name: 'search', args: {} } }] },
      { role: 'user', parts: [{ functionResponse: { id: 123, name: 'search', response: { result: 'done' } } }] },
    ] as unknown as GeminiContent[];

    const out = fromGemini({ contents }, { onWarning: (w) => warnings.push(w) });

    const result = out.find((m) => m.role === 'tool') as Extract<OpenAIMessage, { role: 'tool' }>;
    expect(result).toEqual({ role: 'tool', tool_call_id: 'call_search', content: 'done' });
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'dropped-metadata' }));
    expect(warnings.some((w) => w.code === 'unmapped-tool-result')).toBe(false);
  });

  it('uses id mapping when a functionResponse name is malformed', () => {
    const warnings: Warning[] = [];
    const contents = [
      { role: 'model', parts: [{ functionCall: { id: 'call_search', name: 'search', args: {} } }] },
      {
        role: 'user',
        parts: [{ functionResponse: { id: 'call_search', name: 'lookup.order', response: { result: 'done' } } }],
      },
    ] as unknown as GeminiContent[];

    const out = fromGemini({ contents }, { onWarning: (w) => warnings.push(w) });

    const result = out.find((m) => m.role === 'tool') as Extract<OpenAIMessage, { role: 'tool' }>;
    expect(result).toEqual({ role: 'tool', tool_call_id: 'call_search', content: 'done' });
    expect(warnings.map((w) => w.code)).toEqual(['dropped-metadata']);
  });

  it('generates a fallback id for a standalone functionResponse with a malformed name', () => {
    const warnings: Warning[] = [];
    const contents = [
      { role: 'user', parts: [{ functionResponse: { name: 'lookup.order', response: { result: 'done' } } }] },
    ] as unknown as GeminiContent[];

    const out = fromGemini({ contents }, { onWarning: (w) => warnings.push(w) });

    expect(out).toEqual([
      { role: 'tool', tool_call_id: 'call_unknown_function_0', content: 'done', name: 'unknown_function' },
    ]);
    expect(warnings.map((w) => w.code)).toEqual(['dropped-metadata', 'unmapped-tool-result']);
  });

  it('warns when a functionResponse id has no matching call', () => {
    const warnings: Warning[] = [];
    const out = fromGemini(
      {
        contents: [
          {
            role: 'user',
            parts: [{ functionResponse: { id: 'external_call', name: 'lookup_order', response: { result: 'done' } } }],
          },
        ],
      },
      { onWarning: (w) => warnings.push(w) },
    );

    expect(out).toEqual([{ role: 'tool', tool_call_id: 'external_call', content: 'done', name: 'lookup_order' }]);
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'unmapped-tool-result' }));
  });

  it('does not match a functionResponse id to a generated fallback id', () => {
    const warnings: Warning[] = [];
    const out = fromGemini(
      {
        contents: [
          {
            role: 'model',
            parts: [{ functionCall: { name: 'search', args: {} } }],
          },
          {
            role: 'user',
            parts: [{ functionResponse: { id: 'call_search_0', name: 'search', response: { result: 'external' } } }],
          },
        ],
      },
      { onWarning: (w) => warnings.push(w) },
    );

    const assistant = out.find((m): m is Extract<OpenAIMessage, { role: 'assistant' }> => m.role === 'assistant');
    const result = out.find((m): m is Extract<OpenAIMessage, { role: 'tool' }> => m.role === 'tool');
    expect(assistant?.tool_calls?.[0].id).toBe('call_search_1');
    expect(result).toEqual({ role: 'tool', tool_call_id: 'call_search_0', content: 'external', name: 'search' });
    expect(warnings.map((w) => w.code)).toEqual(['generated-id', 'unmapped-tool-result']);
  });

  it('warns when a matched functionResponse id carries a conflicting name', () => {
    const warnings: Warning[] = [];
    const out = fromGemini(
      {
        contents: [
          {
            role: 'model',
            parts: [{ functionCall: { id: 'call_search', name: 'search', args: {} } }],
          },
          {
            role: 'user',
            parts: [{ functionResponse: { id: 'call_search', name: 'lookup_order', response: { result: 'done' } } }],
          },
        ],
      },
      { onWarning: (w) => warnings.push(w) },
    );

    const result = out.find((m) => m.role === 'tool') as Extract<OpenAIMessage, { role: 'tool' }>;
    expect(result).toEqual({ role: 'tool', tool_call_id: 'call_search', content: 'done' });
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'dropped-metadata' }));
  });

  it('warns and falls back when a functionResponse response cannot be serialized', () => {
    const warnings: Warning[] = [];
    const response: Record<string, unknown> = {};
    response.self = response;

    const out = fromGemini(
      {
        contents: [
          {
            role: 'model',
            parts: [{ functionCall: { id: 'call_lookup', name: 'lookup_order', args: {} } }],
          },
          {
            role: 'user',
            parts: [{ functionResponse: { id: 'call_lookup', name: 'lookup_order', response } }],
          },
        ],
      },
      { onWarning: (w) => warnings.push(w) },
    );

    const result = out.find((m) => m.role === 'tool') as Extract<OpenAIMessage, { role: 'tool' }>;
    expect(result).toEqual({ role: 'tool', tool_call_id: 'call_lookup', content: '{}' });
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'dropped-content' }));
  });

  it('keeps same-name pending calls available after an id-matched response has a conflicting name', () => {
    const warnings: Warning[] = [];
    const out = fromGemini(
      {
        contents: [
          {
            role: 'model',
            parts: [
              { functionCall: { id: 'call_search', name: 'search', args: {} } },
              { functionCall: { id: 'call_lookup', name: 'lookup_order', args: {} } },
            ],
          },
          {
            role: 'user',
            parts: [
              { functionResponse: { id: 'call_lookup', name: 'search', response: { result: 'lookup' } } },
              { functionResponse: { name: 'search', response: { result: 'search' } } },
            ],
          },
        ],
      },
      { onWarning: (w) => warnings.push(w) },
    );

    const results = out.filter((m): m is Extract<OpenAIMessage, { role: 'tool' }> => m.role === 'tool');
    expect(results).toEqual([
      { role: 'tool', tool_call_id: 'call_lookup', content: 'lookup' },
      { role: 'tool', tool_call_id: 'call_search', content: 'search' },
    ]);
    expect(warnings.filter((w) => w.code === 'dropped-metadata')).toHaveLength(1);
    expect(warnings.some((w) => w.code === 'unmapped-tool-result')).toBe(false);
  });

  it('does not consume a pending same-name call for an unmapped functionResponse id', () => {
    const warnings: Warning[] = [];
    const out = fromGemini(
      {
        contents: [
          {
            role: 'model',
            parts: [{ functionCall: { id: 'call_search', name: 'search', args: {} } }],
          },
          {
            role: 'user',
            parts: [
              { functionResponse: { id: 'external_call', name: 'search', response: { result: 'external' } } },
              { functionResponse: { name: 'search', response: { result: 'matched' } } },
            ],
          },
        ],
      },
      { onWarning: (w) => warnings.push(w) },
    );

    const results = out.filter((m): m is Extract<OpenAIMessage, { role: 'tool' }> => m.role === 'tool');
    expect(results).toEqual([
      { role: 'tool', tool_call_id: 'external_call', content: 'external', name: 'search' },
      { role: 'tool', tool_call_id: 'call_search', content: 'matched' },
    ]);
    expect(warnings.filter((w) => w.code === 'unmapped-tool-result')).toHaveLength(1);
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
