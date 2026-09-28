import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initProject, updateProject, doctorProject } from "../src/commands.js";
import { POLICY_END, POLICY_START, MANIFEST_PATH, MANAGED_CONTENT } from "../src/constants.js";
import { hash } from "../src/manifest.js";
import { packageContent } from "../src/content.js";
import { symlinkOrSkip, temporaryProject } from "./helpers.js";

test("init detects tooling and preserves existing guide content", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  project.put("package.json", JSON.stringify({
    dependencies: { next: "1", "@playwright/test": "1" },
    devDependencies: { vitest: "1" },
    scripts: { dev: "next dev", test: "vitest", typecheck: "tsc --noEmit" }
  }));
  project.put("AGENTS.md", "# Existing instructions\n\nKeep this text.\n");
  project.put("CLAUDE.md", "# Claude notes\n");

  const messages: string[] = [];
  const result = initProject({ cwd: project.cwd, log: (message) => messages.push(message) });
  assert.deepEqual(result.detection.frameworks, ["Next.js"]);
  assert.deepEqual(result.detection.verificationTools, ["Playwright", "Vitest"]);
  assert.match(project.get(".prove/PROJECT.md"), /npm run typecheck/);
  assert.match(project.get("AGENTS.md"), /Keep this text\./);
  assert.equal(project.get("AGENTS.md").split(POLICY_START).length - 1, 1);
  assert.equal(project.get("CLAUDE.md").split(POLICY_END).length - 1, 1);
  assert.match(messages.join("\n"), /Verification tools: Playwright, Vitest/);
});

test("init is repeatable and does not overwrite project context or real contracts", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  initProject({ cwd: project.cwd, log: () => {} });
  project.put(".prove/PROJECT.md", "# Project-owned context\n");
  project.put(".prove/contracts/payments.md", "# Real contract\n");
  const originalPolicy = project.get("AGENTS.md");

  initProject({ cwd: project.cwd, log: () => {} });
  assert.equal(project.get(".prove/PROJECT.md"), "# Project-owned context\n");
  assert.equal(project.get(".prove/contracts/payments.md"), "# Real contract\n");
  assert.equal(project.get("AGENTS.md"), originalPolicy);
});

test("update refreshes unchanged managed files and never touches project-owned files", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  initProject({ cwd: project.cwd, log: () => {} });
  const projectContext = "# Hand-authored project context\n";
  const realContract = "# Keep this contract exactly\n";
  project.put(".prove/PROJECT.md", projectContext);
  project.put(".prove/contracts/authentication.md", realContract);

  const skillPath = ".agents/skills/prove/SKILL.md";
  const olderSkill = "---\nname: prove\n---\n\nOlder managed content.\n";
  project.put(skillPath, olderSkill);
  const manifest = JSON.parse(project.get(MANIFEST_PATH));
  manifest.managed[skillPath] = hash(olderSkill);
  project.put(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);

  updateProject({ cwd: project.cwd, log: () => {} });
  assert.equal(project.get(skillPath), packageContent(skillPath));
  assert.equal(project.get(".prove/PROJECT.md"), projectContext);
  assert.equal(project.get(".prove/contracts/authentication.md"), realContract);
  for (const managedPath of Object.keys(MANAGED_CONTENT)) assert.ok(fs.existsSync(path.join(project.cwd, managedPath)));
});

test("update leaves customized managed content alone", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  initProject({ cwd: project.cwd, log: () => {} });
  const skillPath = ".claude/skills/prove/SKILL.md";
  const edited = `${project.get(skillPath)}\nLocal addition.\n`;
  project.put(skillPath, edited);
  const outcomes = updateProject({ cwd: project.cwd, log: () => {} });
  assert.equal(project.get(skillPath), edited);
  assert.equal(outcomes.find(({ path: itemPath }) => itemPath === skillPath)?.status, "preserved-customized");
});

test("doctor reports missing setup and detects verification tools", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  project.put("package.json", JSON.stringify({ devDependencies: { cypress: "1" } }));
  const result = doctorProject({ cwd: project.cwd, log: () => {} });
  assert.equal(result.healthy, false);
  assert.deepEqual(result.detection.verificationTools, ["Cypress"]);
});

test("detector recognizes Python frameworks and pytest from project metadata", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  project.put("pyproject.toml", "[project]\ndependencies = ['fastapi', 'pytest']\n");
  const result = doctorProject({ cwd: project.cwd, log: () => {} });
  assert.ok(result.detection.frameworks.includes("FastAPI"));
  assert.ok(result.detection.verificationTools.includes("pytest"));
  assert.ok(result.detection.projectKinds.includes("API or server"));
});

test("doctor reports symlinked managed paths as blocked", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  fs.mkdirSync(path.join(project.cwd, ".agents/skills/prove"), { recursive: true });
  if (!symlinkOrSkip(t, os.tmpdir(), path.join(project.cwd, ".agents/skills/prove/SKILL.md"), "dir")) return;
  const messages: string[] = [];
  const result = doctorProject({ cwd: project.cwd, log: (message) => messages.push(message) });
  assert.equal(result.healthy, false);
  assert.ok(messages.some((message) => message.includes("BLOCKED .agents/skills/prove/SKILL.md")));
});

test("policy upsert uses bounded markers without duplicating the managed section", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  initProject({ cwd: project.cwd, log: () => {} });
  const first = project.get("CLAUDE.md");
  assert.ok(first.includes(POLICY_START) && first.includes(POLICY_END));
  initProject({ cwd: project.cwd, log: () => {} });
  assert.equal(project.get("CLAUDE.md"), first);
});
