// The commands that hand work to the hosted platform (sandbox-factory)
// instead of running it here, over platform-client.mjs:
//
//   push <slug>       a spec confirmed here becomes a bounty in the signed-in
//                     workspace: POST /api/v1/orgs/:org/bounties with the
//                     ticket's title and `spec: { document: spec.md as
//                     written, format: "duediligence", confirmed, engine }`,
//                     `confirmed` true only while confirmed.json's hash is
//                     spec.md's; the platform then records the decisions as
//                     confirmed by the token's person (a token without
//                     `decisions:confirm` gets `confirmation:
//                     "skipped_scope"`), so approval needs no second
//                     confirmation. 422 `invalid_spec` lists each problem;
//                     a platform older than posted specs (400
//                     `invalid_bounty`) is sent `{ title, description }`.
//                     Recorded in specs/<slug>/platform.json, so pushing
//                     again names the bounty already made.
//   ci --platform     a pull request judged by the platform against a
//                     published version's hidden suite, which never reaches
//                     the runner: the PR's changed files go to
//                     POST /api/judge with the run's GitHub OIDC token (no
//                     secret on either side; the platform checks the token
//                     names the repository the version was sliced from),
//                     then GET /api/judge/:id?workspace= until a verdict. The job's own
//                     pass or fail is the check. A 409 `retryable` (the
//                     platform's active-run limit) is sent again after its
//                     Retry-After, a few times.
//
// Each takes its argv and the outside world as `deps` (account.mjs's, plus
// `git` and `readFile`), so test/hosted.mjs drives them against a fake
// platform.

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { defaultDeps as accountDeps } from "./account.mjs";
import { confirmation } from "./confirm.mjs";
import { specDir } from "./lib.mjs";
import { credentialFor, credentialsPath, platformUrl, PlatformError, request, sendRetrying } from "./platform-client.mjs";

/** The platform's limits on one submission (sandbox-factory SUBMISSION_LIMITS). */
const MAX_FILES = 200;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_BYTES = 4_000_000;
/** How often a verdict is asked for, and for how long. */
const POLL_MS = 10_000;
const POLL_LIMIT_MS = 45 * 60_000;
const TITLE_MAX = 255;
const DESCRIPTION_MAX = 20_000;

export function defaultDeps() {
  return {
    ...accountDeps(),
    git: (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }),
    readFile: (path) => readFileSync(path),
  };
}

function options(argv, spec, usage, positionals = false) {
  try {
    return parseArgs({ args: argv, options: { ...spec, help: { type: "boolean", short: "h" } }, allowPositionals: positionals });
  } catch (error) {
    throw new PlatformError(`${error.message}\n${usage}`);
  }
}

/** The first `# ` heading of a markdown text, else its first line. */
export function titleOf(text) {
  const heading = /^#\s+(.+)$/m.exec(text)?.[1];
  const line = heading ?? text.split("\n").find((each) => each.trim() !== "") ?? "";
  return line.trim().slice(0, TITLE_MAX);
}

/** The lines a 422 `invalid_spec` names: each problem's path and message. */
function specProblems(error) {
  const problems = Array.isArray(error.body?.problems) ? error.body.problems : [];
  return problems.length === 0 ? [error.message] : problems.map((problem) => `${problem.path}: ${problem.message}`);
}

/** `push <slug>`: a locally confirmed spec as a bounty in the signed-in workspace. */
export async function push(argv, { client, version }, deps) {
  const usage = `usage: ${client} push <slug> [--platform <url>] [--again] [--unconfirmed]`;
  const { values, positionals } = options(
    argv,
    { platform: { type: "string" }, again: { type: "boolean" }, unconfirmed: { type: "boolean" } },
    usage,
    true,
  );
  if (values.help || positionals.length !== 1) {
    deps.out(
      `${usage}\n\nPosts specs/<slug>/spec.md, as confirmed (${client} confirm <slug> --by <name>), as a bounty in the workspace\n` +
        `${client} login signed in to, its decisions recorded as confirmed by you, so approval needs no second confirmation.\n` +
        `The bounty's title is ticket.md's (else spec.md's) heading. Pushing again names the bounty already made\n` +
        `(specs/<slug>/platform.json); --again posts a new one, as after editing the spec. --unconfirmed posts a spec\n` +
        `not confirmed here, its decisions to confirm in the web app.\n`,
    );
    return values.help ? 0 : 1;
  }
  const [slug] = positionals;
  const dir = specDir(slug);
  const confirmed = confirmation(slug);
  if (!confirmed.ok && !(values.unconfirmed && confirmed.hash !== undefined))
    throw new PlatformError(`specs/${slug}: ${confirmed.reason}. Confirm it first: ${client} confirm ${slug} --by <name>.`);
  const base = platformUrl(values.platform, deps.env);
  const saved = credentialFor(credentialsPath(deps.env), base, client);
  if (saved === undefined) throw new PlatformError(`Not signed in to ${base}. Run \`${client} login\`.`);
  const recordPath = join(dir, "platform.json");
  const recorded = existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, "utf8")) : null;
  if (recorded !== null && !values.again && recorded.base === base && recorded.organizationId === saved.organizationId) {
    const stale = recorded.specSha256 !== confirmed.hash;
    deps.out(
      `specs/${slug} is bounty ${recorded.bountyId} in @${saved.organizationHandle} (pushed ${recorded.pushedAt.slice(0, 10)}).\n` +
        (stale ? "spec.md was confirmed again since; --again posts it as a new bounty.\n" : ""),
    );
    return 0;
  }
  const spec = readFileSync(join(dir, "spec.md"), "utf8");
  const ticketPath = join(dir, "ticket.md");
  const title = titleOf(existsSync(ticketPath) ? readFileSync(ticketPath, "utf8") : spec);
  if (title === "") throw new PlatformError(`specs/${slug}: no title in ticket.md or spec.md.`);
  if (spec.length > DESCRIPTION_MAX)
    throw new PlatformError(`specs/${slug}/spec.md is ${spec.length} characters; a bounty takes ${DESCRIPTION_MAX}.`);
  const post = (body) =>
    request({
      base,
      token: saved.token,
      client,
      version,
      fetchImpl: deps.fetchImpl,
      method: "POST",
      path: `/api/v1/orgs/${encodeURIComponent(saved.organizationId)}/bounties`,
      body,
    });
  const posted = { document: spec, format: "duediligence", confirmed: confirmed.ok, engine: { name: "duediligence", version } };
  let made;
  let asText = false;
  try {
    made = await post({ title, spec: posted });
  } catch (error) {
    if (!(error instanceof PlatformError)) throw error;
    if (error.status === 422 && error.code === "invalid_spec") {
      throw new PlatformError(
        `${base} cannot store specs/${slug}/spec.md as written; nothing was posted:\n${specProblems(error)
          .map((line) => `  ${line}`)
          .join("\n")}`,
        { status: error.status, code: error.code },
      );
    }
    // A platform older than posted specs refuses the unknown `spec` field; it takes the text alone.
    if (error.status !== 400 || error.code !== "invalid_bounty") throw error;
    made = await post({ title, description: spec });
    asText = true;
  }
  const bountyId = made?.bounty?.id;
  if (typeof bountyId !== "string") throw new PlatformError(`${base} answered without a bounty.`);
  const state = asText ? "text" : !confirmed.ok ? "unconfirmed" : made.confirmation === "skipped_scope" ? "skipped_scope" : "confirmed";
  writeFileSync(
    recordPath,
    `${JSON.stringify(
      {
        base,
        organizationId: saved.organizationId,
        bountyId,
        specSha256: confirmed.hash,
        confirmedBy: confirmed.record?.by ?? null,
        confirmation: state,
        pushedAt: new Date(deps.now()).toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  const next = {
    confirmed: `Its decisions stand confirmed (by ${confirmed.record?.by} here), so approving its price needs no separate confirm step.\n`,
    skipped_scope:
      `The spec is kept, but not its confirmation: this sign-in lacks the decisions:confirm scope. Run \`${client} login\`\n` +
      "again for a token with it, and confirm the decisions in the web app (MCP confirm_link) for this bounty.\n",
    unconfirmed: "Its decisions are not confirmed: a person confirms them in the web app (MCP confirm_link) before approval.\n",
    text:
      `This platform does not take posted specs yet: spec.md was sent as the bounty's text, and sizing drafts its own\n` +
      "spec from it, whose decisions a person confirms in the web app.\n",
  }[state];
  deps.out(
    `Posted specs/${slug} as bounty ${bountyId} in @${saved.organizationHandle} on ${base}.\n${next}` +
      "Size it there, or with the MCP tool size_bounty.\n",
  );
  return 0;
}

/** A GitHub Actions OIDC token for `audience`; the job needs `permissions: id-token: write`. */
export async function oidcToken(audience, deps) {
  const url = deps.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const bearer = deps.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !bearer)
    throw new PlatformError(
      "No GitHub OIDC token: run in GitHub Actions with `permissions: id-token: write` (ACTIONS_ID_TOKEN_REQUEST_URL is unset).",
    );
  const response = await deps.fetchImpl(`${url}${url.includes("?") ? "&" : "?"}audience=${encodeURIComponent(audience)}`, {
    headers: { Authorization: `Bearer ${bearer}`, Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || typeof body.value !== "string") throw new PlatformError(`GitHub gave no OIDC token (HTTP ${response.status}).`);
  return body.value;
}

/** The PR's added and modified files between `base` and HEAD, whole, as the checkout has them. */
export function changedFiles(repo, base, deps) {
  const names = deps
    .git(["diff", "--name-only", "--diff-filter=AM", "-z", `${base}...HEAD`], repo)
    .split("\0")
    .filter((name) => name !== "");
  if (names.length > MAX_FILES) throw new PlatformError(`The change touches ${names.length} files; the platform judges up to ${MAX_FILES}.`);
  const files = [];
  const skipped = [];
  for (const path of names) {
    const bytes = deps.readFile(resolve(repo, path));
    if (bytes.length > MAX_FILE_BYTES || bytes.includes(0)) skipped.push(path);
    else files.push({ path, text: bytes.toString("utf8") });
  }
  const total = files.reduce((sum, file) => sum + Buffer.byteLength(file.text), 0);
  if (total > MAX_BYTES) throw new PlatformError(`The change is ${total} bytes; the platform judges up to ${MAX_BYTES}.`);
  return { files, skipped };
}

const EXIT = { passed: 0, overfit: 2 };

/** `ci --platform`: the change judged on the platform; answers the exit code. */
export async function ciPlatform(argv, { client, version }, deps) {
  const usage = `usage: ${client} ci --platform [<url>] --version <sandbox version id> --workspace <workspace id> [--repo <checkout>] [--base <rev>] [--exit-zero]`;
  const { values } = options(
    argv,
    {
      platform: { type: "string" },
      version: { type: "string" },
      workspace: { type: "string" },
      repo: { type: "string" },
      base: { type: "string" },
      "exit-zero": { type: "boolean" },
    },
    usage,
  );
  if (values.help || !values.version || !values.workspace) {
    deps.out(
      `${usage}\n\nJudges this pull request on the platform against a published sandbox version's hidden suite, which never\n` +
        `reaches the runner. Sends the files the PR added or changed since --base (default origin/$GITHUB_BASE_REF), with\n` +
        `the run's GitHub OIDC token (the job needs \`permissions: id-token: write\`); the platform accepts it only from the\n` +
        `repository the version was sliced from. Prints the verdict, counts and failing scenario keys.\n` +
        `Exit: 0 passed, 2 overfit, 1 otherwise (0 with --exit-zero).\n`,
    );
    return values.help ? 0 : 1;
  }
  const base = platformUrl(values.platform === "" ? undefined : values.platform, deps.env);
  const repo = resolve(values.repo ?? ".");
  const from = values.base ?? (deps.env.GITHUB_BASE_REF ? `origin/${deps.env.GITHUB_BASE_REF}` : "HEAD~1");
  const { files, skipped } = changedFiles(repo, from, deps);
  for (const path of skipped) deps.err(`skipped ${path}: binary or over ${MAX_FILE_BYTES / 1024} KiB\n`);
  if (files.length === 0) {
    deps.out(`No file changed since ${from}; nothing to judge.\n`);
    return 0;
  }
  const call = async (options) =>
    request({ base, token: await oidcToken(base, deps), client, version, fetchImpl: deps.fetchImpl, ...options });
  let { submission } = await sendRetrying(
    () => call({ method: "POST", path: "/api/judge", body: { workspace: values.workspace, versionId: values.version, files } }),
    {
      sleep: deps.sleep,
      onWait: (seconds, attempt) =>
        deps.err(`The platform is at its active-run limit; the submission is kept. Sending it again in ${seconds} s (attempt ${attempt + 1}).\n`),
    },
  );
  deps.out(`Submitted ${files.length} file${files.length === 1 ? "" : "s"} as ${submission.id}; waiting for the verdict...\n`);
  const started = deps.now();
  while (submission.status === "queued" || submission.status === "running") {
    if (deps.now() - started > POLL_LIMIT_MS) throw new PlatformError(`No verdict for ${submission.id} after ${POLL_LIMIT_MS / 60_000} minutes.`);
    await deps.sleep(POLL_MS);
    ({ submission } = await call({
      path: `/api/judge/${encodeURIComponent(submission.id)}?workspace=${encodeURIComponent(values.workspace)}`,
    }));
  }
  const outcome = submission.status === "errored" ? "errored" : (submission.verdict ?? submission.status);
  const verdict = outcome === "errored" && submission.errorCode ? `errored (${submission.errorCode})` : outcome;
  const counts =
    submission.public && submission.hidden
      ? `public ${submission.public.passed}/${submission.public.total}, hidden ${submission.hidden.passed}/${submission.hidden.total}`
      : "no tests ran";
  const lines = [
    `duediligence (platform): ${verdict}, ${counts}`,
    ...((submission.failedScenarios ?? []).length > 0 ? [`failing scenarios: ${submission.failedScenarios.join(", ")}`] : []),
    ...(submission.refused ?? []).map((refusal) => `refused ${refusal.path}: ${refusal.reason}`),
    ...(submission.status === "errored"
      ? ["grading could not run on the platform's side; a workspace owner can regrade it (MCP regrade) without spending its retry"]
      : []),
    ...(submission.carryBack === "failed" ? ["carry back failed: it passed here but cannot be merged back as it is"] : []),
  ];
  deps.out(`${lines.join("\n")}\n`);
  if (deps.env.GITHUB_STEP_SUMMARY)
    appendFileSync(deps.env.GITHUB_STEP_SUMMARY, `### ${lines[0]}\n\n${lines.slice(1).map((line) => `- ${line}`).join("\n")}\n`);
  if (values["exit-zero"]) return 0;
  return EXIT[outcome] ?? 1;
}

/** Runs one, printing a PlatformError as one line on stderr. */
export async function run(command, argv, meta, deps = defaultDeps()) {
  try {
    return await (command === "push" ? push : ciPlatform)(argv, meta, deps);
  } catch (error) {
    if (!(error instanceof PlatformError)) throw error;
    deps.err(`${meta.client} ${command}: ${error.message}\n`);
    return 1;
  }
}
