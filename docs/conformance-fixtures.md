# Conformance fixtures

`llm-messages` keeps OpenAI Chat Completions-compatible messages as its hub
shape. Committed offline conformance fixtures prove that conversions stay
stable. Provider-backed fixture refreshes are intentionally maintainer-run:
this guide defines how refreshed payloads become deterministic offline fixtures,
while the roadmap tracks automation for generating new provider payloads.

The fixture workflow is safe to run in public CI without secrets, while still
allowing maintainers to refresh source payloads with API credits when needed.

Committed fixtures live in `test/fixtures/*.json` as repository test assets;
they are not included in the npm package tarball. The public Vitest harness in
`test/conformance.test.ts` discovers those files in sorted order and runs them
offline as part of `npm test`. It currently routes `source: "anthropic"`
fixtures through `fromAnthropic(...)`, `source: "gemini"` fixtures through
`fromGemini(...)`, `source: "openai"` fixtures through
`responseFromOpenAI(...)`, and `source: "openai-responses"` fixtures through
`responseFromOpenAIResponses(...)`. Response-level fixtures use
`source: "anthropic-response"` for `responseFromAnthropic(...)` and
`source: "gemini-response"` for `responseFromGemini(...)`; add explicit routing
before committing fixtures for another provider or API family. The harness fails
fast if no JSON fixtures are present.

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

## Current fixture inventory

Use this inventory as a release-review index for the committed offline fixtures;
the JSON files remain the source of truth for exact inputs and expected output.
Each fixture id below maps to `test/fixtures/<fixture>.json`.
Update this table in the same change that adds or removes a fixture.

| Fixture                                                       | Source               | Contract                                                                                                                                                              | Warning codes                            |
| ------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `anthropic-response-tool-use-duplicate-provider-id`           | `anthropic-response` | Anthropic response-level tool_use blocks with duplicate provider ids keep the first id and regenerate later duplicates.                                               | `generated-id`                           |
| `anthropic-response-tool-use-generated-id`                    | `anthropic-response` | Anthropic response-level tool_use blocks without usable ids generate deterministic canonical tool call ids and warnings.                                              | 2x `generated-id`                        |
| `anthropic-response-tool-use-id-reservation`                  | `anthropic-response` | Anthropic response-level id-less tool_use blocks skip generated ids reserved by later provider-supplied ids.                                                          | `generated-id`                           |
| `anthropic-response-tool-use-invalid-arguments`               | `anthropic-response` | Response-level Anthropic tool_use blocks with non-object input fall back to empty canonical arguments and warn.                                                       | `invalid-json-arguments`                 |
| `anthropic-response-tool-use-malformed-name`                  | `anthropic-response` | Anthropic response-level tool_use blocks with malformed names use the stable fallback function name and warning.                                                      | `dropped-metadata`                       |
| `anthropic-response-unsupported-content-block`                | `anthropic-response` | Anthropic response-level unsupported content blocks are dropped with explicit warnings while supported text remains.                                                  | `dropped-content`                        |
| `anthropic-tool-result-duplicate-provider-id`                 | `anthropic`          | Anthropic tool_result blocks with repeated provider ids map to duplicate tool_use ids in occurrence order after regeneration.                                         | `generated-id`                           |
| `anthropic-tool-result-generated-id`                          | `anthropic`          | Anthropic tool_result blocks without usable tool_use_id generate deterministic canonical tool message ids and warnings.                                               | `unmapped-tool-result`                   |
| `anthropic-tool-result-id-reservation`                        | `anthropic`          | Anthropic tool_result references reserve provider-supplied ids before earlier id-less tool_use blocks generate canonical ids and warn when no prior tool_use matches. | `generated-id`, `unmapped-tool-result`   |
| `anthropic-tool-result-unmapped-id`                           | `anthropic`          | Anthropic tool_result ids that do not match prior tool_use blocks stay orphaned and warn.                                                                             | `unmapped-tool-result`                   |
| `anthropic-tool-use-duplicate-provider-id`                    | `anthropic`          | Anthropic tool_use blocks with duplicate provider ids keep the first id and regenerate later duplicates.                                                              | `generated-id`                           |
| `anthropic-tool-use-generated-id`                             | `anthropic`          | Anthropic tool_use blocks without usable ids generate deterministic canonical tool call ids and warnings.                                                             | 2x `generated-id`                        |
| `anthropic-tool-use-invalid-arguments`                        | `anthropic`          | Anthropic tool_use blocks with non-object input fall back to empty canonical arguments and warn.                                                                      | `invalid-json-arguments`                 |
| `anthropic-tool-use-malformed-name`                           | `anthropic`          | Anthropic tool_use blocks with malformed names use the stable fallback function name and warning.                                                                     | `dropped-metadata`                       |
| `gemini-function-call-duplicate-provider-id`                  | `gemini`             | Gemini functionCall blocks with duplicate provider ids keep the first id and regenerate later duplicates.                                                             | `generated-id`                           |
| `gemini-function-call-generated-id`                           | `gemini`             | Gemini functionCall blocks without usable ids generate deterministic canonical tool call ids and warnings.                                                            | `generated-id`                           |
| `gemini-function-call-generated-id-reservation`               | `gemini`             | Gemini id-less functionCall blocks skip generated ids that are reserved by later provider-supplied ids.                                                               | `generated-id`                           |
| `gemini-function-call-invalid-arguments`                      | `gemini`             | Gemini functionCall parts with non-object args fall back to empty canonical arguments and warn.                                                                       | `invalid-json-arguments`                 |
| `gemini-function-call-malformed-name`                         | `gemini`             | Gemini functionCall blocks with malformed names use the stable fallback function name and warning.                                                                    | `dropped-metadata`                       |
| `gemini-function-response-duplicate-provider-id`              | `gemini`             | Gemini functionResponse blocks with repeated provider ids map to duplicate functionCall ids in occurrence order after regeneration.                                   | `generated-id`                           |
| `gemini-function-response-duplicate-provider-id-omitted-name` | `gemini`             | Gemini functionResponse blocks with repeated provider ids can omit names and still resolve in occurrence order after regeneration.                                    | `generated-id`                           |
| `gemini-function-response-generated-id`                       | `gemini`             | Gemini functionResponse blocks without a matching call or id generate deterministic canonical tool-message ids.                                                       | `unmapped-tool-result`                   |
| `gemini-function-response-id-precedence`                      | `gemini`             | Gemini functionResponse.id is resolved before falling back to same-name pending function calls.                                                                       | `dropped-metadata`                       |
| `gemini-function-response-non-string-id`                      | `gemini`             | Gemini functionResponse ids that are not strings are ignored before matching by function name.                                                                        | `dropped-metadata`                       |
| `gemini-function-response-null-response`                      | `gemini`             | Gemini functionResponse null response payloads serialize into canonical tool-message content instead of collapsing to an omitted response.                            | none                                     |
| `gemini-function-response-omitted-name-id-match`              | `gemini`             | Gemini functionResponse blocks with a matching id can omit name and still resolve to the pending function call.                                                       | none                                     |
| `gemini-function-response-order`                              | `gemini`             | Gemini user text around a functionResponse preserves canonical message ordering.                                                                                      | none                                     |
| `gemini-function-response-scalar-response`                    | `gemini`             | Gemini functionResponse scalar response payloads serialize into canonical tool-message content without crashing.                                                      | none                                     |
| `gemini-function-response-unmapped-id`                        | `gemini`             | Gemini functionResponse ids that do not match pending calls stay orphaned and do not consume same-name pending calls.                                                 | `unmapped-tool-result`                   |
| `gemini-response-function-call-duplicate-provider-id`         | `gemini-response`    | Gemini response-level functionCall blocks with duplicate provider ids keep the first id and regenerate later duplicates.                                              | `generated-id`                           |
| `gemini-response-function-call-generated-id`                  | `gemini-response`    | Gemini response-level functionCall blocks without usable ids generate deterministic canonical tool call ids and warnings.                                             | `generated-id`                           |
| `gemini-response-function-call-id-reservation`                | `gemini-response`    | Gemini response-level id-less functionCall blocks skip generated ids reserved by later provider-supplied ids.                                                         | `generated-id`                           |
| `gemini-response-function-call-invalid-arguments`             | `gemini-response`    | Response-level Gemini functionCall parts with non-object args fall back to empty canonical arguments and warn.                                                        | `invalid-json-arguments`                 |
| `gemini-response-function-call-malformed-name`                | `gemini-response`    | Gemini response-level functionCall blocks with malformed names use the stable fallback function name and warning.                                                     | `dropped-metadata`                       |
| `gemini-response-unsupported-content-part`                    | `gemini-response`    | Gemini response-level unsupported content parts are dropped with explicit warnings while supported text remains.                                                      | `dropped-content`                        |
| `openai-chat-duplicate-provider-id`                           | `openai`             | OpenAI Chat Completions tool_calls with duplicate provider ids keep the first id and regenerate later duplicates.                                                     | `generated-id`                           |
| `openai-chat-generated-id-reservation`                        | `openai`             | OpenAI Chat Completions id-less tool_calls skip generated ids that are reserved by later provider-supplied ids.                                                       | `generated-id`                           |
| `openai-chat-generated-id-warning`                            | `openai`             | OpenAI Chat Completions tool_calls without ids generate deterministic canonical tool call ids and warnings.                                                           | `generated-id`                           |
| `openai-chat-invalid-argument-string`                         | `openai`             | OpenAI Chat Completions tool_call argument strings that decode to non-objects fall back to empty canonical arguments.                                                 | `invalid-json-arguments`                 |
| `openai-chat-invalid-arguments`                               | `openai`             | OpenAI Chat Completions tool_call arguments that are explicit non-object values fall back to empty canonical arguments.                                               | `invalid-json-arguments`                 |
| `openai-chat-legacy-function-call`                            | `openai`             | Legacy OpenAI Chat Completions function_call responses normalize to canonical tool_calls with a generated id.                                                         | `generated-id`                           |
| `openai-chat-legacy-function-call-invalid-arguments`          | `openai`             | Legacy OpenAI Chat Completions function_call argument strings that decode to non-objects fall back to empty canonical arguments.                                      | `generated-id`, `invalid-json-arguments` |
| `openai-chat-legacy-function-call-malformed-name`             | `openai`             | Legacy OpenAI Chat Completions function_call responses with malformed names fall back before generating canonical ids.                                                | `dropped-metadata`, `generated-id`       |
| `openai-chat-malformed-function-name`                         | `openai`             | OpenAI Chat Completions tool_calls with malformed function names use the stable fallback function name and warning.                                                   | `dropped-metadata`                       |
| `openai-chat-malformed-tool-call`                             | `openai`             | OpenAI Chat Completions malformed tool_calls[] entries are dropped with explicit warnings while supported function calls remain.                                      | `dropped-content`                        |
| `openai-chat-object-arguments`                                | `openai`             | OpenAI Chat Completions tool_call argument objects serialize to canonical JSON strings without warning.                                                               | none                                     |
| `openai-chat-refusal-content-part`                            | `openai`             | OpenAI Chat Completions refusal content parts flatten into canonical assistant text without warning.                                                                  | none                                     |
| `openai-chat-unsupported-content-part`                        | `openai`             | OpenAI Chat Completions unsupported response content parts are dropped with explicit warnings while supported text remains.                                           | `dropped-content`                        |
| `openai-chat-unsupported-tool-call-type`                      | `openai`             | OpenAI Chat Completions unsupported tool_calls[] types are dropped while supported function calls remain.                                                             | `dropped-content`                        |
| `openai-responses-call-id-precedence`                         | `openai-responses`   | OpenAI Responses API function_call items with both call_id and id preserve call_id as the canonical tool-call id.                                                     | none                                     |
| `openai-responses-duplicate-provider-id`                      | `openai-responses`   | OpenAI Responses API function_call items with duplicate provider ids keep the first id and regenerate later duplicates.                                               | `generated-id`                           |
| `openai-responses-generated-id-reservation`                   | `openai-responses`   | OpenAI Responses API id-less function_call items skip generated ids that are reserved by later provider-supplied ids.                                                 | `generated-id`                           |
| `openai-responses-generated-id-warning`                       | `openai-responses`   | OpenAI Responses API function_call items without call_id or id generate a deterministic tool call id and warning.                                                     | `generated-id`                           |
| `openai-responses-invalid-argument-string`                    | `openai-responses`   | OpenAI Responses API function_call argument strings that decode to non-objects fall back to empty canonical arguments.                                                | `invalid-json-arguments`                 |
| `openai-responses-invalid-arguments`                          | `openai-responses`   | OpenAI Responses API function_call arguments that are explicit non-object values fall back to empty canonical arguments.                                              | `invalid-json-arguments`                 |
| `openai-responses-malformed-function-name`                    | `openai-responses`   | OpenAI Responses API function_call items with malformed names use the stable fallback function name and warning.                                                      | `dropped-metadata`                       |
| `openai-responses-refusal-content-part`                       | `openai-responses`   | OpenAI Responses API refusal content parts flatten into canonical assistant text without warning.                                                                     | none                                     |
| `openai-responses-unsupported-content-part`                   | `openai-responses`   | OpenAI Responses API unsupported message content parts are dropped with explicit warnings while supported text remains.                                               | `dropped-content`                        |
| `openai-responses-unsupported-output-item`                    | `openai-responses`   | OpenAI Responses API unsupported top-level output items are dropped with explicit warnings while supported message output remains.                                    | `dropped-content`                        |

## Refresh flow

1. Generate provider payloads locally with maintainer-controlled API keys.
2. Minimize each payload to the fields needed for conversion coverage.
3. Remove request ids, timestamps, account metadata and provider-specific
   tracking fields.
4. Commit only deterministic JSON fixtures and expected normalized output.
5. Run public CI without any API keys.

## Provider API credit use

Credits should be used only for fixture refreshes that improve public coverage:

- Responses API text and tool-call payloads.
- Streaming/tool-call examples that differ from Chat Completions.
- Multimodal message examples relevant to provider conversion.
- Regression checks before releases when provider payload formats change.

Credits should not be used for hidden benchmarks, private app traffic or tests
that require secrets in public CI.

## Fixture contract

Every committed fixture should include:

- `name`: a stable, unique test title that matches the JSON filename without
  `.json`.
- `description`: a short note explaining why the case matters.
- `source`: the source provider or API family. The current public harness
  accepts `anthropic`, `anthropic-response`, `gemini`, `gemini-response`,
  `openai` and `openai-responses`.
- `input`: the minimized provider payload. Anthropic fixtures must include a
  `messages` array, Anthropic response fixtures must include a `content` array,
  Gemini fixtures must include a `contents` array, Gemini response fixtures must
  include a `candidates` array, OpenAI Chat Completions fixtures must include a
  `choices` array, and OpenAI Responses fixtures must include an `output` array.
- `expectedOpenAI`: the expected canonical OpenAI-compatible messages.
- `expectedWarningCodes`: expected warning codes for lossy or unsupported
  conversions. Values must match the package's exported `warningCodes` list.
- `expectedResponse`: required only for response-body fixtures
  (`anthropic-response`, `gemini-response`, `openai`, `openai-responses`).
  It records the normalized `finishReason` and `usage` so response fixtures
  catch metadata regressions as well as message-shape regressions.

Future fixture classes may add provider round-trip expectations, but the current
public harness intentionally stays offline and asserts normalized output,
response metadata and warning codes. Duplicate fixture names and names that do
not match their filenames fail fast so test output remains unambiguous.

## Public CI rule

Public CI must remain offline and deterministic. Live provider calls belong in a
maintainer-only refresh script, not in the default test suite.
