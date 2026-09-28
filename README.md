# Prove

**Give coding agents a project-specific definition of done.** Prove installs shared verification guidance for Claude Code and Codex/OpenAI-style agents, then adds project context and contract templates for your repository.

Prove is an installer and set of agent instructions, not a test runner. Your agent uses the tools and commands already configured in your project.

## Contents

- [Quick start](#quick-start)
- [What Prove adds](#what-prove-adds)
- [Commands](#commands)
- [What it detects](#what-it-detects)
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
2. Add contracts for important business capabilities. Start with `cp .prove/contracts/TEMPLATE.md .prove/contracts/<capability>.md`, then replace the prompts with behavior that must stay true.
3. Ask your coding agent to implement a change and prove it works. The Prove skill tells it to consult the project context and relevant contracts, run appropriate checks, and report the evidence.

Do not put credentials or other secrets in project context or contracts.

## What Prove adds

After `prove init`, the project includes these files. Existing `AGENTS.md` and `CLAUDE.md` files are kept, with a marked Prove section added to each.

```text
.agents/skills/prove/SKILL.md     Codex and OpenAI-style agent skill
.claude/skills/prove/SKILL.md     Claude Code skill
.prove/PROJECT.md                Project-specific setup and verification notes
.prove/contracts/TEMPLATE.md     Starting point for capability contracts
.prove/.prove-managed.json       Tracks Prove-managed shared files
AGENTS.md                        Prove instructions for compatible agents
CLAUDE.md                        Prove instructions for Claude Code
```

The skill guides an agent through reading project requirements, implementing a change, running relevant checks, exercising runtime behavior when appropriate, and reporting what it verified. The `doctor` command can inspect project metadata, but it does not run those checks for the agent.

## Commands

Run the commands from the target project's root. With the current GitHub install method, replace `prove` below with `npx --yes --package=github:jrcaz/prove-starter-cli prove`.

| Command | What it does |
| --- | --- |
| `prove init` | Detects project metadata, creates missing Prove files, installs the shared skills and contract template, and adds or repairs the marked Prove sections in `AGENTS.md` and `CLAUDE.md`. |
| `prove update` | Refreshes Prove-managed skills and the contract template when they have not been locally changed. It leaves project context and real contracts alone. |
| `prove doctor` | Reports whether required Prove files and instruction sections are present, along with detected project details, npm scripts, and verification tools. Exits with a nonzero status if required setup is missing or blocked. |
| `prove --help` | Prints command usage. |

## What it detects

Prove looks at repository files and package metadata. It recognizes common JavaScript and TypeScript frameworks, Python frameworks, Flutter and React Native projects, Tauri, Go modules, and Rust crates. It also looks for test and browser tools such as Playwright, Cypress, Vitest, Jest, pytest, Maestro, and Appium, plus npm scripts that may be useful verification commands.

In a monorepo, Prove also reads the workspaces declared in `package.json` (npm and Yarn) or `pnpm-workspace.yaml`, and includes their dependencies and test configuration in detection. It lists the workspaces it found in `.prove/PROJECT.md`.

Detection is a starting point, not a test of whether a tool is installed or configured correctly. Prove does not install dependencies, execute project scripts, or contact production services. Review `.prove/PROJECT.md` and correct anything the repository metadata cannot tell it.

## Safe updates

- `init` keeps an existing `.prove/PROJECT.md` and existing contracts. It does not replace your project-specific instructions with detected guesses.
- Prove marks the section it owns in `AGENTS.md` and `CLAUDE.md`. Text outside those markers is left unchanged.
- `update` refreshes only shared skills and the contract template whose contents still match the last Prove-managed version. It preserves locally edited or unrecognized files.
- `update` never changes `.prove/PROJECT.md` or real files in `.prove/contracts/`.
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
