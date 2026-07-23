# Support

`llm-messages` is maintained in public on a best-effort basis.

## Questions and design discussions

Use
[GitHub Discussions](https://github.com/slegarraga/llm-messages/discussions)
for integration questions, proposed conversion behavior, and help choosing the
right API.

## Bugs

Open a
[bug report](https://github.com/slegarraga/llm-messages/issues/new?template=bug_report.yml)
with:

- the source and target provider/API surfaces;
- a minimal, sanitized message or response body;
- the canonical output, warning, or finish reason you expected;
- the package and Node.js versions;
- a reproduction or failing conformance fixture when possible.

Do not include API keys, private prompts, personal data, or proprietary model
output.

## Security

Do not open a public issue for a vulnerability. Follow
[SECURITY.md](./SECURITY.md) to use GitHub private vulnerability reporting or
the listed security email.

## Scope

The project can help with message and completed-response normalization.
Incremental SSE event parsing belongs in
[`llm-sse`](https://github.com/slegarraga/llm-sse). Provider account access,
billing, rate limits, and general SDK support belong with the provider.

No response-time guarantee is offered, but well-scoped reproductions and pull
requests are prioritized.
