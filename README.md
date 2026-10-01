# Prove

**Give coding agents a project-specific definition of done.** Prove installs shared verification and feature map skills for Claude Code and Codex/OpenAI-style agents, then adds project context, a starter feature map, and contract templates for your repository.

Prove is an installer and set of agent instructions, not a test runner. Your agent uses the tools and commands already configured in your project.

## Contents

- [Quick start](#quick-start)
- [What Prove adds](#what-prove-adds)
- [Commands](#commands)
- [What it detects](#what-it-detects)
- [Feature maps](#feature-maps)
- [Safe updates](#safe-updates)
- [Development](#development)
- [Contributing](#contributing)

## Quick start

You need Node.js 18 or later and npm. Run Prove from the root of the project you want to set up:

```sh
npx --yes --package=github:jrcaz/prove-starter-cli prove init
```

The npm package has not been published yet. The command above runs the CLI from this public GitHub repository without adding it to your project's dependencies. After the package is published, the shorter command will be:

```sh
npx prove-starter-cli init
```

Then:

1. Review `.prove/PROJECT.md`. Add the commands to start the app and run its required checks, plus any setup steps Prove could not detect.
2. Ask your agent to use the `feature-map` skill to generate the application's feature map. Initialization creates a starter inventory in `.prove/FEATURE_MAP.md`; the skill inspects the implementation to turn it into product capabilities and link existing contracts.
3. Add contracts for important business capabilities. Start with `cp .prove/contracts/TEMPLATE.md .prove/contracts/<capability>.md`, then replace the prompts with behavior that must stay true. Link the contract from its feature map entry.
4. Ask your coding agent to implement a change and prove it works. The Prove skill tells it to consult the project context, feature map, and relevant contracts, run appropriate checks, and report the evidence.

Do not put credentials or other secrets in project context or contracts.

## What Prove adds

After `prove init`, the project includes these files. Existing `AGENTS.md` and `CLAUDE.md` files are kept, with a marked Prove section added to each.

```text
.agents/skills/prove/SKILL.md       Codex and OpenAI-style agent skill
.claude/skills/prove/SKILL.md       Claude Code skill
.agents/skills/feature-map/SKILL.md  Codex feature map skill
.claude/skills/feature-map/SKILL.md  Claude Code feature map skill
.prove/PROJECT.md                  Project-specific setup and verification notes
.prove/FEATURE_MAP.md              Product capabilities, source references, and contract links
.prove/contracts/TEMPLATE.md       Starting point for capability contracts
.prove/.prove-managed.json         Tracks Prove-managed shared files
AGENTS.md                          Prove instructions for compatible agents
CLAUDE.md                          Prove instructions for Claude Code
```

The skill guides an agent through reading project requirements, implementing a change, running relevant checks, exercising runtime behavior when appropriate, and reporting what it verified. The `doctor` command can inspect project metadata, but it does not run those checks for the agent.

## Commands

Run the commands from the target project's root. With the current GitHub install method, replace `prove` below with `npx --yes --package=github:jrcaz/prove-starter-cli prove`.

| Command | What it does |
| --- | --- |
| `prove init` | Detects project metadata, creates a missing feature map with a starter inventory, installs the shared skills and contract template, and adds or repairs the marked Prove sections in `AGENTS.md` and `CLAUDE.md`. |
| `prove update` | Refreshes Prove-managed skills and the contract template when they have not been locally changed. It preserves project context, feature maps, and real contracts. |
| `prove doctor` | Reports whether required Prove files and instruction sections are present, along with detected project details, npm scripts, and verification tools. Exits with a nonzero status if required setup is missing or blocked. |
| `prove --help` | Prints command usage. |

## What it detects

Prove looks at repository files and package metadata. It recognizes common JavaScript and TypeScript frameworks, Python frameworks, Flutter and React Native projects, Tauri, Go modules, and Rust crates. It also looks for test and browser tools such as Playwright, Cypress, Vitest, Jest, pytest, Maestro, and Appium, plus npm scripts that may be useful verification commands.

In a monorepo, Prove also reads the workspaces declared in `package.json` (npm and Yarn) or `pnpm-workspace.yaml`, and includes their dependencies and test configuration in detection. It lists the workspaces it found in `.prove/PROJECT.md`.

Detection is a starting point, not a test of whether a tool is installed or configured correctly. Prove does not install dependencies, execute project scripts, or contact production services. Review `.prove/PROJECT.md` and correct anything the repository metadata cannot tell it.

## Feature maps

A feature map answers what the current product can do. The `feature-map` skill groups capabilities into product areas, records variants and implementation status, and links source evidence and applicable verification contracts. It keeps future plans outside the current capability tree.

`prove init` creates `.prove/FEATURE_MAP.md` only when it is missing. Its starter inventory lists candidate pages and API routes from default Next.js, Nuxt, SvelteKit, and Astro layouts, readable CLI executables declared in `package.json`, and existing Prove contracts. Workspaces are inspected independently. Every candidate starts as `unconfirmed`; contract references are listed for review before attaching them to capabilities.

The initializer uses file conventions to find starting points. It does not inspect business behavior, resolve custom routing, or verify the running app. For other frameworks, mobile apps, background jobs, custom layouts, and capability variants, the skill inspects the source. A project with no recognizable entry points gets a map with review instructions instead of guessed capabilities.

Ask your agent:

```text
Use the feature-map skill to generate the existing application's feature map.
Use the feature-map skill to update the map for the capabilities changed in this diff.
```

A completed entry can look like this when supported by the application:

```markdown
## Authentication

- Login, `authentication.login`, implemented
  - Signs a registered user in with an email address and password.
  - Sources: [Login handler](../src/auth/login.ts)
  - Contracts: [Login](contracts/login.md)
  - Verification: [Login tests](../tests/auth/login.test.ts), runtime not checked.
```

Source and test links are relative to `.prove/FEATURE_MAP.md`; contract links start with `contracts/`. A capability can link to multiple contracts, and several capabilities can share a contract. The Prove skill consults these links before changes and asks the feature-map skill to update affected entries when capabilities change. It also checks the contracts directory so an incomplete map cannot hide a relevant contract.

For an existing Prove installation, run `prove init` once to add the missing map and skill and refresh the marked agent instructions. Existing maps are kept. `prove update` refreshes the shared skill instructions; ask the agent skill to update the product map itself.

## Safe updates

- `init` keeps an existing `.prove/PROJECT.md`, `.prove/FEATURE_MAP.md`, and existing contracts. It does not replace your project-specific instructions with detected guesses.
- Prove marks the section it owns in `AGENTS.md` and `CLAUDE.md`. Text outside those markers is left unchanged.
- `update` refreshes only shared skills and the contract template whose contents still match the last Prove-managed version. It preserves locally edited or unrecognized files.
- `update` never changes `.prove/PROJECT.md`, `.prove/FEATURE_MAP.md`, or real files in `.prove/contracts/`.
- `init` and `update` check every file before writing. If a write still fails, for example because of a permission error, they undo the changes already made, so the project is left as it was.
- If `CLAUDE.md` is a symbolic link to `AGENTS.md` (or another file in the project), Prove edits the target once and leaves the link in place. It refuses links that point outside the project or to a missing file.
- Prove refuses to write through any other symbolic link, such as a linked `.claude/` directory, because the change would land outside the project.
- If the Prove markers in `AGENTS.md` or `CLAUDE.md` are unpaired, repeated, or out of order, Prove stops without changing anything and `doctor` reports the file as invalid.
- The Prove section uses the same line endings (LF or CRLF) as the file it is added to.

## Development

Prove is written in TypeScript and compiles to `dist/` with `tsc`. You need Node.js 18 or later.

```sh
npm install          # installs TypeScript and builds dist/ through the prepare script
npm run typecheck    # type-checks src/, bin/, and tests/ without writing files
npm test             # rebuilds dist/ and runs the compiled tests
npm pack --dry-run   # lists the files that would be published
```

Source lives in `src/`, the executable entry point is `bin/prove.ts`, and tests are in `tests/`. The published package contains only the compiled `dist/bin/` and `dist/src/` files plus `templates/`. When the CLI runs from GitHub with `npx`, npm runs the `prepare` script, which builds `dist/` before the command starts.

The tests use only Node's built-in test runner and temporary directories. They don't touch the network. CI runs them on Node 18, 20, 22 and 24 on Linux, and on Node 22 on macOS and Windows.

The package exposes the `prove` executable through `dist/bin/prove.js`. Its package name is `prove-starter-cli`; change the `name` field in `package.json` if you publish it under another npm name or scope.

## Contributing

Bug reports and pull requests are welcome. See the [open issues](https://github.com/jrcaz/prove-starter-cli/issues) or open a [new issue](https://github.com/jrcaz/prove-starter-cli/issues/new).

## License

[MIT](LICENSE)
