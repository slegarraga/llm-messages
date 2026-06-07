# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.0] - 2026-06-07

### Added

- Added OpenAI Responses API response normalization via
  `responseFromOpenAIResponses(...)` and explicit `normalizeResponse(...)`
  routing, mapping `output_text` to assistant content, `function_call` to Chat
  Completions-compatible `tool_calls`, and Responses usage/status fields to
  neutral `usage` and `finishReason` values.
- Preserved Anthropic `tool_result.is_error` as optional canonical tool-message
  metadata across Anthropic round trips.
- Preserved standalone Gemini `functionResponse.name` as optional canonical
  tool-message metadata so orphaned tool results can convert back to Gemini
  without using the result id as the function name.
- Added `dropped-metadata` warnings for OpenAI message names and provider-only
  tool result metadata that the selected target provider cannot represent.

### Fixed

- Kept empty user turns intact when round-tripping through Anthropic or Gemini.
- Preserved mixed Anthropic user text and `tool_result` block order when
  converting into canonical OpenAI-compatible messages and back.

## [0.4.9] - 2026-06-04

### Added

- Added a public adoption guide for teams evaluating OpenAI-compatible provider
  fallback, local validation, and production conversion checks.
- Included the examples directory in the published npm package.

## [0.4.8] - 2026-06-04

### Changed

- Updated CI to run on Node 20 and 22, matching the secure Vitest development
  tooling while keeping the package runtime build target at Node 18.

## [0.4.7] - 2026-06-04

### Changed

- Updated Vitest development tooling to resolve GitHub Dependabot alerts for
  vulnerable transitive `vitest` / `vite` / `esbuild` versions.

## [0.4.6] - 2026-06-04

### Added

- Added a public conformance fixtures plan describing how API credits should be
  used to refresh deterministic OpenAI/provider conversion fixtures without
  putting secrets in public CI.

## [0.4.5] - 2026-06-04

### Changed

- Aligned npm keywords with the GitHub repository topics for OpenAI-compatible
  provider portability, chat completions, multimodal messages and zero
  dependencies.

## [0.4.4] - 2026-06-04

### Changed

- Published the public maintainer roadmap to npm so the package page also shows
  OpenAI Responses API, conformance fixture and tool-call edge-case priorities.

## [0.4.3] - 2026-06-04

### Changed

- Expanded the provider-portability suite section with links to the companion
  packages, offline demo and public portability map.

## [0.4.2] - 2026-06-04

### Changed

- Published README package-status badges, download visibility and release notes
  to the npm package page.

## [0.4.1] - 2026-06-03

### Changed

- Added OpenAI-compatible provider keywords for DeepSeek, Groq and OpenRouter
  discovery in npm and package metadata.

## [0.4.0] - 2026-06-01

### Added

- Audio and document content parts. Audio (OpenAI `input_audio`) converts between
  OpenAI and Gemini; Anthropic has no audio input, so audio is dropped with an
  `unsupported-modality` warning. Documents (OpenAI `file`, Anthropic `document`,
  Gemini `inlineData` / `fileData`) convert across all three, base64 losslessly.
  Adds the `MediaPart` type and `unsupported-modality` / `gemini-url-media`
  warning codes. (#5)

## [0.3.0] - 2026-06-01

### Added

- Response normalization. `responseFromOpenAI`, `responseFromAnthropic`,
  `responseFromGemini` and `normalizeResponse(body, { from })` parse a provider
  response body into a canonical OpenAI assistant message plus a neutral
  `finishReason` and `usage` (`inputTokens` / `outputTokens`). Tool-call arguments
  are serialized to JSON strings; `finishReason` becomes `tool_calls` whenever a
  tool was called (including Gemini, which reports `STOP`); Gemini tool calls
  without an id get a deterministic one. (#4)

## [0.2.0] - 2026-06-01

### Added

- Multimodal image support. Image parts convert across all three providers:
  OpenAI `image_url` (data URL or remote), Anthropic `image` blocks (base64 or
  url source), and Gemini `inlineData` (base64) or `fileData` (remote). Base64
  data URLs round trip losslessly.
- `parseDataUrl` / `toDataUrl` helpers and a `NormalizedImage` type.

### Notes

- A remote image URL sent to Gemini is emitted as `fileData.fileUri` and flagged
  with a `gemini-url-image` warning, since Gemini may require the Files API for
  non-Google URIs.

## [0.1.0] - 2026-06-01

### Added

- Initial release.
- `toAnthropic` / `fromAnthropic`, `toGemini` / `fromGemini` convert conversations
  between the OpenAI canonical format and each provider.
- `convert(conversation, { from, to })` converts between any two providers, fully
  typed via the `from` / `to` pair.
- Correct handling of system prompts, the `assistant`/`model` role difference,
  tool-call argument serialization, tool-result placement and grouping, Gemini
  id/name matching, and consecutive same-role merging.
- Optional `onWarning` reporting for every non fatal conversion event.
- Zero runtime dependencies.
