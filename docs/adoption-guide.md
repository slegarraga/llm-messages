# llm-messages adoption guide

`llm-messages` is meant for teams that use OpenAI Chat Completions as their
internal conversation shape but need to run the same agent loop against
Anthropic, Gemini, or a fallback provider.

Use it when you need:

- one canonical OpenAI-compatible message history in your app
- provider fallback without rewriting stored conversations
- tool-call and tool-result conversion across providers
- multimodal inputs that keep image, audio, and document parts explicit
- deterministic warnings instead of hidden conversion loss

## Five minute local check

```sh
npm install llm-messages
```

```ts
import { convert, toAnthropic, toGemini } from 'llm-messages';

const openaiMessages = [
  { role: 'system', content: 'You are a concise support agent.' },
  { role: 'user', content: 'Summarize this ticket and call the right tool.' },
  {
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id: 'call_route',
        type: 'function',
        function: {
          name: 'route_ticket',
          arguments: '{"priority":"high","team":"billing"}',
        },
      },
    ],
  },
  { role: 'tool', tool_call_id: 'call_route', content: '{"ok":true}' },
];

const anthropicBody = toAnthropic(openaiMessages);
const geminiBody = toGemini(openaiMessages);
const geminiFromAnthropic = convert(anthropicBody, {
  from: 'anthropic',
  to: 'gemini',
});
```

No API key is required for this check. The conversion runs locally and returns
plain request bodies you can inspect in tests.

## Integration pattern

1. Keep OpenAI Chat Completions messages as the canonical persisted shape.
2. Convert only at the provider boundary.
3. Log conversion warnings from `onWarning`.
4. Normalize provider responses before saving assistant messages.
5. Cover important agent loops with fixtures before enabling provider fallback.

```ts
import { normalizeResponse, toAnthropic } from 'llm-messages';

const requestBody = toAnthropic(messages, {
  onWarning: (warning) => logger.warn({ warning }, 'message conversion warning'),
});

const providerResponse = await anthropic.messages.create(requestBody);
const { message, finishReason, usage } = normalizeResponse(providerResponse, {
  from: 'anthropic',
});
```

## What to validate before production

- tool-call IDs stay stable across your retry and replay path
- provider-specific system prompt rules match your app assumptions
- unsupported modalities are surfaced through warnings
- saved fixtures cover tool calls, tool results, images, and fallback
- provider SDK versions are pinned or tested in CI

## Related public material

- [Conformance fixture plan](./conformance-fixtures.md)
- [Roadmap](../ROADMAP.md)
- [Offline portability demo](https://github.com/slegarraga/llm-portability-demo)
- [OpenAI-compatible agent portability note](https://github.com/slegarraga/llm-portability-demo/blob/main/docs/openai-compatible-agent-portability.md)

Questions, bug reports, and real-world fixture requests are welcome through
[GitHub Issues](https://github.com/slegarraga/llm-messages/issues) or
[sebastian@0a.cl](mailto:sebastian@0a.cl).
