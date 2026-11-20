---
name: bouncer-hosted
description: >-
  Work with the person's workspace on the Lunox platform through the lunox MCP
  tools: post a bounty or import one from a GitHub or Jira issue, price it,
  hand over the link where the person confirms its decisions, start a sandbox,
  write its public project to disk, submit an implementation for a verdict from
  hidden tests kept on the platform, regrade, take a passing submission's files
  back or invite an outside contributor. Use when the lunox MCP server is
  connected, or the person mentions Lunox, platform.lunox.work, bounties or
  sandboxes, or wants a confirmed bouncer spec posted to the platform. Hidden
  tests run locally with no sign-in are the bouncer skill.
license: MIT
compatibility: >-
  Needs the lunox MCP server (bundled by the bouncer-hosted Claude Code plugin)
  signed in through /mcp. Posting a spec from a terminal runs the
  @lunox-work/bouncer@0.8.1 CLI from npm (Node 20.19 or later).
---

# bouncer-hosted

When the `lunox` MCP tools are available and signed in (the `bouncer-hosted`
Claude Code plugin bundles the server; `/mcp` signs in), they work on the
person's workspace on the Lunox platform. Local mode, the `bouncer` skill, is
the default and needs no sign-in; this skill does not change it.

`bouncer <command>` below is the CLI, `@lunox-work/bouncer@0.8.1`; the
`bouncer` skill says how to install it.

## Tools

Reads: `list_workspaces`, `list_bounties`, `get_bounty`, `get_proposal`,
`get_run`, `get_usage`, `list_sandboxes`, `get_sandbox`.

Writes, only when the person asks for that one: `post_bounty`,
`import_github_issue`, `import_jira_issue` (a new bounty), `size_bounty`
(price it; a paid model run) and `respec` (change a priced spec: expand,
answer its open questions or trim, against the revision `get_proposal` read).

## Decisions and approval

`get_decisions` reads what a priced spec decided where the ticket was silent
(its `Decided:` items) and whether a person confirmed them; `confirm_link`
gives the page where the person confirms them. Hand them that link:
confirming, approving a price and publishing happen in the platform's web app,
and you never act for them.

Approval is refused until the decisions are confirmed (409
`decisions_unconfirmed`, with `confirmUrl`) and while the code is still being
profiled (409 `profile_pending`; the price may move, `price_changed`: reload
and approve the new one).

A spec confirmed with the `bouncer` skill and posted with its bounty needs no
second confirmation:

- From a terminal: `bouncer push <slug>`.
- With no terminal: `post_bounty` with `title` from `ticket.md`'s heading and
  `spec: { document: <spec.md as written>, format: "duediligence", confirmed: true, engine: { name: "duediligence", version: <bouncer --version> } }`,
  `confirmed: true` only while `bouncer confirm <slug>` says the confirmation
  is current.

A refusal `invalid_spec` lists each problem's path: fix spec.md, confirm
again, post again. An answer `confirmation: "skipped_scope"` kept the spec but
not the confirmation: the sign-in predates `decisions:confirm`.

## Sandboxes and verdicts

Once the price is approved and the person asks:

1. `start_sandbox` and `prepare` build a version: the platform writes hidden
   tests from the confirmed spec and calibrates them against a reference, as
   `bouncer prepare` does locally.
2. `get_handout` gives the public files and the hidden suite's commitment
   hash. `get_project_files` writes the public project to disk: call it again
   with each page's `nextCursor` until it is null, write `encoding: "base64"`
   files decoded, and for a file marked `too_large` download the whole project
   as a .zip from the web app (or `GET …/sandboxes/versions/<id>/archive`).
3. On a published version, `judge` submits an implementation's changed files
   and `get_verdict` reads the verdict (counts and failing scenario keys only);
   `retry` is a failed one's single retry.

From a terminal, the same without the tools (owners and admins):

- `bouncer prepare <slug> --hosted --version <id>` asks the platform to build
  the draft version, waits, and writes the public project to `--out`. Only
  when the person asks: the build is a paid model run. It sends the version's
  id and nothing else.
- `bouncer judge --platform <submission id>` prints a verdict the platform
  already gave, with the local exit codes; `--wait` polls one being graded.

You never see the hidden tests in hosted mode.

- A submission `errored` (with `errorCode`: grading timed out, was interrupted
  or failed on the platform's side) is not the implementer's fault: `regrade`
  grades it again and spends no retry.
- `carryBack: "failed"` means it went green but cannot be merged back as it
  is.
- `get_submission_files` takes a passing submission's files back from a
  generated (starter) version. A version sliced from a repository merges back
  by pull request instead, which an owner opens in the web app, optionally to
  merge once CI is green (`when: "ci_passes"`).
- `create_contributor_invite` hands the current published version to one
  outside contributor. Its claim link is shown once, so give it to the person
  straight away; the contributor works through the `lunox-contribute` skill.

The platform builds every sandbox as a Node 22 + TypeScript project, so hosted
mode fits TypeScript work; Python, Go and Rust stay local (the `bouncer`
skill).

## Limits

A run that calls a model (`size_bounty`, `respec`, `prepare`, `retry`) counts
against the workspace's monthly model-token limit, and builds and grading
against its evaluator time; `get_usage` shows both.

- An error `quota_exceeded` names the `kind` and when it resets,
  `rate_limited` when to try again: tell the person, never retry before then.
- A 409 with `retryable: true` kept what was sent: send the same files again
  after its `Retry-After`.

## CI and sign-in

`bouncer ci --platform --version <id> --workspace <id>` (or `action.yml` with
`version` and `workspace`, job permission `id-token: write`) judges a pull
request on the platform.

Never ask for a token in the chat: the server signs in through `/mcp`, the CLI
through `bouncer login` in the person's own terminal. Both now include
`specs:write` and `decisions:confirm`. A tool error `insufficient_scope` means
the sign-in predates a scope: ask the person to sign in again (`/mcp`, or
`bouncer login`).
