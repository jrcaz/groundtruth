import fs from "node:fs";
import path from "node:path";
import type { FileWrite, LinkedFile } from "./types.js";

export function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

export function targetPath(root: string, relativePath: string, { allowMissing = true }: { allowMissing?: boolean } = {}): string {
  const absoluteRoot = path.resolve(root);
  const absoluteTarget = path.resolve(absoluteRoot, relativePath);
  if (absoluteTarget === absoluteRoot) return absoluteRoot;
  if (!absoluteTarget.startsWith(`${absoluteRoot}${path.sep}`)) {
    throw new Error(`Refusing to access a path outside the project: ${relativePath}`);
  }

  let current = absoluteRoot;
  const pieces = path.relative(absoluteRoot, absoluteTarget).split(path.sep);
  for (const [index, piece] of pieces.entries()) {
    current = path.join(current, piece);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) {
        throw new Error(`Refusing to follow a symbolic link: ${toPosix(path.relative(absoluteRoot, current))}. GroundTruth only writes real files and directories inside the project. Replace the link with a regular file or directory, then run the command again.`);
      }
      if (index < pieces.length - 1 && !stat.isDirectory()) {
        throw new Error(`Expected a directory at ${toPosix(path.relative(absoluteRoot, current))}, but found a file. Move it aside, then run the command again.`);
      }
    } catch (error) {
      if (errorCode(error) === "ENOENT" && allowMissing) continue;
      throw error;
    }
  }
  return absoluteTarget;
}

export function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

// Resolves a symbolic link to the regular file it points to inside the project.
// Used only for agent instruction files, which are commonly linked to each other
// (for example CLAUDE.md -> AGENTS.md). Everything else refuses symbolic links.
export function resolveLinkedFile(root: string, relativePath: string): LinkedFile {
  const absolutePath = path.join(path.resolve(root), relativePath);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(absolutePath);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { path: relativePath };
    throw error;
  }
  if (!stat.isSymbolicLink()) return { path: relativePath };

  let realTarget: string;
  try {
    realTarget = fs.realpathSync(absolutePath);
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT" || code === "ELOOP") {
      throw new Error(`${relativePath} is a symbolic link to a missing file. Create the target or replace the link with a regular file, then run the command again.`);
    }
    throw error;
  }
  const relativeTarget = path.relative(fs.realpathSync(path.resolve(root)), realTarget);
  if (!relativeTarget || relativeTarget === ".." || relativeTarget.startsWith(`..${path.sep}`) || path.isAbsolute(relativeTarget)) {
    throw new Error(`${relativePath} is a symbolic link to a file outside the project. GroundTruth will not edit it. Replace the link with a regular file, then run the command again.`);
  }
  if (!fs.statSync(realTarget).isFile()) {
    throw new Error(`${relativePath} is a symbolic link to something other than a regular file. Replace the link with a regular file, then run the command again.`);
  }
  return { path: toPosix(relativeTarget), linkedFrom: relativePath };
}

export function readBytes(root: string, relativePath: string): Buffer | null {
  const absolutePath = targetPath(root, relativePath);
  try {
    return fs.readFileSync(absolutePath);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}

export function readText(root: string, relativePath: string): string | null {
  return readBytes(root, relativePath)?.toString("utf8") ?? null;
}

function removeEmptyDirectories(fromDirectory: string, stopAt: string): void {
  let current = fromDirectory;
  while (current === stopAt || current.startsWith(`${stopAt}${path.sep}`)) {
    try {
      fs.rmdirSync(current);
    } catch {
      return;
    }
    if (current === stopAt) return;
    current = path.dirname(current);
  }
}

function firstMissingDirectory(root: string, directory: string): string | undefined {
  const absoluteRoot = path.resolve(root);
  let current = path.resolve(directory);
  let firstMissing: string | undefined;
  while (current !== absoluteRoot) {
    try {
      fs.lstatSync(current);
      break;
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
      firstMissing = current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return firstMissing;
}

// Writes atomically. Returns the first directory this call created, if any.
export function writeText(root: string, relativePath: string, content: string | Uint8Array): string | undefined {
  const absolutePath = targetPath(root, relativePath);
  const createdDirectory = firstMissingDirectory(root, path.dirname(absolutePath));
  const temporaryPath = `${absolutePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    targetPath(root, relativePath);
    fs.writeFileSync(temporaryPath, content, { flag: "wx" });
    fs.renameSync(temporaryPath, absolutePath);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    if (createdDirectory) removeEmptyDirectories(path.dirname(absolutePath), createdDirectory);
    throw error;
  }
  return createdDirectory;
}

// Removes a directory inside the project if it is empty.
export function removeEmptyDirectory(root: string, relativePath: string): "removed" | "missing" | "kept" {
  try {
    fs.rmdirSync(targetPath(root, relativePath, { allowMissing: false }));
    return "removed";
  } catch (error) {
    return errorCode(error) === "ENOENT" ? "missing" : "kept";
  }
}

interface AppliedWrite {
  relativePath: string;
  previous: Buffer | null;
  createdDirectory: string | undefined;
}

function isCurrent(previous: Buffer | null, content: FileWrite["content"]): boolean {
  if (content === null || previous === null) return content === previous;
  return previous.equals(typeof content === "string" ? Buffer.from(content, "utf8") : content);
}

// Applies every write or none of them. A write whose content is null removes the
// file. If a write fails, files changed or removed earlier are restored to their
// previous content, new files are removed, and directories created along the
// way are removed if they are empty.
export function applyWrites(root: string, writes: readonly FileWrite[]): void {
  const applied: AppliedWrite[] = [];
  try {
    for (const { path: relativePath, content } of writes) {
      const previous = readBytes(root, relativePath);
      if (isCurrent(previous, content)) continue;
      if (content === null) {
        fs.rmSync(targetPath(root, relativePath));
        applied.push({ relativePath, previous, createdDirectory: undefined });
        continue;
      }
      const createdDirectory = writeText(root, relativePath, content);
      applied.push({ relativePath, previous, createdDirectory });
    }
  } catch (error) {
    const failures: string[] = [];
    for (const { relativePath, previous, createdDirectory } of applied.reverse()) {
      try {
        const absolutePath = targetPath(root, relativePath);
        if (previous === null) fs.rmSync(absolutePath, { force: true });
        else writeText(root, relativePath, previous);
        if (createdDirectory) removeEmptyDirectories(path.dirname(absolutePath), createdDirectory);
      } catch {
        failures.push(relativePath);
      }
    }
    if (error instanceof Error) {
      if (!/[.!?]$/.test(error.message)) error.message += ".";
      error.message += failures.length
        ? ` Some changes could not be undone: ${failures.join(", ")}.`
        : " No files were changed.";
    }
    throw error;
  }
}
