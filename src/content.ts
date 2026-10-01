import fs from "node:fs";
import path from "node:path";
import { MANAGED_CONTENT, PACKAGE_ROOT, POLICY_END, POLICY_START } from "./constants.js";
import { readText, resolveLinkedFile, targetPath } from "./fs-safe.js";
import { hash } from "./manifest.js";
import type {
  FileWrite,
  LinkedFile,
  ManagedInspection,
  ManagedOutcome,
  Manifest,
  PolicyInspectionStatus,
  PolicyMarkerState,
  PolicyPlan
} from "./types.js";

export const POLICY_FILES = ["AGENTS.md", "CLAUDE.md"] as const;

const POLICY_LINES = [
  POLICY_START,
  "## Definition of done: prove the change",
  "",
  "Implementation and bug-fix work is not complete until the affected behavior has been verified.",
  "",
  "1. Use the `prove` skill and read `.prove/PROJECT.md` and `.prove/FEATURE_MAP.md`.",
  "2. Identify affected capabilities in the feature map and read their linked contracts, plus relevant `.prove/contracts/*.md` files.",
  "3. Exercise the affected behavior with the repository's existing verification tools.",
  "4. Fix failures and repeat the checks. Report what passed and what remains unverified.",
  "",
  "For a new critical business capability, define or update its contract before implementation. Never weaken a contract only to make an implementation pass.",
  "",
  "Use the `feature-map` skill to generate or update `.prove/FEATURE_MAP.md` from the current application. Complete a starter map by inspecting the implementation. After adding, changing, or removing capabilities, update the affected map entries and contract links.",
  POLICY_END
];

export function packageContent(relativePath: string): string {
  const templates: Readonly<Record<string, string>> = {
    ".agents/skills/prove/SKILL.md": "SKILL.md",
    ".claude/skills/prove/SKILL.md": "SKILL.md",
    ".agents/skills/feature-map/SKILL.md": "FEATURE_MAP_SKILL.md",
    ".claude/skills/feature-map/SKILL.md": "FEATURE_MAP_SKILL.md",
    ".prove/contracts/TEMPLATE.md": "CONTRACT_TEMPLATE.md"
  };
  const template = templates[relativePath];
  if (!template) throw new Error(`No bundled template for ${relativePath}`);
  return fs.readFileSync(path.join(PACKAGE_ROOT, "templates", template), "utf8");
}

// "absent": no markers. "valid": exactly one start marker followed by one end marker.
// "invalid": anything else (unpaired, repeated, or out of order).
export function policyMarkerState(content: string): PolicyMarkerState {
  const startCount = content.split(POLICY_START).length - 1;
  const endCount = content.split(POLICY_END).length - 1;
  if (startCount === 0 && endCount === 0) return "absent";
  if (startCount === 1 && endCount === 1 && content.indexOf(POLICY_START) < content.indexOf(POLICY_END)) return "valid";
  return "invalid";
}

export function renderPolicy(current: string, relativePath: string): string {
  const state = policyMarkerState(current);
  if (state === "invalid") {
    throw new Error(`${relativePath} has incomplete, repeated, or out-of-order Prove markers. Resolve them manually; no content was changed.`);
  }
  const eol = current.includes("\r\n") ? "\r\n" : "\n";
  const policy = POLICY_LINES.join(eol);
  if (state === "valid") {
    const start = current.indexOf(POLICY_START);
    const end = current.indexOf(POLICY_END) + POLICY_END.length;
    return `${current.slice(0, start)}${policy}${current.slice(end)}`;
  }
  return `${current}${current && !current.endsWith("\n") ? eol : ""}${current ? eol : ""}${policy}${eol}`;
}

// Plans the Prove section for each agent instruction file. A file that is a
// symbolic link to another file in the project is edited through its target,
// and two links to the same file share one section.
export function planPolicies(root: string): PolicyPlan[] {
  const plans: PolicyPlan[] = [];
  const handled = new Map<string, string>();
  for (const relativePath of POLICY_FILES) {
    const target = resolveLinkedFile(root, relativePath);
    if (target.linkedFrom && (target.path in MANAGED_CONTENT || target.path.startsWith(".prove/"))) {
      throw new Error(`${relativePath} is a symbolic link to ${target.path}, which Prove manages separately. Point it at a regular instructions file, then run the command again.`);
    }
    const sharedWith = handled.get(target.path);
    if (sharedWith) {
      plans.push({ path: relativePath, target: target.path, sharedWith, changed: false });
      continue;
    }
    handled.set(target.path, relativePath);
    const current = readText(root, target.path) ?? "";
    const updated = renderPolicy(current, relativePath);
    plans.push({ path: relativePath, target: target.path, content: updated, changed: updated !== current });
  }
  return plans;
}

export function inspectPolicy(root: string, relativePath: string): PolicyInspectionStatus {
  let content: string | null;
  try {
    const target: LinkedFile = resolveLinkedFile(root, relativePath);
    content = readText(root, target.path);
  } catch {
    return "blocked";
  }
  if (content === null) return "missing";
  const state = policyMarkerState(content);
  return state === "absent" ? "missing" : state;
}

// Plans managed file changes and records the new hashes in `manifest`.
export function planManagedContent(root: string, manifest: Manifest): { outcomes: ManagedOutcome[]; writes: FileWrite[] } {
  const outcomes: ManagedOutcome[] = [];
  const writes: FileWrite[] = [];

  for (const relativePath of Object.keys(MANAGED_CONTENT)) {
    const desired = packageContent(relativePath);
    const current = readText(root, relativePath);
    const priorHash = manifest.managed[relativePath];

    if (current === null) {
      writes.push({ path: relativePath, content: desired });
      manifest.managed[relativePath] = hash(desired);
      outcomes.push({ path: relativePath, status: "created" });
      continue;
    }

    if (!priorHash) {
      if (hash(current) === hash(desired)) {
        manifest.managed[relativePath] = hash(current);
        outcomes.push({ path: relativePath, status: "registered" });
      } else {
        outcomes.push({ path: relativePath, status: "preserved-unmanaged" });
      }
      continue;
    }

    if (hash(current) !== priorHash) {
      outcomes.push({ path: relativePath, status: "preserved-customized" });
      continue;
    }

    if (hash(current) !== hash(desired)) {
      writes.push({ path: relativePath, content: desired });
      outcomes.push({ path: relativePath, status: "updated" });
    } else {
      outcomes.push({ path: relativePath, status: "current" });
    }
    manifest.managed[relativePath] = hash(desired);
  }

  return { outcomes, writes };
}

export function inspectManagedContent(root: string, manifest: Manifest): ManagedInspection[] {
  return Object.entries(MANAGED_CONTENT).map(([relativePath, kind]): ManagedInspection => {
    let content: string | null;
    try {
      content = readText(root, relativePath);
    } catch {
      return { path: relativePath, kind, status: "blocked" };
    }
    if (content === null) return { path: relativePath, kind, status: "missing" };
    const recorded = manifest.managed[relativePath];
    if (!recorded) return { path: relativePath, kind, status: "present-unmanaged" };
    return { path: relativePath, kind, status: hash(content) === recorded ? "managed" : "customized" };
  });
}

export function isRegularFile(root: string, relativePath: string): boolean {
  try {
    const stat = fs.lstatSync(targetPath(root, relativePath));
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}
