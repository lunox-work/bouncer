# Exit codes, verdicts and retries

## `bouncer prepare <slug>`

- `0`: ready. Tell the person how many public and hidden tests were kept.
- `3`: not confirmed, or `spec.md` changed since. Back to step 2.
- `4`: the public suite asserts things the spec leaves open. Show the person
  the list. For each, they decide it in `spec.md` (back to step 2; the suites
  are rewritten) or leave it open (`bouncer prepare <slug> --accept-open`; the
  hidden suite then tests neither reading).
- `1`: a step failed; its output says which. In a repository it can also mean
  the reference broke existing tests ([repository.md](repository.md), step 3).

## `bouncer judge`

It prints the verdict, the counts, the failing scenario keys (such as
`unhappy-2`) and the hidden suite's sha256, the one the handout's brief
showed.

| exit | verdict                                              |
| ---- | ---------------------------------------------------- |
| 0    | `passed`                                             |
| 2    | `overfit`: the public suite is green, the hidden one is not |
| 3    | `regressed` (repository only)                        |
| 1    | `incomplete` (public fails), `refused`, or not judged |

**Hidden suite changed.** If the hidden suite changed since it was committed,
the judge refuses (exit 1, `hidden suite changed since <at>`). Tell the
person; never judge around it.

## What to do with each

- **`incomplete`:** the agent is not done. The public failures are printed and
  may go back to it.
- **`overfit`:** rerun with `--detail` and show the person the failing hidden
  tests. Never show them to the implementing agent. The person classes it:
  - `real`: the code misses what the spec says. One retry at most, giving the
    agent the failing scenario keys and nothing else: no test names, inputs or
    assertions. For a blind session:
    `bouncer grade <slug> && bouncer retry <slug> <variant>`, then judge
    `runs/<slug>/<variant>-retry-keyed/1/submission/src`.
  - `spec-gap`: the hidden test asserts a reading the spec left open. Decide
    it in `spec.md` and go back to step 2.

  Information moves hidden → spec → public, never hidden → agent.
- **`regressed`, `refused`:** [repository.md](repository.md), step 5.
- **`passed`:** say what it means: the code passes tests it never saw, written
  from the confirmed spec. It does not cover what the spec does not say. In a
  repository, offer `promote` ([repository.md](repository.md)).
