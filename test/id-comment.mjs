// The ID check's pull-request comment (bin/id-comment.mjs) against a mocked
// GitHub held in memory: no network, no session. The last part replays the
// 11 commits of evidence/in-repo as pull requests (PLAN.md phase 2, reach
// step 3) when that folder and its repository are on this machine.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MARKER, closingIssues, idComment, inert, planUpsert, renderComment } from "../bin/id-comment.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = mkdtempSync(join(tmpdir(), "bouncer-id-comment-"));

// inert: nothing a ticket, a diff or a model wrote does anything in a comment.
assert.equal(inert("ping @octocat about #12"), "ping @​octocat about #​12");
assert.equal(inert("a <!-- bouncer:id --> b <img src=x>"), "a &lt;!-- bouncer:id --&gt; b &lt;img src=x&gt;");
assert.equal(inert("see [here](https://example.test) ![x](y)"), "see \\[here\\](https://example.test) !\\[x\\](y)");
assert.equal(inert("one\n\n  two\tthree"), "one two three");
assert.equal(inert("x".repeat(400)).length, 300);
assert.equal(inert("keeps `code()` as code"), "keeps `code()` as code");
console.log("ok inert");

assert.deepEqual(closingIssues("Fixes #12 and closes: #7.\nResolved #12. See #99.", "o/r"), [12, 7]);
assert.deepEqual(closingIssues("fix https://github.com/o/r/issues/3, fixes other/repo#4, closes O/R#5", "o/r"), [3, 5]);
assert.deepEqual(closingIssues("prefixes #1; nothing closes here", "o/r"), []);
assert.deepEqual(closingIssues(null, "o/r"), []);
console.log("ok closingIssues");

const items = [
  { question: "What does a $0 bounty release?", ticket: "silent", chose: "Records a release of 0.", where: "src/index.ts:41", instead: "Records nothing." },
  { question: "Is the code matched whatever its case? cc @maintainer, see #4", ticket: "codes are 8 characters", chose: "Yes, <b>upper-cased</b> first.", where: "src/`codes`.ts", instead: "" },
];
const body = renderComment({ items, source: { issues: [12] }, sha: "0123456789abcdef", left: ["the diff past its first 600 KiB"] });
assert.ok(body.startsWith(`${MARKER}\n### Let me see some ID.`));
assert.match(body, /\*\*2 things #12 never said\.\*\* This change picked for you:/);
assert.match(body, /1\. \*\*What does a \$0 bounty release\?\*\*\n {3}- picked: Records a release of 0\. \(`src\/index\.ts:41`\)\n {3}- ticket: silent\n {3}- instead: Records nothing\./);
assert.match(body, /- ticket: "codes are 8 characters"/);
assert.match(body, /\(`src\/ codes \.ts`\)/, "no backtick gets out of the code span");
assert.match(body, /`0123456` · read #12 and this pull request's diff · not read: the diff past its first 600 KiB · edited in place/);
assert.ok(!/bug|wrong|risk|severity|critical/i.test(body), "questions, never findings or ranks");
assert.equal(body.split(MARKER).length, 2, "one marker");
assert.ok(!/@\w/.test(body) && !/<b>/.test(body), "mentions and HTML are inert");
assert.ok(!renderComment({ items, voice: false }).includes("Let me see some ID."));
assert.match(renderComment({ items: [], source: { pull: 5 } }), /Nothing this pull request's description left open that this change answers\./);
assert.match(renderComment({ items, source: { pull: 5 } }), /no linked issue/);
console.log("ok renderComment");

assert.deepEqual(planUpsert([], body), { action: "create" });
assert.equal(planUpsert([], body, { quietWhenEmpty: true }).action, "none");
assert.deepEqual(planUpsert([{ id: 1, body: "hello" }, { id: 2, body: `${MARKER}\nold` }, { id: 3, body: `${MARKER}\nolder twin` }], body), { action: "update", id: 2 });
assert.equal(planUpsert([{ id: 2, body: `${body}\n` }], body).action, "none");
console.log("ok planUpsert");

/** A GitHub in memory: one repository, its pull requests, issues and comments, and every request made. */
function mockGitHub({ repository = "o/r", pulls = {}, issues = {}, readOnly = false } = {}) {
  const state = { comments: {}, requests: [], nextId: 100 };
  const answer = (status, data) => new Response(typeof data === "string" ? data : JSON.stringify(data), { status });
  const send = async (url, init = {}) => {
    const { pathname, searchParams } = new URL(url);
    const method = init.method ?? "GET";
    state.requests.push(`${method} ${pathname}`);
    const base = `/repos/${repository}`;
    let match;
    if (method === "GET" && (match = pathname.match(new RegExp(`^${base}/pulls/(\\d+)$`)))) {
      const pull = pulls[match[1]];
      if (!pull) return answer(404, { message: "Not Found" });
      return String(init.headers?.Accept).includes("diff") ? answer(200, pull.diff) : answer(200, { number: Number(match[1]), title: pull.title, body: pull.body, head: { sha: pull.sha } });
    }
    if (method === "GET" && (match = pathname.match(new RegExp(`^${base}/issues/(\\d+)$`)))) return issues[match[1]] ? answer(200, issues[match[1]]) : answer(404, { message: "Not Found" });
    if (method === "GET" && (match = pathname.match(new RegExp(`^${base}/issues/(\\d+)/comments$`)))) {
      const page = Number(searchParams.get("page") ?? 1);
      return answer(200, (state.comments[match[1]] ?? []).slice((page - 1) * 100, page * 100));
    }
    if (method === "POST" && (match = pathname.match(new RegExp(`^${base}/issues/(\\d+)/comments$`)))) {
      if (readOnly) return answer(403, { message: "Resource not accessible by integration" });
      const comment = { id: (state.nextId += 1), body: JSON.parse(init.body).body };
      (state.comments[match[1]] ??= []).push(comment);
      return answer(201, comment);
    }
    if (method === "PATCH" && (match = pathname.match(new RegExp(`^${base}/issues/comments/(\\d+)$`)))) {
      const comment = Object.values(state.comments)
        .flat()
        .find((c) => c.id === Number(match[1]));
      if (!comment) return answer(404, { message: "Not Found" });
      comment.body = JSON.parse(init.body).body;
      return answer(200, comment);
    }
    return answer(404, { message: `the mock has no ${method} ${pathname}` });
  };
  return { send, state };
}
const eventFile = (name, event) => {
  const file = join(scratch, `${name}.json`);
  writeFileSync(file, JSON.stringify(event));
  return file;
};
const envFor = (pr, sha) => ({ GITHUB_REPOSITORY: "o/r", GITHUB_TOKEN: "t", GITHUB_EVENT_PATH: eventFile(`event-${pr}-${sha}`, { number: pr, pull_request: { number: pr, title: "Add release", body: "Fixes #12", head: { sha } } }) });
const DIFF = "diff --git a/src/index.ts b/src/index.ts\n--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1 +1,2 @@\n export const a = 1;\n+export const b = 2;\n";

// One pull request, three pushes: created, edited in place, then nothing left open.
{
  const hub = mockGitHub({ pulls: { 5: { title: "Add release", body: "Fixes #12", sha: "aaaaaaa1", diff: DIFF } }, issues: { 12: { title: "Release a bounty", body: "Release pays the contributor." } } });
  const seen = [];
  const list = async (given) => (seen.push(given), { items });
  const first = await idComment({ env: envFor(5, "aaaaaaa1"), fetch: hub.send, list });
  assert.equal(first.action, "create");
  assert.deepEqual(seen[0], { ticket: "# Release a bounty\n\nRelease pays the contributor.\n", diff: DIFF, model: undefined }, "the session is given the linked issue and the diff, nothing else");
  const second = await idComment({ env: envFor(5, "bbbbbbb2"), fetch: hub.send, list: async () => ({ items: items.slice(0, 1) }) });
  assert.equal(second.action, "update");
  assert.equal((await idComment({ env: envFor(5, "bbbbbbb2"), fetch: hub.send, list: async () => ({ items: items.slice(0, 1) }) })).action, "none", "the same push twice edits nothing");
  const third = await idComment({ env: envFor(5, "ccccccc3"), fetch: hub.send, list: async () => ({ items: [] }) });
  assert.equal(third.action, "update");
  assert.equal(hub.state.comments[5].length, 1, "one comment, however many pushes");
  assert.match(hub.state.comments[5][0].body, /Nothing #12 left open/);
  assert.match(hub.state.comments[5][0].body, /`ccccccc`/);
  assert.ok(hub.state.requests.every((request) => /^(GET|POST|PATCH) \/repos\/o\/r\/(pulls\/5|issues\/12|issues\/5\/comments|issues\/comments\/\d+)$/.test(request)), "only the pull request, its issue and its comments are touched");
}
console.log("ok one comment, edited in place");

// No linked issue: the pull request's own description is the ticket, and the comment says so. An empty list posts nothing.
{
  const hub = mockGitHub({ pulls: { 6: { title: "Tidy", body: "No issue here. Fixes #99", sha: "ddddddd4", diff: DIFF } }, issues: { 99: { title: "A pull request", body: "", pull_request: {} } } });
  const env = { GITHUB_REPOSITORY: "o/r", GITHUB_TOKEN: "t" };
  assert.equal((await idComment({ env, options: { pr: "6" }, fetch: hub.send, list: async () => ({ items: [] }) })).action, "none");
  assert.equal(hub.state.comments[6], undefined);
  const done = await idComment({ env, options: { pr: "6" }, fetch: hub.send, list: async () => ({ items }) });
  assert.equal(done.action, "create");
  assert.match(done.body, /things this pull request's description never said/);
  assert.match(done.body, /`ddddddd`/);
}
console.log("ok no linked issue");

// What it cannot do is an error for the caller, who exits 0 on it: a read-only token, a session with no list, no pull request.
{
  const hub = mockGitHub({ pulls: { 7: { title: "Fork", body: "", sha: "eeeeeee5", diff: DIFF } }, readOnly: true });
  const env = { GITHUB_REPOSITORY: "o/r", GITHUB_TOKEN: "t" };
  await assert.rejects(idComment({ env, options: { pr: "7" }, fetch: hub.send, list: async () => ({ items }) }), /HTTP 403 \(the token cannot write/);
  await assert.rejects(idComment({ env, options: { pr: "7" }, fetch: hub.send, list: async () => ({ items: null, subtype: "error_during_execution" }) }), /gave no list \(error_during_execution\)/);
  await assert.rejects(idComment({ env: {}, fetch: hub.send, list: async () => ({ items }) }), /no pull request/);
  assert.ok(!hub.state.requests.some((request) => /check-runs|check-suites|statuses|\/commits\//.test(request)));
}
console.log("ok failures");

// The command: offline with --dry-run, and exit 0 when it cannot run (exit 1 only with --strict).
{
  // This test may itself run in a pull request's job: none of that job's GitHub variables reach the command.
  const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GITHUB_|^BOUNCER_|TOKEN/i.test(key)));
  const cli = (argv, env = {}) => spawnSync(process.execPath, [join(ROOT, "bin", "cli.mjs"), "id-comment", ...argv], { encoding: "utf8", env: { ...clean, ...env } });
  writeFileSync(join(scratch, "ticket.md"), "# Release a bounty\n");
  writeFileSync(join(scratch, "change.diff"), DIFF);
  writeFileSync(join(scratch, "items.json"), JSON.stringify(items));
  const dry = cli(["--dry-run", "--ticket", join(scratch, "ticket.md"), "--diff", join(scratch, "change.diff"), "--items", join(scratch, "items.json")]);
  assert.equal(dry.status, 0, dry.stderr);
  assert.ok(dry.stdout.startsWith(MARKER));
  assert.match(dry.stdout, /2 things the ticket never said/);
  const none = cli([]);
  assert.equal(none.status, 0);
  assert.match(none.stderr, /no pull request/);
  const inJob = cli([], { GITHUB_ACTIONS: "true" });
  assert.equal(inJob.status, 0);
  assert.match(inJob.stderr, /^::warning title=bouncer id::no pull request/);
  assert.equal(cli(["--strict"]).status, 1);
}
console.log("ok cli");

// The gate's replay: each commit of evidence/in-repo as a pull request whose
// linked issue is the stored ticket and whose diff is the commit's. The list
// is a stand-in built from the diff itself (changed paths and added lines,
// the most a list could quote), so this measures the comment, not the model.
const cases = join(ROOT, "evidence", "in-repo", "cases.json");
const replayable = existsSync(cases) ? JSON.parse(readFileSync(cases, "utf8")).filter((c) => spawnSync("git", ["-C", resolve(ROOT, c.repo), "cat-file", "-e", `${c.commit}^{commit}`]).status === 0) : [];
if (replayable.length === 0) console.log("skip replay: evidence/in-repo or its repository is not here");
else {
  let titles = 0;
  let checkCalls = 0;
  let single = 0;
  let leaked = 0;
  for (const [index, c] of replayable.entries()) {
    const pr = index + 1;
    const spec = join(ROOT, "evidence", "in-repo", "specs", c.slug);
    const diff = spawnSync("git", ["-C", resolve(ROOT, c.repo), "show", "--format=", "--no-color", "--no-ext-diff", c.commit], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).stdout;
    const added = diff.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++") && line.trim().length > 12);
    const paths = [...diff.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1]);
    const stand = (offset) =>
      Array.from({ length: 12 }, (_, i) => ({
        question: `What should ${paths[(i + offset) % paths.length]} do here: ${added[(i * 37 + offset) % added.length]}`,
        ticket: i % 2 === 0 ? "silent" : (added[(i * 53 + offset) % added.length] ?? "silent"),
        chose: added[(i * 71 + offset) % added.length] ?? "",
        where: `${paths[(i + offset) % paths.length]}:${i + 1}`,
        instead: added[(i * 89 + offset) % added.length] ?? "",
      }));
    const hub = mockGitHub({ pulls: { [pr]: { title: c.subject, body: `Fixes #${1000 + pr}`, sha: c.commit, diff } }, issues: { [1000 + pr]: { title: c.slug, body: readFileSync(join(spec, "ticket.md"), "utf8") } } });
    const env = { GITHUB_REPOSITORY: "o/r", GITHUB_TOKEN: "t" };
    assert.equal((await idComment({ env, options: { pr: String(pr) }, fetch: hub.send, list: async () => ({ items: stand(0) }) })).action, "create");
    assert.equal((await idComment({ env, options: { pr: String(pr) }, fetch: hub.send, list: async () => ({ items: stand(5) }) })).action, "update");
    const posted = hub.state.comments[pr];
    if (posted.length === 1 && posted[0].body.split(MARKER).length === 2) single += 1;
    assert.ok(posted[0].body.length < 65536, "under GitHub's comment limit");
    assert.ok(!/(^|[^\w`])@\w/.test(posted[0].body.replace(/`[^`\n]*`/g, "")), `${c.slug}: a mention outside code`);
    checkCalls += hub.state.requests.filter((request) => /check-runs|check-suites|statuses/.test(request) || !/^(GET|POST|PATCH) /.test(request)).length;
    const hidden = join(spec, "tests", "private");
    for (const file of existsSync(hidden) ? readdirSync(hidden) : []) {
      for (const match of readFileSync(join(hidden, file), "utf8").matchAll(/\b(?:test|it|describe)\(\s*(["'`])((?:\\.|(?!\1).)+)\1/g)) {
        titles += 1;
        // As written, as the comment would escape it, and without its "[key] " prefix.
        const bare = match[2].replace(/^\[[\w-]+\]\s*/, "");
        if ([match[2], inert(match[2]), ...(bare.length >= 16 ? [bare, inert(bare)] : [])].some((title) => posted[0].body.includes(title))) leaked += 1;
      }
    }
  }
  assert.equal(single, replayable.length, "one comment per pull request");
  assert.equal(leaked, 0, "no hidden test's name in a comment");
  assert.equal(checkCalls, 0, "no call to a check or status endpoint");
  console.log(`ok replay: ${replayable.length} commits, ${single} pull requests with one comment after two pushes, 0 of ${titles} hidden test names in a comment, 0 calls to a check or status endpoint (list stubbed from the diff, no model)`);
}

rmSync(scratch, { recursive: true, force: true });
console.log("id-comment passed");
