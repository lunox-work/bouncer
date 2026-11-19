# Security

## Reporting a vulnerability

Report it privately through GitHub: the repository's **Security** tab, then
**Report a vulnerability**. Please don't open a public issue for it. Include
the bouncer version (`npx -y @lunox-work/bouncer --version` prints it), the command you
ran, and the smallest steps that reproduce it.

Only the latest release on npm is supported; fixes ship as a new release.

## What counts

Bouncer's promise is that the agent being judged never sees the hidden
suite and cannot change what judges it. A report is most useful when it breaks
that:

- **A hidden test reaching the implementer:** in a handout, a verdict, the
  output of `judge` or `ci`, a CI check, or a log.
- **A sandbox escape:** an implementer session reading a hidden path or editing
  a test, the harness or a config outside what the verdict reports as
  `refused`.
- **A seal accepted after its hidden suite changed**, against its
  `hiddenSha256`.
- **Credentials:** the platform token in `~/.lunox/credentials`, or a token
  reaching a session, a submission or a log.

## Known limits, not vulnerabilities

These are documented in docs/REFERENCE.md and are not treated as reports:

- In CI, the submission's code runs beside the hidden suite when it is judged.
  The judge's environment carries no token and its output names no hidden test,
  but a submission that reads the runner's disk and sends it over the network
  is not stopped. Keep seals out of reach of the implementer and judge on a
  runner you control.
- The example suites under `specs/` ship in this repository and the npm
  package, so they are not held out. Prepare your own spec where that matters.
- On Windows the sessions run without an OS sandbox.
