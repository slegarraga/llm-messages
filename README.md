# llm-messages

[![npm version](https://img.shields.io/npm/v/llm-messages.svg)](https://www.npmjs.com/package/llm-messages)
[![npm downloads](https://img.shields.io/npm/dm/llm-messages.svg)](https://www.npmjs.com/package/llm-messages)
[![CI](https://github.com/slegarraga/llm-messages/actions/workflows/ci.yml/badge.svg)](https://github.com/slegarraga/llm-messages/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/slegarraga/llm-messages/badge)](https://scorecard.dev/viewer/?uri=github.com/slegarraga/llm-messages)
[![license](https://img.shields.io/npm/l/llm-messages.svg)](./LICENSE)
[![zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](./package.json)

Convert chat conversations between **OpenAI**, **Anthropic** and **Gemini** message formats. Tool calls, system prompts and roles handled correctly. Zero dependencies.

Switching an agent from one provider to another (or running fallback across providers) means rewriting the whole conversation, and the differences are subtle enough to break at runtime:

- The **system prompt** is a message in OpenAI, a top-level `system` field in Anthropic, and `systemInstruction` in Gemini.
- The assistant role is `assistant` in OpenAI and Anthropic but `model` in Gemini.
- Tool-call arguments are a **JSON string** in OpenAI but a **parsed object** in Anthropic and Gemini.
- Tool results are a standalone `role: "tool"` message in OpenAI, a `tool_result` block inside a user turn in Anthropic, and a `functionResponse` part in Gemini.
- Gemini matches tool calls to results **by function name**, while OpenAI and Anthropic use ids.
- Anthropic and Gemini reject consecutive same-role turns; OpenAI does not.

`llm-messages` handles all of it. Write the conversation once, send it to any provider.

## Install

```sh
npm install llm-messages
```

Requires Node 18+. Ships ESM and CommonJS with full TypeScript types.

## Quick start

```ts
import { toAnthropic, toGemini } from 'llm-messages';

// A normal OpenAI Chat Completions conversation
const messages = [
  { role: 'system', content: 'You are a weather assistant.' },
  { role: 'user', content: "What's the weather in Paris?" },
];

const anthropic = toAnthropic(messages);
// -> { system: 'You are a weather assistant.', messages: [{ role: 'user', content: "What's the weather in Paris?" }] }

const gemini = toGemini(messages);
// -> { systemInstruction: { parts: [{ text: 'You are a weather assistant.' }] },
//      contents: [{ role: 'user', parts: [{ text: "What's the weather in Paris?" }] }] }
```

## The canonical hub

OpenAI Chat Completions is the canonical format. Every conversion routes through
it, so you get a function for each direction:

```ts
import { toAnthropic, fromAnthropic, toGemini, fromGemini, convert } from 'llm-messages';

toAnthropic(openaiMessages); // OpenAI  -> Anthropic
fromAnthropic(anthropicBody); // Anthropic -> OpenAI
toGemini(openaiMessages); // OpenAI  -> Gemini
fromGemini(geminiBody); // Gemini  -> OpenAI

// Or convert between any two providers in one call:
convert(anthropicBody, { from: 'anthropic', to: 'gemini' });
```

`convert` is fully typed: the input and output shapes are inferred from the
`from` and `to` providers.

## Tool calls round trip losslessly

The hard part is tool use, and it survives a full round trip unchanged:

```ts
const messages = [
  {
    role: 'assistant',
    content: null,
    tool_calls: [
      { id: 'call_abc', type: 'function', function: { name: 'get_weather', arguments: '{"location":"Paris"}' } },
    ],
  },
  { role: 'tool', tool_call_id: 'call_abc', content: '15C partly cloudy' },
];

fromGemini(toGemini(messages)); // deep-equals the original `messages`
```

Arguments are parsed and re-serialized, ids are preserved (and regenerated
deterministically when a Gemini payload omits them), and parallel tool results
are grouped into the single user turn each provider expects.

## Conversion report

Conversions never throw on malformed input. Instead they make a deterministic
choice and optionally report it, so you can surface or log what happened:

```ts
toGemini(messages, {
  onWarning: (w) => console.warn(`[${w.code}] ${w.message}`),
});
```

Warning codes: `generated-id`, `unmapped-tool-result`, `merged-role`,
`dropped-content`, `invalid-json-arguments`, `system-midstream`.

## Reading responses

The same idea applies to the read side. Normalize a provider's response body into
a canonical OpenAI assistant message, plus a neutral finish reason and token usage:

```ts
import { responseFromAnthropic, normalizeResponse } from 'llm-messages';

const { message, finishReason, usage } = responseFromAnthropic(anthropicResponseBody);
// message     -> { role: 'assistant', content, tool_calls? }  (tool input re-serialized to a JSON string)
// finishReason -> 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'unknown'
// usage       -> { inputTokens, outputTokens }

// Or dispatch by provider:
normalizeResponse(geminiResponseBody, { from: 'gemini' });
```

`finishReason` is normalized to `tool_calls` whenever the model called a tool, even
for Gemini (which reports `STOP`). Gemini tool calls without an id get a
deterministic one.

## Format cheatsheet

|                  | OpenAI                   | Anthropic                        | Gemini                          |
| ---------------- | ------------------------ | -------------------------------- | ------------------------------- |
| System prompt    | `role: "system"` message | top-level `system`               | `systemInstruction`             |
| Assistant role   | `assistant`              | `assistant`                      | `model`                         |
| Tool call        | `tool_calls[].function`  | `tool_use` block                 | `functionCall` part             |
| Call arguments   | JSON string              | object (`input`)                 | object (`args`)                 |
| Tool result      | `role: "tool"` message   | `tool_result` block in user turn | `functionResponse` part in user |
| Match key        | `tool_call_id`           | `tool_use_id`                    | function `name` (id optional)   |
| Role alternation | not required             | strict                           | strict                          |

## Images, audio and documents

Image parts convert across all three providers:

```ts
const messages = [
  {
    role: 'user',
    content: [
      { type: 'text', text: 'What is in this image?' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo...' } },
    ],
  },
];

toAnthropic(messages); // -> { type: 'image', source: { type: 'base64', media_type: 'image/png', data: '...' } }
toGemini(messages); //    -> { inlineData: { mimeType: 'image/png', data: '...' } }
```

Base64 data URLs round trip losslessly. A remote `https` URL maps to an Anthropic
`url` source; for Gemini it is emitted as `fileData.fileUri` with a
`gemini-url-image` warning, since Gemini may require the Files API for non-Google
URIs.

**Audio** (`input_audio`) and **documents** (`file`, e.g. PDF) convert too. Audio
moves between OpenAI and Gemini; Anthropic has no audio input, so an audio part is
dropped with an `unsupported-modality` warning. Documents convert across all three
(OpenAI `file`, Anthropic `document`, Gemini `inlineData`).

## Scope

Version 0.x covers text, system prompts, tool calls/results, images, audio and
documents, which is the core of every agent loop. Unsupported parts are reported
via `dropped-content` rather than failing.

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for current maintenance priorities, including
OpenAI Responses API coverage, live conformance fixtures and tool-call edge
cases. The [conformance fixtures plan](./docs/conformance-fixtures.md) describes
how API credits should be used to refresh deterministic public fixtures without
putting secrets in CI.

For teams evaluating the package, the
[adoption guide](./docs/adoption-guide.md) covers the OpenAI-compatible boundary,
local validation and production checks.

## Provider portability suite

`llm-messages` is the conversation boundary in a small provider-portability
suite for OpenAI-compatible agent infrastructure:

- [`tool-schema`](https://github.com/slegarraga/tool-schema) converts one JSON
  Schema into provider-specific tool/function schemas.
- [`llm-sse`](https://github.com/slegarraga/llm-sse) parses streaming provider
  responses into unified events.
- [`llm-errors`](https://github.com/slegarraga/llm-errors) normalizes provider
  errors, retry hints and fallback decisions.
- [`json-from-llm`](https://github.com/slegarraga/json-from-llm) extracts JSON
  before it enters a tool or message pipeline.
- [`llm-portability-demo`](https://github.com/slegarraga/llm-portability-demo)
  shows the whole flow offline, with no API key required.

Read the
[provider portability map](https://github.com/slegarraga/llm-portability-demo/blob/main/docs/provider-portability.md)
for the package roles, OpenAI-compatible hub shape and demo flow.

## License

MIT (c) Sebastian Legarraga. See [LICENSE](./LICENSE).
