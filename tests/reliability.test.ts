import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { doctorProject, initProject, updateProject } from "../src/commands.js";
import { MANIFEST_PATH, POLICY_END, POLICY_START } from "../src/constants.js";
import { applyWrites } from "../src/fs-safe.js";
import { canTestPermissions, silent, snapshot, symlinkOrSkip, temporaryProject } from "./helpers.js";

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function doctorMessages(cwd: string) {
  const messages: string[] = [];
  const result = doctorProject({ cwd, log: (message) => messages.push(message) });
  return { result, output: messages.join("\n") };
}

// Policy markers

test("init refuses out-of-order markers and leaves every file unchanged", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  project.put("AGENTS.md", `top\n${POLICY_END}\nmiddle\n${POLICY_START}\nbottom\n`);
  const before = snapshot(project.cwd);

  assert.throws(() => initProject({ cwd: project.cwd, log: silent }), /AGENTS\.md has incomplete, repeated, or out-of-order GroundTruth markers/);
  assert.deepEqual(snapshot(project.cwd), before);
});

test("init refuses an unpaired start marker and leaves every file unchanged", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  project.put("CLAUDE.md", `# Notes\n${POLICY_START}\nleft open\n`);
  const before = snapshot(project.cwd);

  assert.throws(() => initProject({ cwd: project.cwd, log: silent }), /CLAUDE\.md has incomplete/);
  assert.deepEqual(snapshot(project.cwd), before);
});

test("doctor reports out-of-order markers as invalid", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  initProject({ cwd: project.cwd, log: silent });
  project.put("AGENTS.md", `${POLICY_END}\n${POLICY_START}\n`);

  const { result, output } = doctorMessages(project.cwd);
  assert.equal(result.healthy, false);
  assert.match(output, /INVALID AGENTS\.md GroundTruth section: markers are incomplete, repeated, or out of order/);
  assert.match(output, /OK CLAUDE\.md GroundTruth section/);
});

// Symbolic links between agent instruction files

test("init edits AGENTS.md once when CLAUDE.md links to it", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  project.put("AGENTS.md", "# Agents\n\nKeep this.\n");
  if (!symlinkOrSkip(t, "AGENTS.md", path.join(project.cwd, "CLAUDE.md"), "file")) return;

  const messages: string[] = [];
  const result = initProject({ cwd: project.cwd, log: (message) => messages.push(message) });

  const agents = project.get("AGENTS.md");
  assert.match(agents, /^# Agents\n\nKeep this\.\n/);
  assert.equal(count(agents, POLICY_START), 1);
  assert.equal(count(agents, POLICY_END), 1);
  assert.ok(fs.lstatSync(path.join(project.cwd, "CLAUDE.md")).isSymbolicLink());
  assert.deepEqual(result.policies.map(({ path: file, target, changed }) => ({ file, target, changed })), [
    { file: "AGENTS.md", target: "AGENTS.md", changed: true },
    { file: "CLAUDE.md", target: "AGENTS.md", changed: false }
  ]);
  assert.ok(messages.includes("confirmed CLAUDE.md (links to AGENTS.md, which holds the GroundTruth section)"));

  const { result: doctor } = doctorMessages(project.cwd);
  assert.equal(doctor.healthy, true);

  const afterFirstRun = snapshot(project.cwd);
  initProject({ cwd: project.cwd, log: silent });
  assert.deepEqual(snapshot(project.cwd), afterFirstRun);
});

test("init edits the target of an instruction link that points to a nested file", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  project.put("docs/agent-guide.md", "# Shared guide\n");
  if (!symlinkOrSkip(t, path.join("docs", "agent-guide.md"), path.join(project.cwd, "CLAUDE.md"), "file")) return;

  const messages: string[] = [];
  initProject({ cwd: project.cwd, log: (message) => messages.push(message) });

  assert.equal(count(project.get("docs/agent-guide.md"), POLICY_START), 1);
  assert.ok(messages.includes("updated CLAUDE.md (edited its link target docs/agent-guide.md)"));
  assert.equal(doctorMessages(project.cwd).result.healthy, true);
});

test("init refuses an instruction link to a file outside the project and changes nothing", (t) => {
  const project = temporaryProject();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "groundtruth-cli-outside-"));
  t.after(() => {
    project.clean();
    fs.rmSync(outside, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(outside, "CLAUDE.md"), "# Shared outside the project\n");
  if (!symlinkOrSkip(t, path.join(outside, "CLAUDE.md"), path.join(project.cwd, "CLAUDE.md"), "file")) return;
  const before = snapshot(project.cwd);

  assert.throws(() => initProject({ cwd: project.cwd, log: silent }), /CLAUDE\.md is a symbolic link to a file outside the project/);
  assert.deepEqual(snapshot(project.cwd), before);
  assert.equal(fs.readFileSync(path.join(outside, "CLAUDE.md"), "utf8"), "# Shared outside the project\n");
  assert.match(doctorMessages(project.cwd).output, /BLOCKED CLAUDE\.md: symbolic link/);
});

test("init refuses a dangling instruction link and changes nothing", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  if (!symlinkOrSkip(t, "missing.md", path.join(project.cwd, "AGENTS.md"), "file")) return;
  const before = snapshot(project.cwd);

  assert.throws(() => initProject({ cwd: project.cwd, log: silent }), /AGENTS\.md is a symbolic link to a missing file/);
  assert.deepEqual(snapshot(project.cwd), before);
});

test("init refuses an instruction link to a GroundTruth-managed file", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  project.put(".groundtruth/PROJECT.md", "# Context\n");
  if (!symlinkOrSkip(t, path.join(".groundtruth", "PROJECT.md"), path.join(project.cwd, "CLAUDE.md"), "file")) return;
  const before = snapshot(project.cwd);

  assert.throws(() => initProject({ cwd: project.cwd, log: silent }), /which GroundTruth manages separately/);
  assert.deepEqual(snapshot(project.cwd), before);
});

// Symbolic link directories

test("init refuses a linked .claude directory before writing anything", (t) => {
  const project = temporaryProject();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "groundtruth-cli-outside-"));
  t.after(() => {
    project.clean();
    fs.rmSync(outside, { recursive: true, force: true });
  });
  project.put("AGENTS.md", "# Agents\n");
  if (!symlinkOrSkip(t, outside, path.join(project.cwd, ".claude"), "dir")) return;
  const before = snapshot(project.cwd);

  assert.throws(
    () => initProject({ cwd: project.cwd, log: silent }),
    /Refusing to follow a symbolic link: \.claude\. .*Replace the link with a regular file or directory/
  );
  assert.deepEqual(snapshot(project.cwd), before);
  assert.deepEqual(fs.readdirSync(outside), []);
});

// All-or-nothing writes

test("applyWrites restores earlier writes when a later write fails", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  project.put("existing.md", "original\n");
  project.put("kept/other.md", "untouched\n");
  const before = snapshot(project.cwd);

  assert.throws(() => applyWrites(project.cwd, [
    { path: "new.md", content: "new\n" },
    { path: "existing.md", content: "changed\n" },
    { path: "fresh/deeply/nested/file.md", content: "nested\n" },
    { path: "kept/new.md", content: "sibling\n" },
    { path: "existing.md/impossible.md", content: "fails\n" }
  ]), /Expected a directory at existing\.md, but found a file\..* No files were changed\./);
  assert.deepEqual(snapshot(project.cwd), before);
});

test("applyWrites skips writes whose content is already current", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  project.put("same.md", "same\n");
  const target = path.join(project.cwd, "same.md");
  const fixedTime = new Date("2020-01-01T00:00:00Z");
  fs.utimesSync(target, fixedTime, fixedTime);

  applyWrites(project.cwd, [{ path: "same.md", content: "same\n" }]);
  assert.equal(fs.statSync(target).mtimeMs, fixedTime.getTime());
});

test("init rolls back every change when the last write fails", { skip: !canTestPermissions() && "needs POSIX permissions and a non-root user" }, (t) => {
  const project = temporaryProject();
  const groundtruthDirectory = path.join(project.cwd, ".groundtruth");
  t.after(() => {
    fs.chmodSync(groundtruthDirectory, 0o755);
    project.clean();
  });
  project.put("AGENTS.md", "# Agents\n\nOriginal text.\n");
  project.put(".groundtruth/PROJECT.md", "# Project context\n");
  project.put(".groundtruth/contracts/payments.md", "# Payments\n");
  fs.chmodSync(groundtruthDirectory, 0o555);
  const before = snapshot(project.cwd);

  assert.throws(() => initProject({ cwd: project.cwd, log: silent }), /EACCES.*\. No files were changed\./);
  assert.deepEqual(snapshot(project.cwd), before);
  assert.equal(project.exists(MANIFEST_PATH), false);
});

test("init removes directories it created when an early write fails", { skip: !canTestPermissions() && "needs POSIX permissions and a non-root user" }, (t) => {
  const project = temporaryProject();
  const claudeDirectory = path.join(project.cwd, ".claude");
  t.after(() => {
    fs.chmodSync(claudeDirectory, 0o755);
    project.clean();
  });
  fs.mkdirSync(claudeDirectory, { mode: 0o555 });
  fs.chmodSync(claudeDirectory, 0o555);
  const before = snapshot(project.cwd);

  assert.throws(() => initProject({ cwd: project.cwd, log: silent }), /EACCES/);
  assert.deepEqual(snapshot(project.cwd), before);
  assert.equal(project.exists(".groundtruth"), false);
  assert.equal(project.exists(".agents"), false);
});

test("update rolls back when the manifest cannot be written", { skip: !canTestPermissions() && "needs POSIX permissions and a non-root user" }, (t) => {
  const project = temporaryProject();
  const groundtruthDirectory = path.join(project.cwd, ".groundtruth");
  t.after(() => {
    fs.chmodSync(groundtruthDirectory, 0o755);
    project.clean();
  });
  initProject({ cwd: project.cwd, log: silent });
  // Forget the .agents skill so update must recreate it and record it in the manifest.
  const skillPath = ".agents/skills/groundtruth/SKILL.md";
  const manifest = JSON.parse(project.get(MANIFEST_PATH));
  delete manifest.managed[skillPath];
  project.put(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.rmSync(path.join(project.cwd, ".agents"), { recursive: true });
  fs.chmodSync(groundtruthDirectory, 0o555);
  const before = snapshot(project.cwd);

  assert.throws(() => updateProject({ cwd: project.cwd, log: silent }), /EACCES.*\. No files were changed\./);
  assert.deepEqual(snapshot(project.cwd), before);
});

// Line endings

test("init matches CRLF line endings in existing instruction files", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  project.put("AGENTS.md", "# Agents\r\nRule one.\r\n");

  initProject({ cwd: project.cwd, log: silent });
  const agents = project.get("AGENTS.md");
  assert.ok(agents.startsWith("# Agents\r\nRule one.\r\n\r\n"));
  assert.equal(/(^|[^\r])\n/.test(agents), false, "AGENTS.md must not contain bare LF line endings");
  assert.ok(agents.endsWith(`${POLICY_END}\r\n`));

  const afterFirstRun = snapshot(project.cwd);
  initProject({ cwd: project.cwd, log: silent });
  assert.deepEqual(snapshot(project.cwd), afterFirstRun);
  assert.equal(doctorMessages(project.cwd).result.healthy, true);
});

test("init keeps LF files free of carriage returns and separates the section from existing text", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  project.put("CLAUDE.md", "# Claude\nNo trailing newline");

  initProject({ cwd: project.cwd, log: silent });
  const claude = project.get("CLAUDE.md");
  assert.equal(claude.includes("\r"), false);
  assert.ok(claude.startsWith(`# Claude\nNo trailing newline\n\n${POLICY_START}\n`));
  assert.equal(project.get("AGENTS.md"), `${claude.slice(claude.indexOf(POLICY_START))}`);
});

// Workspace detection

test("detection reads npm workspaces, including globs and exclusions", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  project.put("package.json", JSON.stringify({ private: true, workspaces: ["apps/*", "packages/**", "!packages/legacy", "../outside"] }));
  project.put("apps/web/package.json", JSON.stringify({ dependencies: { next: "1", react: "1" } }));
  project.put("apps/web/playwright.config.ts", "export default {};\n");
  project.put("apps/api/package.json", JSON.stringify({ dependencies: { express: "1" }, devDependencies: { jest: "1" } }));
  project.put("apps/docs/README.md", "# No package.json here\n");
  project.put("packages/ui/package.json", JSON.stringify({ devDependencies: { vitest: "1" } }));
  project.put("packages/tools/cli/package.json", JSON.stringify({}));
  project.put("packages/legacy/package.json", JSON.stringify({ devDependencies: { cypress: "1" } }));
  project.put("packages/ui/node_modules/dep/package.json", JSON.stringify({ dependencies: { vue: "1" } }));

  const result = initProject({ cwd: project.cwd, log: silent });
  assert.deepEqual(result.detection.workspaces, ["apps/api", "apps/web", "packages/tools/cli", "packages/ui"]);
  assert.deepEqual(result.detection.frameworks, ["Next.js", "React", "Express"]);
  assert.deepEqual(result.detection.projectKinds, ["Web application", "API or server"]);
  assert.deepEqual(result.detection.verificationTools, ["Vitest", "Jest", "Playwright"]);
  assert.match(project.get(".groundtruth/PROJECT.md"), /^Workspaces: apps\/api, apps\/web, packages\/tools\/cli, packages\/ui$/m);
});

test("detection reads Yarn object-style workspaces", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  project.put("package.json", JSON.stringify({ workspaces: { packages: ["services/*"] } }));
  project.put("services/api/package.json", JSON.stringify({ dependencies: { fastify: "1" } }));

  const { result } = doctorMessages(project.cwd);
  assert.deepEqual(result.detection.workspaces, ["services/api"]);
  assert.deepEqual(result.detection.frameworks, ["Fastify"]);
});

test("detection reads pnpm-workspace.yaml", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  project.put("package.json", JSON.stringify({ private: true }));
  project.put("pnpm-workspace.yaml", [
    "# workspace layout",
    "packages:",
    "  - 'apps/*'",
    "  - \"libs/core\" # shared code",
    "",
    "  - '!apps/sandbox'",
    "catalog:",
    "  - 'ignored/*'",
    ""
  ].join("\n"));
  project.put("apps/mobile/package.json", JSON.stringify({ dependencies: { expo: "1" }, devDependencies: { detox: "1" } }));
  project.put("apps/mobile/.maestro/login.yaml", "appId: example\n");
  project.put("apps/sandbox/package.json", JSON.stringify({ dependencies: { svelte: "1" } }));
  project.put("libs/core/package.json", JSON.stringify({ devDependencies: { mocha: "1" } }));
  project.put("ignored/thing/package.json", JSON.stringify({ dependencies: { vue: "1" } }));

  const { result, output } = doctorMessages(project.cwd);
  assert.deepEqual(result.detection.workspaces, ["apps/mobile", "libs/core"]);
  assert.deepEqual(result.detection.frameworks, ["React Native"]);
  assert.deepEqual(result.detection.verificationTools, ["Mocha", "Detox", "Maestro"]);
  assert.match(output, /^Workspaces: apps\/mobile, libs\/core$/m);
});

test("detection without workspaces reports none and omits the line from project context", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  project.put("package.json", JSON.stringify({ dependencies: { vue: "1" } }));

  const result = initProject({ cwd: project.cwd, log: silent });
  assert.deepEqual(result.detection.workspaces, []);
  assert.doesNotMatch(project.get(".groundtruth/PROJECT.md"), /Workspaces:/);
});
