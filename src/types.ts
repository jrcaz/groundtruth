export type Logger = (message: string) => void;

export interface CommandOptions {
  cwd?: string;
  log?: Logger;
}

export interface FileWrite {
  path: string;
  // Text or bytes to write, or null to remove the file.
  content: string | Uint8Array | null;
}

export interface Manifest {
  version: 1;
  managed: Record<string, string>;
}

export type ManagedKind = "skill" | "contract-template";

export type ManagedOutcomeStatus =
  | "created"
  | "registered"
  | "updated"
  | "current"
  | "preserved-unmanaged"
  | "preserved-customized";

export interface ManagedOutcome {
  path: string;
  status: ManagedOutcomeStatus;
}

export type ManagedInspectionStatus = "managed" | "customized" | "present-unmanaged" | "blocked" | "missing";

export interface ManagedInspection {
  path: string;
  kind: ManagedKind;
  status: ManagedInspectionStatus;
}

export type PolicyMarkerState = "absent" | "valid" | "invalid";

export type PolicyInspectionStatus = "valid" | "missing" | "invalid" | "blocked";

export interface PolicyPlan {
  path: string;
  target: string;
  changed: boolean;
  content?: string;
  sharedWith?: string;
}

export interface PackageScript {
  name: string;
  command: string;
}

export interface Detection {
  projectKinds: string[];
  frameworks: string[];
  languages: string[];
  verificationTools: string[];
  workspaces: string[];
  packageScripts: PackageScript[];
}

export interface LinkedFile {
  path: string;
  linkedFrom?: string;
}
