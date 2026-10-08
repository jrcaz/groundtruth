import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import { errorCode } from "../src/fs-safe.js";

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
