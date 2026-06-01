# Contributing to llm-messages

Thanks for taking the time to contribute. This project aims to be a small,
dependable, zero-dependency building block, so the bar for changes is clarity
and correctness over breadth.

## Getting started

```sh
git clone https://github.com/slegarraga/llm-messages.git
cd llm-messages
npm install
```

## Development workflow

Every change should keep the full check suite green:

```sh
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest
npm run build       # tsup (ESM + CJS + types)
npm run format      # prettier --write
```

Run `npm run test:watch` while developing.

## Pull requests

1. Fork the repo and create a branch from `main` (e.g. `fix/gemini-id-matching`).
2. Add or update tests. New behaviour without a test will not be merged.
3. Make sure `typecheck`, `lint`, `test` and `build` all pass.
4. Keep the public API surface small and documented with JSDoc.
5. Open a pull request and fill in the template.

## Commit messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/).
Examples:

```
feat(gemini): support functionResponse arrays
fix(anthropic): merge consecutive tool-result turns
docs: clarify the canonical hub model
test: cover parallel tool calls
chore: bump dev dependencies
```

The type drives the next version bump (`fix` -> patch, `feat` -> minor, a
`!` or `BREAKING CHANGE` footer -> major).

## Reporting bugs

Open an issue with a minimal reproduction: the input conversation, the target
provider, what you expected, and what you got. A failing test case is the most
useful form a bug report can take.

## Scope and philosophy

- Zero runtime dependencies. A dependency needs an exceptional justification.
- Conversions are total: they never throw on malformed input, they make a
  deterministic choice and report it through `onWarning`.
- Provider behaviour is grounded in official documentation. When you add or
  change a rule, link the source in the PR.
