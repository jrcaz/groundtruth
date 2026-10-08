import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { doctorProject, initProject, migrateProject } from "../src/commands.js";
import { MANAGED_CONTENT, POLICY_START } from "../src/constants.js";
import { packageContent, renderPolicySection } from "../src/content.js";
import { findLegacySetup, rewriteLegacyText } from "../src/legacy.js";
import { LEGACY_SECTION, LEGACY_START, legacySetup, silent, snapshot, symlinkOrSkip, temporaryProject } from "./helpers.js";

const SECTION = renderPolicySection("\n");

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function migrate(cwd: string): { result: { migrated: boolean }; messages: string[] } {
  const messages: string[] = [];
  const result = migrateProject({ cwd, log: (message) => messages.push(message) });
  return { result, messages };
}

// Lists files whose path or content still refers to Prove's layout.
function leftovers(cwd: string): string[] {
  return Object.entries(snapshot(cwd))
    .filter(([name, content]) => /(^|\/)\.?prove(\/|-|$)/.test(name) || content.includes(".prove") || content.includes("prove:managed"))
    .map(([name]) => name);
}

test("migrate moves a Prove setup into place and finishes the GroundTruth setup", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  legacySetup(project);
  const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00, 0xfe]);
  fs.writeFileSync(path.join(project.cwd, ".prove/contracts/flow.png"), image);

  const { result, messages } = migrate(project.cwd);
  assert.deepEqual(result, { migrated: true });
  assert.ok(messages.includes("moved .prove/PROJECT.md to .groundtruth/PROJECT.md"), messages.join("\n"));
  assert.ok(messages.includes("removed .claude/skills/prove/SKILL.md"));
  assert.ok(messages.includes("replaced the Prove section in AGENTS.md with the GroundTruth section"));
  assert.ok(messages.includes("removed .prove/"));

  assert.equal(project.get(".groundtruth/PROJECT.md"), "# GroundTruth project context\n\nStart the app with `npm run dev`.\nRead `.groundtruth/FEATURE_MAP.md` for capabilities.\n");
  assert.equal(project.get(".groundtruth/FEATURE_MAP.md"), "# Feature map\n\n- Login, `authentication.login`, implemented\n  - Contracts: [Login](contracts/login.md)\n");
  assert.equal(project.get(".groundtruth/contracts/login.md"), "# Contract: Login\n\nProve that a locked account cannot sign in.\n");
  assert.deepEqual(fs.readFileSync(path.join(project.cwd, ".groundtruth/contracts/flow.png")), image);
  for (const relativePath of Object.keys(MANAGED_CONTENT)) assert.equal(project.get(relativePath), packageContent(relativePath));
  assert.equal(project.get("AGENTS.md"), `# Team notes\n\nKeep commits small.\n\n${SECTION}\n`);
  assert.equal(project.get("CLAUDE.md"), `${SECTION}\n`);

  assert.deepEqual(leftovers(project.cwd), []);
  assert.deepEqual(findLegacySetup(project.cwd), []);
  assert.equal(doctorProject({ cwd: project.cwd, log: silent }).healthy, true);
});

test("migrate is repeatable and has nothing to do without a Prove setup", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  assert.deepEqual(migrate(project.cwd), { result: { migrated: false }, messages: ["No Prove setup found. Nothing to migrate."] });
  assert.deepEqual(snapshot(project.cwd), {});

  legacySetup(project);
  migrate(project.cwd);
  const migrated = snapshot(project.cwd);
  assert.deepEqual(migrate(project.cwd).result, { migrated: false });
  assert.deepEqual(snapshot(project.cwd), migrated);
});

test("migrate removes only the Prove section when GroundTruth was already set up next to it", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  legacySetup(project);
  initProject({ cwd: project.cwd, log: silent });
  assert.equal(count(project.get("AGENTS.md"), POLICY_START), 1);
  assert.equal(count(project.get("AGENTS.md"), LEGACY_START), 1);
  const before = snapshot(project.cwd);

  assert.throws(() => migrate(project.cwd), (error: Error) => {
    assert.match(error.message, /^Cannot migrate this Prove setup yet\. No files were changed\.$/m);
    assert.match(error.message, /^- \.groundtruth\/PROJECT\.md already exists and differs from \.prove\/PROJECT\.md\./m);
    assert.match(error.message, /^- \.groundtruth\/FEATURE_MAP\.md already exists and differs from \.prove\/FEATURE_MAP\.md\./m);
    return true;
  });
  assert.deepEqual(snapshot(project.cwd), before);

  fs.rmSync(path.join(project.cwd, ".groundtruth/PROJECT.md"));
  fs.rmSync(path.join(project.cwd, ".groundtruth/FEATURE_MAP.md"));
  const { messages } = migrate(project.cwd);
  assert.ok(messages.includes("removed the Prove section from AGENTS.md; it already has a GroundTruth section"), messages.join("\n"));
  assert.equal(project.get("AGENTS.md"), `# Team notes\n\nKeep commits small.\n\n${SECTION}\n`);
  assert.equal(project.get("CLAUDE.md"), `${SECTION}\n`);
  assert.match(project.get(".groundtruth/PROJECT.md"), /^# GroundTruth project context\n\nStart the app with `npm run dev`\./);
  assert.deepEqual(leftovers(project.cwd), []);
  assert.equal(doctorProject({ cwd: project.cwd, log: silent }).healthy, true);
});

test("migrate refuses edited Prove skills and broken markers without changing any file", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  legacySetup(project);
  project.put(".claude/skills/prove/SKILL.md", "---\nname: prove\n---\n\nAlso run the smoke tests.\n");
  project.put("AGENTS.md", `# Team notes\n\n${LEGACY_START}\n`);
  const before = snapshot(project.cwd);

  assert.throws(() => migrate(project.cwd), (error: Error) => {
    assert.match(error.message, /^- \.claude\/skills\/prove\/SKILL\.md has local edits, or Prove has no record of installing it\..* add them to \.claude\/skills\/groundtruth\/SKILL\.md\.$/m);
    assert.match(error.message, /^- AGENTS\.md has incomplete, repeated, or out-of-order Prove markers\./m);
    assert.doesNotMatch(error.message, /\.agents\/skills\/prove/);
    return true;
  });
  assert.deepEqual(snapshot(project.cwd), before);
});

test("migrate treats shared files as edited when the Prove manifest is missing", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  legacySetup(project);
  fs.rmSync(path.join(project.cwd, ".prove/.prove-managed.json"));
  const before = snapshot(project.cwd);

  assert.throws(() => migrate(project.cwd), /^- \.agents\/skills\/prove\/SKILL\.md has local edits, or Prove has no record of installing it\./m);
  assert.deepEqual(snapshot(project.cwd), before);
});

test("migrate handles a setup from the first Prove version, which had no feature map", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  legacySetup(project, { featureMap: false });

  migrate(project.cwd);
  // init creates the starter map after the move, so it lists the moved contract.
  assert.match(project.get(".groundtruth/FEATURE_MAP.md"), /^- \[\.groundtruth\/contracts\/login\.md\]\(<contracts\/login\.md>\)$/m);
  assert.equal(project.get(".claude/skills/feature-map/SKILL.md"), packageContent(".claude/skills/feature-map/SKILL.md"));
  assert.deepEqual(leftovers(project.cwd), []);
  assert.equal(doctorProject({ cwd: project.cwd, log: silent }).healthy, true);
});

test("migrate edits AGENTS.md once when CLAUDE.md links to it", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  legacySetup(project);
  fs.rmSync(path.join(project.cwd, "CLAUDE.md"));
  if (!symlinkOrSkip(t, "AGENTS.md", path.join(project.cwd, "CLAUDE.md"), "file")) return;

  migrate(project.cwd);
  assert.equal(fs.readlinkSync(path.join(project.cwd, "CLAUDE.md")), "AGENTS.md");
  assert.equal(project.get("AGENTS.md"), `# Team notes\n\nKeep commits small.\n\n${SECTION}\n`);
});

test("migrate keeps CRLF line endings in instruction files", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  legacySetup(project);
  project.put("AGENTS.md", `# Team notes\r\n\r\n${LEGACY_SECTION.replaceAll("\n", "\r\n")}\r\n\r\nMore notes.\r\n`);

  migrate(project.cwd);
  assert.equal(project.get("AGENTS.md"), `# Team notes\r\n\r\n${renderPolicySection("\r\n")}\r\n\r\nMore notes.\r\n`);
});

test("rewriteLegacyText renames Prove paths and generated headings but not the verb", () => {
  assert.equal(
    rewriteLegacyText([
      "# Prove project context",
      "See `.prove/contracts/*.md` and [map](../.prove/FEATURE_MAP.md); ignore .prove-managed.json.",
      "The initializer scans existing Prove contracts.",
      "Use the `prove` skill.",
      "Prove that checkout totals match. Run proof.prove and example.prove/x."
    ].join("\r\n")),
    [
      "# GroundTruth project context",
      "See `.groundtruth/contracts/*.md` and [map](../.groundtruth/FEATURE_MAP.md); ignore .groundtruth-managed.json.",
      "The initializer scans existing GroundTruth contracts.",
      "Use the `groundtruth` skill.",
      "Prove that checkout totals match. Run proof.prove and example.prove/x."
    ].join("\r\n")
  );
});
