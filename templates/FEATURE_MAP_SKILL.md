---
name: feature-map
description: Generate or update .groundtruth/FEATURE_MAP.md by inspecting the existing application's capabilities, source evidence, and verification contracts. Use for product capability inventories or changes that add, modify, or remove a capability.
---

# Feature map

Maintain `.groundtruth/FEATURE_MAP.md` as a structured view of what the current application can do. Group capabilities into meaningful product areas and include variants when they change observable behavior.

## Inspect the application

Read the existing map, `.groundtruth/PROJECT.md`, repository instructions, and relevant `.groundtruth/contracts/*.md` files. Exclude `TEMPLATE.md` from real contracts. Follow source references and contract links already in the map before editing them.

For an initial map, inspect application entry points, navigation, screens, API handlers, CLI commands, background jobs, and the implementation they call. Use project documentation and tests to understand behavior, then check it against current code. Cover each application in a monorepo and record anything you could not inspect.

For an update after a code change, inspect the diff and follow affected callers and shared dependencies to find the capabilities it changes. Expand the review if the existing map is a starter inventory or the user requests a full refresh.

A dependency, directory name, planned ticket, or contract alone does not establish that a capability exists. Trace the behavior to reachable implementation. Flag unresolved evidence instead of inventing features. Do not treat automated starter entries as confirmed implementation.

## Write the map

Preserve an existing map's useful organization, stable identifiers, ownership, and human notes. For a new map, use product area headings with nested capability bullets. Prefer behavior names such as "Create payment" to file or component names. Split application areas when similarly named capabilities belong to different products.

Each capability should include:

- A stable identifier and a short description of observable behavior.
- Its current implementation status: `implemented`, `partial`, `disabled`, or `unconfirmed`.
- Repository source references that support the description.
- Links to applicable `.groundtruth/contracts/*.md` files, or `None found` when no contract exists.
- Relevant tests or verification references when found. Report runtime proof separately from implementation status.

Use links relative to `.groundtruth/FEATURE_MAP.md`. Source and test links usually start with `../`; contract links start with `contracts/`. Verify every linked file exists. A contract can cover several capabilities, and a capability can reference several contracts.

For example, when supported by the inspected code:

```markdown
## Authentication

- Login, `authentication.login`, implemented
  - Signs a registered user in with an email address and password.
  - Sources: [Login handler](../src/auth/login.ts)
  - Contracts: [Login](contracts/login.md)
  - Verification: [Login tests](../tests/auth/login.test.ts), runtime not checked.
  - Email and password, `authentication.login.password`, implemented
    - Uses the same handler and contract as Login.
```

Exclude future work from the current capability tree. Keep disabled and partial capabilities clearly labeled. Record unconfirmed behavior and inspection gaps in review notes so they can be resolved later.

## Keep it current

Update affected entries when capabilities or variants change. Preserve identifiers through renames where the capability remains the same. Remove or mark a capability as removed only after checking its implementation and other entry points. Explain removals in the final report. Remove stale links or replace them with current evidence.

Link contracts only after reading them and confirming they describe the capability. Generating a map does not authorize rewriting contracts or creating a contract for every entry. When the user requests contracts too, follow the project's contract conventions.

Replace the starter status with a description of the scope actually reviewed. Do not claim full coverage when parts of the application remain uninspected. Make map updates directly without changing application behavior.

Report the areas and capabilities added, changed, or removed, the source and contracts inspected, and any unresolved gaps. State whether runtime checks were run. Source inspection alone supports an implementation inventory, not a claim that the product works.
