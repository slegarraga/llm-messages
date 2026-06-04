# Security posture

`llm-messages` is a small zero-runtime-dependency package, but the repository
still treats supply-chain hygiene as part of maintenance.

Current controls:

- MIT license and public security policy.
- GitHub vulnerability alerts and Dependabot security updates.
- Secret scanning and push protection.
- CI on Node 20 and 22.
- CodeQL analysis for JavaScript/TypeScript.
- OpenSSF Scorecard workflow with published results.
- Branch ruleset for `main` requiring CI and CodeQL checks before merge.
- CODEOWNERS for maintainer review visibility.

Security reports should not be opened as public issues. Use the process in
[SECURITY.md](../SECURITY.md) or contact
[sebastian@0a.cl](mailto:sebastian@0a.cl).
