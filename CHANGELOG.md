# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.4] - 2026-06-29

### Changed

- Documentation: add provider-SDK recipes (OpenAI, Anthropic, Vercel AI SDK), a "why not alternatives" section, complete cross-links to the sibling packages, and install / bundle-size badges. No code changes.

## [0.5.3] - 2026-06-29

### Fixed

- The npm package page showed a broken "resource not found" downloads badge after the self-hosted badge JSON was removed. The README now uses shields.io's native `npm/dm` badge, which renders the live download count directly on npm.

## [0.5.2] - 2026-06-12

### Summary

- Added an offline conformance suite for OpenAI Chat Completions, OpenAI
  Responses, Anthropic and Gemini edge cases around tool-call ids, arguments,
  refusals and tool-result mapping.
- Strengthened the release path with one local validation command, package
  dry-run checks, installed ESM/CommonJS/type smoke tests and a Node 18 consumer
  smoke in CI.
- Documented the response-normalization helpers, stable warning-code export and
  fixture workflow so users and maintainers can audit the supported portability
  surface before publishing.

### Changed

- Added an offline conformance fixture harness and committed fixtures for
  OpenAI Chat Completions, OpenAI Responses, Anthropic and Gemini request and
  response conversions.
- Covered deterministic id generation and reservation, duplicate provider ids,
  malformed function names, invalid argument payloads, refusals, unsupported
  OpenAI tool-call types, Anthropic `tool_result` mapping and Gemini
  `functionResponse` matching.
- Documented direct response normalizers, stable warning codes, Gemini id/name
  matching, the fixture contract and inventory, roadmap distinctions,
  contributor validation commands and release staging review steps.
- Aligned the pull request checklist with the conformance fixture inventory
  workflow so fixture changes are reviewed with their docs update.
- Added `npm run check`, `pack:check` and `examples:check`, then aligned CI and
  release validation around format, typecheck, lint, tests, build, examples,
  pack dry-run and package smoke checks.
- Added a CommonJS usage example and extended packaged examples to cover
  response normalization and the `warningCodes` export.
- Strengthened package smoke testing to install the packed tarball, exercise
  ESM/CommonJS/types, run bundled examples, verify intentional public files,
  reject private source/test/script/config leaks, validate package metadata and
  inspect source maps and audit packaged Markdown file and heading-anchor links.
- Added a fixture-backed self-test for the packaged Markdown link checker so the
  smoke script verifies missing files, missing anchors and package-escaping links
  before auditing the real tarball.
- Exported, froze and documented the `warningCodes` runtime list from the
  package root so tests and consumers can validate warning-code values against
  the public API.
- Tightened the conformance warning-code guard so stale public warning codes
  fail tests if they are no longer emitted by the source.

### Fixed

- Drop Gemini `thought: true` (reasoning) response parts with a
  `dropped-content` warning instead of mixing the model's reasoning text into
  the canonical assistant content.
- Preserve OpenAI Chat Completions refusal text and refusal content parts when
  assistant `content` is empty or array-shaped.
- Drop unsupported OpenAI Chat Completions `tool_calls[]` types with a
  `dropped-content` warning instead of emitting malformed canonical function
  calls.
- Warn and continue when OpenAI Chat Completions `tool_calls` payloads or
  entries are malformed instead of silently skipping provider output.
- Normalize legacy OpenAI Chat Completions `message.function_call` responses
  into canonical `tool_calls` with deterministic ids.
- Warn and fall back to empty canonical arguments when OpenAI Chat Completions,
  OpenAI Responses, Anthropic or Gemini tool-call argument payloads are
  malformed JSON, JSON non-objects or explicit non-object provider-native
  values.
- Warn and fall back to empty canonical arguments when provider-native argument
  objects cannot be JSON serialized.
- Preserve malformed response-level tool calls from OpenAI Chat Completions,
  OpenAI Responses, Anthropic and Gemini by substituting the same stable
  fallback function name used by conversation converters.
- Warn with `dropped-content` when OpenAI Chat Completions, OpenAI Responses,
  Anthropic or Gemini response-level content parts are unsupported instead of
  silently dropping provider output parts.
- Warn with `dropped-content` when OpenAI Chat Completions, OpenAI Responses,
  Anthropic or Gemini response normalizers receive malformed top-level response
  bodies.
- Warn with `dropped-content` when OpenAI Chat Completions, Anthropic or Gemini
  response bodies omit or malform their primary output arrays instead of
  silently returning an empty assistant message.
- Warn with `dropped-content` when OpenAI Chat Completions response choices omit
  or malform their assistant `message` object instead of silently dropping the
  choice payload.
- Warn with `dropped-content` when OpenAI Responses top-level `output[]` items
  are malformed or unsupported instead of silently skipping provider output
  items.
- Treat whitespace-only, OpenAI-incompatible and longer-than-64-character
  provider function names as malformed before emitting canonical tool calls.
- Generate deterministic OpenAI tool-call ids for OpenAI Chat Completions,
  OpenAI Responses, Anthropic and Gemini values that are omitted, empty or
  non-string.
- Reserve provider-supplied tool-call ids before generating fallbacks, avoid
  generated-id collisions and regenerate duplicate provider-supplied ids with a
  `generated-id` warning.
- Preserve Gemini `functionResponse` behavior by preferring explicit ids,
  warning on unmapped ids without consuming same-name pending calls, recovering
  omitted or malformed names from id matches, ignoring non-string ids before
  falling back by name and preserving mixed user text/result order.
- Warn and fall back to an empty canonical tool result when Gemini
  `functionResponse.response` payloads cannot be JSON serialized.
- Map Gemini policy-blocked finish reasons, including blocklist, prohibited
  content, SPII, Model Armor and image safety stops, to the neutral
  `content_filter` finish reason instead of `unknown`.
- Preserve empty canonical user turns, with `dropped-content` warnings, when
  Anthropic or Gemini document URLs cannot be represented in OpenAI Chat
  Completions content.
- Use the tool-call id as the Gemini `functionResponse.name` fallback when a
  standalone canonical tool message has an empty name.
- Warn on Anthropic `tool_result.tool_use_id` values that are missing or do not
  match a prior `tool_use`, generating deterministic canonical ids for missing
  values while preserving explicit unmapped ids.
- Regenerate later duplicate Anthropic `tool_result.tool_use_id` values when
  they are explicit but do not match any prior `tool_use`.
- Emit an empty Anthropic user string, not an empty content-block array, when
  every OpenAI user content part is dropped as unsupported.
- Reserve Anthropic `tool_result.tool_use_id` values before generating fallback
  `tool_use` ids so explicit result references are not reused by id-less calls.

## [0.5.1] - 2026-06-11

### Changed

- Published README download badge updates so the npm package page shows the refreshed 30-day download badge.

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
  Gemini `inlineData`) convert across all three when base64-backed; OpenAI
  `file_id` references map to Anthropic file sources and are dropped for Gemini
  with an `unsupported-modality` warning.
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
