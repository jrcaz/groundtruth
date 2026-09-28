import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MANAGED_CONTENT, POLICY_END, POLICY_START } from "./constants.js";
import { readText, targetPath, writeText } from "./fs-safe.js";
import { hash, loadManifest, saveManifest } from "./manifest.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function packageContent(relativePath) {
  const template = relativePath === ".prove/contracts/TEMPLATE.md" ? "CONTRACT_TEMPLATE.md" : "SKILL.md";
  return fs.readFileSync(path.join(packageRoot, "templates", template), "utf8");
}

export function upsertPolicy(root, relativePath) {
  const current = readText(root, relativePath) ?? "";
  const startCount = current.split(POLICY_START).length - 1;
  const endCount = current.split(POLICY_END).length - 1;
  if (startCount !== endCount || startCount > 1) {
    throw new Error(`${relativePath} has incomplete or repeated Prove markers. Resolve them manually; no content was changed.`);
  }
  const policy = [
    POLICY_START,
    "## Definition of done: prove the change",
    "",
    "Implementation and bug-fix work is not complete until the affected behavior has been verified.",
    "",
    "1. Use the `prove` skill and read `.prove/PROJECT.md`.",
    "2. Read relevant `.prove/contracts/*.md` files before changing covered behavior.",
    "3. Exercise the affected behavior with the repository's existing verification tools.",
    "4. Fix failures and repeat the checks. Report what passed and what remains unverified.",
    "",
    "For a new critical business capability, define or update its contract before implementation. Never weaken a contract only to make an implementation pass.",
    POLICY_END
  ].join("\n");

  let updated;
  if (startCount === 1) {
    const start = current.indexOf(POLICY_START);
    const end = current.indexOf(POLICY_END) + POLICY_END.length;
    updated = `${current.slice(0, start)}${policy}${current.slice(end)}`;
  } else {
    updated = `${current}${current && !current.endsWith("\n") ? "\n" : ""}${current ? "\n" : ""}${policy}\n`;
  }
  if (updated !== current) writeText(root, relativePath, updated);
  return updated !== current;
}

export function installManagedContent(root) {
  const manifest = loadManifest(root);
  const outcomes = [];

  for (const [relativePath] of Object.entries(MANAGED_CONTENT)) {
    const desired = packageContent(relativePath);
    const current = readText(root, relativePath);
    const priorHash = manifest.managed[relativePath];

    if (current === null) {
      writeText(root, relativePath, desired);
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
      writeText(root, relativePath, desired);
      outcomes.push({ path: relativePath, status: "updated" });
    } else {
      outcomes.push({ path: relativePath, status: "current" });
    }
    manifest.managed[relativePath] = hash(desired);
  }

  saveManifest(root, manifest);
  return outcomes;
}

export function inspectManagedContent(root) {
  const manifest = loadManifest(root);
  return Object.entries(MANAGED_CONTENT).map(([relativePath, kind]) => {
    let content;
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

export function isRegularFile(root, relativePath) {
  try {
    const stat = fs.lstatSync(targetPath(root, relativePath));
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}
