import fs from "node:fs";
import path from "node:path";
import { targetPath } from "./fs-safe.js";

function has(root, relativePath) {
  try {
    return fs.existsSync(targetPath(root, relativePath));
  } catch {
    return false;
  }
}

function readPackage(root) {
  if (!has(root, "package.json")) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

function allPackages(packageJson) {
  return new Set([
    ...Object.keys(packageJson?.dependencies ?? {}),
    ...Object.keys(packageJson?.devDependencies ?? {}),
    ...Object.keys(packageJson?.peerDependencies ?? {})
  ]);
}

function safeRead(root, relativePath) {
  try {
    return fs.readFileSync(targetPath(root, relativePath), "utf8");
  } catch {
    return "";
  }
}

export function detectProject(root) {
  const packageJson = readPackage(root);
  const packages = allPackages(packageJson);
  const packageScripts = packageJson?.scripts ?? {};
  const projectKinds = [];
  const frameworks = [];
  const languages = [];
  const pythonMetadata = ["pyproject.toml", "requirements.txt", "Pipfile"]
    .map((file) => safeRead(root, file).toLowerCase())
    .join("\n");

  if (packageJson || has(root, "tsconfig.json") || has(root, "jsconfig.json")) languages.push("JavaScript/TypeScript");
  if (has(root, "pyproject.toml") || has(root, "requirements.txt") || has(root, "Pipfile")) languages.push("Python");
  if (has(root, "go.mod")) languages.push("Go");
  if (has(root, "Cargo.toml")) languages.push("Rust");
  if (has(root, "pubspec.yaml")) languages.push("Dart");

  const frameworkChecks = [
    ["next", "Next.js"], ["nuxt", "Nuxt"], ["@sveltejs/kit", "SvelteKit"],
    ["svelte", "Svelte"], ["@angular/core", "Angular"], ["astro", "Astro"],
    ["react", "React"], ["vue", "Vue"], ["vite", "Vite"],
    ["@nestjs/core", "NestJS"], ["fastify", "Fastify"], ["express", "Express"]
  ];
  for (const [packageName, label] of frameworkChecks) {
    if (packages.has(packageName) && !frameworks.includes(label)) frameworks.push(label);
  }
  for (const [pattern, label] of [[/\bdjango\b/, "Django"], [/\bfastapi\b/, "FastAPI"], [/\bflask\b/, "Flask"]]) {
    if (pattern.test(pythonMetadata)) frameworks.push(label);
  }
  if (packages.has("expo") || packages.has("react-native")) frameworks.push("React Native");
  if (has(root, "pubspec.yaml")) frameworks.push("Flutter");
  if (has(root, "src-tauri")) frameworks.push("Tauri");

  if (frameworks.some((name) => ["Next.js", "Nuxt", "SvelteKit", "Svelte", "Angular", "Astro", "React", "Vue", "Vite"].includes(name))) {
    projectKinds.push("Web application");
  }
  if (frameworks.some((name) => ["NestJS", "Fastify", "Express", "Django", "FastAPI", "Flask"].includes(name))) projectKinds.push("API or server");
  if (frameworks.includes("Flutter") || frameworks.includes("React Native") || has(root, "ios") || has(root, "android")) projectKinds.push("Mobile application");
  if (!projectKinds.length && (packageJson || languages.length)) projectKinds.push("Software project");
  if (!projectKinds.length) projectKinds.push("Not identified");
  if (!languages.length) languages.push("Not identified");

  const verificationTools = [];
  const toolChecks = [
    ["@playwright/test", "Playwright"], ["playwright", "Playwright"],
    ["cypress", "Cypress"], ["vitest", "Vitest"], ["jest", "Jest"],
    ["mocha", "Mocha"], ["appium", "Appium"], ["webdriverio", "WebdriverIO"],
    ["detox", "Detox"], ["selenium-webdriver", "Selenium"]
  ];
  for (const [packageName, label] of toolChecks) {
    if (packages.has(packageName) && !verificationTools.includes(label)) verificationTools.push(label);
  }
  if (["playwright.config.js", "playwright.config.ts", "playwright.config.mjs", "playwright.config.cjs", "playwright.config.mts"].some((file) => has(root, file)) && !verificationTools.includes("Playwright")) verificationTools.push("Playwright");
  if (["cypress.config.js", "cypress.config.ts", "cypress.config.mjs", "cypress.config.cjs"].some((file) => has(root, file)) && !verificationTools.includes("Cypress")) verificationTools.push("Cypress");
  if (["vitest.config.js", "vitest.config.ts", "vitest.config.mjs", "vitest.config.mts"].some((file) => has(root, file)) && !verificationTools.includes("Vitest")) verificationTools.push("Vitest");
  if (["jest.config.js", "jest.config.ts", "jest.config.mjs", "jest.config.cjs"].some((file) => has(root, file)) && !verificationTools.includes("Jest")) verificationTools.push("Jest");
  if (has(root, "maestro") || has(root, ".maestro")) verificationTools.push("Maestro");
  if (["pytest.ini", "pyproject.toml", "requirements.txt", "Pipfile"].some((file) => /\bpytest\b/.test(safeRead(root, file)))) verificationTools.push("pytest");
  if (has(root, "appium.config.js") || has(root, "appium.config.ts")) {
    if (!verificationTools.includes("Appium")) verificationTools.push("Appium");
  }

  return {
    projectKinds,
    frameworks: frameworks.length ? frameworks : ["Not identified"],
    languages,
    verificationTools,
    packageScripts: Object.entries(packageScripts).map(([name, command]) => ({ name, command }))
  };
}

export function renderProjectContext(detection) {
  const lines = [
    "# Prove project context",
    "",
    "Fill in any details the installer could not detect. Do not store secrets here.",
    "",
    "## Application",
    "",
    `Type: ${detection.projectKinds.join(", ")}`,
    `Framework: ${detection.frameworks.join(", ")}`,
    `Language: ${detection.languages.join(", ")}`,
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
    "List business-critical flows and point to their `.prove/contracts/*.md` files.",
    "",
    "## Known constraints",
    "",
    "List setup steps, unavailable environments, and other limits that affect verification.",
    ""
  );
  return lines.join("\n");
}
