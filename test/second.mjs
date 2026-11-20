// A second writer's hidden suite (bin/second.mjs): calibrated on the first
// suite's reference with no session, then run by judge beside the first; a
// pass needs both. No model: the second suite here is the first one's tests
// plus one hand-written test the bundled reference fails on purpose (the
// stand-in for a rule the first writer never tested).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const home = mkdtempSync(join(tmpdir(), "bouncer-second-test-"));
const env = { ...process.env, BOUNCER_HOME: home, BOUNCER_SPECS: "" };
const run = (...argv) => spawnSync(process.execPath, argv, { cwd: ROOT, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
try {
  const first = join(home, "specs", "duration-parse");
  const second = join(home, "specs", "duration-parse-second");
  cpSync(join(ROOT, "specs", "duration-parse"), first, { recursive: true });
  for (const part of ["spec.md", "skeleton", "tests", "reference"]) cpSync(join(first, part), join(second, part), { recursive: true });
  const file = readdirSync(join(second, "tests", "private")).find((name) => name.endsWith(".test.ts"));
  const source = readFileSync(join(second, "tests", "private", file), "utf8");
  // Passes the reference: kept. And one the reference cannot satisfy: dropped by calibration.
  writeFileSync(join(second, "tests", "private", file), `${source}\ntest("[happy-1] the second writer's own case", () => { assert.equal(parseDuration("13m"), 780000); });\ntest("[happy-1] a case the reference fails", () => { assert.equal(parseDuration("1s"), 999); });\n`);

  // No Codex login and no --backend: refused before any session, not a silent Claude writer.
  // A `codex` on PATH or not makes no difference: the backend installs its own CLI.
  writeFileSync(join(first, "imported.json"), "{}\n");
  const noLogin = { ...env, CODEX_HOME: join(home, "no-codex-login") };
  delete noLogin.OPENAI_API_KEY;
  delete noLogin.CODEX_API_KEY;
  const noCodex = spawnSync(process.execPath, [join(ROOT, "bin", "second.mjs"), "duration-parse"], { cwd: ROOT, env: noLogin, encoding: "utf8" });
  rmSync(join(first, "imported.json"));
  assert.equal(noCodex.status, 1, noCodex.stdout + noCodex.stderr);
  assert.match(noCodex.stderr, /no Codex login here .*, and the second writer should be another model family/);
  assert.match(noCodex.stderr, /--backend claude-cli to accept a Claude writer anyway/);
  console.log("ok - second refuses a same-family writer unless --backend names one");

  const calibrate = run("--input-type=module", "-e", `
    import { calibrateOnReference } from "${join(ROOT, "bin", "second.mjs")}";
    import { writeJson } from "${join(ROOT, "bin", "lib.mjs")}";
    import { recordCommitment } from "${join(ROOT, "bin", "commitment.mjs")}";
    const record = calibrateOnReference("duration-parse-second");
    writeJson("${join(second, "calibration.json")}", { ...record, writer: { backend: "hand", model: null }, of: "duration-parse" });
    recordCommitment("duration-parse-second", "test");
    console.log(JSON.stringify({ status: record.status, kept: record.kept.length, written: record.hiddenWritten, dropped: record.dropped.map((item) => item.id) }));`);
  assert.equal(calibrate.status, 0, calibrate.stderr);
  const calibrated = JSON.parse(calibrate.stdout.trim().split("\n").at(-1));
  assert.equal(calibrated.status, "ok");
  assert.equal(calibrated.kept, calibrated.written - 1);
  assert.match(calibrated.dropped.join("\n"), /a case the reference fails/);
  console.log("ok - calibrateOnReference: kept what the reference passes, dropped what it cannot");

  const judged = run(join(ROOT, "bin", "judge.mjs"), "duration-parse", join(first, "reference", "src"), "--plain");
  assert.equal(judged.status, 0, judged.stdout + judged.stderr);
  assert.match(judged.stdout, /duration-parse: passed\. Public 22\/22, hidden 39\/39, second hidden \d+\/\d+\./);
  assert.match(judged.stdout, /Second hidden suite by hand, sha256 [0-9a-f]{64}\./);

  // A submission that clears the first suite and not the second: overfit, with the second suite's key.
  const broken = join(home, "broken");
  cpSync(join(first, "reference", "src"), join(broken, "src"), { recursive: true });
  const index = join(broken, "src", "index.ts");
  writeFileSync(index, readFileSync(index, "utf8").replace("export function parseDuration(text: string): number {", 'export function parseDuration(text: string): number {\n  if (text === "13m") return 0;'));
  const strict = run(join(ROOT, "bin", "judge.mjs"), "duration-parse", join(broken, "src"), "--plain");
  assert.equal(strict.status, 2, strict.stdout + strict.stderr);
  assert.match(strict.stdout, /duration-parse: overfit\. Public 22\/22, hidden 39\/39, second hidden \d+\/\d+\./);
  assert.match(strict.stdout, /failing happy-1/);
  console.log("ok - judge runs the second suite: passed needs both, a second-suite failure is overfit with its key");

  writeFileSync(join(second, "tests", "private", file), `${source}\n// changed\n`);
  const moved = run(join(ROOT, "bin", "judge.mjs"), "duration-parse", join(first, "reference", "src"), "--plain");
  assert.equal(moved.status, 1);
  assert.match(moved.stderr, /duration-parse-second: hidden suite changed since/);
  console.log("ok - a second suite changed after its commitment is refused");
} finally {
  rmSync(home, { recursive: true, force: true });
}
