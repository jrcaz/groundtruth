import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ManagedKind } from "./types.js";

// Compiled files live in dist/src, so the package root is two levels up.
export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const MANIFEST_PATH = ".prove/.prove-managed.json";
export const POLICY_START = "<!-- prove:managed:start -->";
export const POLICY_END = "<!-- prove:managed:end -->";

export const MANAGED_CONTENT: Readonly<Record<string, ManagedKind>> = {
  ".agents/skills/prove/SKILL.md": "skill",
  ".claude/skills/prove/SKILL.md": "skill",
  ".prove/contracts/TEMPLATE.md": "contract-template"
};
