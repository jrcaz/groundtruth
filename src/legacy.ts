import fs from "node:fs";
import path from "node:path";
import { lineEnding, planManagedContent, planPolicies, POLICY_FILES, policyMarkerState, renderPolicySection } from "./content.js";
import { readBytes, readText, resolveLinkedFile, targetPath } from "./fs-safe.js";
import { hash, loadManifest } from "./manifest.js";
import type { FileWrite, Manifest } from "./types.js";

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
const FEATURE_MAP_SKILLS = [".agents/skills/feature-map/SKILL.md", ".claude/skills/feature-map/SKILL.md"];

export interface MigrationPlan {
  writes: FileWrite[];
  // Directories the writes leave empty, deepest first.
  emptied: string[];
  actions: string[];
}

// Does not follow symbolic links, so a linked `.prove/` is reported and then refused.
function lstat(root: string, relativePath: string): fs.Stats | null {
  try {
    return fs.lstatSync(path.join(path.resolve(root), relativePath));
  } catch {
    return null;
  }
}

// A plain file named `.prove` belongs to another tool, such as Perl's `prove`.
function hasLegacyDirectory(root: string): boolean {
  const stat = lstat(root, LEGACY_DIRECTORY);
  return stat !== null && (stat.isDirectory() || stat.isSymbolicLink());
}

// A feature-map skill that still points agents at `.prove/` came from Prove.
function isLegacyFeatureMapSkill(content: Buffer): boolean {
  return content.includes(`${LEGACY_DIRECTORY}/`);
}

// Instruction files to check, with links resolved and each target listed once.
function policyTargets(root: string, { skipBroken = false } = {}): Array<{ path: string; content: string }> {
  const targets = new Map<string, string>();
  for (const relativePath of POLICY_FILES) {
    let target: string;
    let content: string | null;
    try {
      target = resolveLinkedFile(root, relativePath).path;
      if (targets.has(target)) continue;
      content = readText(root, target);
    } catch (error) {
      if (skipBroken) continue;
      throw error;
    }
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
  if (hasLegacyDirectory(root)) found.push(`${LEGACY_DIRECTORY}/`);
  for (const directory of LEGACY_SKILL_DIRECTORIES) {
    if (lstat(root, `${directory}/SKILL.md`)) found.push(`${directory}/SKILL.md`);
  }
  for (const skill of FEATURE_MAP_SKILLS) {
    let content: Buffer | null = null;
    try {
      content = readBytes(root, skill);
    } catch {
      // doctor reports linked skill paths separately.
    }
    if (content && isLegacyFeatureMapSkill(content)) found.push(skill);
  }
  // doctor reports broken instruction links separately.
  for (const target of policyTargets(root, { skipBroken: true })) {
    if (hasLegacyMarkers(target.content)) found.push(`${target.path} Prove section`);
  }
  return found;
}

// Renames Prove paths and the generated Prove headings in a moved Markdown file.
// "Prove" is also a verb, so other uses of the word are left alone.
export function rewriteLegacyText(content: string): string {
  return content
    .replace(/(?<![\w.-])\.prove(?!\w|[.-]\w)/g, DIRECTORY)
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

// Removes a marked section and the blank line that separated it, keeping the
// text on both sides in separate paragraphs.
function removeSection(content: string, start: string, end: string, eol: string): string {
  let before = content.slice(0, content.indexOf(start));
  let after = content.slice(content.indexOf(end) + end.length);
  if (after.startsWith(eol)) after = after.slice(eol.length);
  if (!before) while (after.startsWith(eol)) after = after.slice(eol.length);
  else if (before.endsWith(eol + eol) && (!after || after.startsWith(eol))) before = before.slice(0, -eol.length);
  return before + after;
}

// Rewrites a moved Markdown file. A file that is not valid UTF-8 would be damaged
// by decoding, so it moves unchanged.
function migrateContent(file: string, content: Buffer): { content: Buffer; rewritten: boolean } {
  if (!/\.md$/i.test(file)) return { content, rewritten: true };
  const text = content.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(content)) return { content, rewritten: false };
  return { content: Buffer.from(rewriteLegacyText(text), "utf8"), rewritten: true };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message.replace(/; no content was changed\.$/, ".") : String(error);
}

// Plans every change needed to turn a Prove setup into the files GroundTruth
// expects. Throws, listing every problem, if any file cannot be migrated safely.
export function planMigration(root: string): MigrationPlan {
  const hasDirectory = hasLegacyDirectory(root);
  const legacyManifest: Manifest = hasDirectory ? loadManifest(root, LEGACY_MANIFEST_PATH) : { version: 1, managed: {} };
  const unedited = (relativePath: string, content: Buffer): boolean => {
    const recorded = legacyManifest.managed[relativePath];
    // A checkout with Windows line endings changes the hash, not the file.
    return recorded !== undefined && (recorded === hash(content) || recorded === hash(content.toString("utf8").replace(/\r\n/g, "\n")));
  };
  const writes: FileWrite[] = [];
  const emptied: string[] = [];
  const actions: string[] = [];
  const problems: string[] = [];

  // migrate runs init after moving the files. Check now what would stop init,
  // so a migration is not left half done. Moving the files does not change these checks.
  try {
    planManagedContent(root, loadManifest(root));
    planPolicies(root);
  } catch (error) {
    problems.push(message(error));
  }

  const files: string[] = [];
  const directories: string[] = [];
  if (hasDirectory) listFiles(root, LEGACY_DIRECTORY, files, directories);
  for (const file of files) {
    if (file === LEGACY_MANIFEST_PATH) continue;
    const content = readBytes(root, file) ?? Buffer.alloc(0);
    if (file === LEGACY_TEMPLATE_PATH && unedited(file, content)) {
      writes.push({ path: file, content: null });
      actions.push(`removed ${file}; it was never edited, so the current template replaces it`);
      continue;
    }
    const destination = DIRECTORY + file.slice(LEGACY_DIRECTORY.length);
    const { content: migrated, rewritten } = migrateContent(file, content);
    const existing = readBytes(root, destination);
    if (existing === null) {
      writes.push({ path: destination, content: migrated }, { path: file, content: null });
      actions.push(rewritten ? `moved ${file} to ${destination}` : `moved ${file} to ${destination} unchanged; it is not UTF-8 text, so Prove paths inside it were not renamed`);
    } else if (existing.equals(migrated)) {
      writes.push({ path: file, content: null });
      actions.push(`removed ${file}; ${destination} already has the same content`);
    } else {
      problems.push(`${destination} already exists and differs from ${file}. Keep one of them: delete or rename the other.`);
    }
  }
  // The old manifest goes last, so an interrupted migration can still tell which files were never edited.
  if (files.includes(LEGACY_MANIFEST_PATH)) writes.push({ path: LEGACY_MANIFEST_PATH, content: null });
  emptied.push(...directories.reverse());

  for (const [skill, replacement] of Object.entries(LEGACY_SKILLS)) {
    const content = readBytes(root, skill);
    if (content === null) continue;
    // A feature-map skill that does not point at `.prove/` is not Prove's; init handles it.
    if (skill === replacement && !isLegacyFeatureMapSkill(content)) continue;
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
    const state = policyMarkerState(content);
    // Broken GroundTruth markers are reported by the init check above.
    if (legacyState === "absent" || state === "invalid") continue;
    if (legacyState === "invalid") {
      problems.push(`${target.path} has incomplete, repeated, or out-of-order Prove markers. Remove the old Prove section by hand.`);
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
