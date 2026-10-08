# GroundTruth

Give coding agents a project-specific definition of done.

Coding agents are good at making a change and bad at proving it works. "Done" often means the code compiled, a test command started, or the agent read its own diff and liked it. GroundTruth installs two agent skills and a handful of project files that tell the agent what done means in your repository: which commands to run, which business behavior has to stay true, and what evidence to report back.

GroundTruth is an installer and a set of agent instructions. It is not a test runner. Your agent runs the tools the project already has, such as Vitest, Playwright, pytest, or Maestro. It works with Claude Code and with Codex and other agents that read `AGENTS.md` and `.agents/skills/`.

## Contents

- [Why use it](#why-use-it)
- [Quick start](#quick-start)
- [What lands in your repository](#what-lands-in-your-repository)
- [How a verified change works](#how-a-verified-change-works)
- [Commands](#commands)
- [What it detects](#what-it-detects)
- [Feature maps](#feature-maps)
- [Contracts](#contracts)
- [What GroundTruth does not do](#what-groundtruth-does-not-do)
- [Safe to run again](#safe-to-run-again)
- [Moving from Prove](#moving-from-prove)
- [Development](#development)
- [Contributing](#contributing)

## Why use it

**Proof instead of claims.** The skill tells the agent to inspect the output of every check and to report each acceptance criterion as `PASS` or `BLOCKED`, with the evidence behind it. A command that started is not a pass.

**Your project's rules, not generic ones.** `.groundtruth/PROJECT.md` holds how this app starts, which checks are required, and where the high-risk flows are. The agent reads it before it changes code, so you stop repeating "run the e2e suite too" in every prompt.

**Business rules that survive refactors.** A contract pins down the behavior a capability such as login or checkout must keep. When a change touches that capability, the agent has to read the contract and run the proof it asks for. The skill forbids weakening a contract to make an implementation pass.

**A map of what the product does today.** `.groundtruth/FEATURE_MAP.md` lists capabilities by product area with a status (`implemented`, `partial`, `disabled`, `unconfirmed`) and links to the source, the contract, and the tests. The agent uses it to find what a change affects. You can use it to find what nobody has verified yet.

**Nothing new to install in the project.** The package adds Markdown files to your repository and a marked section to `AGENTS.md` and `CLAUDE.md`. There is no runtime dependency and no service to sign up for.

## Quick start

You need Node.js 18 or later and npm. Run from the root of the project you want to set up:

```sh
npx --yes --package=github:jrcaz/groundtruth groundtruth init
```

The package is not on npm yet. This command runs the CLI from the GitHub repository without adding it to your project's dependencies. Once published, the command becomes `npx groundtruth init`.

Here is what `init` printed for a Next.js project that uses Vitest and Playwright:

```text
Detected project: Web application
Frameworks: Next.js, React
Languages: JavaScript/TypeScript
Verification tools: Playwright, Vitest
created .groundtruth/PROJECT.md
created .groundtruth/FEATURE_MAP.md; use the feature-map skill to review and complete the starter inventory
created .agents/skills/groundtruth/SKILL.md
created .claude/skills/groundtruth/SKILL.md
created .agents/skills/feature-map/SKILL.md
created .claude/skills/feature-map/SKILL.md
created .groundtruth/contracts/TEMPLATE.md
updated AGENTS.md
updated CLAUDE.md
GroundTruth is ready. Try: "Implement this feature and prove it works."
```

Then, in this order:

1. Open `.groundtruth/PROJECT.md` and fill in how to start the app and which checks are required. The installer lists the npm scripts and tools it found; you add the setup steps it could not see.
2. Ask your agent: `Use the feature-map skill to generate the existing application's feature map.` The starter map only lists candidate pages and routes. The skill reads the implementation and turns them into product capabilities.
3. Write a contract for each business-critical capability. Copy the template with `cp .groundtruth/contracts/TEMPLATE.md .groundtruth/contracts/login.md`, replace the prompts with the behavior that must stay true, and link the contract from its feature map entry. Most features do not need one.
4. Ask for a change the way you normally would, for example "Add rate limiting to login and prove it works." The agent reads the context, the map, and the relevant contracts, runs your checks, and reports what passed and what it could not verify.

Do not put credentials or other secrets in any of these files.

## What lands in your repository

```text
.claude/skills/groundtruth/SKILL.md     Verification workflow for Claude Code
.agents/skills/groundtruth/SKILL.md     Same workflow for Codex and OpenAI-style agents
.claude/skills/feature-map/SKILL.md     Feature map skill for Claude Code
.agents/skills/feature-map/SKILL.md     Same skill for Codex and OpenAI-style agents
.groundtruth/PROJECT.md                 How to run this project and which checks are required
.groundtruth/FEATURE_MAP.md             What the product can do, with source, contract, and test links
.groundtruth/contracts/TEMPLATE.md      Starting point for a capability contract
.groundtruth/.groundtruth-managed.json  Hashes of the shared files GroundTruth manages
AGENTS.md, CLAUDE.md                    A marked "Definition of done" section; existing text is kept
```

The two copies of each skill are identical, one per agent family so each agent finds it where it looks. `PROJECT.md`, `FEATURE_MAP.md`, and your contracts are yours. The skills and the template are shared, and `update` keeps them current.

## How a verified change works

With the skill installed, asking for a change sets off this sequence. The full text is in `SKILL.md` in your repository after `init`.

Before touching code, the agent reads `PROJECT.md` and the feature map, finds the capabilities the request affects, and reads their contracts. It also searches `.groundtruth/contracts/` directly, so an incomplete map cannot hide a contract. It turns the request into acceptance criteria it can observe, including failure cases, and sizes the proof to the risk. Authentication, payments, and anything that can lose data get stronger proof. A new business-critical capability with no contract gets one before implementation.

While implementing, the agent uses the project's own tools. It starts with focused checks for the changed behavior, then widens. When the change affects runtime behavior it exercises the running app or API and looks at UI state, responses, logs, browser console errors, and failed network requests. It checks negative paths such as invalid input and denied access, reads the actual output of every check, fixes what its change broke, and reruns. It never runs against production unless the task explicitly requires it and access is authorized.

When done, the agent reports what it verified and the evidence, which checks ran and whether they passed, and what it could not verify and why. `PASS` is only for criteria backed by evidence. `BLOCKED` means missing access, environment, or tooling got in the way. If the change added, modified, or removed a capability, the agent updates the feature map entry too.

## Commands

Run from the project root. Until the package is published, replace `groundtruth` with `npx --yes --package=github:jrcaz/groundtruth groundtruth`.

| Command | What it does |
| --- | --- |
| `groundtruth init` | Detects the project, creates `PROJECT.md` and a starter feature map if they are missing, installs the skills and contract template, and adds or repairs the marked section in `AGENTS.md` and `CLAUDE.md`. |
| `groundtruth update` | Refreshes the skills and contract template when you have not edited them. |
| `groundtruth doctor` | Reports which GroundTruth files and instruction sections are present, plus the frameworks, tools, and npm scripts it detects. Exits nonzero if required setup is missing or blocked. |
| `groundtruth --help` | Prints usage. `--version` prints the installed version. |

## What it detects

`init` and `doctor` read repository files and package metadata. They recognize common JavaScript and TypeScript frameworks, Python frameworks, Flutter and React Native, Tauri, Go modules, and Rust crates. They look for test and browser tools such as Playwright, Cypress, Vitest, Jest, pytest, Maestro, and Appium, and list npm scripts that look like verification commands. In a monorepo, they also read the workspaces declared in `package.json` (npm and Yarn) or `pnpm-workspace.yaml` and list them in `PROJECT.md`.

Detection reads metadata. It does not install dependencies, execute scripts, or check that a tool is configured correctly. Treat `PROJECT.md` as a draft and correct what the repository could not tell it.

## Feature maps

A feature map answers one question: what can this product do right now? Each capability has a stable identifier, a status, a short description of observable behavior, and links to the source, the contracts that apply, and the tests. Future plans stay out of it. A completed entry looks like this:

```markdown
## Authentication

- Login, `authentication.login`, implemented
  - Signs a registered user in with an email address and password.
  - Sources: [Login handler](../src/auth/login.ts)
  - Contracts: [Login](contracts/login.md)
  - Verification: [Login tests](../tests/auth/login.test.ts), runtime not checked.
```

Links are relative to `.groundtruth/FEATURE_MAP.md`, so source and test links start with `../` and contract links with `contracts/`. A capability can link several contracts, and several capabilities can share one.

`init` creates the map only when it is missing. The starter version lists candidate pages and API routes from the default Next.js, Nuxt, SvelteKit, and Astro layouts, CLI executables declared in `package.json`, and existing contracts, each marked `unconfirmed`. It does not read business logic or resolve custom routing. The `feature-map` skill does that part by inspecting the source. Two prompts cover most of the work:

```text
Use the feature-map skill to generate the existing application's feature map.
Use the feature-map skill to update the map for the capabilities changed in this diff.
```

## Contracts

A contract is a short Markdown file that pins down the behavior a capability must keep. The template has five parts: the purpose of the capability, the invariants written as "Given [state]" scenarios with the observable behavior that must hold, the failure and boundary cases, the proof that must run whenever the capability changes, and a place to record the evidence.

Write one for each capability where a silent regression would hurt, such as login, authorization, payments, or anything that deletes data. Skip them for cosmetic work. The skill treats a contract as a requirement. It may change one only when the product requirement itself changed, never to make a failing implementation pass.

## What GroundTruth does not do

- It does not guarantee compliance. A skill is text the agent reads, and a determined shortcut can still skip it. The report format exists so you can check the evidence yourself.
- It does not write contracts or complete the feature map for you. `init` creates a starter map and a template; your agent does the rest when you ask it to.
- `doctor` checks that the GroundTruth files are present and valid. It does not check that your tests pass.

## Safe to run again

- `init` keeps an existing `.groundtruth/PROJECT.md`, `.groundtruth/FEATURE_MAP.md`, and any contracts. It never replaces your instructions with detected guesses.
- `update` refreshes only skills and the contract template whose contents still match the last managed version. Files you edited are kept and reported as customized. It never touches `PROJECT.md`, the feature map, or your contracts.
- GroundTruth marks the section it owns in `AGENTS.md` and `CLAUDE.md` with `<!-- groundtruth:managed:start -->` and `<!-- groundtruth:managed:end -->`. Text outside the markers is left alone, and the section uses the file's existing line endings. If the markers are unpaired, repeated, or out of order, `init` stops without changing anything and `doctor` reports the file as invalid.
- `init` and `update` check every file before writing. If a write still fails, for example because of a permission error, they undo the writes already made and the project is left as it was.
- If `CLAUDE.md` is a symbolic link to `AGENTS.md` or another file in the project, GroundTruth edits the target once and leaves the link in place. It refuses links that point outside the project, to a missing file, or to a file it manages, and it refuses to write through any other symbolic link, such as a linked `.claude/` directory.

## Moving from Prove

Projects set up by the earlier `prove` command have a `.prove/` directory, `prove` skills, and `<!-- prove:managed -->` markers. GroundTruth does not read those. To migrate:

1. Rename the directory with `git mv .prove .groundtruth`, then delete `.groundtruth/.prove-managed.json`.
2. Inside the moved files, replace `.prove/` with `.groundtruth/`. Relative source links in the feature map still work; only text that spells out the directory name changes.
3. Delete `.claude/skills/prove/` and `.agents/skills/prove/`.
4. Remove the section between `<!-- prove:managed:start -->` and `<!-- prove:managed:end -->` from `AGENTS.md` and `CLAUDE.md`.
5. Run `groundtruth init`. It keeps your moved context, map, and contracts, installs the new skills, and adds the new section.

## Development

GroundTruth is written in TypeScript and compiles to `dist/` with `tsc`. You need Node.js 18 or later.

```sh
npm install          # installs TypeScript and builds dist/ through the prepare script
npm run typecheck    # type-checks src/, bin/, and tests/ without writing files
npm test             # rebuilds dist/ and runs the compiled tests
npm pack --dry-run   # lists the files that would be published
```

Source is in `src/`, the executable entry point is `bin/groundtruth.ts`, and tests are in `tests/`. The published package contains the compiled `dist/bin/` and `dist/src/` plus `templates/`. When `npx` runs the CLI from GitHub, npm runs the `prepare` script, which builds `dist/` before the command starts.

The tests use Node's built-in test runner and temporary directories and never touch the network. CI runs them on Node 18, 20, 22, and 24 on Linux, and on Node 22 on macOS and Windows.

## Contributing

Bug reports and pull requests are welcome. See the [open issues](https://github.com/jrcaz/groundtruth/issues) or open a [new issue](https://github.com/jrcaz/groundtruth/issues/new).

## License

[MIT](LICENSE)
