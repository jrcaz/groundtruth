import { detectProject, renderProjectContext } from "./detect.js";
import { installManagedContent, inspectManagedContent, isRegularFile, upsertPolicy } from "./content.js";
import { readText, writeText } from "./fs-safe.js";
import { POLICY_END, POLICY_START } from "./constants.js";

const policyFiles = ["AGENTS.md", "CLAUDE.md"];

function statusLabel(status) {
  return ({
    created: "created",
    registered: "registered as managed",
    updated: "updated",
    current: "up to date",
    "preserved-unmanaged": "kept existing, not managed",
    "preserved-customized": "kept local edits"
  })[status] ?? status;
}

function describeDetection(detection, log) {
  log(`Detected project: ${detection.projectKinds.join(", ")}`);
  log(`Frameworks: ${detection.frameworks.join(", ")}`);
  log(`Languages: ${detection.languages.join(", ")}`);
  log(`Verification tools: ${detection.verificationTools.length ? detection.verificationTools.join(", ") : "none detected"}`);
}

export function initProject({ cwd = process.cwd(), log = console.log } = {}) {
  const detection = detectProject(cwd);
  describeDetection(detection, log);
  const projectPath = ".prove/PROJECT.md";
  if (readText(cwd, projectPath) === null) {
    writeText(cwd, projectPath, renderProjectContext(detection));
    log(`created ${projectPath}`);
  } else {
    log(`kept ${projectPath}; project context is never overwritten`);
  }

  const outcomes = installManagedContent(cwd);
  for (const outcome of outcomes) log(`${statusLabel(outcome.status)} ${outcome.path}`);
  for (const relativePath of policyFiles) {
    const changed = upsertPolicy(cwd, relativePath);
    log(`${changed ? "updated" : "confirmed"} ${relativePath}`);
  }
  log("Prove is ready. Try: \"Implement this feature and prove it works.\"");
  return { detection, outcomes };
}

export function updateProject({ cwd = process.cwd(), log = console.log } = {}) {
  const outcomes = installManagedContent(cwd);
  for (const outcome of outcomes) log(`${statusLabel(outcome.status)} ${outcome.path}`);
  log("Update only refreshes Prove-managed skills and the contract template. Project context and real contracts were left untouched.");
  return outcomes;
}

export function doctorProject({ cwd = process.cwd(), log = console.log } = {}) {
  const detection = detectProject(cwd);
  const managed = inspectManagedContent(cwd);
  let healthy = true;
  log("Prove installation:");
  for (const item of managed) {
    const label = ({
      managed: "OK",
      customized: "CUSTOMIZED, update will preserve local edits",
      "present-unmanaged": "PRESENT, ownership not recorded",
      blocked: "BLOCKED",
      missing: "MISSING"
    })[item.status];
    log(`${label} ${item.path}`);
    if (item.status === "missing" || item.status === "blocked") healthy = false;
  }

  for (const relativePath of [".prove/PROJECT.md", "AGENTS.md", "CLAUDE.md"]) {
    let content;
    try {
      content = readText(cwd, relativePath);
    } catch {
      content = null;
    }
    const hasPolicy = content?.split(POLICY_START).length === 2
      && content?.split(POLICY_END).length === 2
      && content.indexOf(POLICY_START) < content.indexOf(POLICY_END);
    const good = relativePath === ".prove/PROJECT.md" ? isRegularFile(cwd, relativePath) : hasPolicy;
    log(`${good ? "OK" : "MISSING"} ${relativePath}${relativePath === ".prove/PROJECT.md" ? "" : " Prove section"}`);
    if (!good) healthy = false;
  }

  log("Detected verification tooling:");
  log(`Project: ${detection.projectKinds.join(", ")}`);
  log(`Frameworks: ${detection.frameworks.join(", ")}`);
  log(`Tools: ${detection.verificationTools.length ? detection.verificationTools.join(", ") : "none detected"}`);
  if (detection.packageScripts.length) log(`npm scripts: ${detection.packageScripts.map(({ name }) => name).join(", ")}`);
  log(healthy ? "Prove setup looks good." : "Prove setup is incomplete. Run `prove init` or resolve the missing files.");
  return { healthy, detection, managed };
}
