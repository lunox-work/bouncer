#!/usr/bin/env node
// `bouncer ci init`: the ID comment on pull requests in one command. It
// writes .github/workflows/bouncer-id.yml (the caller of
// .github/workflows/id-comment.yml) into the checkout and sets the
// repository secret the session runs on, through the GitHub CLI.
//
//   bouncer ci init [--repo <checkout>] [--api-key | --openai-key] [--ref <ref>] [--force] [--dry-run]
//
// - Default: the person's Claude subscription. The secret is
//   CLAUDE_CODE_OAUTH_TOKEN, made by `claude setup-token`.
// - --api-key: ANTHROPIC_API_KEY instead (billed per push, about $0.06);
//   --openai-key: OPENAI_API_KEY, for Codex. The caller passes all three, so
//   switching later is a secret, not an edit; the token wins when several are set.
//
// The secret's value never passes through argv, the output or an agent:
// - already a secret of the repository: nothing to do;
// - in this process's environment under its own name: piped to `gh secret set`;
// - a person's terminal: `claude setup-token` runs (subscription), then
//   `gh secret set` asks them to paste it;
// - otherwise (a coding agent's shell): it prints the one command for the
//   person to run in their own terminal and exits 2.
//
// It never commits or pushes: the workflow file is left for the person or
// their agent to commit. The pull request that adds it gets the first comment.
// Exit 0 done, 1 error, 2 the person's secret step is left.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const WORKFLOW = ".github/workflows/bouncer-id.yml";
const REUSABLE = "lunox-work/bouncer/.github/workflows/id-comment.yml";
export const MODES = {
  subscription: { secret: "CLAUDE_CODE_OAUTH_TOKEN", what: "your Claude subscription (Pro or Max)" },
  "api-key": { secret: "ANTHROPIC_API_KEY", what: "an Anthropic API key, about $0.06 a push" },
  "openai-key": { secret: "OPENAI_API_KEY", what: "an OpenAI key, on Codex" },
};

/** The caller workflow: block style only (a flow mapping holding `${{ }}` is not YAML). */
export function callerWorkflow({ ref = "main" } = {}) {
  return [
    "# Bouncer's ID check on each pull request: what the ticket never said and",
    "# what the change picked, as one comment edited in place. Never a check.",
    "# Runs on CLAUDE_CODE_OAUTH_TOKEN (Claude subscription, `claude setup-token`)",
    "# or ANTHROPIC_API_KEY; the token wins when both are set. Written by `bouncer ci init`.",
    "name: bouncer id",
    "on:",
    "  pull_request:",
    "    types: [opened, synchronize, edited]",
    "jobs:",
    "  id:",
    "    permissions:",
    "      contents: read",
    "      pull-requests: write",
    "      issues: read",
    `    uses: ${REUSABLE}@${ref}`,
    "    secrets:",
    "      claude-code-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}",
    "      anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}",
    "      openai-api-key: ${{ secrets.OPENAI_API_KEY }}",
    "",
  ].join("\n");
}

/** owner/repo from a GitHub remote URL (https, ssh or git@), or null. */
export function slugOf(url) {
  const match = /github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(String(url ?? "").trim());
  return match ? `${match[1]}/${match[2]}` : null;
}

/** The workflow files of a checkout that already call the reusable workflow. */
export function callersIn(root) {
  const dir = join(root, ".github", "workflows");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => /\.ya?ml$/.test(name))
    .filter((name) => readFileSync(join(dir, name), "utf8").split("\n").some((line) => line.trim().startsWith(`uses: ${REUSABLE}@`)))
    .map((name) => `.github/workflows/${name}`);
}

/**
 * What to do about the workflow file: "write", "same" (already there),
 * "elsewhere" (another file calls it), or "differs" (bouncer-id.yml is
 * someone's own, left alone without --force).
 */
export function workflowPlan(root, text, { force = false } = {}) {
  const path = join(root, WORKFLOW);
  if (existsSync(path)) {
    const now = readFileSync(path, "utf8");
    if (now === text) return { action: "same" };
    return force ? { action: "write" } : { action: "differs" };
  }
  const others = callersIn(root);
  return others.length > 0 ? { action: "elsewhere", files: others } : { action: "write" };
}

const defaultDeps = {
  run: (bin, argv, options = {}) => spawnSync(bin, argv, { encoding: "utf8", ...options }),
  env: process.env,
  tty: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  log: (line) => console.error(line),
  out: (line) => console.log(line),
};

/** Sets up the ID comment; returns the exit code. `deps` stands in for processes and the terminal in tests. */
export async function ciInit(options, deps = defaultDeps) {
  const { run, env, tty, log, out } = { ...defaultDeps, ...deps };
  const mode = options["api-key"] ? "api-key" : options["openai-key"] ? "openai-key" : "subscription";
  if (options["api-key"] && options["openai-key"]) throw new Error("--api-key or --openai-key, not both");
  const { secret, what } = MODES[mode];
  const dry = Boolean(options["dry-run"]);
  const version = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8")).version;
  const self = `npx -y @lunox-work/bouncer@${version} ci init${mode === "subscription" ? "" : ` --${mode}`}`;

  const top = run("git", ["-C", resolve(options.repo ?? "."), "rev-parse", "--show-toplevel"]);
  if (top.status !== 0) throw new Error(`${resolve(options.repo ?? ".")} is not a git checkout`);
  const root = top.stdout.trim();
  const remote = run("git", ["-C", root, "remote", "get-url", "origin"]);
  let slug = remote.status === 0 ? slugOf(remote.stdout) : null;

  // 1. The workflow file.
  const text = callerWorkflow({ ref: options.ref ?? "main" });
  const plan = workflowPlan(root, text, { force: Boolean(options.force) });
  if (plan.action === "differs") {
    log(`${WORKFLOW} exists and is not bouncer's caller; left as it is (--force replaces it).`);
    return 1;
  }
  if (plan.action === "write") {
    if (!dry) {
      mkdirSync(join(root, ".github", "workflows"), { recursive: true });
      writeFileSync(join(root, WORKFLOW), text);
    }
    out(`${dry ? "would write" : "wrote"} ${WORKFLOW}`);
  } else if (plan.action === "same") out(`${WORKFLOW} is already there`);
  else {
    out(`already called from ${plan.files.join(", ")}`);
    const input = { CLAUDE_CODE_OAUTH_TOKEN: "claude-code-oauth-token", ANTHROPIC_API_KEY: "anthropic-api-key", OPENAI_API_KEY: "openai-api-key" }[secret];
    const missing = plan.files.filter((file) => !readFileSync(join(root, file), "utf8").includes(`secrets.${secret}`));
    if (missing.length > 0) {
      log(`${missing.join(", ")} does not pass ${secret}: add \`${input}: \${{ secrets.${secret} }}\` under its \`secrets:\`, then run this again.`);
      return 1;
    }
  }

  // 2. The secret.
  const gh = run("gh", ["--version"]);
  if (gh.error || gh.status !== 0) {
    log(`No GitHub CLI: install gh and run \`gh auth login\`, then run this again. Or add the ${secret} secret in the repository's Settings → Secrets and variables → Actions.`);
    return 2;
  }
  if (slug === null) {
    const viewed = run("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], { cwd: root });
    slug = viewed.status === 0 ? viewed.stdout.trim() || null : null;
  }
  if (slug === null) throw new Error("No GitHub repository for this checkout (no github.com origin, and `gh repo view` found none)");
  const listed = run("gh", ["secret", "list", "--repo", slug, "--json", "name", "-q", ".[].name"]);
  const names = listed.status === 0 ? listed.stdout.split("\n").map((line) => line.trim()).filter(Boolean) : null;
  if (names?.includes(secret)) {
    out(`${slug} already has ${secret}: the comment runs on ${what}.`);
    return finish();
  }
  if (mode === "subscription" && names?.includes("ANTHROPIC_API_KEY"))
    log(`${slug} has ANTHROPIC_API_KEY: until ${secret} is set it runs on that key. (\`bouncer ci init --api-key\` keeps it that way.)`);
  if (dry) {
    out(`would set ${secret} on ${slug}`);
    return finish();
  }

  if (env[secret]) {
    const set = run("gh", ["secret", "set", secret, "--repo", slug], { input: env[secret] });
    if (set.status !== 0) throw new Error(`gh secret set ${secret}: ${(set.stderr || "").trim() || `exit ${set.status}`}`);
    out(`set ${secret} on ${slug} from this environment: the comment runs on ${what}.`);
    return finish();
  }
  if (!tty) {
    // A coding agent's shell: the person's step, in their own terminal, so the value never enters a transcript.
    log(
      [
        `One step is yours: the ${secret} secret on ${slug}, for ${what}.`,
        `Run this in your own terminal (not through the agent, so the ${mode === "subscription" ? "token" : "key"} stays out of its transcript):`,
        "",
        `  ${self}`,
        "",
        mode === "subscription"
          ? `It runs \`claude setup-token\` (sign in with the browser), then \`gh secret set ${secret} --repo ${slug}\` asks you to paste the token.`
          : `\`gh secret set ${secret} --repo ${slug}\` asks you to paste the key.`,
        ...(mode === "subscription" ? ["No Claude Pro or Max subscription? The same command with --api-key uses an Anthropic API key."] : []),
      ].join("\n"),
    );
    return 2;
  }
  if (mode === "subscription") {
    const { findClaude } = await import("./lib.mjs");
    const claude = deps.claude ?? findClaude();
    if (claude === null) throw new Error("No claude CLI here to make the token (`claude setup-token`). Install Claude Code, or use --api-key.");
    log("Making a long-lived token for CI with `claude setup-token`: sign in in the browser, then copy the token it prints.");
    const made = run(claude, ["setup-token"], { stdio: "inherit" });
    if (made.status !== 0) throw new Error(`claude setup-token exited ${made.status}`);
  }
  log(`Paste the ${mode === "subscription" ? "token" : "key"} when gh asks (it is not shown).`);
  const set = run("gh", ["secret", "set", secret, "--repo", slug], { stdio: "inherit" });
  if (set.status !== 0) throw new Error(`gh secret set ${secret} exited ${set.status}`);
  out(`set ${secret} on ${slug}: the comment runs on ${what}.`);
  return finish();

  function finish() {
    if (plan.action === "write")
      out(`Next: commit ${WORKFLOW} and push it. The pull request that adds it gets the first comment.`);
    return 0;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { args } = await import("./lib.mjs");
  const { options } = args();
  if (options.help !== undefined) {
    console.error("usage: bouncer ci init [--repo <checkout>] [--api-key | --openai-key] [--ref <ref>] [--force] [--dry-run]");
    process.exit(0);
  }
  try {
    process.exitCode = await ciInit(options);
  } catch (error) {
    console.error(`ci init: ${error.message}`);
    process.exitCode = 1;
  }
}
