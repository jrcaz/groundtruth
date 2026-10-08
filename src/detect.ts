import fs from "node:fs";
import path from "node:path";
import { targetPath } from "./fs-safe.js";
import type { Detection, PackageScript } from "./types.js";

interface PackageJson {
  dependencies: Record<string, unknown>;
  devDependencies: Record<string, unknown>;
  peerDependencies: Record<string, unknown>;
  scripts: Record<string, unknown>;
  workspaces: unknown;
}

const MAX_WORKSPACE_DEPTH = 6;
const MAX_WORKSPACES = 500;

function has(root: string, relativePath: string): boolean {
  try {
    return fs.existsSync(targetPath(root, relativePath));
  } catch {
    return false;
  }
}

function safeRead(root: string, relativePath: string): string {
  try {
    return fs.readFileSync(targetPath(root, relativePath), "utf8");
  } catch {
    return "";
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readPackage(root: string, directory = ""): PackageJson | null {
  const relativePath = directory ? `${directory}/package.json` : "package.json";
  if (!has(root, relativePath)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(safeRead(root, relativePath));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const fields = parsed as Record<string, unknown>;
  return {
    dependencies: record(fields.dependencies),
    devDependencies: record(fields.devDependencies),
    peerDependencies: record(fields.peerDependencies),
    scripts: record(fields.scripts),
    workspaces: fields.workspaces
  };
}

function packageNames(packageJson: PackageJson | null): string[] {
  if (!packageJson) return [];
  return [
    ...Object.keys(packageJson.dependencies),
    ...Object.keys(packageJson.devDependencies),
    ...Object.keys(packageJson.peerDependencies)
  ];
}

// Reads the `packages:` list from pnpm-workspace.yaml without a YAML parser.
function pnpmWorkspacePatterns(yaml: string): string[] {
  const patterns: string[] = [];
  let inPackages = false;
  for (const line of yaml.split(/\r?\n/)) {
    if (/^packages\s*:/.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    if (/^[^\s#]/.test(line)) break;
    const match = line.match(/^\s*-\s*(["']?)(.+?)\1\s*(#.*)?$/);
    if (match?.[2]) patterns.push(match[2]);
  }
  return patterns;
}

function workspacePatterns(root: string, packageJson: PackageJson | null): string[] {
  const declared = packageJson?.workspaces;
  const nested = record(declared).packages;
  const fromPackage: unknown[] = Array.isArray(declared) ? declared : Array.isArray(nested) ? nested : [];
  return [...fromPackage, ...pnpmWorkspacePatterns(safeRead(root, "pnpm-workspace.yaml"))]
    .filter((pattern): pattern is string => typeof pattern === "string" && pattern.trim() !== "");
}

function childDirectories(root: string, directory: string): string[] {
  try {
    const absolute = directory ? targetPath(root, directory) : path.resolve(root);
    return fs.readdirSync(absolute, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "node_modules" && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function segmentPattern(segment: string): RegExp {
  const escaped = segment.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${escaped.join("[^/]*")}$`);
}

// Expands a workspace glob into directories. Supports literal segments, `*`
// within a segment, and `**` for any depth, which covers npm, Yarn, and pnpm
// workspace declarations in practice.
function expandWorkspacePattern(root: string, pattern: string): string[] {
  const segments = pattern.replace(/\\/g, "/").split("/").filter((segment) => segment && segment !== ".");
  if (segments.includes("..")) return [];
  const matches = new Set<string>();
  const walk = (directory: string, index: number, depth: number): void => {
    if (depth > MAX_WORKSPACE_DEPTH) return;
    if (index === segments.length) {
      if (directory) matches.add(directory);
      return;
    }
    const segment = segments[index];
    const join = (name: string): string => (directory ? `${directory}/${name}` : name);
    if (segment === undefined) return;
    if (segment === "**") {
      walk(directory, index + 1, depth);
      for (const name of childDirectories(root, directory)) walk(join(name), index, depth + 1);
    } else if (!segment.includes("*")) {
      if (has(root, join(segment))) walk(join(segment), index + 1, depth + 1);
    } else {
      const matcher = segmentPattern(segment);
      for (const name of childDirectories(root, directory)) {
        if (matcher.test(name)) walk(join(name), index + 1, depth + 1);
      }
    }
  };
  walk("", 0, 0);
  return [...matches];
}

function findWorkspaces(root: string, packageJson: PackageJson | null): string[] {
  const included = new Set<string>();
  const excluded = new Set<string>();
  for (const pattern of workspacePatterns(root, packageJson)) {
    const negated = pattern.startsWith("!");
    for (const directory of expandWorkspacePattern(root, negated ? pattern.slice(1) : pattern)) {
      (negated ? excluded : included).add(directory);
    }
  }
  return [...included]
    .filter((directory) => !excluded.has(directory) && has(root, `${directory}/package.json`))
    .sort()
    .slice(0, MAX_WORKSPACES);
}

export function detectProject(root: string): Detection {
  const packageJson = readPackage(root);
  const workspaces = findWorkspaces(root, packageJson);
  const directories = ["", ...workspaces];
  const inAnyDirectory = (file: string): boolean => directories.some((directory) => has(root, directory ? `${directory}/${file}` : file));
  const packages = new Set([
    ...packageNames(packageJson),
    ...workspaces.flatMap((directory) => packageNames(readPackage(root, directory)))
  ]);
  const packageScripts: PackageScript[] = Object.entries(packageJson?.scripts ?? {})
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([name, command]) => ({ name, command }));
  const projectKinds: string[] = [];
  const frameworks: string[] = [];
  const languages: string[] = [];
  const pythonMetadata = ["pyproject.toml", "requirements.txt", "Pipfile"]
    .map((file) => safeRead(root, file).toLowerCase())
    .join("\n");

  if (packageJson || has(root, "tsconfig.json") || has(root, "jsconfig.json")) languages.push("JavaScript/TypeScript");
  if (has(root, "pyproject.toml") || has(root, "requirements.txt") || has(root, "Pipfile")) languages.push("Python");
  if (has(root, "go.mod")) languages.push("Go");
  if (has(root, "Cargo.toml")) languages.push("Rust");
  if (has(root, "pubspec.yaml")) languages.push("Dart");

  const frameworkChecks: Array<[string, string]> = [
    ["next", "Next.js"], ["nuxt", "Nuxt"], ["@sveltejs/kit", "SvelteKit"],
    ["svelte", "Svelte"], ["@angular/core", "Angular"], ["astro", "Astro"],
    ["react", "React"], ["vue", "Vue"], ["vite", "Vite"],
    ["@nestjs/core", "NestJS"], ["fastify", "Fastify"], ["express", "Express"]
  ];
  for (const [packageName, label] of frameworkChecks) {
    if (packages.has(packageName) && !frameworks.includes(label)) frameworks.push(label);
  }
  const pythonFrameworks: Array<[RegExp, string]> = [[/\bdjango\b/, "Django"], [/\bfastapi\b/, "FastAPI"], [/\bflask\b/, "Flask"]];
  for (const [pattern, label] of pythonFrameworks) {
    if (pattern.test(pythonMetadata)) frameworks.push(label);
  }
  if (packages.has("expo") || packages.has("react-native")) frameworks.push("React Native");
  if (has(root, "pubspec.yaml")) frameworks.push("Flutter");
  if (inAnyDirectory("src-tauri")) frameworks.push("Tauri");

  if (frameworks.some((name) => ["Next.js", "Nuxt", "SvelteKit", "Svelte", "Angular", "Astro", "React", "Vue", "Vite"].includes(name))) {
    projectKinds.push("Web application");
  }
  if (frameworks.some((name) => ["NestJS", "Fastify", "Express", "Django", "FastAPI", "Flask"].includes(name))) projectKinds.push("API or server");
  if (frameworks.includes("Flutter") || frameworks.includes("React Native") || has(root, "ios") || has(root, "android")) projectKinds.push("Mobile application");
  if (!projectKinds.length && (packageJson || languages.length)) projectKinds.push("Software project");
  if (!projectKinds.length) projectKinds.push("Not identified");
  if (!languages.length) languages.push("Not identified");

  const verificationTools: string[] = [];
  const toolChecks: Array<[string, string]> = [
    ["@playwright/test", "Playwright"], ["playwright", "Playwright"],
    ["cypress", "Cypress"], ["vitest", "Vitest"], ["jest", "Jest"],
    ["mocha", "Mocha"], ["appium", "Appium"], ["webdriverio", "WebdriverIO"],
    ["detox", "Detox"], ["selenium-webdriver", "Selenium"]
  ];
  for (const [packageName, label] of toolChecks) {
    if (packages.has(packageName) && !verificationTools.includes(label)) verificationTools.push(label);
  }
  const configChecks: Array<[string[], string]> = [
    [["playwright.config.js", "playwright.config.ts", "playwright.config.mjs", "playwright.config.cjs", "playwright.config.mts"], "Playwright"],
    [["cypress.config.js", "cypress.config.ts", "cypress.config.mjs", "cypress.config.cjs"], "Cypress"],
    [["vitest.config.js", "vitest.config.ts", "vitest.config.mjs", "vitest.config.mts"], "Vitest"],
    [["jest.config.js", "jest.config.ts", "jest.config.mjs", "jest.config.cjs"], "Jest"],
    [["maestro", ".maestro"], "Maestro"],
    [["appium.config.js", "appium.config.ts"], "Appium"]
  ];
  for (const [files, label] of configChecks) {
    if (files.some(inAnyDirectory) && !verificationTools.includes(label)) verificationTools.push(label);
  }
  if (["pytest.ini", "pyproject.toml", "requirements.txt", "Pipfile"].some((file) => /\bpytest\b/.test(safeRead(root, file)))) verificationTools.push("pytest");

  return {
    projectKinds,
    frameworks: frameworks.length ? frameworks : ["Not identified"],
    languages,
    verificationTools,
    workspaces,
    packageScripts
  };
}

export function renderProjectContext(detection: Detection): string {
  const lines = [
    "# GroundTruth project context",
    "",
    "Fill in any details the installer could not detect. Do not store secrets here.",
    "",
    "## Application",
    "",
    `Type: ${detection.projectKinds.join(", ")}`,
    `Framework: ${detection.frameworks.join(", ")}`,
    `Language: ${detection.languages.join(", ")}`,
    ...(detection.workspaces.length ? [`Workspaces: ${detection.workspaces.join(", ")}`] : []),
    "",
    "## Feature map",
    "",
    "Read `.groundtruth/FEATURE_MAP.md` for product capabilities and their contracts. Use the `feature-map` skill to complete its starter inventory from the current implementation and update it when capabilities change.",
    "",
    "## How to run",
    "",
    "Add the command(s) needed to start the app and any local services.",
    "",
    "## Required checks",
    "",
    "Choose the checks required for changes in this repository."
  ];

  const recommended = detection.packageScripts.filter(({ name }) => /^(typecheck|type-check|lint|test|test:e2e|e2e|check|build)$/.test(name));
  if (recommended.length) {
    lines.push("", "Detected npm scripts:", "", ...recommended.map(({ name }) => `- \`npm run ${name}\``));
  } else {
    lines.push("", "- Add the appropriate type-check, lint, and test commands.");
  }
  lines.push(
    "",
    "## Runtime verification",
    "",
    detection.verificationTools.length
      ? `Detected tooling: ${detection.verificationTools.join(", ")}. Prefer the existing tools for runtime checks.`
      : "No verification tool was detected. Record the tool used to exercise the running application.",
    "",
    "Inspect relevant application logs, browser console errors, and failed network requests when applicable.",
    "",
    "## Test environment",
    "",
    "Never run verification against production unless the task explicitly requires it and access is authorized.",
    "Keep credentials in environment variables or a secret manager. Never commit them.",
    "",
    "## High-risk areas",
    "",
    "List business-critical flows and point to their `.groundtruth/contracts/*.md` files.",
    "",
    "## Known constraints",
    "",
    "List setup steps, unavailable environments, and other limits that affect verification.",
    ""
  );
  return lines.join("\n");
}
