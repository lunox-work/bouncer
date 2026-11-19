# A change inside a repository

Read this when the work is a change to one package of the person's own
TypeScript or Python repository. It is built in their checkout, with the
package's runner and its existing suite, which must keep passing. The steps
are the five in SKILL.md, with what is below added.

## 0. Fit

`bouncer fit --repo <path> --package <dir>` reads the repository at a commit,
installs it in a copy and runs the package's existing suite once. It prints
`supported` or `unsupported: <reason>`.

Supported: an npm, pnpm or Yarn (not Plug'n'Play) lockfile, TypeScript, and
vitest, Jest or `node --test` over a `tsconfig.test.json` build; or a Python
package with pytest and `uv.lock`, `poetry.lock` or `requirements*.txt`; with a
suite under ten minutes. Tests that fail in the copy (network, services) become
known failures, not a refusal.

If it says unsupported, say so and stop; offer the new-module target if the
logic can be cut out of the repository. A change visible only through a
running service does not fit yet: `fit`, `repo` and the judge take
`--seam http`, but no brief writes its suites.

## 1. Spec: point it at the package first

```sh
bouncer repo <slug> --repo <path> --package <dir> --seam <file>[,<file>] [--base <ref>] [--allowed <path>,...]
```

- The **seam** is the file or files the stub writes and both suites import.
- The **allowed paths** are what the implementer may change (default: the
  seam's folders).

It writes `specs/<slug>/toolchain.json`, prepares the base tree and records the
existing suite in `baseline.json`. Draft `spec.md` by
[prompts/repo/spec-from-ticket.md](prompts/repo/spec-from-ticket.md)
([prompts/repo-python/spec-from-ticket.md](prompts/repo-python/spec-from-ticket.md)
for a Python package): the seam's exports with signatures, the existing exports
that keep their behaviour, nothing a unit test cannot check.

## 2. Confirm

The seam and the allowed paths are listed with the decisions, and changing
either voids the confirmation.

## 3. Prepare

Exit 1 also means the reference broke existing tests: the spec changes
behaviour those tests pin, or the allowed paths are too narrow. The person
decides which, in `spec.md` or with `repo.mjs --allowed`, then confirm again
and rerun with `--force`.

## 4. Implement: three more ways

- **A blind session** (`bouncer run`) gets a copy of base plus stub plus
  public suite; `submission/` holds the files it changed at their repository
  paths. Grade it with `bouncer grade <slug>`.
- **In their checkout:** `bouncer handout <slug> --repo [<checkout>]` writes
  the stub and the public suite into the working tree, uncommitted, and prints
  the brief (`runs/<slug>/handout/BRIEF.md`). It refuses if those paths are
  dirty or exist. Give the brief to their agent, or follow it in this session
  (SKILL.md, "You are not blind"). `--remove` takes the handout out again while
  it is unchanged.
- **In CI (blind by placement):** `bouncer seal <slug>` writes one file
  holding the suites. The person stores it where the implementer cannot read
  (a private repository, artifact or secret URL) and calls
  `.github/workflows/judge.yml` (or `action.yml`) on pull requests. Each pull
  request gets a check with the verdict, counts and failing scenario keys; no
  audit is needed.

The brief also says: keep the existing suite green and stay inside the allowed
paths.

## 5. Judge

```sh
bouncer judge <slug> --repo [<checkout>] [--ref <rev>] --audit
```

It judges the working tree, or the commit `--ref`, against base plus stub plus
public suite, with the existing suite too. Two more verdicts:

- **`regressed`**: a test of the existing suite that passed on base plus stub
  fails now. It is printed by name, since the repository's own tests are
  public; the agent fixes it without a retry rule.
- **`refused`**: it changed harness: a public or existing test,
  `package.json`, `pyproject.toml`, a lockfile, a TypeScript, Jest or pytest
  config, a `conftest.py`.

A change outside the allowed paths is reported as outside scope, and refused
only with `--strict-scope`. Report the audit line with the verdict.

## After `passed`: promote

Offer `bouncer promote <slug>`. It copies the hidden suite into the checkout
beside the public one as the repository's own regression tests
(uncommitted). After it, the spec judges nothing.
