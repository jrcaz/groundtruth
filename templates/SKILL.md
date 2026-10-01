---
name: prove
description: Verify implementation work against project context, business contracts, and the repository's existing tools.
---

# Prove

Use this workflow to verify implementation and bug-fix work. Prove the behavior that changed. Do not claim checks passed unless you ran them and inspected their results.

## Before changing code

1. Read `.prove/PROJECT.md` for project-specific setup and verification instructions, and `.prove/FEATURE_MAP.md` for the application's capabilities.
2. Identify affected capabilities and read their linked contracts. Also search `.prove/contracts/*.md` for relevant contracts that the map may not yet include. A starter or incomplete map does not limit the scope of verification.
3. Turn the request into observable acceptance criteria. Include failure cases and important edge cases, not only the happy path.
4. Assess the risk. Authentication, authorization, payments, data loss, privacy, and other critical business flows need stronger proof.
5. If a new critical business capability has no contract, define or update its contract before implementation. Do not create a contract for every small task.

When no relevant contract exists, derive task-specific criteria and proceed. Do not treat the absence of a contract as a reason to skip verification.

## Implement and verify

1. Use the project's existing tests and verification tools. Do not build a replacement for Playwright, Maestro, Appium, or another tool the project already uses.
2. Start with focused checks for the changed behavior, then run broader checks when the risk and available time warrant them.
3. Exercise the running application or API when the change affects runtime behavior. Check relevant UI states, API results, logs, browser console errors, and failed network requests.
4. Verify important negative paths, such as invalid input, denied access, duplicate actions, and dependency failures when they apply.
5. Inspect the actual output of every check. A command that started is not proof that it passed.
6. Fix failures caused by the change and repeat the relevant checks. Do not weaken or rewrite a contract just to make an implementation pass. Change a contract only when the product requirement itself has changed.

Do not run against production unless the task explicitly requires it and access is authorized. Keep credentials outside the repository.

When the change adds, modifies, or removes a product capability, use the `feature-map` skill to update its map entry, source references, and contract links. Preserve unrelated entries. Finding a capability in source code does not mean it passed runtime verification.

## Report the proof

Summarize:

- What behavior you verified and the evidence you observed.
- The tests or runtime checks you ran and whether they passed.
- Any criteria you could not verify, why they remain unverified, and what would be needed to verify them.

Use `PASS` only for criteria supported by evidence. Use `BLOCKED` when missing access, environment, or tooling prevents verification. Be direct about partial results.
