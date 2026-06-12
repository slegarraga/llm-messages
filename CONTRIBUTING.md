# Contributing to llm-messages

Thanks for taking the time to contribute. This project aims to be a small,
dependable, zero-dependency building block, so the bar for changes is clarity
and correctness over breadth.

## Getting started

The published package supports Node 18+ at runtime. The local development
toolchain currently needs Node 20.19+ or Node 22.13+ because the lint, test and
build dependencies follow those active Node release lines. CI keeps the runtime
floor honest by installing the packed tarball in a separate Node 18 consumer
smoke.

```sh
git clone https://github.com/slegarraga/llm-messages.git
cd llm-messages
npm install
```

## Development workflow

Every change should keep the full check suite green:

```sh
npm run check        # full validation suite
```

That script runs the same checks individually listed here:

```sh
npm run format:check # prettier --check
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest
npm run build       # tsup (ESM + CJS + types)
npm run examples:check # smoke-test packaged ESM/CommonJS examples
npm run pack:check  # npm pack --dry-run, with lifecycle output quieted
npm run pack:smoke  # install the packed tarball and verify runtime/types usage
```

Run `npm run test:watch` and `npm run format` while developing.

## Release and staging review

Before staging release, fixture, package metadata or published-file changes,
review the complete worktree, including untracked files:

```sh
git status --short -uall
git diff --stat
npm run check
npm pack --dry-run --foreground-scripts=false
```

Confirm that new fixtures, examples and scripts are intentional, and that no
private source, test, script, config or generated files are included in the
package dry-run output. Do not publish from a dirty tree whose untracked files
have not been reviewed.

## Pull requests

1. Fork the repo and create a branch from `main` (e.g. `fix/gemini-id-matching`).
2. Add or update tests. New behaviour without a test will not be merged.
3. When adding conformance fixtures, update `docs/conformance-fixtures.md`
   in the same change so the fixture inventory stays reviewable and the
   offline harness remains deterministic.
4. Make sure `format:check`, `typecheck`, `lint`, `test`, `build`,
   `examples:check`, `pack:check` and `pack:smoke` all pass.
5. Keep the public API surface small and documented with JSDoc.
6. Open a pull request and fill in the template.

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
