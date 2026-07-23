# llm-messages

[![npm version](https://img.shields.io/npm/v/llm-messages.svg)](https://www.npmjs.com/package/llm-messages)
[![npm downloads](https://img.shields.io/npm/dm/llm-messages?logo=npm&label=downloads)](https://www.npmjs.com/package/llm-messages)
[![CI](https://github.com/slegarraga/llm-messages/actions/workflows/ci.yml/badge.svg)](https://github.com/slegarraga/llm-messages/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/slegarraga/llm-messages/badge)](https://scorecard.dev/viewer/?uri=github.com/slegarraga/llm-messages)
[![license](https://img.shields.io/npm/l/llm-messages.svg)](./LICENSE)
[![zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](./package.json)
[![install size](https://packagephobia.com/badge?p=llm-messages)](https://packagephobia.com/result?p=llm-messages)
[![bundle size](https://img.shields.io/bundlephobia/minzip/llm-messages?label=min%2Bgzip)](https://bundlephobia.com/package/llm-messages)

One library to write a conversation once and send it to OpenAI, Anthropic, or Gemini: handles system prompts, tool calls, role names, consecutive-turn merging, and response normalization. Zero dependencies.

Switching an agent from one provider to another (or running fallback across providers) means rewriting the whole conversation, and the differences are subtle enough to break at runtime:

- The **system prompt** is a message in OpenAI, a top-level `system` field in Anthropic, and `systemInstruction` in Gemini.
- The assistant role is `assistant` in OpenAI and Anthropic but `model` in Gemini.
- Tool-call arguments are a **JSON string** in OpenAI but a **parsed object** in Anthropic and Gemini.
- Tool results are a standalone `role: "tool"` message in OpenAI, a `tool_result` block inside a user turn in Anthropic, and a `functionResponse` part in Gemini.
- Gemini can match tool calls to results **by id when present** or by function
  name when ids are omitted, while OpenAI and Anthropic require ids.
- Anthropic and Gemini reject consecutive same-role turns; OpenAI does not.

`llm-messages` handles all of it. Write the conversation once, send it to any provider.

## Project

- [Roadmap](./ROADMAP.md): conformance and portability priorities
- [Contributing](./CONTRIBUTING.md): development and fixture workflow
- [Governance](./GOVERNANCE.md): decisions and the path to reviewer or maintainer
- [Support](./SUPPORT.md): questions and reproducible bug reports
- [Security](./SECURITY.md): private vulnerability reporting
- [Conformance fixtures](./docs/conformance-fixtures.md): public compatibility contract
- [Changelog](./CHANGELOG.md): release history and migration notes
- [Code of Conduct](./CODE_OF_CONDUCT.md): community standards

## Install

```sh
npm install llm-messages
```

Requires Node 18+. Ships ESM and CommonJS with full TypeScript types.

CommonJS consumers can import the same package root:

```js
const { toAnthropic, toGemini } = require('llm-messages');
```

## Quick start

```ts
import { toAnthropic, toGemini, type OpenAIMessage } from 'llm-messages';

// A normal OpenAI Chat Completions conversation
const messages: OpenAIMessage[] = [
  { role: 'system', content: 'You are a weather assistant.' },
  { role: 'user', content: "What's the weather in Paris?" },
];

const anthropic = toAnthropic(messages);
// -> { system: 'You are a weather assistant.', messages: [{ role: 'user', content: "What's the weather in Paris?" }] }

const gemini = toGemini(messages);
// -> { systemInstruction: { parts: [{ text: 'You are a weather assistant.' }] },
//      contents: [{ role: 'user', parts: [{ text: "What's the weather in Paris?" }] }] }
```

## Recipes

### Convert an OpenAI conversation to Anthropic and call the SDK

```ts
import Anthropic from '@anthropic-ai/sdk';
import { toAnthropic, responseFromAnthropic, type OpenAIMessage } from 'llm-messages';

const client = new Anthropic();

const conversation: OpenAIMessage[] = [
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: 'What is 2 + 2?' },
];

const { system, messages } = toAnthropic(conversation);

const raw = await client.messages.create({
  model: 'claude-opus-4-8',
  max_tokens: 256,
  system,
  messages,
});

// Normalize the response back to the OpenAI-compatible shape:
const { message, finishReason, usage } = responseFromAnthropic(raw);
const text = raw.content.find((b) => b.type === 'text')?.text ?? '';
// message.role === 'assistant', finishReason === 'stop', usage.outputTokens > 0
```

### Provider-fallback loop: one conversation, two providers

When a provider is rate-limited or unavailable, retry against the next one without
rewriting the conversation or the response-parsing logic:

```ts
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { toAnthropic, responseFromAnthropic, responseFromOpenAI, type OpenAIMessage } from 'llm-messages';

const conversation: OpenAIMessage[] = [
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: 'Summarize the water cycle in one sentence.' },
];

async function callWithFallback() {
  // Try OpenAI first:
  try {
    const oai = new OpenAI();
    const res = await oai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: conversation,
    });
    const raw = res.choices[0].message.content ?? '';
    return responseFromOpenAI(res);
  } catch {
    // Fall back to Anthropic with the same conversation:
    const ant = new Anthropic();
    const { system, messages } = toAnthropic(conversation);
    const res = await ant.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      system,
      messages,
    });
    return responseFromAnthropic(res);
  }
}

const { message, finishReason } = await callWithFallback();
// message.role === 'assistant' regardless of which provider answered
```

### Vercel AI SDK: keep your conversation portable

```ts
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { toAnthropic, type OpenAIMessage } from 'llm-messages';

const conversation: OpenAIMessage[] = [
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: 'Hello!' },
];

// Use directly with Vercel AI SDK (already OpenAI-compatible):
const { text } = await generateText({ model: openai('gpt-4o-mini'), messages: conversation });

// Or convert the same conversation to send via Anthropic SDK:
const { system, messages } = toAnthropic(conversation);
```

## Why not X

**`ai` (Vercel AI SDK)** covers model routing and streaming well, but its
`CoreMessage` type differs from OpenAI's Chat Completions shape, and it does not
export converters to/from raw Anthropic or Gemini wire formats. `llm-messages` is
a complement: convert once so the conversation stays in one shape, then hand it to
whichever SDK or HTTP client you use.

**Writing the conversion yourself** is straightforward for text, but subtle for
tool calls: argument serialization differs per provider, consecutive same-role
turns are rejected by Anthropic and Gemini, Gemini matches results by name when
ids are absent, and Anthropic `tool_use_id` pairing has its own rules. The edge
cases accumulate. `llm-messages` has conformance fixtures that cover them.

**LangChain / LlamaIndex** solve orchestration. If you only need the message
conversion layer without the orchestration overhead, `llm-messages` is ~6 KB
min+gzip with zero runtime dependencies.

## API

### The canonical hub

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

### Tool calls round trip losslessly

The hard part is tool use, and it survives a full round trip unchanged:

```ts
import { fromGemini, toGemini, type OpenAIMessage } from 'llm-messages';

const messages: OpenAIMessage[] = [
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
deterministically when a Gemini payload does not provide a non-empty string id), and
parallel tool results are grouped into the single user turn each provider expects. Anthropic
`tool_result.is_error` is preserved as optional canonical tool-message metadata;
standalone Gemini `functionResponse.name` is also preserved so orphaned tool
results can be sent back to Gemini without renaming the function to the id. When
Anthropic includes `tool_result.tool_use_id` or Gemini includes
`functionResponse.id`, it is matched before provider-specific fallback behavior.

### Conversion report

When typed provider payloads contain malformed tool-call or media fields,
conversions make a deterministic choice and optionally report it, so you can
surface or log what happened:

```ts
toGemini(messages, {
  onWarning: (w) => console.warn(`[${w.code}] ${w.message}`),
});
```

Warning codes: `generated-id`, `unmapped-tool-result`, `merged-role`,
`dropped-content`, `dropped-metadata`, `invalid-json-arguments`,
`system-midstream`, `gemini-url-image`, `gemini-url-media`,
`unsupported-modality`.

Consumers that validate fixture metadata or warning filters can import the same
stable list from the package root as `warningCodes`.

### Reading responses

The same idea applies to the read side. Normalize a provider's response body into
a canonical OpenAI assistant message, plus a neutral finish reason and token usage:

```ts
import {
  responseFromAnthropic,
  responseFromGemini,
  responseFromOpenAI,
  responseFromOpenAIResponses,
  normalizeResponse,
} from 'llm-messages';

const { message, finishReason, usage } = responseFromAnthropic(anthropicResponseBody);
// message     -> { role: 'assistant', content, tool_calls? }  (tool input re-serialized to a JSON string)
// finishReason -> 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'unknown'
// usage       -> { inputTokens, outputTokens }

const responses = responseFromOpenAIResponses(openaiResponsesBody);
// OpenAI Responses API `output_text` items become assistant `content`.
// `function_call` items become Chat Completions-compatible `tool_calls`.

const chat = responseFromOpenAI(openaiChatBody);
// Chat Completions `choices[0].message.tool_calls` stay Chat Completions-compatible.

const gemini = responseFromGemini(geminiResponseBody);
// Gemini `functionCall` parts become assistant `tool_calls`.

// Or dispatch by provider:
normalizeResponse(geminiResponseBody, { from: 'gemini' });
normalizeResponse(openaiResponsesBody, { from: 'openai-responses' });
```

`finishReason` is normalized to `tool_calls` whenever the model called a tool, even
for Gemini (which reports `STOP`) and Responses API bodies with `function_call`
items. OpenAI Chat Completions, OpenAI Responses, Anthropic and Gemini tool
calls without a non-empty string id get a deterministic one.

### Streaming Responses API output

`llm-messages` normalizes completed response bodies and conversations. For
incremental SSE events, use
[`llm-sse`](https://github.com/slegarraga/llm-sse)'s
`parseOpenAIResponsesStream`, then `collectStream` and `toAssistantMessage`
before converting the completed history here. Keeping the streaming and message
boundaries separate lets both packages stay small, deterministic, and
zero-dependency.

The cross-package conformance example is tracked in
[issue #29](https://github.com/slegarraga/llm-messages/issues/29).

### Format cheatsheet

|                  | OpenAI                   | Anthropic                        | Gemini                          |
| ---------------- | ------------------------ | -------------------------------- | ------------------------------- |
| System prompt    | `role: "system"` message | top-level `system`               | `systemInstruction`             |
| Assistant role   | `assistant`              | `assistant`                      | `model`                         |
| Tool call        | `tool_calls[].function`  | `tool_use` block                 | `functionCall` part             |
| Call arguments   | JSON string              | object (`input`)                 | object (`args`)                 |
| Tool result      | `role: "tool"` message   | `tool_result` block in user turn | `functionResponse` part in user |
| Match key        | `tool_call_id`           | `tool_use_id`                    | `id` when present, else `name`  |
| Role alternation | not required             | strict                           | strict                          |

### Images, audio and documents

Image parts convert across all three providers:

```ts
import { toAnthropic, toGemini, type OpenAIMessage } from 'llm-messages';

const messages: OpenAIMessage[] = [
  {
    role: 'user',
    content: [
      { type: 'text', text: 'What is in this image?' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo...' } },
    ],
  },
];

toAnthropic(messages).messages[0]?.content;
// -> [{ type: 'text', ... }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: '...' } }]

toGemini(messages).contents[0]?.parts;
// -> [{ text: 'What is in this image?' }, { inlineData: { mimeType: 'image/png', data: '...' } }]
```

Base64 data URLs round trip losslessly. A remote `https` URL maps to an Anthropic
`url` source; for Gemini it is emitted as `fileData.fileUri` with a
`gemini-url-image` warning, since Gemini may require the Files API for non-Google
URIs.

If you need to handle image payloads directly, `parseDataUrl` and `toDataUrl`
are exported for the same base64 data URL shape used by the converters.

**Audio** (`input_audio`) and **documents** (`file`, e.g. PDF) convert too. Audio
moves between OpenAI and Gemini; Anthropic has no audio input, so an audio part is
dropped with an `unsupported-modality` warning. Base64 document payloads convert
across all three providers (OpenAI `file`, Anthropic `document`, Gemini
`inlineData`). OpenAI `file_id` document references map to Anthropic `file`
sources; Gemini has no equivalent and drops them with `unsupported-modality`.

## Scope

Version 0.x covers text, system prompts, tool calls/results, images, audio and
documents, which is the core of every agent loop. Unsupported or lossy parts are
reported through stable warning codes such as `dropped-content`,
`unsupported-modality` or provider-specific media warnings rather than failing.
Provider-only fields are preserved only when the canonical OpenAI-compatible
shape has an explicit optional metadata field for them, such as Anthropic
`tool_result.is_error` and standalone Gemini `functionResponse.name`. When that
metadata has no target-provider equivalent, conversion continues and reports
`dropped-metadata`.

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for current maintenance priorities, including
OpenAI Responses API coverage, offline conformance fixtures and tool-call edge
cases. The [conformance fixtures guide](./docs/conformance-fixtures.md)
describes how API credits should be used to refresh deterministic public
fixtures without putting secrets in CI.

For teams evaluating the package, the
[adoption guide](./docs/adoption-guide.md) covers the OpenAI-compatible boundary,
local validation and production checks.

Security posture is tracked in [docs/security-posture.md](./docs/security-posture.md),
including CodeQL, OpenSSF Scorecard, Dependabot and branch rules.

Questions, reproducible bugs, and maintainer responsibilities are documented in
[SUPPORT.md](./SUPPORT.md) and [GOVERNANCE.md](./GOVERNANCE.md).

## Related

`llm-messages` is the conversation boundary in a small provider-portability
suite for OpenAI-compatible agent infrastructure. The other packages in the suite:

- [`json-from-llm`](https://www.npmjs.com/package/json-from-llm): extract valid JSON from an LLM response, even inside reasoning tags, fenced blocks or prose
- [`tool-schema`](https://www.npmjs.com/package/tool-schema): convert a JSON Schema into a provider tool / function-calling schema for OpenAI, Anthropic, Gemini and MCP
- [`llm-sse`](https://www.npmjs.com/package/llm-sse): parse streaming SSE from LLM providers into typed, provider-agnostic events
- [`llm-errors`](https://www.npmjs.com/package/llm-errors): normalize provider errors (rate limits, retries, status) into one shape

The [`llm-portability-demo`](https://github.com/slegarraga/llm-portability-demo)
shows the whole flow offline, with no API key required.

Read the
[provider portability map](https://github.com/slegarraga/llm-portability-demo/blob/main/docs/provider-portability.md)
for the package roles, OpenAI-compatible hub shape and demo flow.

## License

MIT (c) Sebastian Legarraga. See [LICENSE](./LICENSE).
