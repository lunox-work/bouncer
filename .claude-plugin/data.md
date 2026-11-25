- **No MCP server:** the `bouncer-verify` plugin bundles no MCP server and
  its skill runs the CLI on the machine; installing it asks for no sign-in,
  and it reaches Lunox's platform only if the person runs one of the
  platform commands below themselves.
- **Offer on done (the plugin's one hook):** when a session hands the turn
  back, it reads that session's transcripts on the machine to count code
  edits and keeps what it offered in `~/.bouncer/offer/sessions.json`. It
  runs no model and sends nothing; `bouncer offer off` stops it.
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
  `push`, `prepare --hosted`, `judge --platform` and `ci --platform` are the
  only commands that talk to the platform.
  The CLI sends the token, its name and version, and, once at sign-in, the
  machine's host name to label the token. `push <slug>` posts a confirmed spec
  as a bounty: the ticket's title, the text of `spec.md`, whether it is
  confirmed here and the bouncer version, recorded in
  `specs/<slug>/platform.json` on the same machine; the platform records the
  decisions as confirmed by the signed-in person. `ci --platform`, in a
  GitHub Actions job that opts in, sends the pull request's changed files with
  the run's GitHub OIDC token (no saved token) to be judged against a
  published version's hidden suite, and reads back the verdict.
  `prepare <slug> --hosted --version <id>` sends only that sandbox version's
  id, and downloads the public project and the hidden suite's count and
  hash; `judge --platform <submission id>` reads a verdict the platform
  already gave. No other spec, ticket, suite or code is uploaded.
- **Personal data:** a ticket can name people; it is stored with the spec
  under `~/.bouncer/specs/` on the same machine.
- **Retention:** bouncer itself runs no service. What the model backends
  keep is governed by the person's own agreement with that provider, and what
  the platform keeps of what is sent to it by its privacy policy, at
  https://lunox.work/privacy/platform.
