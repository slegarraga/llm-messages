# Governance

`llm-messages` is an independent open-source project and the conversation
boundary of the provider-portability suite. Governance favors correctness,
transparent tradeoffs, and a realistic path for contributors to take ownership.

## Current maintainer

- [Sebastian Legarraga](https://github.com/slegarraga) — project direction,
  releases, security response, and repository administration.

The project currently has a single maintainer. Adding trusted reviewers and
maintainers is a project goal.

## Decision process

- Small fixes and backward-compatible improvements are decided through
  pull-request review.
- New canonical message fields, provider targets, warning codes, or breaking
  changes should start with a public issue or discussion.
- Provider mappings must be grounded in primary documentation and reproducible
  fixtures.
- Lossy behavior must stay visible through stable warnings rather than being
  hidden for convenience.
- When reasonable contributors disagree, the maintainer records the tradeoff
  and decision publicly.

## Roles

### Contributor

Anyone who reports a reproducible problem, improves documentation, adds a
reviewed fixture, or lands a code change.

### Reviewer

A contributor with demonstrated understanding of one or more conversion
surfaces who regularly helps review changes or triage issues.

### Maintainer

A trusted reviewer with sustained, constructive involvement who can merge
changes, manage issues, and prepare releases. Maintainers are expected to:

- uphold the code of conduct and security policy;
- require tests and primary-source evidence for provider behavior;
- preserve deterministic, offline CI and the zero-dependency runtime;
- disclose conflicts of interest;
- avoid merging their own substantial changes without another review when a
  second maintainer is available.

Maintainer access is based on judgment, reliability, project need, and mutual
agreement. It is never exchanged for sponsorship, stars, or a fixed number of
pull requests.

## Releases

Releases follow Semantic Versioning. The release workflow runs the full
validation suite, package dry run, installed ESM/CommonJS/type smoke tests, and
npm provenance publishing. Breaking changes require a migration note.

## Security and conduct

Security reports follow [SECURITY.md](./SECURITY.md). Community behavior follows
[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md). A maintainer involved in a conduct
or security concern should recuse themselves when another trusted reviewer is
available.

## Governance changes

Governance changes use the normal public pull-request process and should explain
the problem they solve.
