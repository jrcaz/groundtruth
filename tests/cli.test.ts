import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { PACKAGE_ROOT, POLICY_END, POLICY_START } from "../src/constants.js";
import { legacySetup, snapshot, temporaryProject } from "./helpers.js";

const binPath = path.join(PACKAGE_ROOT, "dist", "bin", "groundtruth.js");
const { version } = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8")) as { version: string };

function groundtruth(cwd: string, ...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [binPath, ...args], { cwd, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("groundtruth --version prints the package version", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  for (const flag of ["--version", "-v", "version"]) {
    const result = groundtruth(project.cwd, flag);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, `${version}\n`);
  }
});

test("groundtruth with no command or --help prints usage", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  for (const args of [[], ["--help"], ["-h"], ["help"]]) {
    const result = groundtruth(project.cwd, ...args);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /^GroundTruth CLI \d+\.\d+\.\d+\n\nUsage:\n {2}groundtruth <command>/);
  }
  assert.deepEqual(snapshot(project.cwd), {});
});

test("groundtruth rejects unknown commands and extra arguments with exit code 1", (t) => {
  const project = temporaryProject();
  t.after(project.clean);

  const unknown = groundtruth(project.cwd, "install");
  assert.equal(unknown.status, 1);
  assert.equal(unknown.stdout, "");
  assert.match(unknown.stderr, /^groundtruth: Unknown command 'install'\. Run 'groundtruth --help' for usage\.$/m);

  const extra = groundtruth(project.cwd, "init", "--force");
  assert.equal(extra.status, 1);
  assert.match(extra.stderr, /^groundtruth: Unexpected arguments: --force$/m);
  assert.deepEqual(snapshot(project.cwd), {});
});

test("groundtruth doctor exits 1 before init and 0 after init", (t) => {
  const project = temporaryProject();
  t.after(project.clean);

  const before = groundtruth(project.cwd, "doctor");
  assert.equal(before.status, 1);
  assert.match(before.stdout, /GroundTruth setup is incomplete\./);

  const init = groundtruth(project.cwd, "init");
  assert.equal(init.status, 0, init.stderr);
  assert.match(init.stdout, /^created \.groundtruth\/PROJECT\.md$/m);
  assert.match(init.stdout, /GroundTruth is ready\./);

  const after = groundtruth(project.cwd, "doctor");
  assert.equal(after.status, 0, after.stdout);
  assert.match(after.stdout, /GroundTruth setup looks good\./);

  const update = groundtruth(project.cwd, "update");
  assert.equal(update.status, 0, update.stderr);
  assert.match(update.stdout, /^up to date \.claude\/skills\/groundtruth\/SKILL\.md$/m);
});

test("a failed groundtruth init exits 1, reports the reason, and writes nothing", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  project.put("AGENTS.md", `${POLICY_END}\n${POLICY_START}\n`);
  const before = snapshot(project.cwd);

  const result = groundtruth(project.cwd, "init");
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /^groundtruth: AGENTS\.md has incomplete, repeated, or out-of-order GroundTruth markers\./m);
  assert.deepEqual(snapshot(project.cwd), before);
});

test("groundtruth init and update refuse a Prove setup, doctor reports it, and migrate converts it", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  legacySetup(project);
  const before = snapshot(project.cwd);

  for (const command of ["init", "update"]) {
    const refused = groundtruth(project.cwd, command);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /^groundtruth: Found a setup from Prove, the earlier name of GroundTruth: \.prove\/, \.agents\/skills\/prove\/SKILL\.md, \.claude\/skills\/prove\/SKILL\.md, \.agents\/skills\/feature-map\/SKILL\.md, \.claude\/skills\/feature-map\/SKILL\.md, AGENTS\.md Prove section, CLAUDE\.md Prove section\. Run `groundtruth migrate` instead\..* No files were changed\.$/m);
  }
  assert.deepEqual(snapshot(project.cwd), before);

  const doctor = groundtruth(project.cwd, "doctor");
  assert.equal(doctor.status, 1);
  assert.match(doctor.stdout, /^OLD \.prove\/$/m);
  assert.match(doctor.stdout, /^OLD AGENTS\.md Prove section$/m);
  assert.match(doctor.stdout, /Run `groundtruth migrate` to move it to GroundTruth\.$/m);

  const migrate = groundtruth(project.cwd, "migrate");
  assert.equal(migrate.status, 0, migrate.stderr);
  assert.match(migrate.stdout, /^moved \.prove\/PROJECT\.md to \.groundtruth\/PROJECT\.md$/m);
  assert.match(migrate.stdout, /GroundTruth is ready\./);
  assert.equal(groundtruth(project.cwd, "doctor").status, 0);
  assert.equal(groundtruth(project.cwd, "init").status, 0);
});
