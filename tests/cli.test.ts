import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { PACKAGE_ROOT, POLICY_END, POLICY_START } from "../src/constants.js";
import { snapshot, temporaryProject } from "./helpers.js";

const binPath = path.join(PACKAGE_ROOT, "dist", "bin", "prove.js");
const { version } = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8")) as { version: string };

function prove(cwd: string, ...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [binPath, ...args], { cwd, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("prove --version prints the package version", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  for (const flag of ["--version", "-v", "version"]) {
    const result = prove(project.cwd, flag);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, `${version}\n`);
  }
});

test("prove with no command or --help prints usage", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  for (const args of [[], ["--help"], ["-h"], ["help"]]) {
    const result = prove(project.cwd, ...args);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /^Prove CLI \d+\.\d+\.\d+\n\nUsage:\n {2}prove <command>/);
  }
  assert.deepEqual(snapshot(project.cwd), {});
});

test("prove rejects unknown commands and extra arguments with exit code 1", (t) => {
  const project = temporaryProject();
  t.after(project.clean);

  const unknown = prove(project.cwd, "install");
  assert.equal(unknown.status, 1);
  assert.equal(unknown.stdout, "");
  assert.match(unknown.stderr, /^prove: Unknown command 'install'\. Run 'prove --help' for usage\.$/m);

  const extra = prove(project.cwd, "init", "--force");
  assert.equal(extra.status, 1);
  assert.match(extra.stderr, /^prove: Unexpected arguments: --force$/m);
  assert.deepEqual(snapshot(project.cwd), {});
});

test("prove doctor exits 1 before init and 0 after init", (t) => {
  const project = temporaryProject();
  t.after(project.clean);

  const before = prove(project.cwd, "doctor");
  assert.equal(before.status, 1);
  assert.match(before.stdout, /Prove setup is incomplete\./);

  const init = prove(project.cwd, "init");
  assert.equal(init.status, 0, init.stderr);
  assert.match(init.stdout, /^created \.prove\/PROJECT\.md$/m);
  assert.match(init.stdout, /Prove is ready\./);

  const after = prove(project.cwd, "doctor");
  assert.equal(after.status, 0, after.stdout);
  assert.match(after.stdout, /Prove setup looks good\./);

  const update = prove(project.cwd, "update");
  assert.equal(update.status, 0, update.stderr);
  assert.match(update.stdout, /^up to date \.claude\/skills\/prove\/SKILL\.md$/m);
});

test("a failed prove init exits 1, reports the reason, and writes nothing", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  project.put("AGENTS.md", `${POLICY_END}\n${POLICY_START}\n`);
  const before = snapshot(project.cwd);

  const result = prove(project.cwd, "init");
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /^prove: AGENTS\.md has incomplete, repeated, or out-of-order Prove markers\./m);
  assert.deepEqual(snapshot(project.cwd), before);
});
