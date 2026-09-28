import { createHash } from "node:crypto";
import { MANIFEST_PATH } from "./constants.js";
import { readText } from "./fs-safe.js";
import type { FileWrite, Manifest } from "./types.js";

export function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function isManifest(value: unknown): value is Manifest {
  if (typeof value !== "object" || value === null) return false;
  const { version, managed } = value as Record<string, unknown>;
  return version === 1
    && typeof managed === "object"
    && managed !== null
    && !Array.isArray(managed)
    && Object.values(managed).every((entry) => typeof entry === "string");
}

export function loadManifest(root: string): Manifest {
  const raw = readText(root, MANIFEST_PATH);
  if (raw === null) return { version: 1, managed: {} };
  let manifest: unknown;
  try {
    manifest = JSON.parse(raw);
  } catch {
    throw new Error(`Cannot read ${MANIFEST_PATH}: invalid JSON. Move or repair it before continuing.`);
  }
  if (!isManifest(manifest)) {
    throw new Error(`Cannot read ${MANIFEST_PATH}: unsupported manifest format.`);
  }
  return manifest;
}

export function manifestWrite(manifest: Manifest): FileWrite {
  return { path: MANIFEST_PATH, content: `${JSON.stringify(manifest, null, 2)}\n` };
}
