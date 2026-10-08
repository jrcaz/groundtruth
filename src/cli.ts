import { readFileSync } from "node:fs";
import path from "node:path";
import { doctorProject, initProject, migrateProject, updateProject } from "./commands.js";
import { PACKAGE_ROOT } from "./constants.js";
import { findLegacySetup } from "./legacy.js";

const packageJson = JSON.parse(readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8")) as { version: string };

const help = `GroundTruth CLI ${packageJson.version}

Usage:
  groundtruth <command>

Commands:
  init      Detect the project, create a feature map, and install GroundTruth guidance
  update    Refresh unchanged, GroundTruth-managed shared files
  doctor    Check installation and detected verification tools
  migrate   Move a setup made by Prove, the earlier name of GroundTruth
  --help    Show this help
  --version Show the installed version`;

export async function main(args: readonly string[]): Promise<void> {
  const [command] = args;
  if (!command || command === "--help" || command === "-h" || command === "help") {
    console.log(help);
    return;
  }
  if (command === "--version" || command === "-v" || command === "version") {
    console.log(packageJson.version);
    return;
  }
  if (args.length > 1) throw new Error(`Unexpected arguments: ${args.slice(1).join(" ")}`);
  if (command === "init" || command === "update") {
    // Running these next to a Prove setup would add a second, separate setup.
    const legacy = findLegacySetup(process.cwd());
    if (legacy.length) {
      throw new Error(`Found a setup from Prove, the earlier name of GroundTruth: ${legacy.join(", ")}. Run \`groundtruth migrate\` instead. It moves the Prove files and then finishes the GroundTruth setup. No files were changed.`);
    }
  }
  if (command === "init") initProject();
  else if (command === "update") updateProject();
  else if (command === "migrate") migrateProject();
  else if (command === "doctor") {
    const result = doctorProject();
    if (!result.healthy) process.exitCode = 1;
  } else {
    throw new Error(`Unknown command '${command}'. Run 'groundtruth --help' for usage.`);
  }
}
