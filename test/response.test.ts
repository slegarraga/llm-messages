import { describe, it, expect } from 'vitest';
import {
  responseFromOpenAI,
  responseFromOpenAIResponses,
  responseFromAnthropic,
  responseFromGemini,
  normalizeResponse,
} from '../src/index.ts';
import type { Warning } from '../src/index.ts';

describe('response helpers', () => {
  it('return neutral defaults for malformed top-level bodies', () => {
    const expected = {
      message: { role: 'assistant', content: null },
      finishReason: 'unknown',
      usage: { inputTokens: 0, outputTokens: 0 },
    };

    expect(responseFromOpenAI(null)).toEqual(expected);
    expect(responseFromOpenAIResponses(null)).toEqual(expected);
    expect(responseFromAnthropic(null)).toEqual(expected);
    expect(responseFromGemini(null)).toEqual(expected);
  });

  it('warns when malformed top-level response bodies are dropped', () => {
    const expected = {
      message: { role: 'assistant', content: null },
      finishReason: 'unknown',
      usage: { inputTokens: 0, outputTokens: 0 },
    };
    const cases = [
      ['OpenAI Chat Completions', responseFromOpenAI],
      ['OpenAI Responses', responseFromOpenAIResponses],
      ['Anthropic', responseFromAnthropic],
      ['Gemini', responseFromGemini],
    ] as const;

    for (const [provider, normalize] of cases) {
      const warnings: Warning[] = [];

      expect(normalize(null, { onWarning: (w) => warnings.push(w) })).toEqual(expected);
      expect(warnings).toEqual([
        {
          code: 'dropped-content',
          message: expect.stringContaining(provider),
        },
      ]);
    }
  });
});

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

  it('warns when the Chat Completions choices array is missing or malformed', () => {
    const missingWarnings: Warning[] = [];
    const missing = responseFromOpenAI(
      { usage: { prompt_tokens: 1, completion_tokens: 2 } },
      { onWarning: (w) => missingWarnings.push(w) },
    );

    expect(missing).toEqual({
      message: { role: 'assistant', content: null },
      finishReason: 'unknown',
      usage: { inputTokens: 1, outputTokens: 2 },
    });
    expect(missingWarnings.map((w) => w.code)).toEqual(['dropped-content']);
    expect(missingWarnings[0]?.message).toContain('missing choices array');

    const malformedWarnings: Warning[] = [];
    const malformed = responseFromOpenAI({ choices: 'not an array' }, { onWarning: (w) => malformedWarnings.push(w) });

    expect(malformed.message).toEqual({ role: 'assistant', content: null });
    expect(malformedWarnings.map((w) => w.code)).toEqual(['dropped-content']);
    expect(malformedWarnings[0]?.message).toContain('malformed OpenAI Chat Completions response choices');

    const malformedChoiceWarnings: Warning[] = [];
    responseFromOpenAI({ choices: [null] }, { onWarning: (w) => malformedChoiceWarnings.push(w) });

    expect(malformedChoiceWarnings.map((w) => w.code)).toEqual(['dropped-content']);
    expect(malformedChoiceWarnings[0]?.message).toContain('malformed OpenAI Chat Completions response choice');
  });

  it('warns when a Chat Completions choice message is missing or malformed', () => {
    const missingWarnings: Warning[] = [];
    const missing = responseFromOpenAI(
      { choices: [{ finish_reason: 'stop' }] },
      { onWarning: (w) => missingWarnings.push(w) },
    );

    expect(missing).toEqual({
      message: { role: 'assistant', content: null },
      finishReason: 'stop',
      usage: { inputTokens: 0, outputTokens: 0 },
    });
    expect(missingWarnings.map((w) => w.code)).toEqual(['dropped-content']);
    expect(missingWarnings[0]?.message).toContain('missing message object');

    const malformedWarnings: Warning[] = [];
    const malformed = responseFromOpenAI(
      { choices: [{ message: 'not an object', finish_reason: 'stop' }] },
      { onWarning: (w) => malformedWarnings.push(w) },
    );

    expect(malformed.message).toEqual({ role: 'assistant', content: null });
    expect(malformed.finishReason).toBe('stop');
    expect(malformedWarnings.map((w) => w.code)).toEqual(['dropped-content']);
    expect(malformedWarnings[0]?.message).toContain('malformed OpenAI Chat Completions response choice message');
  });

  it('uses refusal text when Chat Completions content is empty', () => {
    const r = responseFromOpenAI({
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            refusal: 'I cannot help with that.',
          },
          finish_reason: 'content_filter',
        },
      ],
    });

    expect(r.message).toEqual({
      role: 'assistant',
      content: 'I cannot help with that.',
    });
    expect(r.finishReason).toBe('content_filter');
  });

  it('preserves refusal content parts in Chat Completions assistant arrays', () => {
    const r = responseFromOpenAI({
      choices: [
        {
          message: {
            role: 'assistant',
            content: [{ type: 'refusal', refusal: 'I cannot help with that.' }],
          },
          finish_reason: 'content_filter',
        },
      ],
    });

    expect(r.message).toEqual({
      role: 'assistant',
      content: 'I cannot help with that.',
    });
    expect(r.finishReason).toBe('content_filter');
  });

  it('strips provider-only fields from normalized Chat Completions tool calls', () => {
    const r = responseFromOpenAI({
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'c1',
                type: 'function',
                index: 0,
                function: { name: 'lookup_order', arguments: '{"id":"ord_123"}', extra: 'ignored' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    });

    expect(r.message.tool_calls).toEqual([
      {
        id: 'c1',
        type: 'function',
        function: { name: 'lookup_order', arguments: '{"id":"ord_123"}' },
      },
    ]);
  });

  it('drops unsupported Chat Completions tool_call types', () => {
    const warnings: Warning[] = [];
    const r = responseFromOpenAI(
      {
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                { id: 'call_lookup_order_0', type: 'web_search', web_search: { query: 'status' } },
                { type: 'function', function: { name: 'lookup_order', arguments: '{}' } },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      },
      { onWarning: (w) => warnings.push(w) },
    );

    expect(r.message.tool_calls).toEqual([
      { id: 'call_lookup_order_0', type: 'function', function: { name: 'lookup_order', arguments: '{}' } },
    ]);
    expect(r.finishReason).toBe('tool_calls');
    expect(warnings.map((w) => w.code)).toEqual(['dropped-content', 'generated-id']);
    expect(warnings[0]?.message).toContain("tool_call type 'web_search' is not supported");
  });

  it('warns when Chat Completions tool_calls are malformed', () => {
    const malformedArrayWarnings: Warning[] = [];
    const malformedArray = responseFromOpenAI(
      {
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: { id: 'call_lookup_order_0' },
            },
            finish_reason: 'tool_calls',
          },
        ],
      },
      { onWarning: (w) => malformedArrayWarnings.push(w) },
    );

    expect(malformedArray.message).toEqual({ role: 'assistant', content: null });
    expect(malformedArray.finishReason).toBe('tool_calls');
    expect(malformedArrayWarnings.map((w) => w.code)).toEqual(['dropped-content']);
    expect(malformedArrayWarnings[0]?.message).toContain('tool_calls; expected an array');

    const malformedEntryWarnings: Warning[] = [];
    const malformedEntry = responseFromOpenAI(
      {
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                null,
                {
                  id: 'call_lookup_order_0',
                  type: 'function',
                  function: { name: 'lookup_order', arguments: '{"id":"ord_123"}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      },
      { onWarning: (w) => malformedEntryWarnings.push(w) },
    );

    expect(malformedEntry.message.tool_calls).toEqual([
      {
        id: 'call_lookup_order_0',
        type: 'function',
        function: { name: 'lookup_order', arguments: '{"id":"ord_123"}' },
      },
    ]);
    expect(malformedEntry.finishReason).toBe('tool_calls');
    expect(malformedEntryWarnings.map((w) => w.code)).toEqual(['dropped-content']);
    expect(malformedEntryWarnings[0]?.message).toContain('tool_call; expected an object');
  });

  it('uses a fallback name when a tool_call function name is malformed', () => {
    const warnings: Warning[] = [];
    const overlongName = 'a'.repeat(65);
    const r = responseFromOpenAI(
      {
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                { id: 'c1', type: 'function', function: { name: null, arguments: '{}' } },
                { id: 'c2', type: 'function', function: { name: '   ', arguments: '{"ok":true}' } },
                { id: 'c3', type: 'function', function: { name: 'lookup.order', arguments: '{}' } },
                { id: 'c4', type: 'function', function: { name: overlongName, arguments: '{}' } },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      },
      { onWarning: (w) => warnings.push(w) },
    );

    expect(r.message.tool_calls).toEqual([
      {
        id: 'c1',
        type: 'function',
        function: { name: 'unknown_function', arguments: '{}' },
      },
      {
        id: 'c2',
        type: 'function',
        function: { name: 'unknown_function', arguments: '{"ok":true}' },
      },
      {
        id: 'c3',
        type: 'function',
        function: { name: 'unknown_function', arguments: '{}' },
      },
      {
        id: 'c4',
        type: 'function',
        function: { name: 'unknown_function', arguments: '{}' },
      },
    ]);
    expect(r.finishReason).toBe('tool_calls');
    expect(warnings.map((w) => w.code)).toEqual([
      'dropped-metadata',
      'dropped-metadata',
      'dropped-metadata',
      'dropped-metadata',
    ]);
  });

  it('does not generate a tool_call id that collides with a provider id', () => {
    const warnings: Warning[] = [];
    const r = responseFromOpenAI(
      {
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                { id: 'call_search_0', type: 'function', function: { name: 'search', arguments: '{}' } },
                { type: 'function', function: { name: 'search', arguments: '{}' } },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      },
      { onWarning: (w) => warnings.push(w) },
    );

    expect(r.message.tool_calls?.map((call) => call.id)).toEqual(['call_search_0', 'call_search_1']);
    expect(warnings.map((w) => w.code)).toEqual(['generated-id']);
  });

  it('preserves a later provider tool_call id when an earlier fallback would collide', () => {
    const warnings: Warning[] = [];
    const r = responseFromOpenAI(
      {
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                { type: 'function', function: { name: 'search', arguments: '{}' } },
                { id: 'call_search_0', type: 'function', function: { name: 'search', arguments: '{}' } },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      },
      { onWarning: (w) => warnings.push(w) },
    );

    expect(r.message.tool_calls?.map((call) => call.id)).toEqual(['call_search_1', 'call_search_0']);
    expect(warnings.map((w) => w.code)).toEqual(['generated-id']);
  });

  it('regenerates duplicate provider tool_call ids', () => {
    const warnings: Warning[] = [];
    const r = responseFromOpenAI(
      {
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                { id: 'call_search_0', type: 'function', function: { name: 'search', arguments: '{}' } },
                { id: 'call_search_0', type: 'function', function: { name: 'search', arguments: '{}' } },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      },
      { onWarning: (w) => warnings.push(w) },
    );

    expect(r.message.tool_calls?.map((call) => call.id)).toEqual(['call_search_0', 'call_search_1']);
    expect(warnings.map((w) => w.code)).toEqual(['generated-id']);
    expect(warnings[0]?.message).toContain("reused id 'call_search_0'");
  });

  it('warns and falls back when tool_call arguments are explicit non-object values', () => {
    const warnings: Warning[] = [];
    const r = responseFromOpenAI(
      {
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                { id: 'call_lookup', type: 'function', function: { name: 'lookup_order', arguments: ['bad'] } },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      },
      { onWarning: (w) => warnings.push(w) },
    );

    expect(r.message.tool_calls).toEqual([
      { id: 'call_lookup', type: 'function', function: { name: 'lookup_order', arguments: '{}' } },
    ]);
    expect(warnings.map((w) => w.code)).toEqual(['invalid-json-arguments']);
  });

  it('warns and falls back when tool_call argument strings are malformed or non-object JSON', () => {
    const warnings: Warning[] = [];
    const r = responseFromOpenAI(
      {
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                { id: 'call_malformed', type: 'function', function: { name: 'lookup_order', arguments: 'not json' } },
                { id: 'call_array', type: 'function', function: { name: 'lookup_order', arguments: '["bad"]' } },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      },
      { onWarning: (w) => warnings.push(w) },
    );

    expect(r.message.tool_calls).toEqual([
      { id: 'call_malformed', type: 'function', function: { name: 'lookup_order', arguments: '{}' } },
      { id: 'call_array', type: 'function', function: { name: 'lookup_order', arguments: '{}' } },
    ]);
    expect(warnings.map((w) => w.code)).toEqual(['invalid-json-arguments', 'invalid-json-arguments']);
  });

  it('normalizes legacy function_call responses into tool_calls', () => {
    const warnings: Warning[] = [];
    const r = responseFromOpenAI(
      {
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              function_call: { name: 'lookup_order', arguments: '{"id":"ord_123"}' },
            },
            finish_reason: 'function_call',
          },
        ],
      },
      { onWarning: (w) => warnings.push(w) },
    );

    expect(r.message).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call_lookup_order_0',
          type: 'function',
          function: { name: 'lookup_order', arguments: '{"id":"ord_123"}' },
        },
      ],
    });
    expect(r.finishReason).toBe('tool_calls');
    expect(warnings.map((w) => w.code)).toEqual(['generated-id']);
  });

  it('warns and falls back when legacy function_call arguments are explicit non-object values', () => {
    const warnings: Warning[] = [];
    const r = responseFromOpenAI(
      {
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              function_call: { name: 'lookup_order', arguments: ['bad'] },
            },
            finish_reason: 'function_call',
          },
        ],
      },
      { onWarning: (w) => warnings.push(w) },
    );

    expect(r.message.tool_calls).toEqual([
      {
        id: 'call_lookup_order_0',
        type: 'function',
        function: { name: 'lookup_order', arguments: '{}' },
      },
    ]);
    expect(r.finishReason).toBe('tool_calls');
    expect(warnings.map((w) => w.code)).toEqual(['generated-id', 'invalid-json-arguments']);
  });
});

describe('responseFromOpenAIResponses', () => {
  it('collects output_text items, function calls, finish reason and usage', () => {
    const r = responseFromOpenAIResponses({
      object: 'response',
      status: 'completed',
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Checking.' }],
        },
        {
          type: 'function_call',
          call_id: 'call_weather',
          name: 'get_weather',
          arguments: '{"location":"Paris"}',
        },
      ],
      usage: { input_tokens: 12, output_tokens: 6, total_tokens: 18 },
    });

    expect(r.message).toEqual({
      role: 'assistant',
      content: 'Checking.',
      tool_calls: [
        {
          id: 'call_weather',
          type: 'function',
          function: { name: 'get_weather', arguments: '{"location":"Paris"}' },
        },
      ],
    });
    expect(r.finishReason).toBe('tool_calls');
    expect(r.usage).toEqual({ inputTokens: 12, outputTokens: 6 });
  });

  it('maps incomplete max output token responses to length', () => {
    const r = responseFromOpenAIResponses({
      object: 'response',
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'partial' }] }],
    });

    expect(r.message).toEqual({ role: 'assistant', content: 'partial' });
    expect(r.finishReason).toBe('length');
  });

  it('maps incomplete content filter responses and preserves refusal text', () => {
    const r = responseFromOpenAIResponses({
      object: 'response',
      status: 'incomplete',
      incomplete_details: { reason: 'content_filter' },
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'refusal', refusal: 'I cannot help with that.' }],
        },
      ],
    });

    expect(r.message).toEqual({ role: 'assistant', content: 'I cannot help with that.' });
    expect(r.finishReason).toBe('content_filter');
  });

  it('generates deterministic ids and serializes object arguments for function calls', () => {
    const r = responseFromOpenAIResponses({
      object: 'response',
      status: 'completed',
      output: [
        {
          type: 'function_call',
          name: 'lookup_order',
          arguments: { id: 'ord_123' },
        },
      ],
    });

    expect(r.message).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call_lookup_order_0',
          type: 'function',
          function: { name: 'lookup_order', arguments: '{"id":"ord_123"}' },
        },
      ],
    });
    expect(r.finishReason).toBe('tool_calls');
  });

  it('generates deterministic ids when function call ids are empty', () => {
    const warnings: Warning[] = [];
    const r = responseFromOpenAIResponses(
      {
        object: 'response',
        status: 'completed',
        output: [
          {
            type: 'function_call',
            call_id: '',
            id: '',
            name: 'lookup_order',
            arguments: '{}',
          },
        ],
      },
      { onWarning: (w) => warnings.push(w) },
    );

    expect(r.message.tool_calls?.[0].id).toBe('call_lookup_order_0');
    expect(r.finishReason).toBe('tool_calls');
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'generated-id' }));
  });

  it('preserves a later Responses function_call id when an earlier fallback would collide', () => {
    const warnings: Warning[] = [];
    const r = responseFromOpenAIResponses(
      {
        object: 'response',
        status: 'completed',
        output: [
          { type: 'function_call', name: 'search', arguments: '{}' },
          { type: 'function_call', call_id: 'call_search_0', name: 'search', arguments: '{}' },
        ],
      },
      { onWarning: (w) => warnings.push(w) },
    );

    expect(r.message.tool_calls?.map((call) => call.id)).toEqual(['call_search_1', 'call_search_0']);
    expect(warnings.map((w) => w.code)).toEqual(['generated-id']);
  });

  it('regenerates duplicate function_call ids', () => {
    const warnings: Warning[] = [];
    const r = responseFromOpenAIResponses(
      {
        object: 'response',
        status: 'completed',
        output: [
          { type: 'function_call', call_id: 'call_search_0', name: 'search', arguments: '{}' },
          { type: 'function_call', call_id: 'call_search_0', name: 'search', arguments: '{}' },
        ],
      },
      { onWarning: (w) => warnings.push(w) },
    );

    expect(r.message.tool_calls?.map((call) => call.id)).toEqual(['call_search_0', 'call_search_1']);
    expect(warnings.map((w) => w.code)).toEqual(['generated-id']);
    expect(warnings[0]?.message).toContain("reused id 'call_search_0'");
  });

  it('uses a fallback name when a function_call name is malformed', () => {
    const warnings: Warning[] = [];
    const r = responseFromOpenAIResponses(
      {
        object: 'response',
        status: 'completed',
        output: [
          { type: 'function_call', call_id: 'call_1', name: null, arguments: '{}' },
          { type: 'function_call', call_id: 'call_2', name: 'lookup.order', arguments: '{}' },
        ],
      },
      { onWarning: (w) => warnings.push(w) },
    );

    expect(r.message.tool_calls).toEqual([
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'unknown_function', arguments: '{}' },
      },
      {
        id: 'call_2',
        type: 'function',
        function: { name: 'unknown_function', arguments: '{}' },
      },
    ]);
    expect(r.finishReason).toBe('tool_calls');
    expect(warnings.map((w) => w.code)).toEqual(['dropped-metadata', 'dropped-metadata']);
  });

  it('warns and falls back when function_call arguments are explicit non-object values', () => {
    const warnings: Warning[] = [];
    const r = responseFromOpenAIResponses(
      {
        object: 'response',
        status: 'completed',
        output: [{ type: 'function_call', call_id: 'call_lookup', name: 'lookup_order', arguments: ['bad'] }],
      },
      { onWarning: (w) => warnings.push(w) },
    );

    expect(r.message.tool_calls).toEqual([
      { id: 'call_lookup', type: 'function', function: { name: 'lookup_order', arguments: '{}' } },
    ]);
    expect(warnings.map((w) => w.code)).toEqual(['invalid-json-arguments']);
  });

  it('warns and falls back when function_call argument strings are malformed or non-object JSON', () => {
    const warnings: Warning[] = [];
    const r = responseFromOpenAIResponses(
      {
        object: 'response',
        status: 'completed',
        output: [
          { type: 'function_call', call_id: 'call_malformed', name: 'lookup_order', arguments: 'not json' },
          { type: 'function_call', call_id: 'call_array', name: 'lookup_order', arguments: '["bad"]' },
        ],
      },
      { onWarning: (w) => warnings.push(w) },
    );

    expect(r.message.tool_calls).toEqual([
      { id: 'call_malformed', type: 'function', function: { name: 'lookup_order', arguments: '{}' } },
      { id: 'call_array', type: 'function', function: { name: 'lookup_order', arguments: '{}' } },
    ]);
    expect(warnings.map((w) => w.code)).toEqual(['invalid-json-arguments', 'invalid-json-arguments']);
  });

  it('warns when dropping malformed or unsupported top-level output items', () => {
    const warnings: Warning[] = [];
    const r = responseFromOpenAIResponses(
      {
        object: 'response',
        status: 'completed',
        output: [
          null,
          { type: 'reasoning', summary: [{ type: 'summary_text', text: 'provider-only' }] },
          { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'visible' }] },
        ],
      },
      { onWarning: (w) => warnings.push(w) },
    );

    expect(r.message).toEqual({ role: 'assistant', content: 'visible' });
    expect(warnings.map((w) => w.code)).toEqual(['dropped-content', 'dropped-content']);
    expect(warnings[0]?.message).toContain('malformed OpenAI Responses output item');
    expect(warnings[1]?.message).toContain("unsupported OpenAI Responses output item 'reasoning'");
  });

  it('warns when the top-level output array is missing or malformed', () => {
    const missingWarnings: Warning[] = [];
    const missing = responseFromOpenAIResponses(
      {
        object: 'response',
        status: 'completed',
      },
      { onWarning: (w) => missingWarnings.push(w) },
    );

    expect(missing.message).toEqual({ role: 'assistant', content: null });
    expect(missing.finishReason).toBe('stop');
    expect(missingWarnings.map((w) => w.code)).toEqual(['dropped-content']);
    expect(missingWarnings[0]?.message).toContain('missing top-level output array');

    const malformedWarnings: Warning[] = [];
    const malformed = responseFromOpenAIResponses(
      {
        object: 'response',
        status: 'completed',
        output: { type: 'message', content: [{ type: 'output_text', text: 'hidden' }] },
      },
      { onWarning: (w) => malformedWarnings.push(w) },
    );

    expect(malformed.message).toEqual({ role: 'assistant', content: null });
    expect(malformed.finishReason).toBe('stop');
    expect(malformedWarnings.map((w) => w.code)).toEqual(['dropped-content']);
    expect(malformedWarnings[0]?.message).toContain('malformed OpenAI Responses top-level output');
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

  it('warns when the Anthropic content array is missing or malformed', () => {
    const missingWarnings: Warning[] = [];
    const missing = responseFromAnthropic(
      { stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 2 } },
      { onWarning: (w) => missingWarnings.push(w) },
    );

    expect(missing).toEqual({
      message: { role: 'assistant', content: null },
      finishReason: 'stop',
      usage: { inputTokens: 1, outputTokens: 2 },
    });
    expect(missingWarnings.map((w) => w.code)).toEqual(['dropped-content']);
    expect(missingWarnings[0]?.message).toContain('missing content array');

    const malformedWarnings: Warning[] = [];
    const malformed = responseFromAnthropic(
      { content: 'not an array' },
      { onWarning: (w) => malformedWarnings.push(w) },
    );

    expect(malformed.message).toEqual({ role: 'assistant', content: null });
    expect(malformedWarnings.map((w) => w.code)).toEqual(['dropped-content']);
    expect(malformedWarnings[0]?.message).toContain('malformed Anthropic response content');
  });

  it('warns and falls back when tool_use input is not an object', () => {
    const warnings: Warning[] = [];
    const r = responseFromAnthropic(
      {
        content: [{ type: 'tool_use', id: 't1', name: 'get', input: null }],
        stop_reason: 'tool_use',
      },
      { onWarning: (w) => warnings.push(w) },
    );

    expect(r.message.tool_calls).toEqual([{ id: 't1', type: 'function', function: { name: 'get', arguments: '{}' } }]);
    expect(warnings.map((w) => w.code)).toEqual(['invalid-json-arguments']);
  });

  it('warns and falls back when provider argument objects cannot be JSON serialized', () => {
    const anthropicWarnings: Warning[] = [];
    const anthropic = responseFromAnthropic(
      {
        content: [{ type: 'tool_use', id: 'a1', name: 'get', input: { value: 1n } }],
        stop_reason: 'tool_use',
      },
      { onWarning: (w) => anthropicWarnings.push(w) },
    );
    const geminiWarnings: Warning[] = [];
    const gemini = responseFromGemini(
      {
        candidates: [
          {
            content: { parts: [{ functionCall: { id: 'g1', name: 'search', args: { value: 1n } } }] },
            finishReason: 'STOP',
          },
        ],
      },
      { onWarning: (w) => geminiWarnings.push(w) },
    );

    expect(anthropic.message.tool_calls).toEqual([
      { id: 'a1', type: 'function', function: { name: 'get', arguments: '{}' } },
    ]);
    expect(gemini.message.tool_calls).toEqual([
      { id: 'g1', type: 'function', function: { name: 'search', arguments: '{}' } },
    ]);
    expect(anthropicWarnings.map((w) => w.code)).toEqual(['invalid-json-arguments']);
    expect(geminiWarnings.map((w) => w.code)).toEqual(['invalid-json-arguments']);
  });

  it('strips provider-only fields from normalized Anthropic tool calls', () => {
    const r = responseFromAnthropic({
      id: 'msg_123',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-20250514',
      content: [
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'lookup_order',
          input: { id: 'ord_123' },
          cache_control: { type: 'ephemeral' },
        },
      ],
      stop_reason: 'tool_use',
      stop_sequence: null,
    });

    expect(r.message).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [
        { id: 'toolu_1', type: 'function', function: { name: 'lookup_order', arguments: '{"id":"ord_123"}' } },
      ],
    });
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

  it.each([
    ['max_tokens', 'length'],
    ['stop_sequence', 'stop'],
    ['refusal', 'content_filter'],
    ['unknown_stop_reason', 'unknown'],
  ] as const)('maps Anthropic stop_reason %s to %s without tool calls', (stopReason, finishReason) => {
    const r = responseFromAnthropic({
      content: [{ type: 'text', text: 'hello' }],
      stop_reason: stopReason,
    });

    expect(r.message).toEqual({ role: 'assistant', content: 'hello' });
    expect(r.finishReason).toBe(finishReason);
  });

  it('generates deterministic ids when tool_use ids are missing or empty', () => {
    const warnings: Warning[] = [];
    const r = responseFromAnthropic(
      {
        content: [
          { type: 'tool_use', name: 'lookup_order', input: { id: 'ord_123' } },
          { type: 'tool_use', id: '', name: 'search', input: { q: 'weather' } },
        ],
        stop_reason: 'tool_use',
      },
      { onWarning: (w) => warnings.push(w) },
    );

    expect(r.message.tool_calls?.map((call) => call.id)).toEqual(['call_lookup_order_0', 'call_search_1']);
    expect(r.finishReason).toBe('tool_calls');
    expect(warnings.filter((w) => w.code === 'generated-id')).toHaveLength(2);
  });

  it('regenerates duplicate tool_use ids', () => {
    const warnings: Warning[] = [];
    const r = responseFromAnthropic(
      {
        content: [
          { type: 'tool_use', id: 'call_lookup_0', name: 'lookup', input: { q: 'one' } },
          { type: 'tool_use', id: 'call_lookup_0', name: 'lookup', input: { q: 'two' } },
        ],
        stop_reason: 'tool_use',
      },
      { onWarning: (w) => warnings.push(w) },
    );

    expect(r.message.tool_calls?.map((call) => call.id)).toEqual(['call_lookup_0', 'call_lookup_1']);
    expect(warnings.map((w) => w.code)).toEqual(['generated-id']);
    expect(warnings[0]?.message).toContain("reused id 'call_lookup_0'");
  });

  it('preserves a later Anthropic tool_use id when an earlier fallback would collide', () => {
    const warnings: Warning[] = [];
    const r = responseFromAnthropic(
      {
        content: [
          { type: 'tool_use', name: 'lookup', input: { q: 'one' } },
          { type: 'tool_use', id: 'call_lookup_0', name: 'lookup', input: { q: 'two' } },
        ],
        stop_reason: 'tool_use',
      },
      { onWarning: (w) => warnings.push(w) },
    );

    expect(r.message.tool_calls?.map((call) => call.id)).toEqual(['call_lookup_1', 'call_lookup_0']);
    expect(warnings.map((w) => w.code)).toEqual(['generated-id']);
  });

  it('uses a fallback name when a tool_use name is malformed', () => {
    const warnings: Warning[] = [];
    const r = responseFromAnthropic(
      {
        content: [{ type: 'tool_use', id: 'toolu_1', name: null, input: { ok: true } }],
        stop_reason: 'tool_use',
      },
      { onWarning: (w) => warnings.push(w) },
    );

    expect(r.message.tool_calls).toEqual([
      {
        id: 'toolu_1',
        type: 'function',
        function: { name: 'unknown_function', arguments: '{"ok":true}' },
      },
    ]);
    expect(r.finishReason).toBe('tool_calls');
    expect(warnings.map((w) => w.code)).toEqual(['dropped-metadata']);
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

  it('drops thought (reasoning) parts instead of mixing them into content', () => {
    const warnings: Warning[] = [];
    const r = responseFromGemini(
      {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'internal reasoning', thought: true }, { text: 'final answer' }],
            },
            finishReason: 'STOP',
          },
        ],
      },
      { onWarning: (w) => warnings.push(w) },
    );
    expect(r.message.content).toBe('final answer');
    expect(warnings.some((w) => w.code === 'dropped-content' && w.message.includes('thought'))).toBe(true);
  });

  it('warns when Gemini candidates or candidate parts are missing or malformed', () => {
    const missingWarnings: Warning[] = [];
    const missing = responseFromGemini(
      { usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2 } },
      { onWarning: (w) => missingWarnings.push(w) },
    );

    expect(missing).toEqual({
      message: { role: 'assistant', content: null },
      finishReason: 'unknown',
      usage: { inputTokens: 1, outputTokens: 2 },
    });
    expect(missingWarnings.map((w) => w.code)).toEqual(['dropped-content']);
    expect(missingWarnings[0]?.message).toContain('missing candidates array');

    const malformedCandidatesWarnings: Warning[] = [];
    responseFromGemini({ candidates: 'not an array' }, { onWarning: (w) => malformedCandidatesWarnings.push(w) });

    expect(malformedCandidatesWarnings.map((w) => w.code)).toEqual(['dropped-content']);
    expect(malformedCandidatesWarnings[0]?.message).toContain('malformed Gemini response candidates');

    const malformedCandidateWarnings: Warning[] = [];
    responseFromGemini({ candidates: [null] }, { onWarning: (w) => malformedCandidateWarnings.push(w) });

    expect(malformedCandidateWarnings.map((w) => w.code)).toEqual(['dropped-content']);
    expect(malformedCandidateWarnings[0]?.message).toContain('malformed Gemini response candidate');

    const malformedContentWarnings: Warning[] = [];
    responseFromGemini(
      { candidates: [{ content: 'not an object', finishReason: 'STOP' }] },
      { onWarning: (w) => malformedContentWarnings.push(w) },
    );

    expect(malformedContentWarnings.map((w) => w.code)).toEqual(['dropped-content']);
    expect(malformedContentWarnings[0]?.message).toContain('malformed Gemini response candidate content');

    const malformedPartsWarnings: Warning[] = [];
    responseFromGemini(
      { candidates: [{ content: { parts: 'not an array' }, finishReason: 'STOP' }] },
      { onWarning: (w) => malformedPartsWarnings.push(w) },
    );

    expect(malformedPartsWarnings.map((w) => w.code)).toEqual(['dropped-content']);
    expect(malformedPartsWarnings[0]?.message).toContain('malformed Gemini response candidate content parts');
  });

  it('warns and falls back when functionCall args are not an object', () => {
    const warnings: Warning[] = [];
    const r = responseFromGemini(
      {
        candidates: [
          {
            content: { parts: [{ functionCall: { id: 'g1', name: 'search', args: ['bad'] } }] },
            finishReason: 'STOP',
          },
        ],
      },
      { onWarning: (w) => warnings.push(w) },
    );

    expect(r.message.tool_calls).toEqual([
      { id: 'g1', type: 'function', function: { name: 'search', arguments: '{}' } },
    ]);
    expect(warnings.map((w) => w.code)).toEqual(['invalid-json-arguments']);
  });

  it('strips provider-only fields from normalized Gemini function calls', () => {
    const r = responseFromGemini({
      candidates: [
        {
          index: 0,
          content: {
            role: 'model',
            parts: [
              {
                thought: true,
                thoughtSignature: 'opaque',
                functionCall: {
                  id: 'call_lookup',
                  name: 'lookup_order',
                  args: { id: 'ord_123' },
                  extra: 'ignored',
                },
              },
            ],
          },
          finishReason: 'STOP',
          safetyRatings: [{ category: 'HARM_CATEGORY_DANGEROUS_CONTENT', probability: 'NEGLIGIBLE' }],
        },
      ],
      promptFeedback: { blockReason: 'SAFETY' },
    });

    expect(r.message).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [
        { id: 'call_lookup', type: 'function', function: { name: 'lookup_order', arguments: '{"id":"ord_123"}' } },
      ],
    });
  });

  it('keeps an existing functionCall id', () => {
    const r = responseFromGemini({
      candidates: [{ content: { parts: [{ functionCall: { id: 'g1', name: 'f', args: {} } }] }, finishReason: 'STOP' }],
    });
    expect(r.message.tool_calls?.[0].id).toBe('g1');
  });

  it.each([
    ['STOP', 'stop'],
    ['MAX_TOKENS', 'length'],
    ['SAFETY', 'content_filter'],
    ['RECITATION', 'content_filter'],
    ['BLOCKLIST', 'content_filter'],
    ['PROHIBITED_CONTENT', 'content_filter'],
    ['SPII', 'content_filter'],
    ['MALFORMED_FUNCTION_CALL', 'content_filter'],
    ['MODEL_ARMOR', 'content_filter'],
    ['IMAGE_SAFETY', 'content_filter'],
    ['IMAGE_PROHIBITED_CONTENT', 'content_filter'],
    ['IMAGE_RECITATION', 'content_filter'],
    ['OTHER', 'unknown'],
    ['IMAGE_OTHER', 'unknown'],
    ['UNEXPECTED_TOOL_CALL', 'unknown'],
    ['NO_IMAGE', 'unknown'],
  ] as const)('maps Gemini finishReason %s to %s without function calls', (geminiReason, finishReason) => {
    const r = responseFromGemini({
      candidates: [{ content: { parts: [{ text: 'hello' }] }, finishReason: geminiReason }],
    });

    expect(r.message).toEqual({ role: 'assistant', content: 'hello' });
    expect(r.finishReason).toBe(finishReason);
  });

  it('preserves a later Gemini functionCall id when an earlier fallback would collide', () => {
    const warnings: Warning[] = [];
    const r = responseFromGemini(
      {
        candidates: [
          {
            content: {
              parts: [
                { functionCall: { name: 'search', args: { q: 'generated' } } },
                { functionCall: { id: 'call_search_0', name: 'search', args: { q: 'provided' } } },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      },
      { onWarning: (w) => warnings.push(w) },
    );

    expect(r.message.tool_calls?.map((call) => call.id)).toEqual(['call_search_1', 'call_search_0']);
    expect(warnings.map((w) => w.code)).toEqual(['generated-id']);
  });

  it('regenerates duplicate functionCall ids', () => {
    const warnings: Warning[] = [];
    const r = responseFromGemini(
      {
        candidates: [
          {
            content: {
              parts: [
                { functionCall: { id: 'call_search_0', name: 'search', args: { q: 'one' } } },
                { functionCall: { id: 'call_search_0', name: 'search', args: { q: 'two' } } },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      },
      { onWarning: (w) => warnings.push(w) },
    );

    expect(r.message.tool_calls?.map((call) => call.id)).toEqual(['call_search_0', 'call_search_1']);
    expect(warnings.map((w) => w.code)).toEqual(['generated-id']);
    expect(warnings[0]?.message).toContain("reused id 'call_search_0'");
  });

  it('generates deterministic ids when functionCall ids are empty or non-string', () => {
    const warnings: Warning[] = [];
    const r = responseFromGemini(
      {
        candidates: [
          {
            content: {
              parts: [
                { functionCall: { id: '', name: 'search', args: { q: 'x' } } },
                { functionCall: { id: 123, name: 'lookup', args: { id: 'ord_123' } } },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      },
      { onWarning: (w) => warnings.push(w) },
    );

    expect(r.message.tool_calls?.map((call) => call.id)).toEqual(['call_search_0', 'call_lookup_1']);
    expect(warnings.filter((w) => w.code === 'generated-id')).toHaveLength(2);
  });

  it('uses a fallback name when a functionCall name is malformed', () => {
    const warnings: Warning[] = [];
    const r = responseFromGemini(
      {
        candidates: [
          {
            content: { parts: [{ functionCall: { id: 'g1', name: null, args: {} } }] },
            finishReason: 'STOP',
          },
        ],
      },
      { onWarning: (w) => warnings.push(w) },
    );

    expect(r.message.tool_calls).toEqual([
      {
        id: 'g1',
        type: 'function',
        function: { name: 'unknown_function', arguments: '{}' },
      },
    ]);
    expect(r.finishReason).toBe('tool_calls');
    expect(warnings.map((w) => w.code)).toEqual(['dropped-metadata']);
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

  it('passes warning options to OpenAI Chat Completions normalization', () => {
    const warnings: Warning[] = [];
    const r = normalizeResponse(
      {
        choices: [
          {
            message: {
              role: 'assistant',
              tool_calls: [{ id: 'c1', type: 'function', function: { name: '', arguments: '{}' } }],
            },
            finish_reason: 'tool_calls',
          },
        ],
      },
      { from: 'openai' },
      { onWarning: (w) => warnings.push(w) },
    );

    expect(r.message.tool_calls?.[0].function.name).toBe('unknown_function');
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'dropped-metadata' }));
  });

  it('passes warning options to Anthropic response normalization', () => {
    const warnings: Warning[] = [];
    const r = normalizeResponse(
      { content: [{ type: 'tool_use', name: 'lookup', input: {} }], stop_reason: 'tool_use' },
      { from: 'anthropic' },
      { onWarning: (w) => warnings.push(w) },
    );

    expect(r.message.tool_calls?.[0].id).toBe('call_lookup_0');
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'generated-id' }));
  });

  it('passes warning options to Gemini response normalization', () => {
    const warnings: Warning[] = [];
    const r = normalizeResponse(
      {
        candidates: [
          {
            content: { parts: [{ functionCall: { name: 'lookup', args: {} } }] },
            finishReason: 'STOP',
          },
        ],
      },
      { from: 'gemini' },
      { onWarning: (w) => warnings.push(w) },
    );

    expect(r.message.tool_calls?.[0].id).toBe('call_lookup_0');
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'generated-id' }));
  });

  it('passes warning options to OpenAI Responses normalization', () => {
    const warnings: Warning[] = [];
    const r = normalizeResponse(
      {
        object: 'response',
        status: 'completed',
        output: [{ type: 'function_call', call_id: '', id: '', name: 'lookup', arguments: '{}' }],
      },
      { from: 'openai-responses' },
      { onWarning: (w) => warnings.push(w) },
    );

    expect(r.message.tool_calls?.[0].id).toBe('call_lookup_0');
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'generated-id' }));
  });

  it('dispatches OpenAI Responses API bodies explicitly', () => {
    const r = normalizeResponse(
      {
        object: 'response',
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'hi' }] }],
      },
      { from: 'openai-responses' },
    );
    expect(r.message.content).toBe('hi');
    expect(r.finishReason).toBe('stop');
  });
});
