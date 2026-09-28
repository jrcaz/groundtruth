import { createHash } from "node:crypto";
import { MANIFEST_PATH } from "./constants.js";
import { readText, writeText } from "./fs-safe.js";

export function hash(content) {
  return createHash("sha256").update(content).digest("hex");
}

export function loadManifest(root) {
  const raw = readText(root, MANIFEST_PATH);
  if (raw === null) return { version: 1, managed: {} };
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch {
    throw new Error(`Cannot read ${MANIFEST_PATH}: invalid JSON. Move or repair it before continuing.`);
  }
  if (manifest.version !== 1 || !manifest.managed || typeof manifest.managed !== "object" || Array.isArray(manifest.managed)) {
    throw new Error(`Cannot read ${MANIFEST_PATH}: unsupported manifest format.`);
  }
  return manifest;
}

export function saveManifest(root, manifest) {
  writeText(root, MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
}
