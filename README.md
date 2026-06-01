# llm-messages

[![npm version](https://img.shields.io/npm/v/llm-messages.svg)](https://www.npmjs.com/package/llm-messages)
[![CI](https://github.com/slegarraga/llm-messages/actions/workflows/ci.yml/badge.svg)](https://github.com/slegarraga/llm-messages/actions/workflows/ci.yml)
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

## Scope

Version 0.x covers text, system prompts, and tool calls/results, which is the
core of every agent loop. Multimodal parts (images, audio) are passed through
where possible and reported as `dropped-content` otherwise; first-class
multimodal mapping is on the roadmap.

## Part of a set

`llm-messages` pairs with [`tool-schema`](https://github.com/slegarraga/tool-schema),
which converts your tool/function **schemas** across the same providers. Together
they let you write an agent once and run it on any LLM.

## License

MIT (c) Sebastian Legarraga. See [LICENSE](./LICENSE).
