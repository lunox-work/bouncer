# Privacy

bouncer is a command-line tool and agent skill that runs on your machine. It
needs no account and sends no telemetry, and nothing it handles reaches its
authors unless you use Lunox's hosted platform, which is optional (below).

- **Which plugin reaches the platform:** two plugins, installed separately.
  `bouncer-verify` bundles no MCP server and its skill runs the CLI on the machine;
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
  through the plugin. The platform's privacy policy, which also covers these
  plugins and the MCP server, is at https://lunox.work/privacy/platform.
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

Questions about this policy: open an issue at
https://github.com/lunox-work/bouncer/issues.

Last updated 2026-11-20.
