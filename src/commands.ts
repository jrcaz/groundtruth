import { detectProject, renderProjectContext } from "./detect.js";
import { inspectManagedContent, inspectPolicy, isRegularFile, planManagedContent, planPolicies, POLICY_FILES } from "./content.js";
import { applyWrites, readText } from "./fs-safe.js";
import { loadManifest, manifestWrite } from "./manifest.js";
import { FEATURE_MAP_PATH } from "./constants.js";
import { renderFeatureMap } from "./feature-map.js";
import type {
  CommandOptions,
  Detection,
  Logger,
  ManagedInspection,
  ManagedInspectionStatus,
  ManagedOutcome,
  ManagedOutcomeStatus,
  PolicyInspectionStatus,
  PolicyPlan
} from "./types.js";

const PROJECT_PATH = ".prove/PROJECT.md";

function statusLabel(status: ManagedOutcomeStatus): string {
  const labels: Record<ManagedOutcomeStatus, string> = {
    created: "created",
    registered: "registered as managed",
    updated: "updated",
    current: "up to date",
    "preserved-unmanaged": "kept existing, not managed",
    "preserved-customized": "kept local edits"
  };
  return labels[status];
}

function describeDetection(detection: Detection, log: Logger): void {
  log(`Detected project: ${detection.projectKinds.join(", ")}`);
  log(`Frameworks: ${detection.frameworks.join(", ")}`);
  log(`Languages: ${detection.languages.join(", ")}`);
  if (detection.workspaces.length) log(`Workspaces: ${detection.workspaces.join(", ")}`);
  log(`Verification tools: ${detection.verificationTools.length ? detection.verificationTools.join(", ") : "none detected"}`);
}

function describePolicy(plan: PolicyPlan): string {
  if (plan.sharedWith) return `confirmed ${plan.path} (links to ${plan.target}, which holds the Prove section)`;
  const verb = plan.changed ? "updated" : "confirmed";
  return plan.target === plan.path ? `${verb} ${plan.path}` : `${verb} ${plan.path} (edited its link target ${plan.target})`;
}

// Every file is planned and checked before anything is written, and the writes
// are applied together, so a failed init leaves the project as it was.
export function initProject({ cwd = process.cwd(), log = console.log }: CommandOptions = {}): { detection: Detection; outcomes: ManagedOutcome[]; policies: PolicyPlan[] } {
  const detection = detectProject(cwd);
  const keepProjectContext = readText(cwd, PROJECT_PATH) !== null;
  const keepFeatureMap = readText(cwd, FEATURE_MAP_PATH) !== null;
  const manifest = loadManifest(cwd);
  const managed = planManagedContent(cwd, manifest);
  const policies = planPolicies(cwd);

  applyWrites(cwd, [
    ...(keepProjectContext ? [] : [{ path: PROJECT_PATH, content: renderProjectContext(detection) }]),
    ...(keepFeatureMap ? [] : [{ path: FEATURE_MAP_PATH, content: renderFeatureMap(cwd, detection) }]),
    ...managed.writes,
    ...policies.flatMap((plan) => (plan.changed && plan.content !== undefined ? [{ path: plan.target, content: plan.content }] : [])),
    manifestWrite(manifest)
  ]);

  describeDetection(detection, log);
  log(keepProjectContext ? `kept ${PROJECT_PATH}; project context is never overwritten` : `created ${PROJECT_PATH}`);
  log(keepFeatureMap ? `kept ${FEATURE_MAP_PATH}; feature maps are never overwritten` : `created ${FEATURE_MAP_PATH}; use the feature-map skill to review and complete the starter inventory`);
  for (const outcome of managed.outcomes) log(`${statusLabel(outcome.status)} ${outcome.path}`);
  for (const plan of policies) log(describePolicy(plan));
  log("Prove is ready. Try: \"Implement this feature and prove it works.\"");
  return { detection, outcomes: managed.outcomes, policies };
}

export function updateProject({ cwd = process.cwd(), log = console.log }: CommandOptions = {}): ManagedOutcome[] {
  const manifest = loadManifest(cwd);
  const { outcomes, writes } = planManagedContent(cwd, manifest);
  applyWrites(cwd, [...writes, manifestWrite(manifest)]);
  for (const outcome of outcomes) log(`${statusLabel(outcome.status)} ${outcome.path}`);
  log("Update only refreshes Prove-managed skills and the contract template. Project context, feature maps, and real contracts were left untouched.");
  return outcomes;
}

export interface DoctorResult {
  healthy: boolean;
  detection: Detection;
  managed: ManagedInspection[];
  policies: Array<{ path: string; status: PolicyInspectionStatus }>;
}

const MANAGED_LABELS: Record<ManagedInspectionStatus, string> = {
  managed: "OK",
  customized: "CUSTOMIZED, update will preserve local edits",
  "present-unmanaged": "PRESENT, ownership not recorded",
  blocked: "BLOCKED",
  missing: "MISSING"
};

function describePolicyStatus(relativePath: string, status: PolicyInspectionStatus): string {
  switch (status) {
    case "valid":
      return `OK ${relativePath} Prove section`;
    case "missing":
      return `MISSING ${relativePath} Prove section`;
    case "invalid":
      return `INVALID ${relativePath} Prove section: markers are incomplete, repeated, or out of order`;
    case "blocked":
      return `BLOCKED ${relativePath}: symbolic link to a missing file or a file outside the project`;
  }
}

export function doctorProject({ cwd = process.cwd(), log = console.log }: CommandOptions = {}): DoctorResult {
  const detection = detectProject(cwd);
  const managed = inspectManagedContent(cwd, loadManifest(cwd));
  let healthy = true;
  log("Prove installation:");
  for (const item of managed) {
    log(`${MANAGED_LABELS[item.status]} ${item.path}`);
    if (item.status === "missing" || item.status === "blocked") healthy = false;
  }

  const projectContextPresent = isRegularFile(cwd, PROJECT_PATH);
  log(`${projectContextPresent ? "OK" : "MISSING"} ${PROJECT_PATH}`);
  if (!projectContextPresent) healthy = false;

  const featureMapPresent = isRegularFile(cwd, FEATURE_MAP_PATH);
  log(`${featureMapPresent ? "OK" : "MISSING"} ${FEATURE_MAP_PATH}`);
  if (!featureMapPresent) healthy = false;

  const policies = POLICY_FILES.map((relativePath) => ({ path: relativePath, status: inspectPolicy(cwd, relativePath) }));
  for (const { path: relativePath, status } of policies) {
    log(describePolicyStatus(relativePath, status));
    if (status !== "valid") healthy = false;
  }

  log("Detected verification tooling:");
  log(`Project: ${detection.projectKinds.join(", ")}`);
  log(`Frameworks: ${detection.frameworks.join(", ")}`);
  if (detection.workspaces.length) log(`Workspaces: ${detection.workspaces.join(", ")}`);
  log(`Tools: ${detection.verificationTools.length ? detection.verificationTools.join(", ") : "none detected"}`);
  if (detection.packageScripts.length) log(`npm scripts: ${detection.packageScripts.map(({ name }) => name).join(", ")}`);
  log(healthy ? "Prove setup looks good." : "Prove setup is incomplete. Run `prove init` or resolve the missing files.");
  return { healthy, detection, managed, policies };
}
