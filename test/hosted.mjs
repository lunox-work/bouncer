#!/usr/bin/env node
// `push` and `ci --platform` (bin/hosted.mjs) against a fake platform on
// node:http, never the real one: a confirmed spec posted once as a bounty
// (as `spec`, confirmed only while its hash holds) and named again after,
// an unconfirmed one refused unless --unconfirmed, 422 `invalid_spec` with
// each problem, an older platform's 400 `invalid_bounty` answered with the
// text alone, and `skipped_scope`; a pull request's changed files sent with
// the run's OIDC token, sent again after a retryable 409, polled to a
// verdict on a virtual clock, and the exit code and step summary from the
// verdict; quota, rate-limit and credential-kind refusals said, not looped.
// `prepare --hosted`: a version built there, its run polled, the public
// project written file by file (hash checked, nothing outside the folder),
// only the hidden suite's count and hash kept; and `judge --platform`: a
// stored verdict printed as a local one, with its exit code.
//
//   node test/hosted.mjs

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { IDENTITY } from "../bin/identity.mjs";

const scratch = mkdtempSync(join(tmpdir(), "bouncer-hosted-"));
process.env.BOUNCER_SPECS = join(scratch, "specs");
const { insideOf, run, titleOf } = await import("../bin/hosted.mjs");
const { confirmation } = await import("../bin/confirm.mjs");
const { retryAfterSeconds, writeCredentials } = await import("../bin/platform-client.mjs");

const CLIENT = { ...IDENTITY, version: "9.9.9" };
const SECRET = "lnx_s3cr3t-never-printed";
const OIDC = "oidc.header.signature";

const sha = (text, encoding = "utf8") => createHash("sha256").update(Buffer.from(text, encoding)).digest("hex");
/** The public project a built version hands out, in two pages. */
const PROJECT = [
  { path: "package.json", encoding: "utf8", content: '{"name":"durations"}\n' },
  { path: "src/index.ts", encoding: "utf8", content: "export const parse = () => 0;\n" },
  { path: "tests/public/parse.test.ts", encoding: "utf8", content: 'test("[happy-1] parses", () => {});\n' },
  { path: "assets/logo.bin", encoding: "base64", content: Buffer.from([0, 1, 2, 255]).toString("base64") },
  { path: "assets/big.bin", encoding: null, content: null, omitted: "too_large" },
].map((file) => ({ omitted: null, ...file, sizeBytes: file.content === null ? 9_000_000 : Buffer.from(file.content, file.encoding).length, sha256: file.content === null ? "0".repeat(64) : sha(file.content, file.encoding) }));
const HIDDEN_SHA = "ab".repeat(32);

async function fakePlatform({ verdicts = ["running", "passed"], bounty = "new", judge = [], build = "ok", builds = ["running", "succeeded"], project = PROJECT } = {}) {
  // bounty: "new" takes `spec`; "old" is a platform before posted specs (strict body); "invalid" refuses the spec;
  // "skipped" is a token without decisions:confirm. judge: refusals POST /api/judge answers first, in order.
  // build: "ok", "unconfirmed" (409 decisions_unconfirmed) or "member" (403); builds: the run's statuses as it is read.
  const state = { requests: [], verdicts: [...verdicts], bounties: 0, judge: [...judge], builds: [...builds] };
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw === "" ? undefined : JSON.parse(raw);
    const url = new URL(req.url, "http://x");
    state.requests.push({ method: req.method, path: url.pathname, auth: req.headers.authorization, body });
    const send = (status, json) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(json));
    };
    const route = `${req.method} ${url.pathname}`;
    if (route === "GET /oidc") {
      if (req.headers.authorization !== "Bearer actions-request-token" || url.searchParams.get("audience") !== state.url)
        return send(403, {});
      return send(200, { value: OIDC });
    }
    if (route === "POST /api/v1/orgs/org_acme/bounties") {
      if (req.headers.authorization !== `Bearer ${SECRET}`) return send(401, { error: "This API token is not valid." });
      if (state.bounty === "old" && body.spec !== undefined) return send(400, { code: "invalid_bounty", error: 'Unrecognized key: "spec"' });
      if (state.bounty === "invalid" && body.spec !== undefined) {
        const problems = [
          { path: "scenarios[0]", message: "A scenario has no Then step." },
          { path: "decisions", message: "No Decided: list." },
        ];
        return send(422, { code: "invalid_spec", error: "The posted spec cannot be stored as written.", problems });
      }
      state.bounties += 1;
      const skipped = state.bounty === "skipped" && body.spec?.confirmed === true;
      return send(201, { bounty: { id: `bty_${state.bounties}`, title: body.title }, ...(skipped ? { confirmation: "skipped_scope" } : {}) });
    }
    const submission = (status) => ({
      id: "sbm_1",
      sandboxVersionId: "sbv_1",
      status: status === "running" || status === "queued" || status === "errored" ? status : status === "passed" ? "passed" : "failed",
      errorCode: status === "errored" ? "grading_timed_out" : null,
      verdict: ["passed", "overfit", "refused", "incomplete"].includes(status) ? status : null,
      public: status === "running" || status === "errored" ? null : { passed: 1, total: 1 },
      hidden: status === "running" || status === "errored" ? null : { passed: status === "passed" ? 2 : 1, total: 2 },
      failedScenarios: status === "overfit" ? ["s2"] : [],
      refused: status === "refused" ? [{ path: "src/a.ts", reason: "It adds a way to pass the tests without the code." }] : [],
      runId: "arn_grade",
      retryOf: null,
      merge: null,
      createdAt: "2026-11-12T00:00:00.000Z",
      updatedAt: "2026-11-12T00:00:00.000Z",
    });
    const SBX = "/api/v1/orgs/org_acme/sandboxes";
    if (url.pathname.startsWith(SBX) || url.pathname.startsWith("/api/v1/orgs/org_acme/github/runs/")) {
      if (req.headers.authorization !== `Bearer ${SECRET}`) return send(401, { error: "This API token is not valid." });
      const buildRun = (status) => ({ run: { id: "arn_build", tool: "sandbox_build", status, errorCode: status === "failed" ? "agent_failed" : null, errorDetail: status === "failed" ? "The reference never passed." : null } });
      if (route === `POST ${SBX}/versions/sbv_1/build`) {
        if (build === "unconfirmed") return send(409, { code: "decisions_unconfirmed", error: "Confirm the spec's decisions before building.", confirmUrl: "https://app.example.test/acme/bounties/bty_1/price" });
        if (build === "member") return send(403, { error: "Only owners and admins can build a version." });
        return send(202, buildRun(state.builds.length > 0 ? "queued" : "succeeded"));
      }
      if (route === "GET /api/v1/orgs/org_acme/github/runs/arn_build") return send(200, buildRun(state.builds.shift() ?? "succeeded"));
      if (route === `GET ${SBX}/versions/sbv_1/handout`)
        return send(200, { versionId: "sbv_1", run: { id: "arn_build", status: "succeeded" }, files: project.map(({ path, sizeBytes, sha256 }) => ({ path, sizeBytes, sha256 })), hiddenTests: 14, hiddenSha256: HIDDEN_SHA, hiddenSha256Version: 2 });
      if (route === `GET ${SBX}/versions/sbv_1/handout/files`) {
        const from = Number(url.searchParams.get("cursor") ?? 0);
        const next = from + 2 < project.length ? String(from + 2) : null;
        return send(200, { versionId: "sbv_1", root: "durations-sandbox", sha256: "cd".repeat(32), total: project.length, files: project.slice(from, from + 2), nextCursor: next });
      }
      if (route === `GET ${SBX}/submissions/sbm_1`) return send(200, { submission: submission(state.verdicts.shift() ?? "passed") });
      return send(404, { error: "Not found." });
    }
    if (req.headers.authorization !== `Bearer ${OIDC}` && url.pathname.startsWith("/api/judge"))
      return send(401, { error: "A GitHub OIDC token is needed.", code: "oidc_required" });
    if (route === "POST /api/judge") {
      const refusal = state.judge.shift();
      if (refusal !== undefined) {
        res.writeHead(refusal.status, { "content-type": "application/json", ...(refusal.retryAfter ? { "retry-after": refusal.retryAfter } : {}) });
        return res.end(JSON.stringify(refusal.body));
      }
      return send(202, { submission: submission("queued") });
    }
    if (route === "GET /api/judge/sbm_1" && url.searchParams.get("workspace") === "org_acme") return send(200, { submission: submission(state.verdicts.shift() ?? "passed") });
    return send(404, { error: "Not found" });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  state.url = `http://127.0.0.1:${server.address().port}`;
  state.bounty = bounty;
  return { state, close: () => new Promise((resolve) => server.close(resolve)) };
}

function deps({ env = {}, files = {}, changed = Object.keys(files) } = {}) {
  const out = [];
  const err = [];
  let clock = Date.parse("2026-11-12T00:00:00.000Z");
  const slept = [];
  return {
    out,
    err,
    slept,
    deps: {
      env: { LUNOX_CREDENTIALS: join(scratch, "credentials"), ...env },
      out: (text) => out.push(text),
      err: (text) => err.push(text),
      sleep: async (ms) => {
        slept.push(ms);
        clock += ms;
      },
      now: () => clock,
      fetchImpl: fetch,
      git: (args) => {
        assert.deepEqual(args.slice(0, 4), ["diff", "--name-only", "--diff-filter=AM", "-z"]);
        return `${changed.join("\0")}\0`;
      },
      readFile: (path) => {
        const name = Object.keys(files).find((each) => path.endsWith(each));
        return Buffer.from(files[name]);
      },
    },
  };
}

const specs = join(scratch, "specs");
function spec(slug, { confirm = true } = {}) {
  const dir = join(specs, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "ticket.md"), "# Accept duration strings\n\nPeople keep getting timeouts wrong.\n");
  writeFileSync(join(dir, "spec.md"), "# Duration strings\n\n```gherkin\nFeature: Durations\n```\n");
  if (confirm) {
    const { hash } = confirmation(slug);
    writeFileSync(join(dir, "confirmed.json"), JSON.stringify({ sha256: hash, by: "Ada", at: "2026-11-12T00:00:00.000Z" }));
  }
}

try {
  // titleOf: the first heading, else the first line.
  assert.equal(titleOf("intro\n# Heading\n"), "Heading");
  assert.equal(titleOf("\n  just a line\nmore"), "just a line");
  // Retry-After: seconds, or an HTTP date from now.
  assert.equal(retryAfterSeconds("30"), 30);
  assert.equal(retryAfterSeconds("Wed, 12 Nov 2026 00:01:00 GMT", Date.parse("2026-11-12T00:00:00Z")), 60);
  assert.equal(retryAfterSeconds(null), undefined);
  assert.equal(retryAfterSeconds("soon"), undefined);

  // push: posted once as a bounty, named again after; --again posts anew.
  {
    const platform = await fakePlatform();
    writeCredentials(join(scratch, "credentials"), {
      [platform.state.url]: { duediligence: { token: SECRET, organizationId: "org_acme", organizationHandle: "acme" } },
    });
    spec("durations");
    const first = deps({ env: { LUNOX_PLATFORM_URL: platform.state.url } });
    assert.equal(await run("push", ["durations"], CLIENT, first.deps), 0);
    const posted = platform.state.requests.at(-1);
    assert.equal(posted.path, "/api/v1/orgs/org_acme/bounties");
    assert.equal(posted.body.title, "Accept duration strings");
    assert.deepEqual(posted.body.spec, {
      document: readFileSync(join(specs, "durations", "spec.md"), "utf8"),
      format: "duediligence",
      confirmed: true,
      engine: { name: "duediligence", version: "9.9.9" },
    });
    assert.equal(posted.body.description, undefined, "the platform takes the document as the description");
    assert.match(first.out.join(""), /bounty bty_1 in @acme/);
    assert.match(first.out.join(""), /stand confirmed \(by Ada here\), so approving its price needs no separate confirm step/);
    assert.equal(first.out.join("").includes(SECRET), false);
    const record = JSON.parse(readFileSync(join(specs, "durations", "platform.json"), "utf8"));
    assert.equal(record.bountyId, "bty_1");
    assert.equal(record.confirmedBy, "Ada");
    assert.equal(record.confirmation, "confirmed");

    const again = deps({ env: { LUNOX_PLATFORM_URL: platform.state.url } });
    assert.equal(await run("push", ["durations"], CLIENT, again.deps), 0);
    assert.equal(platform.state.bounties, 1);
    assert.match(again.out.join(""), /is bounty bty_1/);
    assert.equal(await run("push", ["durations", "--again"], CLIENT, again.deps), 0);
    assert.equal(platform.state.bounties, 2);

    // Not confirmed, or not signed in: refused before anything is sent.
    spec("draft", { confirm: false });
    const draft = deps({ env: { LUNOX_PLATFORM_URL: platform.state.url } });
    assert.equal(await run("push", ["draft"], CLIENT, draft.deps), 1);
    assert.match(draft.err.join(""), /never been confirmed/);
    const anonymous = deps({ env: { LUNOX_PLATFORM_URL: platform.state.url, LUNOX_CREDENTIALS: join(scratch, "none") } });
    assert.equal(await run("push", ["durations", "--again"], CLIENT, anonymous.deps), 1);
    assert.match(anonymous.err.join(""), /Not signed in/);
    assert.equal(platform.state.bounties, 2);
    const usage = deps();
    assert.equal(await run("push", [], CLIENT, usage.deps), 1);
    assert.match(usage.out.join(""), /usage: bouncer push <slug>/);

    // --unconfirmed posts it with confirmed: false, its decisions left to the web app.
    const loose = deps({ env: { LUNOX_PLATFORM_URL: platform.state.url } });
    assert.equal(await run("push", ["draft", "--unconfirmed"], CLIENT, loose.deps), 0, loose.err.join(""));
    assert.equal(platform.state.requests.at(-1).body.spec.confirmed, false);
    assert.match(loose.out.join(""), /not confirmed: a person confirms them in the web app/);
    assert.equal(JSON.parse(readFileSync(join(specs, "draft", "platform.json"), "utf8")).confirmation, "unconfirmed");

    // Edited after confirming: confirmed only while the hash holds, so refused without --unconfirmed, false with it.
    spec("edited");
    writeFileSync(join(specs, "edited", "spec.md"), "# Duration strings\n\n```gherkin\nFeature: Durations, edited\n```\n");
    const edited = deps({ env: { LUNOX_PLATFORM_URL: platform.state.url } });
    assert.equal(await run("push", ["edited"], CLIENT, edited.deps), 1);
    assert.match(edited.err.join(""), /changed after Ada confirmed it/);
    assert.equal(await run("push", ["edited", "--unconfirmed"], CLIENT, edited.deps), 0);
    assert.equal(platform.state.requests.at(-1).body.spec.confirmed, false);
    await platform.close();
  }

  // push: 422 invalid_spec names each problem and posts nothing; nothing is recorded.
  {
    const platform = await fakePlatform({ bounty: "invalid" });
    writeCredentials(join(scratch, "credentials"), {
      [platform.state.url]: { duediligence: { token: SECRET, organizationId: "org_acme", organizationHandle: "acme" } },
    });
    spec("broken");
    const world = deps({ env: { LUNOX_PLATFORM_URL: platform.state.url } });
    assert.equal(await run("push", ["broken"], CLIENT, world.deps), 1);
    const said = world.err.join("");
    assert.match(said, /cannot store specs\/broken\/spec\.md as written; nothing was posted/);
    assert.match(said, /\n {2}scenarios\[0\]: A scenario has no Then step\.\n {2}decisions: No Decided: list\./);
    assert.equal(platform.state.bounties, 0);
    assert.equal(platform.state.requests.filter((r) => r.path.endsWith("/bounties")).length, 1, "no fallback after a 422");
    assert.equal(existsSync(join(specs, "broken", "platform.json")), false);
    await platform.close();
  }

  // push: an older platform (400 invalid_bounty on `spec`) is sent { title, description }.
  {
    const platform = await fakePlatform({ bounty: "old" });
    writeCredentials(join(scratch, "credentials"), {
      [platform.state.url]: { duediligence: { token: SECRET, organizationId: "org_acme", organizationHandle: "acme" } },
    });
    spec("legacy");
    const world = deps({ env: { LUNOX_PLATFORM_URL: platform.state.url } });
    assert.equal(await run("push", ["legacy"], CLIENT, world.deps), 0, world.err.join(""));
    const sent = platform.state.requests.filter((r) => r.path.endsWith("/bounties")).map((r) => r.body);
    assert.equal(sent.length, 2);
    assert.ok(sent[0].spec !== undefined);
    assert.deepEqual(Object.keys(sent[1]).sort(), ["description", "title"]);
    assert.match(sent[1].description, /Feature: Durations/);
    assert.match(world.out.join(""), /does not take posted specs yet/);
    assert.equal(JSON.parse(readFileSync(join(specs, "legacy", "platform.json"), "utf8")).confirmation, "text");
    await platform.close();
  }

  // push: a token without decisions:confirm: the spec kept, the confirmation skipped; sign in again.
  {
    const platform = await fakePlatform({ bounty: "skipped" });
    writeCredentials(join(scratch, "credentials"), {
      [platform.state.url]: { duediligence: { token: SECRET, organizationId: "org_acme", organizationHandle: "acme" } },
    });
    spec("scoped");
    const world = deps({ env: { LUNOX_PLATFORM_URL: platform.state.url } });
    assert.equal(await run("push", ["scoped"], CLIENT, world.deps), 0, world.err.join(""));
    assert.match(world.out.join(""), /lacks the decisions:confirm scope\. Run `bouncer login`/);
    assert.equal(JSON.parse(readFileSync(join(specs, "scoped", "platform.json"), "utf8")).confirmation, "skipped_scope");
    await platform.close();
  }

  // ci --platform: the PR's files with the OIDC token, polled to a verdict.
  for (const [verdict, code] of [
    ["passed", 0],
    ["overfit", 2],
    ["refused", 1],
    ["errored", 1],
  ]) {
    const platform = await fakePlatform({ verdicts: ["running", verdict] });
    const summary = join(scratch, `summary-${verdict}.md`);
    const world = deps({
      env: {
        ACTIONS_ID_TOKEN_REQUEST_URL: `${platform.state.url}/oidc?api-version=2.0`,
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: "actions-request-token",
        GITHUB_BASE_REF: "main",
        GITHUB_STEP_SUMMARY: summary,
      },
      files: { "src/a.ts": "export const a = 1;\n", "logo.png": "\u0000binary" },
    });
    const exit = await run(
      "ci",
      ["--platform=", "--version", "sbv_1", "--workspace", "org_acme", "--platform", platform.state.url],
      CLIENT,
      world.deps,
    );
    assert.equal(exit, code, verdict);
    const sent = platform.state.requests.find((each) => each.path === "/api/judge");
    assert.deepEqual(sent.body, { workspace: "org_acme", versionId: "sbv_1", files: [{ path: "src/a.ts", text: "export const a = 1;\n" }] });
    assert.equal(sent.auth, `Bearer ${OIDC}`);
    // A fresh token for each call, as one lasts minutes.
    assert.equal(platform.state.requests.filter((each) => each.path === "/oidc").length, 3);
    assert.match(world.err.join(""), /skipped logo.png/);
    const printed = world.out.join("");
    assert.match(printed, new RegExp(`bouncer \\(platform\\): ${verdict}`));
    if (verdict === "overfit") assert.match(printed, /failing scenarios: s2/);
    if (verdict === "refused") assert.match(printed, /refused src\/a.ts/);
    if (verdict === "errored") assert.match(printed, /errored \(grading_timed_out\), no tests ran\n.*regrade it \(MCP regrade\) without spending its retry/);
    assert.match(readFileSync(summary, "utf8"), new RegExp(`### bouncer \\(platform\\): ${verdict}`));
    await platform.close();
  }

  // ci --platform: a retryable 409 (the active-run limit) is sent again after Retry-After; bounded.
  const ciEnv = (platform) => ({
    ACTIONS_ID_TOKEN_REQUEST_URL: `${platform.state.url}/oidc?api-version=2.0`,
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "actions-request-token",
    GITHUB_BASE_REF: "main",
  });
  const ciArgs = (platform) => ["--platform=", "--version", "sbv_1", "--workspace", "org_acme", "--platform", platform.state.url];
  const runLimit = {
    status: 409,
    retryAfter: "7",
    body: { code: "run_limit", retryable: true, error: "The active analysis limit has been reached. The submission is kept: send the same files again to queue it." },
  };
  {
    const platform = await fakePlatform({ judge: [runLimit, runLimit] });
    const world = deps({ env: ciEnv(platform), files: { "src/a.ts": "export const a = 1;\n" } });
    assert.equal(await run("ci", ciArgs(platform), CLIENT, world.deps), 0, world.err.join(""));
    const sends = platform.state.requests.filter((r) => r.path === "/api/judge");
    assert.equal(sends.length, 3);
    assert.deepEqual(sends[2].body, sends[0].body, "the same files again");
    assert.deepEqual(world.slept.slice(0, 2), [7000, 7000], "waits Retry-After before each resend");
    assert.match(world.err.join(""), /active-run limit; the submission is kept\. Sending it again in 7 s \(attempt 2\)/);
    await platform.close();

    const stuck = await fakePlatform({ judge: [runLimit, runLimit, runLimit, runLimit, runLimit] });
    const gave = deps({ env: ciEnv(stuck), files: { "src/a.ts": "a" } });
    assert.equal(await run("ci", ciArgs(stuck), CLIENT, gave.deps), 1);
    assert.equal(stuck.state.requests.filter((r) => r.path === "/api/judge").length, 4, "at most four sends");
    assert.match(gave.err.join(""), /Still refused after 4 attempts/);
    await stuck.close();
  }

  // ci --platform: quota, rate limit and credential kind are said once, never looped on.
  for (const [refusal, expected] of [
    [
      {
        status: 429,
        retryAfter: "3600",
        body: { code: "quota_exceeded", kind: "evaluator_seconds", used: 360000, limit: 360000, resetsAt: "2026-12-01T00:00:00.000Z", error: "spent" },
      },
      /used its monthly evaluator time \(builds, imports and grading\) \(360000 of 360000\)\. It resets 2026-12-01T00:00:00\.000Z/,
    ],
    [
      { status: 429, retryAfter: "120", body: { code: "quota_exceeded", kind: "model_tokens", used: 1, limit: 1, error: "spent" } },
      /monthly model-token limit .* It resets in 120 s;/,
    ],
    [
      { status: 429, retryAfter: "90", body: { code: "rate_limited", scope: "assignment", limit: 10, retryAt: "2026-11-12T08:00:00.000Z", retryable: true, error: "braked" } },
      /Rate limited \(10 attempts a day, per assignment\): try again after 2026-11-12T08:00:00\.000Z\. What was sent is kept\./,
    ],
    [
      { status: 403, body: { code: "workspace_credential", error: "Contributor routes take a contributor credential." } },
      /takes a contributor credential, not a workspace's: an lnxc_ token made on the web app's Contributions page/,
    ],
    [
      { status: 403, body: { code: "contributor_credential", error: "A contributor credential reaches only your own contributions." } },
      /contributor credential \(lnxc_\): it reaches only your own contributions.*`bouncer login`/,
    ],
    [
      { status: 403, body: { code: "insufficient_scope", error: "This credential lacks the judge scope." } },
      /This credential lacks the judge scope\. The sign-in predates that scope: run `bouncer login` again/,
    ],
  ]) {
    const platform = await fakePlatform({ judge: [refusal] });
    const world = deps({ env: ciEnv(platform), files: { "src/a.ts": "a" } });
    assert.equal(await run("ci", ciArgs(platform), CLIENT, world.deps), 1);
    assert.match(world.err.join(""), expected);
    assert.equal(platform.state.requests.filter((r) => r.path === "/api/judge").length, 1, `${refusal.body.code}: sent once`);
    await platform.close();
  }

  // Without an OIDC token, without arguments, or with nothing changed.
  {
    const bare = deps({ files: { "src/a.ts": "a" } });
    assert.equal(await run("ci", ["--platform=", "--version", "sbv_1", "--workspace", "org_acme"], CLIENT, bare.deps), 1);
    assert.match(bare.err.join(""), /id-token: write/);
    const usage = deps();
    assert.equal(await run("ci", ["--platform="], CLIENT, usage.deps), 1);
    assert.match(usage.out.join(""), /usage: bouncer ci --platform/);
    const quiet = deps({ files: {} });
    assert.equal(await run("ci", ["--platform=", "--version", "sbv_1", "--workspace", "org_acme"], CLIENT, quiet.deps), 0);
    assert.match(quiet.out.join(""), /nothing to judge/);
    const zero = deps({
      env: {},
      files: { "src/a.ts": "a" },
    });
    // --exit-zero still needs a token to submit.
    assert.equal(await run("ci", ["--platform=", "--version", "v", "--workspace", "w", "--exit-zero"], CLIENT, zero.deps), 1);
  }
  // prepare --hosted: built there, the public project here, the hidden suite nowhere on this machine.
  {
    const platform = await fakePlatform();
    writeCredentials(join(scratch, "credentials"), {
      [platform.state.url]: { duediligence: { token: SECRET, organizationId: "org_acme", organizationHandle: "acme" } },
    });
    spec("hosted");
    const env = { LUNOX_PLATFORM_URL: platform.state.url };
    const out = join(scratch, "pulled");
    const missing = deps({ env });
    assert.equal(await run("prepare", ["hosted", "--hosted", "--out", out], CLIENT, missing.deps), 1);
    assert.match(missing.err.join(""), /Which version\? Pass --version <id>/);
    assert.equal(platform.state.requests.length, 0, "nothing is sent before a version is named");

    const world = deps({ env });
    assert.equal(await run("prepare", ["hosted", "--hosted", "--version", "sbv_1", "--out", out], CLIENT, world.deps), 0);
    assert.deepEqual(
      platform.state.requests.map((r) => `${r.method} ${r.path}`),
      [
        "POST /api/v1/orgs/org_acme/sandboxes/versions/sbv_1/build",
        "GET /api/v1/orgs/org_acme/github/runs/arn_build",
        "GET /api/v1/orgs/org_acme/github/runs/arn_build",
        "GET /api/v1/orgs/org_acme/sandboxes/versions/sbv_1/handout",
        "GET /api/v1/orgs/org_acme/sandboxes/versions/sbv_1/handout/files",
        "GET /api/v1/orgs/org_acme/sandboxes/versions/sbv_1/handout/files",
        "GET /api/v1/orgs/org_acme/sandboxes/versions/sbv_1/handout/files",
      ],
    );
    assert.equal(platform.state.requests[0].body, undefined, "the build is asked for by id: no spec, ticket or code is sent");
    assert.deepEqual(world.slept, [10_000, 10_000]);
    assert.equal(readFileSync(join(out, "src", "index.ts"), "utf8"), "export const parse = () => 0;\n");
    assert.deepEqual([...readFileSync(join(out, "assets", "logo.bin"))], [0, 1, 2, 255]);
    assert.equal(existsSync(join(out, "assets", "big.bin")), false);
    assert.match(world.err.join(""), /not written: assets\/big\.bin is too large/);
    assert.match(world.out.join(""), /Prepared sbv_1 on .*: 4 public files in /);
    assert.match(world.out.join(""), /14 hidden tests stay on the platform \(sha256 abababababab\.\.\.\)/);
    assert.equal(world.out.join("").includes(SECRET), false);
    const record = JSON.parse(readFileSync(join(specs, "hosted", "hosted.json"), "utf8"));
    assert.deepEqual(
      { ...record, base: undefined },
      { base: undefined, organizationId: "org_acme", versionId: "sbv_1", runId: "arn_build", out, projectSha256: "cd".repeat(32), files: 4, hiddenTests: 14, hiddenSha256: HIDDEN_SHA, preparedAt: "2026-11-12T00:00:20.000Z" },
    );

    // Again: the version and the folder are remembered, and the same folder is written over.
    const again = deps({ env });
    assert.equal(await run("prepare", ["hosted", "--hosted"], CLIENT, again.deps), 0);
    assert.match(again.out.join(""), /4 public files in /);
    // Another folder that holds something is left alone.
    const taken = join(scratch, "taken");
    mkdirSync(taken);
    writeFileSync(join(taken, "mine.txt"), "mine");
    const refused = deps({ env });
    assert.equal(await run("prepare", ["hosted", "--hosted", "--out", taken], CLIENT, refused.deps), 1);
    assert.match(refused.err.join(""), /is not empty\. Pass --out <an empty folder>; nothing was written/);
    assert.deepEqual(readFileSync(join(taken, "mine.txt"), "utf8"), "mine");
    await platform.close();
  }

  // prepare --hosted: refusals are said, a failed build pulls nothing, and no file leaves the folder or keeps a wrong hash.
  {
    const cases = [
      [{ build: "unconfirmed" }, /its spec's decisions wait for a person\. Confirm them in the web app \(https:\/\/app\.example\.test\/acme\/bounties\/bty_1\/price\)/],
      [{ build: "member" }, /Only owners and admins can build a version/],
      [{ builds: ["running", "failed"] }, /The build failed \(agent_failed\): The reference never passed\. Nothing was pulled/],
      [{ builds: [], project: [{ ...PROJECT[0], path: "../escaped.txt" }] }, /named a file outside the folder \("\.\.\/escaped\.txt"\)/],
      [{ builds: [], project: [{ ...PROJECT[0], path: "/etc/escaped.txt" }] }, /named a file outside the folder/],
      [{ builds: [], project: [{ ...PROJECT[0], sha256: "1".repeat(64) }] }, /package\.json does not match its hash/],
    ];
    for (const [index, [options, expected]] of cases.entries()) {
      const platform = await fakePlatform(options);
      writeCredentials(join(scratch, "credentials"), {
        [platform.state.url]: { duediligence: { token: SECRET, organizationId: "org_acme", organizationHandle: "acme" } },
      });
      spec(`refused-${index}`);
      const out = join(scratch, `refused-${index}-out`);
      const world = deps({ env: { LUNOX_PLATFORM_URL: platform.state.url } });
      assert.equal(await run("prepare", [`refused-${index}`, "--hosted", "--version", "sbv_1", "--out", out], CLIENT, world.deps), 1);
      assert.match(world.err.join(""), expected);
      assert.equal(existsSync(out) && readdirSync(out).length > 0, false, `${expected}: nothing written`);
      assert.equal(existsSync(join(scratch, "escaped.txt")), false);
      await platform.close();
    }
    const queued = await fakePlatform({ builds: ["running", "running"] });
    writeCredentials(join(scratch, "credentials"), {
      [queued.state.url]: { duediligence: { token: SECRET, organizationId: "org_acme", organizationHandle: "acme" } },
    });
    spec("queued");
    const world = deps({ env: { LUNOX_PLATFORM_URL: queued.state.url } });
    assert.equal(await run("prepare", ["queued", "--hosted", "--version", "sbv_1", "--no-wait"], CLIENT, world.deps), 0);
    assert.match(world.out.join(""), /Building sbv_1 as run arn_build .* again to wait for it and pull the project/);
    assert.equal(queued.state.requests.length, 1);
    assert.equal(JSON.parse(readFileSync(join(specs, "queued", "hosted.json"), "utf8")).preparedAt, null);
    await queued.close();
    const signedOut = deps({ env: { LUNOX_PLATFORM_URL: "http://127.0.0.1:9", LUNOX_CREDENTIALS: join(scratch, "none") } });
    assert.equal(await run("prepare", ["queued", "--hosted", "--version", "sbv_1"], CLIENT, signedOut.deps), 1);
    assert.match(signedOut.err.join(""), /Not signed in to http:\/\/127\.0\.0\.1:9\. Run `bouncer login`/);
    assert.throws(() => insideOf(scratch, "a/../../b"), /outside the folder/);
    assert.throws(() => insideOf(scratch, "."), /outside the folder/);
    assert.equal(insideOf(scratch, "a/b.ts"), join(scratch, "a", "b.ts"));
  }

  // judge --platform: a stored verdict in a local verdict's words and exit codes.
  {
    const table = [
      [["passed"], 0, /^sbm_1: passed\. Public 1\/1, hidden 2\/2\.\nJudged on the platform against version sbv_1\.\n$/],
      [["overfit"], 2, /sbm_1: overfit\. Public 1\/1, hidden 1\/2\.\n[^]*Failing scenarios: s2\n$/],
      [["incomplete"], 1, /sbm_1: incomplete\./],
      [["refused"], 1, /sbm_1: refused\.[^]*Refused:\n- src\/a\.ts: It adds a way to pass the tests without the code\./],
      [["errored"], 1, /sbm_1: not judged \(grading_timed_out\)\. Grading could not run on the platform's side/],
      [["running"], 1, /sbm_1: not judged yet \(running\)\. Run it again, or pass --wait\./],
    ];
    for (const [verdicts, exit, expected] of table) {
      const platform = await fakePlatform({ verdicts });
      writeCredentials(join(scratch, "credentials"), {
        [platform.state.url]: { duediligence: { token: SECRET, organizationId: "org_acme", organizationHandle: "acme" } },
      });
      const world = deps({ env: { LUNOX_PLATFORM_URL: platform.state.url } });
      assert.equal(await run("judge", ["--platform", "sbm_1"], CLIENT, world.deps), exit, verdicts[0]);
      assert.match(world.out.join(""), expected);
      assert.deepEqual(platform.state.requests.map((r) => `${r.method} ${r.path}`), ["GET /api/v1/orgs/org_acme/sandboxes/submissions/sbm_1"], "read once, nothing sent");
      await platform.close();
    }
    const platform = await fakePlatform({ verdicts: ["queued", "running", "overfit"] });
    writeCredentials(join(scratch, "credentials"), {
      [platform.state.url]: { duediligence: { token: SECRET, organizationId: "org_acme", organizationHandle: "acme" } },
    });
    const waited = deps({ env: { LUNOX_PLATFORM_URL: platform.state.url } });
    assert.equal(await run("judge", ["--platform", "sbm_1", "--wait"], CLIENT, waited.deps), 2);
    assert.deepEqual(waited.slept, [10_000, 10_000]);
    const json = deps({ env: { LUNOX_PLATFORM_URL: platform.state.url } });
    assert.equal(await run("judge", ["--platform", "sbm_1", "--json"], CLIENT, json.deps), 0);
    assert.equal(JSON.parse(json.out.join("")).verdict, "passed");
    const gone = deps({ env: { LUNOX_PLATFORM_URL: platform.state.url } });
    assert.equal(await run("judge", ["--platform", "sbm_404"], CLIENT, gone.deps), 1);
    assert.match(gone.err.join(""), /Not found/);
    const usage = deps();
    assert.equal(await run("judge", ["sbm_1"], CLIENT, usage.deps), 1);
    assert.match(usage.out.join(""), /usage: bouncer judge --platform <submission id>/);
    await platform.close();
  }
  console.log("hosted: push, ci --platform, prepare --hosted and judge --platform ok");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
