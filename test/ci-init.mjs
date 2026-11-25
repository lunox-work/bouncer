// `bouncer ci init` (bin/ci-init.mjs) in a scratch git checkout with a fake
// `gh` and a fake terminal: no network, no GitHub, no real secret.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WORKFLOW, callerWorkflow, ciInit, slugOf } from "../bin/ci-init.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = mkdtempSync(join(tmpdir(), "bouncer-ci-init-"));

assert.equal(slugOf("https://github.com/o/r.git"), "o/r");
assert.equal(slugOf("git@github.com:o/r.git\n"), "o/r");
assert.equal(slugOf("ssh://git@github.com/o/r"), "o/r");
assert.equal(slugOf("https://gitlab.com/o/r.git"), null);
console.log("ok slugOf");

// The caller is block-style YAML passing all three secrets, the token first.
{
  const text = callerWorkflow();
  assert.match(text, /uses: lunox-work\/bouncer\/\.github\/workflows\/id-comment\.yml@main\n/);
  for (const line of ["claude-code-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}", "anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}", "openai-api-key: ${{ secrets.OPENAI_API_KEY }}"])
    assert.ok(text.includes(`      ${line}\n`), line);
  assert.doesNotMatch(text, /\{ *\$\{\{/);
  assert.match(callerWorkflow({ ref: "v0.9.0" }), /id-comment\.yml@v0\.9\.0\n/);
  // Every secret the caller passes is one the reusable workflow declares.
  const reusable = readFileSync(join(ROOT, ".github/workflows/id-comment.yml"), "utf8");
  for (const [, name] of text.matchAll(/^ {6}([a-z-]+): \$\{\{ secrets\./gm)) assert.match(reusable, new RegExp(`^      ${name}:\\n`, "m"), name);
  console.log("ok callerWorkflow");
}

/** A checkout with a GitHub origin, and deps whose gh is a script of answers. */
function setup(name, { secrets = [], env = {}, tty = false, gh = true } = {}) {
  const repo = join(scratch, name);
  mkdirSync(repo, { recursive: true });
  spawnSync("git", ["init", "-q", repo]);
  spawnSync("git", ["-C", repo, "remote", "add", "origin", "git@github.com:acme/widgets.git"]);
  const calls = [];
  const lines = { out: [], log: [] };
  const deps = {
    env,
    tty,
    claude: "/fake/claude",
    out: (line) => lines.out.push(line),
    log: (line) => lines.log.push(line),
    run: (bin, argv, options = {}) => {
      if (bin === "git") return spawnSync(bin, argv, { encoding: "utf8", ...options });
      calls.push({ bin, argv, input: options.input, stdio: options.stdio });
      if (bin === "gh" && !gh) return { status: null, error: new Error("ENOENT") };
      if (bin === "gh" && argv[0] === "secret" && argv[1] === "list") return { status: 0, stdout: secrets.join("\n") + "\n" };
      return { status: 0, stdout: "" };
    },
  };
  return { repo, calls, lines, deps };
}
const sets = (calls) => calls.filter((c) => c.bin === "gh" && c.argv[0] === "secret" && c.argv[1] === "set");

// An agent's shell, subscription by default: writes the workflow, never asks
// for the token, hands the person one command, exit 2.
{
  const { repo, calls, lines, deps } = setup("agent");
  assert.equal(await ciInit({ repo }, deps), 2);
  assert.equal(readFileSync(join(repo, WORKFLOW), "utf8"), callerWorkflow());
  assert.equal(sets(calls).length, 0);
  assert.ok(!calls.some((c) => c.bin === "/fake/claude"));
  const said = lines.log.join("\n");
  assert.match(said, /CLAUDE_CODE_OAUTH_TOKEN secret on acme\/widgets/);
  assert.match(said, /npx -y @lunox-work\/bouncer@[\d.]+ ci init\n/);
  assert.match(said, /--api-key uses an Anthropic API key/);
  // Run again: the file is the same, nothing rewritten.
  assert.equal(await ciInit({ repo }, deps), 2);
  assert.ok(lines.out.includes(`${WORKFLOW} is already there`));
  console.log("ok agent shell: workflow written, the person's step left");
}

// The secret already set: done, exit 0, the next step named.
{
  const { repo, calls, lines, deps } = setup("present", { secrets: ["CLAUDE_CODE_OAUTH_TOKEN"] });
  assert.equal(await ciInit({ repo }, deps), 0);
  assert.equal(sets(calls).length, 0);
  assert.ok(lines.out.some((line) => line.startsWith(`Next: commit ${WORKFLOW}`)));
  console.log("ok secret already there");
}

// The value in the environment: piped on stdin, never in argv or the output.
{
  const value = "sk-ant-oat01-not-a-real-token";
  const { repo, calls, lines, deps } = setup("env", { env: { CLAUDE_CODE_OAUTH_TOKEN: value } });
  assert.equal(await ciInit({ repo }, deps), 0);
  const [set] = sets(calls);
  assert.deepEqual(set.argv, ["secret", "set", "CLAUDE_CODE_OAUTH_TOKEN", "--repo", "acme/widgets"]);
  assert.equal(set.input, value);
  assert.ok(!JSON.stringify({ argv: calls.map((c) => c.argv), lines }).includes(value));
  console.log("ok value from the environment, on stdin only");
}

// --api-key in an agent's shell with the key in its environment.
{
  const { repo, calls, deps } = setup("apikey", { env: { ANTHROPIC_API_KEY: "sk-ant-api-fake" }, secrets: ["SOMETHING_ELSE"] });
  assert.equal(await ciInit({ repo, "api-key": true }, deps), 0);
  assert.equal(sets(calls)[0].argv[2], "ANTHROPIC_API_KEY");
  console.log("ok --api-key");
}

// A person's terminal: claude setup-token, then gh asks for the paste.
{
  const { repo, calls, deps } = setup("tty", { tty: true });
  assert.equal(await ciInit({ repo }, deps), 0);
  const order = calls.filter((c) => c.stdio === "inherit").map((c) => [c.bin, ...c.argv].slice(0, 3).join(" "));
  assert.deepEqual(order, ["/fake/claude setup-token", "gh secret set"]);
  console.log("ok terminal: setup-token then paste");
}

// Subscription mode on a repository that has only an API key: said, then the person's step.
{
  const { repo, lines, deps } = setup("haskey", { secrets: ["ANTHROPIC_API_KEY"] });
  assert.equal(await ciInit({ repo }, deps), 2);
  assert.match(lines.log.join("\n"), /has ANTHROPIC_API_KEY: until CLAUDE_CODE_OAUTH_TOKEN is set it runs on that key/);
  console.log("ok API key already there");
}

// Someone's own bouncer-id.yml is left alone without --force; --dry-run writes nothing.
{
  const { repo, deps } = setup("own");
  mkdirSync(join(repo, ".github/workflows"), { recursive: true });
  writeFileSync(join(repo, WORKFLOW), "name: mine\n");
  assert.equal(await ciInit({ repo }, deps), 1);
  assert.equal(readFileSync(join(repo, WORKFLOW), "utf8"), "name: mine\n");
  const dry = setup("dry");
  assert.equal(await ciInit({ repo: dry.repo, "dry-run": true }, dry.deps), 0);
  assert.ok(!existsSync(join(dry.repo, WORKFLOW)));
  assert.equal(sets(dry.calls).length, 0);
  console.log("ok own file kept, dry run writes nothing");
}

// Another workflow already calls it without the token: told the line to add, exit 1.
{
  const { repo, lines, deps } = setup("elsewhere", { secrets: ["CLAUDE_CODE_OAUTH_TOKEN"] });
  mkdirSync(join(repo, ".github/workflows"), { recursive: true });
  writeFileSync(join(repo, ".github/workflows/pr.yml"), "jobs:\n  id:\n    uses: lunox-work/bouncer/.github/workflows/id-comment.yml@main\n    secrets:\n      anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}\n");
  assert.equal(await ciInit({ repo }, deps), 1);
  assert.ok(!existsSync(join(repo, WORKFLOW)));
  assert.match(lines.log.join("\n"), /add `claude-code-oauth-token: \$\{\{ secrets\.CLAUDE_CODE_OAUTH_TOKEN \}\}`/);
  console.log("ok existing caller without the token");
}

// No gh: the file is still written, the secret step named, exit 2.
{
  const { repo, lines, deps } = setup("nogh", { gh: false });
  assert.equal(await ciInit({ repo }, deps), 2);
  assert.ok(existsSync(join(repo, WORKFLOW)));
  assert.match(lines.log.join("\n"), /No GitHub CLI/);
  console.log("ok no gh");
}

// The command line routes `ci init` to it.
{
  const help = spawnSync(process.execPath, [join(ROOT, "bin/cli.mjs"), "ci", "init", "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /^bouncer ci init: /);
  assert.match(help.stdout, /bouncer ci init \[--repo/);
  console.log("ok bouncer ci init routes");
}

rmSync(scratch, { recursive: true, force: true });
