import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { doctorProject, initProject, updateProject } from "../src/commands.js";
import { FEATURE_MAP_PATH, MANIFEST_PATH } from "../src/constants.js";
import { packageContent } from "../src/content.js";
import { hash } from "../src/manifest.js";
import { silent, snapshot, symlinkOrSkip, temporaryProject } from "./helpers.js";

test("init inventories Next.js entry points without treating helpers or private files as capabilities", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  project.put("package.json", JSON.stringify({ dependencies: { next: "1" } }));
  project.put("app/(account)/login/page.tsx", "export default function Login() { return null; }\n");
  project.put("app/api/payments/route.ts", "export function POST() {}\n");
  project.put("app/layout.tsx", "export default function Layout() {}\n");
  project.put("app/login/form.tsx", "export function Form() {}\n");
  project.put("app/_private/page.tsx", "export default function Private() {}\n");
  project.put("app/@modal/login/page.tsx", "export default function Modal() {}\n");
  project.put("app/__tests__/page.tsx", "export default function Fixture() {}\n");
  project.put("app/node_modules/dependency/page.tsx", "export default function Dependency() {}\n");
  project.put("pages/_app.tsx", "export default function App() {}\n");
  project.put("pages/reports/index.tsx", "export default function Reports() {}\n");
  project.put("pages/api/receipts.ts", "export default function Receipts() {}\n");
  project.put("app/build/page.tsx", "export default function Build() {}\n");

  initProject({ cwd: project.cwd, log: silent });
  const map = project.get(FEATURE_MAP_PATH);
  assert.match(map, /^- \/login, unconfirmed$/m);
  assert.match(map, /^- \/api\/payments, unconfirmed$/m);
  assert.match(map, /^- \/reports, unconfirmed$/m);
  assert.match(map, /^- \/api\/receipts, unconfirmed$/m);
  assert.match(map, /^- \/build, unconfirmed$/m);
  assert.equal(map.match(/  - Source:/g)?.length, 5);
  for (const excluded of ["form.tsx", "layout.tsx", "_private", "@modal", "__tests__", "node_modules", "_app.tsx"]) {
    assert.ok(!map.includes(excluded), excluded);
  }
  assert.match(map, /Implementation and runtime behavior have not been reviewed/);
  assert.equal(project.get(".agents/skills/feature-map/SKILL.md"), packageContent(".agents/skills/feature-map/SKILL.md"));
  assert.equal(project.get(".claude/skills/feature-map/SKILL.md"), project.get(".agents/skills/feature-map/SKILL.md"));
  assert.equal(JSON.parse(project.get(MANIFEST_PATH)).managed[FEATURE_MAP_PATH], undefined);
});

test("starter maps find current Nuxt, SvelteKit, and Astro layouts independently in workspaces", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  project.put("package.json", JSON.stringify({ workspaces: ["apps/*"], dependencies: { express: "1" } }));
  project.put("app/fake/page.tsx", "not a Next.js application\n");
  project.put("apps/nuxt/package.json", JSON.stringify({ dependencies: { nuxt: "^4.0.0" } }));
  project.put("apps/nuxt/app/pages/(account)/login.vue", "<template>Login</template>\n");
  project.put("apps/nuxt/app/pages/helper.ts", "export const label = 'not a route';\n");
  project.put("apps/nuxt/server/api/payments/[id].get.ts", "export default defineEventHandler(() => null);\n");
  project.put("apps/nuxt/server/api/payments/[id].post.ts", "export default defineEventHandler(() => null);\n");
  project.put("apps/nuxt/server/routes/health.ts", "export default defineEventHandler(() => 'ok');\n");
  project.put("apps/nuxt/server/middleware/log.ts", "export default defineEventHandler(() => {});\n");
  project.put("apps/svelte/package.json", JSON.stringify({ devDependencies: { "@sveltejs/kit": "1" } }));
  project.put("apps/svelte/src/routes/(account)/login/+page.svelte", "<h1>Login</h1>\n");
  project.put("apps/svelte/src/routes/api/payments/+server.ts", "export function GET() {}\n");
  project.put("apps/svelte/src/routes/login/+page.server.ts", "export function load() {}\n");
  project.put("apps/astro/package.json", JSON.stringify({ dependencies: { astro: "1" } }));
  project.put("apps/astro/src/pages/reports/index.astro", "<h1>Reports</h1>\n");
  project.put("apps/astro/src/pages/api/receipts.ts", "export function GET() {}\n");

  initProject({ cwd: project.cwd, log: silent });
  const map = project.get(FEATURE_MAP_PATH);
  assert.match(map, /### apps\/nuxt \/ Web pages/);
  assert.match(map, /GET \/api\/payments/);
  assert.match(map, /POST \/api\/payments/);
  assert.match(map, /\/health, unconfirmed/);
  assert.match(map, /### apps\/svelte \/ API routes/);
  assert.match(map, /### apps\/astro \/ API routes/);
  assert.equal(map.match(/  - Source:/g)?.length, 8);
  assert.ok(!map.includes("fake/page.tsx"));
  assert.ok(!map.includes("+page.server.ts"));
  assert.ok(!map.includes("helper.ts"));
  assert.ok(!map.includes("server/middleware"));
});

test("starter maps list readable CLI entry points and keep contracts separate until reviewed", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  project.put("package.json", JSON.stringify({ name: "@example/payments", bin: "./bin/payments.js" }));
  project.put("bin/payments.js", "process.stdout.write('payments');\n");
  project.put(".prove/contracts/payments/create.md", "# Create payment contract\n");
  project.put(".prove/contracts/TEMPLATE.md", "# Template\n");

  initProject({ cwd: project.cwd, log: silent });
  const map = project.get(FEATURE_MAP_PATH);
  assert.match(map, /^- payments, unconfirmed$/m);
  assert.match(map, /\.\.\/bin\/payments\.js/);
  assert.match(map, /Contract references awaiting review/);
  assert.match(map, /<contracts\/payments\/create\.md>/);
  assert.ok(!map.includes("TEMPLATE.md"));
  assert.ok(!map.includes("Create payment, implemented"));
});

test("declared executables outside the project or missing on disk are review gaps rather than capabilities", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  project.put("package.json", JSON.stringify({ bin: { missing: "./missing.js", outside: "../outside.js" } }));

  initProject({ cwd: project.cwd, log: silent });
  const map = project.get(FEATURE_MAP_PATH);
  assert.ok(!map.includes("### CLI executables"));
  assert.match(map, /Declared CLI missing has no readable executable/);
  assert.match(map, /Declared CLI outside has no readable executable/);
});

test("unrecognized applications get review instructions without invented capabilities", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  project.put("package.json", JSON.stringify({ dependencies: { express: "1", stripe: "1" } }));
  project.put("src/payments/service.ts", "export function createPayment() {}\n");

  initProject({ cwd: project.cwd, log: silent });
  const map = project.get(FEATURE_MAP_PATH);
  assert.match(map, /No conventional entry points were discovered/);
  assert.ok(!map.includes("### Payments"));
  assert.ok(!map.includes("service.ts"));
  assert.equal(doctorProject({ cwd: project.cwd, log: silent }).healthy, true);
});

test("feature map links resolve for dynamic routes and filenames with Markdown characters", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  project.put("package.json", JSON.stringify({ dependencies: { next: "1" } }));
  project.put("src/app/receipts/[receipt]/page.tsx", "export default function Receipt() {}\n");
  project.put(".prove/contracts/receipt [details].md", "# Receipt contract\n");

  initProject({ cwd: project.cwd, log: silent });
  const map = project.get(FEATURE_MAP_PATH);
  const targets = [...map.matchAll(/\]\(<([^>]+)>\)/g)].map((match) => decodeURIComponent(match[1] ?? ""));
  assert.equal(targets.length, 2);
  for (const target of targets) assert.ok(fs.statSync(path.resolve(project.cwd, ".prove", target)).isFile(), target);
});

test("init and update preserve an existing feature map exactly and do not register it as managed", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  const map = "# Product map\r\n\r\nHuman notes and contract links.\r\n";
  project.put(FEATURE_MAP_PATH, map);
  initProject({ cwd: project.cwd, log: silent });
  const afterInit = snapshot(project.cwd);
  initProject({ cwd: project.cwd, log: silent });
  updateProject({ cwd: project.cwd, log: silent });
  assert.equal(project.get(FEATURE_MAP_PATH), map);
  assert.deepEqual(snapshot(project.cwd), afterInit);
  assert.equal(JSON.parse(project.get(MANIFEST_PATH)).managed[FEATURE_MAP_PATH], undefined);
});

test("update refreshes an unchanged feature map skill and preserves a customized copy", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  initProject({ cwd: project.cwd, log: silent });
  const agentSkill = ".agents/skills/feature-map/SKILL.md";
  const claudeSkill = ".claude/skills/feature-map/SKILL.md";
  const oldSkill = "---\nname: feature-map\ndescription: Old skill\n---\nOld instructions\n";
  project.put(agentSkill, oldSkill);
  const manifest = JSON.parse(project.get(MANIFEST_PATH));
  manifest.managed[agentSkill] = hash(oldSkill);
  project.put(MANIFEST_PATH, JSON.stringify(manifest) + "\n");
  const customizedSkill = project.get(claudeSkill) + "\nLocal guidance.\n";
  project.put(claudeSkill, customizedSkill);

  const outcomes = updateProject({ cwd: project.cwd, log: silent });
  assert.equal(outcomes.find(({ path: file }) => file === agentSkill)?.status, "updated");
  assert.equal(project.get(agentSkill), packageContent(agentSkill));
  assert.equal(outcomes.find(({ path: file }) => file === claudeSkill)?.status, "preserved-customized");
  assert.equal(project.get(claudeSkill), customizedSkill);
});

test("doctor detects a missing map or maintenance skill and init repairs the installation", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  initProject({ cwd: project.cwd, log: silent });
  fs.rmSync(path.join(project.cwd, FEATURE_MAP_PATH));
  const messages: string[] = [];
  assert.equal(doctorProject({ cwd: project.cwd, log: (message) => messages.push(message) }).healthy, false);
  assert.ok(messages.includes("MISSING " + FEATURE_MAP_PATH));
  initProject({ cwd: project.cwd, log: silent });
  assert.equal(doctorProject({ cwd: project.cwd, log: silent }).healthy, true);
  fs.rmSync(path.join(project.cwd, ".claude/skills/feature-map/SKILL.md"));
  assert.equal(doctorProject({ cwd: project.cwd, log: silent }).healthy, false);
  initProject({ cwd: project.cwd, log: silent });
  assert.equal(doctorProject({ cwd: project.cwd, log: silent }).healthy, true);
});

test("init refuses a symbolic feature map before writing any files", (t) => {
  const project = temporaryProject();
  t.after(project.clean);
  project.put("map.md", "# Keep this map\n");
  fs.mkdirSync(path.join(project.cwd, ".prove"));
  if (!symlinkOrSkip(t, "../map.md", path.join(project.cwd, FEATURE_MAP_PATH), "file")) return;
  const before = snapshot(project.cwd);

  assert.throws(() => initProject({ cwd: project.cwd, log: silent }), /Refusing to follow a symbolic link/);
  assert.deepEqual(snapshot(project.cwd), before);
});

test("starter scans skip linked source directories and disclose depth limits", (t) => {
  const project = temporaryProject();
  const linked = temporaryProject();
  t.after(project.clean);
  t.after(linked.clean);
  project.put("package.json", JSON.stringify({ dependencies: { next: "1" } }));
  linked.put("secret/page.tsx", "export default function Secret() {}\n");
  project.put("app/" + Array.from({ length: 18 }, () => "deep").join("/") + "/page.tsx", "export default function Deep() {}\n");
  if (!symlinkOrSkip(t, linked.cwd, path.join(project.cwd, "src"), "dir")) return;

  initProject({ cwd: project.cwd, log: silent });
  const map = project.get(FEATURE_MAP_PATH);
  assert.ok(!map.includes("secret/page.tsx"));
  assert.match(map, /reached its depth or entry limit/);
  assert.match(map, /Could not inspect src\/app/);
});
