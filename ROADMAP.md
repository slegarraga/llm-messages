# Roadmap

`llm-messages` is maintained as the conversation-boundary package in the
provider-portability suite. The near-term roadmap focuses on OpenAI-compatible
agent workflows where message shape correctness, tool-call preservation and
fallback behavior matter.

## Current priorities

1. **OpenAI Responses API boundary**

   Completed response normalization maps Responses API `output_text`,
   `function_call`, refusal, and supported multimodal items into the current
   OpenAI Chat Completions-compatible hub shape. Incremental SSE normalization
   belongs in `llm-sse`. Next: prove the cross-package handoff from a streamed
   function call into portable Anthropic and Gemini histories.

   Public issue: https://github.com/slegarraga/llm-messages/issues/29

2. **Provider-backed fixture refreshes**

   Add provider-backed fixture generation for OpenAI, Anthropic and Gemini
   payloads, while keeping the committed conformance fixtures deterministic,
   offline, and safe to run without API keys.

   Plan: [docs/conformance-fixtures.md](./docs/conformance-fixtures.md)

3. **Tool-call edge cases**

   Expand tests for parallel tool calls, missing provider ids, invalid JSON
   arguments, tool-result ordering and lossy conversion warnings.

4. **Docs for agent fallback loops**

   Document the recommended flow for converting one conversation across
   providers after rate limits or retryable provider failures.

5. **Reviewer and maintainer growth**

   Make fixture ownership, review expectations, and the path to repository
   responsibility explicit in [GOVERNANCE.md](./GOVERNANCE.md).

## API credit use

If API credits are available, they will be used for conformance checks against
OpenAI APIs, especially Responses API and tool-call fixtures. Generated fixtures
should be minimized, reviewed, and committed only when they improve public test
coverage or documentation.

## Non-goals

- No runtime dependencies.
- No hidden network calls in the library.
- No provider-specific SDK dependency.
- No silent data loss; lossy mappings should be represented as warnings.
