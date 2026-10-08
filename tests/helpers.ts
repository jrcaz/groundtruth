import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import { errorCode } from "../src/fs-safe.js";
import { hash } from "../src/manifest.js";

export interface TemporaryProject {
  cwd: string;
  clean: () => void;
  put: (relativePath: string, content: string) => void;
  get: (relativePath: string) => string;
  exists: (relativePath: string) => boolean;
}

export function temporaryProject(): TemporaryProject {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "groundtruth-cli-test-"));
  return {
    cwd,
    clean: () => fs.rmSync(cwd, { recursive: true, force: true }),
    put(relativePath: string, content: string) {
      const target = path.join(cwd, relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    },
    get(relativePath: string) {
      return fs.readFileSync(path.join(cwd, relativePath), "utf8");
    },
    exists(relativePath: string) {
      try {
        fs.lstatSync(path.join(cwd, relativePath));
        return true;
      } catch {
        return false;
      }
    }
  };
}

// Captures every file, directory, and link under `root` so a test can assert
// that a failed command left the project exactly as it was.
export function snapshot(root: string): Record<string, string> {
  const entries: Record<string, string> = {};
  const walk = (relative: string): void => {
    const absolute = path.join(root, relative);
    for (const name of fs.readdirSync(absolute).sort()) {
      const childRelative = relative ? `${relative}/${name}` : name;
      const childAbsolute = path.join(absolute, name);
      const stat = fs.lstatSync(childAbsolute);
      if (stat.isSymbolicLink()) {
        entries[childRelative] = `link -> ${fs.readlinkSync(childAbsolute)}`;
      } else if (stat.isDirectory()) {
        entries[childRelative] = "directory";
        walk(childRelative);
      } else {
        entries[childRelative] = fs.readFileSync(childAbsolute, "utf8");
      }
    }
  };
  walk("");
  return entries;
}

// Creating symbolic links needs extra privileges on some Windows setups.
export function symlinkOrSkip(t: TestContext, target: string, linkPath: string, type: "file" | "dir"): boolean {
  try {
    fs.symlinkSync(target, linkPath, type);
    return true;
  } catch (error) {
    const code = errorCode(error);
    if (code !== "EPERM" && code !== "EACCES") throw error;
    t.skip(`symbolic links are not available here (${code})`);
    return false;
  }
}

// Permission-based failure tests need POSIX permissions and a non-root user.
export function canTestPermissions(): boolean {
  return process.platform !== "win32" && process.getuid?.() !== 0;
}

export function silent(): void {}

export const LEGACY_START = "<!-- prove:managed:start -->";
export const LEGACY_END = "<!-- prove:managed:end -->";
export const LEGACY_SECTION = [LEGACY_START, "## Definition of done: prove the change", "", "1. Use the `prove` skill and read `.prove/PROJECT.md`.", LEGACY_END].join("\n");

// Recreates what `prove init` left in a project. The old manifest records the
// hashes of the shared files, so they count as never edited. The first Prove
// version had no feature map, which `featureMap: false` reproduces.
export function legacySetup(project: TemporaryProject, { featureMap = true } = {}): void {
  const skill = "---\nname: prove\n---\n\n# Prove\n\nRead `.prove/PROJECT.md`.\n";
  const mapSkill = "---\nname: feature-map\n---\n\nMaintain `.prove/FEATURE_MAP.md`.\n";
  const managed: Record<string, string> = {
    ".agents/skills/prove/SKILL.md": skill,
    ".claude/skills/prove/SKILL.md": skill,
    ".prove/contracts/TEMPLATE.md": "# Contract: [capability]\n",
    ...(featureMap ? { ".agents/skills/feature-map/SKILL.md": mapSkill, ".claude/skills/feature-map/SKILL.md": mapSkill } : {})
  };
  for (const [relativePath, content] of Object.entries(managed)) project.put(relativePath, content);
  const hashes = Object.fromEntries(Object.entries(managed).map(([relativePath, content]) => [relativePath, hash(content)]));
  project.put(".prove/.prove-managed.json", `${JSON.stringify({ version: 1, managed: hashes }, null, 2)}\n`);
  project.put(".prove/PROJECT.md", "# Prove project context\n\nStart the app with `npm run dev`.\nRead `.prove/FEATURE_MAP.md` for capabilities.\n");
  if (featureMap) project.put(".prove/FEATURE_MAP.md", "# Feature map\n\n- Login, `authentication.login`, implemented\n  - Contracts: [Login](contracts/login.md)\n");
  project.put(".prove/contracts/login.md", "# Contract: Login\n\nProve that a locked account cannot sign in.\n");
  project.put("AGENTS.md", `# Team notes\n\nKeep commits small.\n\n${LEGACY_SECTION}\n`);
  project.put("CLAUDE.md", `${LEGACY_SECTION}\n`);
}
