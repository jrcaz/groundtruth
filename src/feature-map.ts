import fs from "node:fs";
import path from "node:path";
import { readText, targetPath } from "./fs-safe.js";
import type { Detection } from "./types.js";

interface EntryPoint {
  area: string;
  label: string;
  source: string;
}

const MAX_DEPTH = 16;
const MAX_ENTRIES = 2000;
const IGNORED_DIRECTORIES = new Set(["node_modules", "__tests__", "__fixtures__"]);

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function safeRead(root: string, relativePath: string): string | null {
  try {
    return readText(root, relativePath);
  } catch {
    return null;
  }
}

function packageMetadata(root: string, directory: string): Record<string, unknown> {
  const content = safeRead(root, directory ? directory + "/package.json" : "package.json");
  try {
    return record(JSON.parse(content ?? "{}"));
  } catch {
    return {};
  }
}

// Scan only known entry-point directories, skipping links, dependencies, and
// test fixtures. Route names such as "build" or "coverage" can be real pages.
function sourceFiles(root: string, directory: string, notes: Set<string>): string[] {
  const files: string[] = [];
  let visited = 0;
  const walk = (relativePath: string, depth: number): void => {
    if (depth > MAX_DEPTH || visited >= MAX_ENTRIES) {
      notes.add("The scan of " + directory + " reached its depth or entry limit. Review it with the feature-map skill.");
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(targetPath(root, relativePath), { withFileTypes: true });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        notes.add("Could not inspect " + relativePath + ". Review it manually if it contains application code.");
      }
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (visited >= MAX_ENTRIES) {
        notes.add("The scan of " + directory + " reached its entry limit. Review it with the feature-map skill.");
        break;
      }
      visited++;
      const child = relativePath + "/" + entry.name;
      if (entry.isSymbolicLink() || entry.name.startsWith(".")) continue;
      if (entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name)) walk(child, depth + 1);
      else if (entry.isFile()) files.push(child);
    }
  };
  walk(directory, 0);
  return files;
}

function routeName(segments: string[], omitGroups: boolean): string {
  return "/" + segments.filter((segment) => !omitGroups || !/^\([^)]*\)$/.test(segment)).join("/");
}

function routes(root: string, directory: string, metadata: Record<string, unknown>, notes: Set<string>): EntryPoint[] {
  const packages = new Set([
    ...Object.keys(record(metadata.dependencies)),
    ...Object.keys(record(metadata.devDependencies)),
    ...Object.keys(record(metadata.peerDependencies))
  ]);
  const entries: EntryPoint[] = [];
  const scan = (folder: string, mode: "next-app" | "next-pages" | "nuxt" | "sveltekit" | "astro"): void => {
    const base = directory ? directory + "/" + folder : folder;
    const nuxtVersion = String(record(metadata.dependencies).nuxt ?? record(metadata.devDependencies).nuxt ?? "");
    const nuxt2 = /(?:^|[^\d])2(?:[.\-]|$)/.test(nuxtVersion);
    for (const source of sourceFiles(root, base, notes)) {
      const segments = source.slice(base.length + 1).split("/");
      const filename = segments.pop() ?? "";
      let area = "Web pages";
      if (mode === "next-app") {
        if (segments.some((segment) => segment.startsWith("_") || segment.startsWith("@") || /^\(\.{1,3}\)/.test(segment))) continue;
        if (!/^(page|route)\.(js|jsx|ts|tsx)$/.test(filename)) continue;
        if (filename.startsWith("route.")) area = "API routes";
      } else if (mode === "sveltekit") {
        if (/^\+server\.(js|ts)$/.test(filename)) area = "API routes";
        else if (!/^\+page(?:@[^.]*)?\.svelte$/.test(filename)) continue;
      } else {
        const allowed = mode === "astro"
          ? /\.(astro|md|mdx|html|js|ts)$/
          : mode === "nuxt"
            ? nuxt2 ? /\.(vue|js|ts)$/ : /\.vue$/
            : /\.(js|jsx|ts|tsx)$/;
        if (!allowed.test(filename) || /\.(test|spec|d)\.[^.]+$/.test(filename)) continue;
        const stem = filename.replace(/\.[^.]+$/, "");
        if (mode === "next-pages" && /^_(app|document|error)$/.test(stem)) continue;
        if ((mode === "next-pages" && segments[0] === "api") || (mode === "astro" && /\.(js|ts)$/.test(filename))) area = "API routes";
        if (stem !== "index") segments.push(stem);
      }
      entries.push({
        area: directory ? directory + " / " + area : area,
        label: routeName(segments, mode === "next-app" || mode === "sveltekit" || mode === "nuxt"),
        source
      });
    }
  };
  if (packages.has("next")) {
    scan("app", "next-app");
    scan("src/app", "next-app");
    scan("pages", "next-pages");
    scan("src/pages", "next-pages");
  }
  if (packages.has("nuxt")) {
    scan("pages", "nuxt");
    scan("app/pages", "nuxt");
    for (const [folder, prefix, area] of [
      ["server/api", "/api", "API routes"],
      ["server/routes", "", "Server routes"]
    ] as const) {
      const base = directory ? directory + "/" + folder : folder;
      for (const source of sourceFiles(root, base, notes)) {
        const segments = source.slice(base.length + 1).split("/");
        const filename = segments.pop() ?? "";
        if (!/\.(js|ts)$/.test(filename) || /\.(test|spec|d)\.[^.]+$/.test(filename)) continue;
        const stem = filename.replace(/\.(js|ts)$/, "");
        const method = stem.match(/\.(get|post|put|patch|delete|head|options|connect|trace|all)$/i)?.[1]?.toUpperCase();
        const routeStem = method ? stem.slice(0, -(method.length + 1)) : stem;
        if (!routeStem) continue;
        segments.push(routeStem);
        const route = prefix + routeName(segments, false);
        entries.push({
          area: directory ? directory + " / " + area : area,
          label: method ? method + " " + route : route,
          source
        });
      }
    }
  }
  if (packages.has("@sveltejs/kit")) scan("src/routes", "sveltekit");
  if (packages.has("astro")) scan("src/pages", "astro");
  return entries;
}

function markdownText(value: string): string {
  return value.replace(/[\\\x60*_[\]<>]/g, "\\$&").replace(/[\r\n]/g, " ");
}

function sourceLink(relativePath: string): string {
  const target = path.posix.relative(".prove", relativePath);
  return "[" + markdownText(relativePath) + "](<" + target.split("/").map(encodeURIComponent).join("/") + ">)";
}

export function renderFeatureMap(root: string, detection: Detection): string {
  const entries: EntryPoint[] = [];
  const notes = new Set<string>();
  for (const directory of ["", ...detection.workspaces]) {
    const metadata = packageMetadata(root, directory);
    entries.push(...routes(root, directory, metadata, notes));
    const binaries = typeof metadata.bin === "string"
      ? { [typeof metadata.name === "string" ? metadata.name.split("/").pop() ?? "CLI" : "CLI"]: metadata.bin }
      : record(metadata.bin);
    for (const [name, executable] of Object.entries(binaries)) {
      if (typeof executable !== "string") continue;
      const source = path.posix.normalize((directory ? directory + "/" : "") + executable.replace(/\\/g, "/"));
      if (safeRead(root, source) === null) {
        notes.add("Declared CLI " + name + " has no readable executable at " + source + ". Inspect its source and build configuration.");
        continue;
      }
      entries.push({ area: directory ? directory + " / CLI executables" : "CLI executables", label: name, source });
    }
  }

  const lines = [
    "# Product feature map",
    "",
    "Status: Starter inventory. Implementation and runtime behavior have not been reviewed.",
    "",
    "Use the `feature-map` skill to inspect the current application, group capabilities into product areas, and link their contracts. Keep this map current as capabilities change.",
    "",
    "## Capabilities",
    "",
    "The entries below are candidates discovered from conventional entry-point files. Their names describe route patterns or executables, not confirmed product behavior. Custom routing, configuration, and reachability still need review.",
    ""
  ];
  for (const area of [...new Set(entries.map(({ area }) => area))].sort()) {
    lines.push("### " + markdownText(area), "");
    for (const entry of entries.filter((entry) => entry.area === area).sort((a, b) => a.source.localeCompare(b.source))) {
      lines.push("- " + markdownText(entry.label) + ", unconfirmed", "  - Source: " + sourceLink(entry.source), "  - Contracts: Not yet mapped.");
    }
    lines.push("");
  }
  if (!entries.length) lines.push("No conventional entry points were discovered. Inspect the application's screens, handlers, commands, and jobs with the feature-map skill to populate this section.", "");

  const contracts = sourceFiles(root, ".prove/contracts", notes)
    .filter((file) => file.endsWith(".md") && path.posix.basename(file).toUpperCase() !== "TEMPLATE.MD");
  lines.push("## Contract references awaiting review", "", "A contract describes required behavior. Confirm its implementation and link it to the appropriate capability.", "");
  if (contracts.length) lines.push(...contracts.map((file) => "- " + sourceLink(file)));
  else lines.push("No existing capability contracts were found.");
  lines.push("", "## Review notes", "",
    "- The initializer scans default Next.js, Nuxt, SvelteKit, and Astro page or API directories, declared npm executables, and existing Prove contracts. It does not infer capabilities from dependencies or arbitrary folder names.",
    "- Use the feature-map skill to inspect other frameworks, custom source layouts, API registrations, mobile screens, background jobs, and capability variants.",
    "- Confirm source behavior before changing an entry to implemented, partial, or disabled. Record runtime verification separately.");
  if (detection.workspaces.length) lines.push("- Declared workspaces to review: " + detection.workspaces.map(markdownText).join(", ") + ".");
  lines.push(...[...notes].sort().map((note) => "- " + markdownText(note)), "");
  return lines.join("\n");
}
