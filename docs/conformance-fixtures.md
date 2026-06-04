# Conformance fixtures plan

`llm-messages` keeps OpenAI Chat Completions-compatible messages as its hub
shape. Provider-backed conformance fixtures are the next layer for proving that
the conversions stay correct as OpenAI, Anthropic and Gemini payloads evolve.

The fixture workflow should be safe to run in public CI without secrets, while
still allowing maintainers to refresh source payloads with API credits when
needed.

## Fixture classes

| Class               | What it proves                                                                 |
| ------------------- | ------------------------------------------------------------------------------ |
| Text response       | Basic assistant text maps into the canonical OpenAI message shape.             |
| Tool call           | Provider tool/function calls preserve name, arguments and ids where available. |
| Tool result         | Tool result placement remains valid after provider conversion.                 |
| Parallel tools      | Multiple tool calls and results keep deterministic ordering.                   |
| Multimodal input    | Image, audio and document parts are preserved or warned consistently.          |
| Responses API shape | OpenAI Responses API output can be mapped or rejected with explicit warnings.  |
| Lossy conversion    | Unsupported or ambiguous provider data emits stable warning codes.             |

## Refresh flow

1. Generate provider payloads locally with maintainer-controlled API keys.
2. Minimize each payload to the fields needed for conversion coverage.
3. Remove request ids, timestamps, account metadata and provider-specific
   tracking fields.
4. Commit only deterministic JSON fixtures and expected normalized output.
5. Run public CI without any API keys.

## OpenAI API credit use

Credits should be used only for fixture refreshes that improve public coverage:

- Responses API text and tool-call payloads.
- Streaming/tool-call examples that differ from Chat Completions.
- Multimodal message examples relevant to provider conversion.
- Regression checks before releases when provider payload formats change.

Credits should not be used for hidden benchmarks, private app traffic or tests
that require secrets in public CI.

## Fixture contract

Every committed fixture should include:

- Provider name and source API family.
- Input payload.
- Expected canonical OpenAI-compatible message.
- Expected provider output when round-tripping is supported.
- Expected warning codes for lossy or unsupported conversions.
- A short note explaining why the case matters.

## Public CI rule

Public CI must remain offline and deterministic. Live provider calls belong in a
maintainer-only refresh script, not in the default test suite.
