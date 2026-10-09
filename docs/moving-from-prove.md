# Moving from Prove

GroundTruth used to be called Prove. A project set up with `prove init` has a `.prove/` directory, `prove` skills, and a section in `AGENTS.md` and `CLAUDE.md` marked with `<!-- prove:managed:start -->` and `<!-- prove:managed:end -->`. GroundTruth does not use any of those. Running GroundTruth next to them would add a second, separate setup, so `init` and `update` refuse to run while they are present, or while a `feature-map` skill still points at `.prove/`, and `doctor` lists them.

Run the commands on this page from the project root. Until the package is published, replace `groundtruth` with `npx --yes --package=github:jrcaz/groundtruth groundtruth`. Back to the [README](../README.md).

From the project root, preferably with a clean Git working tree so you can review the change, run:

```sh
groundtruth migrate
```

Here is what it printed for a project set up with the last Prove release:

```text
moved .prove/FEATURE_MAP.md to .groundtruth/FEATURE_MAP.md
moved .prove/PROJECT.md to .groundtruth/PROJECT.md
removed .prove/contracts/TEMPLATE.md; it was never edited, so the current template replaces it
removed .agents/skills/prove/SKILL.md
removed .claude/skills/prove/SKILL.md
removed .agents/skills/feature-map/SKILL.md
removed .claude/skills/feature-map/SKILL.md
replaced the Prove section in AGENTS.md with the GroundTruth section
replaced the Prove section in CLAUDE.md with the GroundTruth section
removed .prove/contracts/
removed .prove/
removed .agents/skills/prove/
removed .claude/skills/prove/
Detected project: Software project
Frameworks: Not identified
Languages: JavaScript/TypeScript
Verification tools: none detected
kept .groundtruth/PROJECT.md; project context is never overwritten
kept .groundtruth/FEATURE_MAP.md; feature maps are never overwritten
created .agents/skills/groundtruth/SKILL.md
created .claude/skills/groundtruth/SKILL.md
created .agents/skills/feature-map/SKILL.md
created .claude/skills/feature-map/SKILL.md
created .groundtruth/contracts/TEMPLATE.md
confirmed AGENTS.md
confirmed CLAUDE.md
GroundTruth is ready. Try: "Implement this feature and prove it works."
```

`migrate` makes these changes and then runs `init`:

- It moves everything in `.prove/` to `.groundtruth/`, including your project context, feature map, and contracts. In moved Markdown files it changes `.prove` paths to `.groundtruth`, the `# Prove project context` heading and the "existing Prove contracts" note that Prove generated, and mentions of the `prove` skill. Other files keep their content.
- It deletes the old manifest. It removes the `prove` skills and the old `feature-map` skills, but only if you never edited them. The hashes in `.prove/.prove-managed.json` tell it which files those are. The old contract template is removed the same way, and an edited template moves with your other files. `init` then installs the current versions.
- It replaces the old section in `AGENTS.md` and `CLAUDE.md` with the GroundTruth section, in the same place. If a file already has a GroundTruth section, it removes only the old one.

Before it changes anything, it checks every file and runs the checks `init` would run. It stops without changing files and lists every problem when:

- A `prove` or `feature-map` skill has local edits, or `.prove/.prove-managed.json` is missing so it cannot tell. Copy your edits somewhere safe and delete the file. After migrating, add the edits to the new skill.
- A file exists in both `.prove/` and `.groundtruth/` with different content, for example because `groundtruth init` ran before the project was migrated. Keep one copy and delete the other.
- The old markers are unpaired, repeated, or out of order.
- `.prove/.prove-managed.json` is not valid, `.prove/` contains a symbolic link or anything other than files and directories, or `init` would refuse the project, for example because of broken GroundTruth markers.

What `migrate` does not do:

- It does not change other mentions of "Prove" in your own text, because the word is also a verb. If your notes or contracts name the tool, search for them after migrating.
- It does not change `.prove` references outside the moved Markdown files, such as in CI configuration, `.gitignore`, scripts, or text outside the marked section in `AGENTS.md`.
- It replaces everything between the old markers, including text you added there, as `init` always has.
- It does not keep file permissions or empty directories from `.prove/`. A Markdown file that is not UTF-8 moves without its paths renamed, and the output says so.
- If the `init` step fails after the files moved, for example because of a permission error, the files stay moved. Fix the problem and run `groundtruth init`.

To migrate by hand instead:

1. Rename the directory with `git mv .prove .groundtruth`, then delete the old manifest with `rm .groundtruth/.prove-managed.json`. `git rm` refuses it right after the move because the move staged it.
2. Inside the moved files, replace `.prove/` with `.groundtruth/` and the name "Prove" with "GroundTruth". Relative source links in the feature map still work; only text that spells out the directory or product name changes.
3. Delete the old skills: `.claude/skills/prove/`, `.agents/skills/prove/`, `.claude/skills/feature-map/`, and `.agents/skills/feature-map/`. The old feature-map skill points agents at `.prove/`, and once the manifest is gone `update` will not replace it. Copy out any local edits first; `init` installs fresh versions.
4. In `AGENTS.md` and `CLAUDE.md`, delete the old section, including the `<!-- prove:managed:start -->` and `<!-- prove:managed:end -->` lines.
5. Run `groundtruth init`. It keeps your moved context, map, and contracts, installs the new skills, and adds the new section.
