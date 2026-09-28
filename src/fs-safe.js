import fs from "node:fs";
import path from "node:path";

export function targetPath(root, relativePath, { allowMissing = true } = {}) {
  const absoluteRoot = path.resolve(root);
  const absoluteTarget = path.resolve(absoluteRoot, relativePath);
  if (absoluteTarget !== absoluteRoot && !absoluteTarget.startsWith(`${absoluteRoot}${path.sep}`)) {
    throw new Error(`Refusing to access a path outside the project: ${relativePath}`);
  }

  let current = absoluteRoot;
  const pieces = path.relative(absoluteRoot, absoluteTarget).split(path.sep);
  for (const [index, piece] of pieces.entries()) {
    current = path.join(current, piece);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) {
        throw new Error(`Refusing to follow a symbolic link: ${path.relative(absoluteRoot, current)}`);
      }
      if (index < pieces.length - 1 && !stat.isDirectory()) {
        throw new Error(`Expected a directory at ${path.relative(absoluteRoot, current)}`);
      }
    } catch (error) {
      if (error.code === "ENOENT" && allowMissing) continue;
      throw error;
    }
  }
  return absoluteTarget;
}

export function readText(root, relativePath) {
  const absolutePath = targetPath(root, relativePath);
  try {
    return fs.readFileSync(absolutePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export function writeText(root, relativePath, content) {
  const absolutePath = targetPath(root, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  targetPath(root, relativePath);
  const temporaryPath = `${absolutePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, content, { flag: "wx" });
    fs.renameSync(temporaryPath, absolutePath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}

export function exists(root, relativePath) {
  try {
    return fs.existsSync(targetPath(root, relativePath));
  } catch (error) {
    if (error.message.startsWith("Refusing to follow a symbolic link:")) return false;
    throw error;
  }
}
