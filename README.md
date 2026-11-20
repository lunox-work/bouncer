# bouncer

Your agent says it's on the list. He checks. Verify your coding agent's work with tests it never saw. A hidden suite written from the spec you confirmed judges the result. Local only: no MCP server and no sign-in. Hosted mode is the separate bouncer-hosted plugin.

## Skills

- **bouncer**: Use when an agent says it's done or that the tests pass and the person doubts it: "check my agent's work", "is this really done", "bounce this", "I don't trust its green tests", "did it game the tests". Also for grading a contractor's, candidate's or agent's submission against a spec or ticket, and for tests an agent can't see for a ticket. Bouncer turns the ticket into a spec the person confirms, a public suite for the implementing agent and a calibrated hidden suite he keeps, then judges the work: passed, overfit, incomplete, regressed or refused. One module (TypeScript, Python, Go, Rust), a command, an HTTP service or one package of a TypeScript or Python repository. Not for writing ordinary unit tests, raising coverage, fixing a failing test, or a code, style or security review by eye.

## Install

```sh
claude plugin marketplace add lunox-work/bouncer
claude plugin install bouncer@bouncer
```

The same marketplace has `bouncer-hosted`: Bouncer on Lunox's hosted platform (platform.lunox.work): a bundled MCP server that signs in on first use, and the lunox-contribute skill for invited contributors.

## Requirements

- **bouncer**: Node ^20.19 or 22+. Runs the @lunox-work/bouncer@0.8.0 CLI from npm, which starts Claude Code, Codex or Anthropic API sessions and installs its test toolchain under ~/.bouncer/ once (network).

## No sign-in

The plugin bundles no MCP server: installing it asks for no sign-in, and its skill runs on the machine.

## Links

- [Privacy](https://github.com/lunox-work/bouncer/blob/main/PRIVACY.md)
- [Documentation](https://github.com/lunox-work/bouncer#readme)
- [Support](https://github.com/lunox-work/bouncer/issues)

## Data

- **Which plugin reaches the platform:** two plugins, installed separately.
  `bouncer` bundles no MCP server and its skill runs the CLI on the machine;
  installing it asks for no sign-in, and it reaches Lunox's platform only if
  the person runs `bouncer login`, `push` or `ci --platform` themselves
  (below). `bouncer-hosted` bundles the `lunox` MCP server and the
  `bouncer-hosted` and `lunox-contribute` skills; it talks to
  platform.lunox.work once the person signs in through `/mcp`.
- **Sent off the machine:** the spec, the ticket it came from and the code
  being judged go to the model backend the person chooses, on their own
  account: a Claude Code session, the Codex CLI, or the Anthropic API with
  their `ANTHROPIC_API_KEY`. `confirm --from` reads a GitHub issue, or a Jira
  issue with `JIRA_BASE_URL`, `JIRA_EMAIL` and `JIRA_API_TOKEN`, from the
  person's own GitHub or Jira. The first run installs the test toolchain from
  npm, and from pip for Python; Go and Rust use the toolchains already
  installed. There is no telemetry.
- **Lunox platform, only when asked:** without an account the CLI is
  unchanged and local. `bouncer login` signs in to Lunox's hosted service
  at platform.lunox.work with a code approved in the browser, and stores a
  workspace API token in `~/.lunox/credentials` on the same machine (mode 600,
  shared with carveout); `logout` deletes it. `login`, `whoami`, `logout`,
  `push` and `ci --platform` are the only commands that talk to the platform.
  The CLI sends the token, its name and version, and, once at sign-in, the
  machine's host name to label the token. `push <slug>` posts a confirmed spec
  as a bounty: the ticket's title, the text of `spec.md`, whether it is
  confirmed here and the bouncer version, recorded in
  `specs/<slug>/platform.json` on the same machine; the platform records the
  decisions as confirmed by the signed-in person. `ci --platform`, in a
  GitHub Actions job that opts in, sends the pull request's changed files with
  the run's GitHub OIDC token (no saved token) to be judged against a
  published version's hidden suite, and reads back the verdict. No other
  spec, ticket, suite or code is uploaded.
- **The `lunox` MCP server, in the `bouncer-hosted` plugin only:** in Claude
  Code it talks to platform.lunox.work only once the person signs in to it
  through `/mcp`. Its read tools (`list_*`, `get_*`) read the account and the
  workspace, with its bounties, repositories, sandboxes and runs. Its write
  tools run only when the person asks for that action: a bounty posted (title
  and spec text, with the person's confirmation when the spec was confirmed
  here) or imported from a GitHub or Jira issue, a spec changed, a sandbox
  version built, an implementation's changed files submitted for a verdict or
  graded again, a contributor invited to a published version, and a passing
  submission's files taken back. `size_bounty`, `respec`, `prepare` and
  `retry` start model runs on the platform that count against the workspace's
  monthly token limit. Hidden tests are written and kept on the platform and
  never sent to the session. Confirming a priced spec's decisions, approving a
  price, publishing and merging back happen in the platform's web app, not
  through the plugin. The platform's privacy policy is at
  https://platform.lunox.work/privacy.
- **The `lunox-contribute` skill, in the `bouncer-hosted` plugin:** for a
  person invited to contribute, it talks to platform.lunox.work only through
  the contributor MCP server they add and sign in to themselves
  (`/mcp/contribute`), or their own `lnxc_` token: it reads the version they
  were invited to and submits the files they changed for a verdict.
- **Personal data:** a ticket can name people; it is stored with the spec
  under `~/.bouncer/specs/` on the same machine.
- **Retention:** bouncer itself runs no service. What the model backends
  keep is governed by the person's own agreement with that provider, and what
  the platform keeps of what is sent to it by its privacy policy.

## Source

This branch holds only the plugins' files: `bouncer` at its root, `bouncer-hosted` in bouncer-hosted/. The CLI, its documentation and the
skills' source are on the main branch of https://github.com/lunox-work/bouncer. License: MIT.
