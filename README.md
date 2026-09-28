# Prove CLI

Prove adds a shared verification workflow to a project. It installs the same agent skill for Claude Code and Codex/OpenAI-style agents, creates project context and a contract template, and adds a bounded Definition of Done section to `AGENTS.md` and `CLAUDE.md`.

## Use it

From the root of your project, run:

```sh
npx prove-starter-cli init
```

Then edit `.prove/PROJECT.md` with the setup details the installer could not detect. Create contracts in `.prove/contracts/` for important business capabilities, not individual tickets.

```sh
npx prove-starter-cli update
npx prove-starter-cli doctor
```

The package exposes the `prove` binary. You can also run it explicitly through npm:

```sh
npm exec --yes --package=prove-starter-cli -- prove init
```

## Commands

- `prove init` detects common frameworks and verification tools, creates missing Prove files, and adds or repairs only the marked Prove section in `AGENTS.md` and `CLAUDE.md`.
- `prove update` refreshes the two shared skills and contract template only when their contents still match the last Prove-managed version. It never changes `.prove/PROJECT.md` or real contracts.
- `prove doctor` checks the installation and reports detected project metadata, npm scripts, and verification tooling. It exits nonzero when required Prove files or policy sections are missing.

## What gets installed

```text
.agents/skills/prove/SKILL.md
.claude/skills/prove/SKILL.md
.prove/PROJECT.md
.prove/contracts/TEMPLATE.md
.prove/.prove-managed.json
AGENTS.md
CLAUDE.md
```

Existing `.prove/PROJECT.md` and files in `.prove/contracts/` are project-owned. `init` leaves them alone if present. `update` does not read or write project context or real contracts. If a shared file has local edits, update preserves it and reports that state. Existing, unrecognized files are not claimed as managed.

The Prove sections in `AGENTS.md` and `CLAUDE.md` sit between `<!-- prove:managed:start -->` and `<!-- prove:managed:end -->`. Text outside those markers remains unchanged. `update` does not modify either instruction file.

## Detection

The detector reads repository metadata and does not install dependencies or execute project scripts. It recognizes common JavaScript frameworks and test tools, Flutter/Tauri projects, Python project files, Go modules, Rust crates, Maestro, Appium, and npm scripts. Detection is a starting point. Review `.prove/PROJECT.md` and correct anything the repository metadata cannot establish.

## Development

Requires Node.js 18 or newer.

```sh
npm test
npm pack --dry-run
```

The package name is `prove-starter-cli`. Change the `name` field in `package.json` if you publish under a different npm account or scope.

## Contributing

Issues and pull requests are welcome at [jrcaz/prove-starter-cli](https://github.com/jrcaz/prove-starter-cli).

## License

MIT. See [LICENSE](LICENSE).
