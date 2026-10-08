import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ManagedKind } from "./types.js";

// Compiled files live in dist/src, so the package root is two levels up.
export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const MANIFEST_PATH = ".groundtruth/.groundtruth-managed.json";
export const FEATURE_MAP_PATH = ".groundtruth/FEATURE_MAP.md";
export const POLICY_START = "<!-- groundtruth:managed:start -->";
export const POLICY_END = "<!-- groundtruth:managed:end -->";

export const MANAGED_CONTENT: Readonly<Record<string, ManagedKind>> = {
  ".agents/skills/groundtruth/SKILL.md": "skill",
  ".claude/skills/groundtruth/SKILL.md": "skill",
  ".agents/skills/feature-map/SKILL.md": "skill",
  ".claude/skills/feature-map/SKILL.md": "skill",
  ".groundtruth/contracts/TEMPLATE.md": "contract-template"
};
