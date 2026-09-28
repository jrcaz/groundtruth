import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { doctorProject, initProject, updateProject } from "./commands.js";

const packageJson = JSON.parse(readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf8"));

const help = `Prove CLI ${packageJson.version}

Usage:
  prove <command>

Commands:
  init      Detect the project and install Prove guidance
  update    Refresh unchanged, Prove-managed shared files
  doctor    Check installation and detected verification tools
  --help    Show this help
  --version Show the installed version`;

export async function main(args) {
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
  if (command === "init") initProject();
  else if (command === "update") updateProject();
  else if (command === "doctor") {
    const result = doctorProject();
    if (!result.healthy) process.exitCode = 1;
  } else {
    throw new Error(`Unknown command '${command}'. Run 'prove --help' for usage.`);
  }
}
