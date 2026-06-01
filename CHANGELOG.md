# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
