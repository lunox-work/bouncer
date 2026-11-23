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
//   prepare --hosted  a draft sandbox version built on the platform instead of
//                     here: POST .../sandboxes/versions/:vid/build, the run
//                     read at .../github/runs/:id until it ends, then the
//                     handout (.../versions/:vid/handout and its paged
//                     /files) written to a folder, each file checked against
//                     its sha256 and kept inside that folder. The hidden
//                     suite stays on the platform: only its count and
//                     commitment hash come back. Recorded in
//                     specs/<slug>/hosted.json, so running it again needs no
//                     --version.
//   judge --platform  a verdict the platform already gave, read at
//                     .../sandboxes/submissions/:sid and printed as a local
//                     verdict is: verdict, counts, failing scenario keys,
//                     refused paths, the same exit codes.
//
// Each takes its argv and the outside world as `deps` (account.mjs's, plus
// `git` and `readFile`), so test/hosted.mjs drives them against a fake
// platform.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

import { defaultDeps as accountDeps } from "./account.mjs";
import { confirmation } from "./confirm.mjs";
import { specDir } from "./lib.mjs";
import { credentialFor, credentialsPath, platformUrl, PlatformError, request, sendRetrying } from "./platform-client.mjs";
import { say } from "./voice.mjs";

/** The platform's limits on one submission (sandbox-factory SUBMISSION_LIMITS). */
const MAX_FILES = 200;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_BYTES = 4_000_000;
/** How often a verdict is asked for, and for how long. */
const POLL_MS = 10_000;
const POLL_LIMIT_MS = 45 * 60_000;
/** A build writes and calibrates a hidden suite: it is waited for longer than a verdict. */
const BUILD_LIMIT_MS = 90 * 60_000;
/** More pages than a handout can have: a cursor that never ends is the platform's fault, not a loop here. */
const MAX_PAGES = 2_000;
const TITLE_MAX = 255;
const DESCRIPTION_MAX = 20_000;

export function defaultDeps() {
  return {
    ...accountDeps(),
    git: (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }),
    // Where Bouncer's own line goes, on a terminal (voice.mjs); a test passes none and gets none.
    voice: process.stdout,
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
export async function push(argv, { client, cli = client, pkg = client, version }, deps) {
  const usage = `usage: ${cli} push <slug> [--platform <url>] [--again] [--unconfirmed]`;
  const { values, positionals } = options(
    argv,
    { platform: { type: "string" }, again: { type: "boolean" }, unconfirmed: { type: "boolean" } },
    usage,
    true,
  );
  if (values.help || positionals.length !== 1) {
    deps.out(
      `${usage}\n\nPosts specs/<slug>/spec.md, as confirmed (${cli} confirm <slug> --by <name>), as a bounty in the workspace\n` +
        `${cli} login signed in to, its decisions recorded as confirmed by you, so approval needs no second confirmation.\n` +
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
    throw new PlatformError(`specs/${slug}: ${confirmed.reason}. Confirm it first: ${cli} confirm ${slug} --by <name>.`);
  const base = platformUrl(values.platform, deps.env);
  const saved = credentialFor(credentialsPath(deps.env), base, client);
  if (saved === undefined) throw new PlatformError(`Not signed in to ${base}. Run \`${cli} login\`.`);
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
      cli,
      pkg,
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
      `The spec is kept, but not its confirmation: this sign-in lacks the decisions:confirm scope. Run \`${cli} login\`\n` +
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
export async function ciPlatform(argv, { client, cli = client, pkg = client, version }, deps) {
  const usage = `usage: ${cli} ci --platform [<url>] --version <sandbox version id> --workspace <workspace id> [--repo <checkout>] [--base <rev>] [--exit-zero]`;
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
    request({ base, token: await oidcToken(base, deps), client, cli, pkg, version, fetchImpl: deps.fetchImpl, ...options });
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
    `bouncer (platform): ${verdict}, ${counts}`,
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

/** The signed-in workspace on `given` (a URL, else LUNOX_PLATFORM_URL, else the default), and a request bound to it. */
function workspace(given, { client, cli = client, pkg = client, version }, deps) {
  const base = platformUrl(given, deps.env);
  const saved = credentialFor(credentialsPath(deps.env), base, client);
  if (saved === undefined) throw new PlatformError(`Not signed in to ${base}. Run \`${cli} login\`.`);
  const org = `/api/v1/orgs/${encodeURIComponent(saved.organizationId)}`;
  const call = (path, options = {}) => request({ base, token: saved.token, client, cli, pkg, version, fetchImpl: deps.fetchImpl, path: `${org}${path}`, ...options });
  return { base, saved, call };
}

/** Where `path`, a platform's file name, lands under `root`: never outside it. */
export function insideOf(root, path) {
  const target = resolve(root, path);
  const back = relative(root, target);
  if (typeof path !== "string" || path === "" || isAbsolute(path) || path.includes("\0") || back === "" || back === ".." || back.startsWith(`..${sep}`) || isAbsolute(back))
    throw new PlatformError(`The platform named a file outside the folder (${JSON.stringify(path)}); nothing more was written.`);
  return target;
}

/** `prepare <slug> --hosted`: a draft version built on the platform, its public project pulled back. */
export async function prepareHosted(argv, meta, deps) {
  const cli = meta.cli ?? meta.client;
  const usage = `usage: ${cli} prepare <slug> --hosted [--version <sandbox version id>] [--out <folder>] [--no-wait] [--platform <url>]`;
  const { values, positionals } = options(
    argv,
    { hosted: { type: "boolean" }, version: { type: "string" }, out: { type: "string" }, "no-wait": { type: "boolean" }, platform: { type: "string" } },
    usage,
    true,
  );
  if (values.help || positionals.length !== 1) {
    deps.out(
      `${usage}\n\nBuilds a draft sandbox version on the platform instead of preparing here: the standalone project, its baseline\n` +
        `and hidden tests written from the approved spec and calibrated there. Waits for the build, then writes the public\n` +
        `project to --out (default the project's own folder name, here). The hidden tests never reach this machine: only\n` +
        `their count and commitment hash. --version is the draft cut for the bounty (web app, or MCP start_sandbox and\n` +
        `cut_slice); it is remembered in specs/<slug>/hosted.json. Owners and admins only.\n`,
    );
    return values.help ? 0 : 1;
  }
  const [slug] = positionals;
  const dir = specDir(slug);
  if (!existsSync(dir)) throw new PlatformError(`No spec: specs/${slug}.`);
  const { base, saved, call } = workspace(values.platform, meta, deps);
  const recordPath = join(dir, "hosted.json");
  const before = existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, "utf8")) : null;
  const recorded = before !== null && before.base === base && before.organizationId === saved.organizationId ? before : null;
  const versionId = values.version ?? recorded?.versionId;
  if (versionId === undefined)
    throw new PlatformError(`Which version? Pass --version <id>: the draft cut for this bounty (web app, or the MCP tools start_sandbox and cut_slice).\n${usage}`);
  const version = `/sandboxes/versions/${encodeURIComponent(versionId)}`;
  const record = (more) =>
    writeFileSync(recordPath, `${JSON.stringify({ base, organizationId: saved.organizationId, versionId, ...more }, null, 2)}\n`);

  let run;
  try {
    ({ run } = await call(`${version}/build`, { method: "POST" }));
  } catch (error) {
    if (error instanceof PlatformError && error.code === "decisions_unconfirmed")
      throw new PlatformError(
        `${versionId} is not built: its spec's decisions wait for a person. Confirm them in the web app${typeof error.body?.confirmUrl === "string" ? ` (${error.body.confirmUrl})` : " (MCP confirm_link)"}, or push a spec confirmed here (${cli} push), then run this again.`,
        { status: error.status, code: error.code },
      );
    throw error;
  }
  if (typeof run?.id !== "string") throw new PlatformError(`${base} answered without a build run.`);
  if (run.status === "queued" || run.status === "running") {
    if (values["no-wait"]) {
      record({ runId: run.id, out: values.out ? resolve(values.out) : (recorded?.out ?? null), preparedAt: null });
      deps.out(`Building ${versionId} as run ${run.id} on ${base}. Run \`${cli} prepare ${slug} --hosted\` again to wait for it and pull the project.\n`);
      return 0;
    }
    deps.out(`Building ${versionId} as run ${run.id}; waiting (it writes and calibrates the hidden tests there, so minutes, not seconds)...\n`);
    const started = deps.now();
    while (run.status === "queued" || run.status === "running") {
      if (deps.now() - started > BUILD_LIMIT_MS)
        throw new PlatformError(`Run ${run.id} is still ${run.status} after ${BUILD_LIMIT_MS / 60_000} minutes. Run this again to keep waiting.`);
      await deps.sleep(POLL_MS);
      ({ run } = await call(`/github/runs/${encodeURIComponent(run.id)}`));
    }
  }
  if (run.status !== "succeeded")
    throw new PlatformError(`The build ${run.status === "failed" ? "failed" : `ended as ${run.status}`}${run.errorCode ? ` (${run.errorCode})` : ""}${run.errorDetail ? `: ${String(run.errorDetail).replace(/[.\s]+$/, "")}` : ""}. Nothing was pulled.`);

  const handout = await call(`${version}/handout`);
  let out = values.out ? resolve(values.out) : recorded?.versionId === versionId && recorded.out ? recorded.out : null;
  const again = () => recorded?.versionId === versionId && recorded.out === out;
  const written = [];
  const skipped = [];
  let projectSha256 = null;
  let cursor = null;
  for (let page = 0; ; page += 1) {
    if (page >= MAX_PAGES) throw new PlatformError(`${base} gave more than ${MAX_PAGES} pages of files; stopped.`);
    const got = await call(`${version}/handout/files${cursor === null ? "" : `?cursor=${encodeURIComponent(cursor)}`}`);
    if (page === 0) {
      out ??= insideOf(resolve("."), String(got.root ?? ""));
      projectSha256 = got.sha256 ?? null;
      if (existsSync(out) && readdirSync(out).length > 0 && !again())
        throw new PlatformError(`${out} is not empty. Pass --out <an empty folder>; nothing was written.`);
    }
    for (const file of got.files ?? []) {
      const target = insideOf(out, file.path);
      if (file.omitted || typeof file.content !== "string") {
        skipped.push(file.path);
        continue;
      }
      const bytes = Buffer.from(file.content, file.encoding === "base64" ? "base64" : "utf8");
      if (createHash("sha256").update(bytes).digest("hex") !== file.sha256)
        throw new PlatformError(`${file.path} does not match its hash; stopped. Run it again, and if it repeats the platform's copy is damaged.`);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes);
      written.push(file.path);
    }
    if (typeof got.nextCursor !== "string" || got.nextCursor === cursor) break;
    cursor = got.nextCursor;
  }
  record({
    runId: run.id,
    out,
    projectSha256,
    files: written.length,
    hiddenTests: handout.hiddenTests ?? null,
    hiddenSha256: handout.hiddenSha256 ?? null,
    preparedAt: new Date(deps.now()).toISOString(),
  });
  for (const path of skipped) deps.err(`not written: ${path} is too large for the API; the web app downloads the whole project as a .zip\n`);
  const hidden =
    typeof handout.hiddenSha256 === "string"
      ? `${handout.hiddenTests} hidden test${handout.hiddenTests === 1 ? "" : "s"} stay on the platform (sha256 ${handout.hiddenSha256.slice(0, 12)}...): no name or body of one is on this machine.`
      : "This version has no hidden tests recorded yet.";
  deps.out(
    `Prepared ${versionId} on ${base}: ${written.length} public file${written.length === 1 ? "" : "s"} in ${out}.\n${hidden}\n` +
      `Implement there. It is judged on the platform: the MCP tool judge, or, once a person publishes the version,\n` +
      `\`${cli} ci --platform --version ${versionId} --workspace ${saved.organizationId}\` in CI. Read a verdict with \`${cli} judge --platform <submission id>\`.\n`,
  );
  return 0;
}

/** `judge --platform <submission id>`: a verdict the platform gave, printed as a local one. Answers the exit code. */
export async function judgePlatform(argv, meta, deps) {
  const cli = meta.cli ?? meta.client;
  const usage = `usage: ${cli} judge --platform <submission id> [--wait] [--json] [--platform-url <url>]`;
  const { values, positionals } = options(
    argv,
    { platform: { type: "string" }, wait: { type: "boolean" }, json: { type: "boolean" }, "platform-url": { type: "string" } },
    usage,
    true,
  );
  if (values.help || !values.platform || positionals.length > 0) {
    deps.out(
      `${usage}\n\nPrints the verdict the platform gave a submission (the MCP tool judge, a contributor's patch, or ${cli} ci\n` +
        `--platform), as a local verdict is printed: verdict, counts, failing scenario keys and refused paths, never a\n` +
        `hidden test's name. Nothing is judged here and nothing is sent but the id. --wait polls one still being graded.\n` +
        `Owners and admins only. Exit: 0 passed, 2 overfit, 1 otherwise.\n`,
    );
    return values.help ? 0 : 1;
  }
  const { call } = workspace(values["platform-url"], meta, deps);
  const read = () => call(`/sandboxes/submissions/${encodeURIComponent(values.platform)}`);
  let { submission } = await read();
  if (typeof submission?.id !== "string") throw new PlatformError("The platform answered without a submission.");
  const started = deps.now();
  while (values.wait && (submission.status === "queued" || submission.status === "running")) {
    if (deps.now() - started > POLL_LIMIT_MS) throw new PlatformError(`No verdict for ${submission.id} after ${POLL_LIMIT_MS / 60_000} minutes.`);
    await deps.sleep(POLL_MS);
    ({ submission } = await read());
  }
  if (values.json) {
    deps.out(`${JSON.stringify(submission, null, 2)}\n`);
    return EXIT[submission.verdict] ?? 1;
  }
  if (submission.status === "queued" || submission.status === "running") {
    deps.out(`${submission.id}: not judged yet (${submission.status}). Run it again, or pass --wait.\n`);
    return 1;
  }
  if (submission.status === "errored" || !submission.verdict) {
    deps.out(
      `${submission.id}: not judged${submission.errorCode ? ` (${submission.errorCode})` : ""}. Grading could not run on the platform's side;\n` +
        "a workspace owner can regrade it (MCP regrade) without spending its retry.\n",
    );
    return 1;
  }
  const keys = submission.failedScenarios ?? [];
  const count = (suite) => (suite ? `${suite.passed}/${suite.total}` : "-");
  if (deps.voice) say(submission.verdict, { stream: deps.voice, keys, retry: Boolean(submission.retryOf), counts: { public: submission.public, hidden: submission.hidden } });
  const lines = [
    `${submission.id}: ${submission.verdict}. Public ${count(submission.public)}, hidden ${count(submission.hidden)}.`,
    `Judged on the platform against version ${submission.sandboxVersionId}${submission.retryOf ? `, a retry of ${submission.retryOf}` : ""}.`,
    ...((submission.refused ?? []).length > 0 ? [`Refused:\n${submission.refused.map((item) => `- ${item.path}: ${item.reason}`).join("\n")}`] : []),
    ...(keys.length > 0 ? [`Failing scenarios: ${keys.join(", ")}`] : []),
    ...(submission.carryBack === "failed" ? ["Carry back failed: it passed there but cannot be merged back as it is."] : []),
  ];
  deps.out(`${lines.join("\n")}\n`);
  return EXIT[submission.verdict] ?? 1;
}

const COMMANDS = { push, ci: ciPlatform, prepare: prepareHosted, judge: judgePlatform };

/** Runs one, printing a PlatformError as one line on stderr. */
export async function run(command, argv, meta, deps = defaultDeps()) {
  try {
    return await COMMANDS[command](argv, meta, deps);
  } catch (error) {
    if (!(error instanceof PlatformError)) throw error;
    deps.err(`${meta.cli ?? meta.client} ${command}: ${error.message}\n`);
    return 1;
  }
}
