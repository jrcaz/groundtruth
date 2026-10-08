import fs from "node:fs";
import path from "node:path";
import { lineEnding, packageContent, POLICY_FILES, policyMarkerState, renderPolicySection } from "./content.js";
import { readBytes, readText, resolveLinkedFile, targetPath } from "./fs-safe.js";
import { hash, loadManifest } from "./manifest.js";
import type { FileWrite } from "./types.js";

// GroundTruth was called Prove before it was renamed. Prove kept its files in
// `.prove/`, installed a `prove` skill, and marked its section in the agent
// instruction files with `prove:managed` markers.
const LEGACY_DIRECTORY = ".prove";
const LEGACY_MANIFEST_PATH = ".prove/.prove-managed.json";
const LEGACY_TEMPLATE_PATH = ".prove/contracts/TEMPLATE.md";
const LEGACY_POLICY_START = "<!-- prove:managed:start -->";
const LEGACY_POLICY_END = "<!-- prove:managed:end -->";
const DIRECTORY = ".groundtruth";

// Skills Prove installed, mapped to the GroundTruth skill that replaces them.
const LEGACY_SKILLS: Readonly<Record<string, string>> = {
  ".agents/skills/prove/SKILL.md": ".agents/skills/groundtruth/SKILL.md",
  ".claude/skills/prove/SKILL.md": ".claude/skills/groundtruth/SKILL.md",
  ".agents/skills/feature-map/SKILL.md": ".agents/skills/feature-map/SKILL.md",
  ".claude/skills/feature-map/SKILL.md": ".claude/skills/feature-map/SKILL.md"
};
const LEGACY_SKILL_DIRECTORIES = [".agents/skills/prove", ".claude/skills/prove"];

export interface MigrationPlan {
  writes: FileWrite[];
  // Directories the writes leave empty, deepest first.
  emptied: string[];
  actions: string[];
}

// Also true for a symbolic link, so a linked `.prove/` is reported and then refused.
function exists(root: string, relativePath: string): boolean {
  try {
    fs.lstatSync(path.join(path.resolve(root), relativePath));
    return true;
  } catch {
    return false;
  }
}

// Instruction files to check, with links resolved and each target listed once.
function policyTargets(root: string): Array<{ path: string; content: string }> {
  const targets = new Map<string, string>();
  for (const relativePath of POLICY_FILES) {
    const target = resolveLinkedFile(root, relativePath).path;
    if (targets.has(target)) continue;
    const content = readText(root, target);
    if (content !== null) targets.set(target, content);
  }
  return [...targets].map(([target, content]) => ({ path: target, content }));
}

function hasLegacyMarkers(content: string): boolean {
  return content.includes(LEGACY_POLICY_START) || content.includes(LEGACY_POLICY_END);
}

// Lists what remains of a Prove setup. `migrate` converts everything listed
// here, and `init`, `update`, and `doctor` use it to send the user to `migrate`.
export function findLegacySetup(root: string): string[] {
  const found: string[] = [];
  if (exists(root, LEGACY_DIRECTORY)) found.push(`${LEGACY_DIRECTORY}/`);
  for (const directory of LEGACY_SKILL_DIRECTORIES) {
    if (exists(root, `${directory}/SKILL.md`)) found.push(`${directory}/SKILL.md`);
  }
  let targets: Array<{ path: string; content: string }> = [];
  try {
    targets = policyTargets(root);
  } catch {
    // doctor reports broken instruction links separately.
  }
  for (const target of targets) {
    if (hasLegacyMarkers(target.content)) found.push(`${target.path} Prove section`);
  }
  return found;
}

// Renames Prove paths and the generated Prove headings in a moved Markdown file.
// "Prove" is also a verb, so other uses of the word are left alone.
export function rewriteLegacyText(content: string): string {
  return content
    .replace(/(?<![\w.-])\.prove(?!\w)/g, DIRECTORY)
    .replace(/^# Prove project context(?=\r?$)/gm, "# GroundTruth project context")
    .replace(/existing Prove contracts/g, "existing GroundTruth contracts")
    .replace(/`prove` skill/g, "`groundtruth` skill");
}

function listFiles(root: string, directory: string, files: string[], directories: string[]): void {
  directories.push(directory);
  for (const name of fs.readdirSync(targetPath(root, directory)).sort()) {
    const child = `${directory}/${name}`;
    const stat = fs.lstatSync(targetPath(root, child));
    if (stat.isDirectory()) listFiles(root, child, files, directories);
    else if (stat.isFile()) files.push(child);
    else throw new Error(`${child} is not a regular file or directory. Move it out of ${LEGACY_DIRECTORY}/, then run the command again.`);
  }
}

function removeSection(content: string, start: string, end: string, eol: string): string {
  let before = content.slice(0, content.indexOf(start));
  let after = content.slice(content.indexOf(end) + end.length);
  if (after.startsWith(eol)) after = after.slice(eol.length);
  if (!before) while (after.startsWith(eol)) after = after.slice(eol.length);
  else if (before.endsWith(eol + eol)) before = before.slice(0, -eol.length);
  return before + after;
}

// Plans every change needed to turn a Prove setup into the files GroundTruth
// expects. Throws, listing every problem, if any file cannot be migrated safely.
export function planMigration(root: string): MigrationPlan {
  const legacyManifest = loadManifest(root, LEGACY_MANIFEST_PATH);
  const unedited = (relativePath: string, content: Buffer): boolean =>
    legacyManifest.managed[relativePath] === hash(content);
  const writes: FileWrite[] = [];
  const emptied: string[] = [];
  const actions: string[] = [];
  const problems: string[] = [];

  const files: string[] = [];
  const directories: string[] = [];
  if (exists(root, LEGACY_DIRECTORY)) listFiles(root, LEGACY_DIRECTORY, files, directories);
  for (const file of files) {
    const content = readBytes(root, file) ?? Buffer.alloc(0);
    if (file === LEGACY_MANIFEST_PATH) {
      writes.push({ path: file, content: null });
      continue;
    }
    if (file === LEGACY_TEMPLATE_PATH && unedited(file, content)) {
      writes.push({ path: file, content: null });
      actions.push(`removed ${file}; it was never edited, so the current template replaces it`);
      continue;
    }
    const destination = DIRECTORY + file.slice(LEGACY_DIRECTORY.length);
    const migrated = /\.md$/i.test(file) ? Buffer.from(rewriteLegacyText(content.toString("utf8")), "utf8") : content;
    const existing = readBytes(root, destination);
    if (existing === null) {
      writes.push({ path: destination, content: migrated }, { path: file, content: null });
      actions.push(`moved ${file} to ${destination}`);
    } else if (existing.equals(migrated)) {
      writes.push({ path: file, content: null });
      actions.push(`removed ${file}; ${destination} already has the same content`);
    } else {
      problems.push(`${destination} already exists and differs from ${file}. Keep one of them: delete or rename the other.`);
    }
  }
  emptied.push(...directories.reverse());

  for (const [skill, replacement] of Object.entries(LEGACY_SKILLS)) {
    const content = readBytes(root, skill);
    if (content === null) continue;
    if (skill === replacement && content.equals(Buffer.from(packageContent(replacement), "utf8"))) continue;
    if (unedited(skill, content)) {
      writes.push({ path: skill, content: null });
      actions.push(`removed ${skill}`);
    } else {
      problems.push(`${skill} has local edits, or Prove has no record of installing it. Copy your edits somewhere safe and delete the file. After migrating, add them to ${replacement}.`);
    }
  }
  emptied.push(...LEGACY_SKILL_DIRECTORIES);

  for (const target of policyTargets(root)) {
    const { content } = target;
    const legacyState = policyMarkerState(content, LEGACY_POLICY_START, LEGACY_POLICY_END);
    if (legacyState === "absent") continue;
    const state = policyMarkerState(content);
    if (legacyState === "invalid") {
      problems.push(`${target.path} has incomplete, repeated, or out-of-order Prove markers. Remove the old Prove section by hand.`);
    } else if (state === "invalid") {
      problems.push(`${target.path} has incomplete, repeated, or out-of-order GroundTruth markers. Resolve them by hand.`);
    } else if (state === "valid") {
      writes.push({ path: target.path, content: removeSection(content, LEGACY_POLICY_START, LEGACY_POLICY_END, lineEnding(content)) });
      actions.push(`removed the Prove section from ${target.path}; it already has a GroundTruth section`);
    } else {
      // Put the new section where the old one was.
      const start = content.indexOf(LEGACY_POLICY_START);
      const end = content.indexOf(LEGACY_POLICY_END) + LEGACY_POLICY_END.length;
      writes.push({ path: target.path, content: content.slice(0, start) + renderPolicySection(lineEnding(content)) + content.slice(end) });
      actions.push(`replaced the Prove section in ${target.path} with the GroundTruth section`);
    }
  }

  if (problems.length) {
    throw new Error(`Cannot migrate this Prove setup yet. No files were changed.\n${problems.map((problem) => `- ${problem}`).join("\n")}\nFix these, then run \`groundtruth migrate\` again.`);
  }
  return { writes, emptied, actions };
}
