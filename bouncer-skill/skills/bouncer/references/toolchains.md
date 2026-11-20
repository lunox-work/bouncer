# Toolchains: languages, commands and services

Read this when the target is a new module that is not plain TypeScript, or is
checked as a command or an HTTP service. A change inside a repository uses the
repository's own runner instead: [repository.md](repository.md).

The templates (`template*/`) and the briefs for the sessions the CLI starts
(`prompts/`) are in the CLI's package; specs and runs are in the home.
`bouncer where` prints both (`home`, `package`).

## toolchain.json

A new module is built on its own, on a bundled toolchain. Write
`specs/<slug>/toolchain.json` in step 1 when it is not TypeScript:

| target                     | toolchain.json                                     | template           |
| -------------------------- | -------------------------------------------------- | ------------------ |
| TypeScript on `node:test`  | none (the default)                                 | `template/`        |
| Python on pytest           | `{"name": "python"}`                               | `template-python/` |
| Go                         | `{"name": "go"}`                                   | `template-go/`     |
| Rust                       | `{"name": "rust"}`                                 | `template-rust/`   |
| a command, at its boundary | `{"name": "exec", "boundary": {"command": ["node", "src/cli.js"]}}` | `template/` |

An HTTP service checked only at its boundary:

```json
{"name": "exec", "boundary": {"service": {"start": ["node", "src/server.js"], "healthcheck": "/"}}}
```

Commands and services run on the same TypeScript template. Their code may be
Python, Go or Rust instead: add `"language": "python"`, `"go"` or `"rust"` to
the boundary. The command (or the service's `start`) is then
`["python3", "src/cli.py"]` (`src/server.py` for a service), `[".bin/task"]`
or `["target/debug/task"]`. The suites stay TypeScript.

## Spec rules per target

Draft `spec.md` by the rules for the target (copies of the package's prompts
at this skill's version):

- TypeScript: [prompts/spec-from-ticket.md](prompts/spec-from-ticket.md)
- Python: [prompts/python/spec-from-ticket.md](prompts/python/spec-from-ticket.md)
- Go: [prompts/go/spec-from-ticket.md](prompts/go/spec-from-ticket.md)
- Rust: [prompts/rust/spec-from-ticket.md](prompts/rust/spec-from-ticket.md)
- a command: [prompts/exec/spec-from-ticket.md](prompts/exec/spec-from-ticket.md)
- an HTTP service: [prompts/http/spec-from-ticket.md](prompts/http/spec-from-ticket.md)
- a command in another language: [prompts/exec-native/spec-from-ticket.md](prompts/exec-native/spec-from-ticket.md)
- a service in another language: [prompts/http-native/spec-from-ticket.md](prompts/http-native/spec-from-ticket.md)

## What each needs on the machine

- Node 20.19 or later, on macOS, Linux or Windows.
- One account for the sessions, taken in this order unless `BOUNCER_BACKEND`
  names one: `claude` signed in (`CLAUDE_BIN`, PATH or the VS Code extension
  bundle), else their Codex login (`codex-cli`; Codex 0.164.0 installed into
  the home once), else `ANTHROPIC_API_KEY` (`anthropic-api`); or `exec` with
  `BOUNCER_EXEC=<command>`.
- claude sessions are held by Claude Code's sandbox and deny rules, the
  others by `sandbox-exec` or `bwrap`. On Windows there is no OS sandbox: say
  so before step 3, and that WSL2 gives one.
- The first command that needs the bundled toolchain installs it with npm
  10.9.2 into the home, `~/.bouncer/` (network, once).
- Python: `python3` (`python` on Windows); pytest is installed into the home
  once.
- Go and Rust: `go` or `cargo` on PATH.

## Skeletons from `prepare`

Step 3 writes the skeleton the hidden tests must fail on:

- TypeScript `skeleton/src/index.ts`; Python `solution.py`; Go `task.go`;
  Rust `lib.rs`.
- A command: `src/cli.ts`, which exits 2. A service: `src/server.ts`, which
  answers 501.
- With a `language`: `src/cli.py`, `src/server.py`, `src/main.go` or
  `src/main.rs`.

## The implementer's brief

`BRIEF.md` in a handout is the package's `prompts/agent.md`;
`prompts/exec/agent.md` or `prompts/http/agent.md` at a command or a service;
the `-native/` folder of either in another language; `prompts/repo/agent.md`
in a repository. It tells the implementer to make the public suite go green
and to write one test of its own per scenario, with inputs unlike the public
ones.
