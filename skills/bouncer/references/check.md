# After the fact: the agent already says it's done

The usual flow writes the list before the code. When the code exists and the
person doubts the agent's "done" or "all tests pass", there are two stops:
the list, in seconds, and a verdict, in minutes. Start with the list. Go on
to the verdict only when the person asks for it.

## The list (seconds): `bouncer id`

Run it in the checkout, with the ticket one of three ways:

- `--from <issue url | owner/repo#n | KEY>`: the issue the work came from.
- `--ticket -`: the request on stdin, in the person's words. In the session
  that did the work, that is what they asked for, quoted as they wrote it,
  follow-ups included. Never your summary of what was built: it would state
  every pick as if the ticket had. In another session, ask them for it.
- `--ticket <file>` when it is already a file.

It reads the change `bouncer check` would read: the working tree against
HEAD, or everything since the fork from the default branch when the work is
committed (it says which; `--base <ref>` reads less). It lists what the
ticket never said and what the agent picked, with file and line, in one
session: about 17 seconds and $0.06. No package has to fit and nothing is
installed.

Lead with his `Bouncer:` lines word for word (`Let me see some ID.`, and
anything beside it), then give the person the list as printed, all of it,
with no voice of his inside it. They are questions, not bugs: never rank
them, drop one, or say which pick is wrong. they would change is work the agent is not done with, and that may be all
they wanted. Then offer the verdict with its cost (his `Cover charge`
line, when printed, says it), and stop.

## The verdict (minutes): `bouncer check`

It reuses steps 1–5 of SKILL.md and the repository target
([repository.md](repository.md)); nothing here skips the person's
confirmation. Run after `bouncer id` on the same change, it takes the ticket
that read and keeps its list, so the person confirms the list they saw.
Otherwise give it `--from <issue>` or `--ticket <file>`.

`bouncer check` in the checkout runs steps 1 to 4 below in order, picks the
base, the package and the seam from the change (`--base`, `--package`,
`--seam` override), drafts `spec.md` from the ticket and the list, and stops
with exit 3 for step 3's confirmation, having listed the `Decided:` items
(the person's clock starts there). Put those decisions to the person in that
same turn, as step 3 says, record `--by`, then run `bouncer check` again: it
prepares and judges. The steps below are what it runs, for when one needs
doing by hand.

It takes a few minutes before that stop (`fit` installs and runs the
existing suite, then the ID and drafting sessions) and 10–25 more after it
(prepare and judge): run it in the background or with a long timeout, and
wait for it to exit instead of polling.

Run again in the same checkout and branch, it resumes the newest check there
and says which (base, seam, ticket). For a second task on the same branch use
`bouncer check --new`: a flag that differs from the resumed check is refused,
not ignored. When the change moved since the list was read it says so, and
redoes the list and the draft while the spec is still unconfirmed.

## What the confirmation means here

Here the spec is drafted from the agent's own picks. If the person keeps
every pick as it is, the hidden suite encodes what the code already does and
the verdict says little. It is independent in two places: the rules the
ticket states, and the picks the person changes. So put each decision as a
real choice between the pick and the alternative, never as a list to wave
through, and say this when they keep everything. The list holds twelve picks
at most: a larger change has decisions that are not on it.

## 1. The door (no model, seconds)

`bouncer door` in the checkout reads the agent's session transcript (the
newest for this folder that edited a file, or `--transcript <file>`; when
no session here edited anything, the change came from elsewhere and it says
so) and, in a TypeScript
checkout with carveout installed, `carveout gate`. It lists what is worth a
look: no test run after the last edit, tests skipped, weakened or deleted, the
last test run red, only tests the agent wrote, a TODO left in code, harness or
config edited. It never
turns work away: measured on real sessions its rules were rarely right
(evidence/DOOR.md), so put each finding to the person as a question, without
his voice. Then go on.

## 2. Fit and point the spec at the change

- The package the diff touches: `bouncer fit --repo . --package <dir>`. On
  `unsupported`, or a change spanning packages, no hidden suite can be
  prepared: say why, then still run step 3's `bouncer id` on the whole change
  and put its list to the person (`bouncer check` with a ticket does this
  and exits 2).
- The base is the commit before the agent's change (`git log`; ask the person
  when it is not clear). The seam is the files the change implements.
  `bouncer repo <slug> --repo . --package <dir> --seam <file>[,<file>] --base <base>`.

## 3. The ID check, as the confirmation

- Save the ticket as `specs/<slug>/ticket.md` (`bouncer confirm <slug> --from
<issue>` fetches one); with no ticket, ask the person for the request in
  their words and save that.
- `bouncer id <slug> --repo . --base <base>` lists what the ticket never said
  and what the agent picked, with where. They are questions, not bugs: never
  rank them or say which pick is wrong.
- Draft `spec.md` by [prompts/repo/spec-from-ticket.md](prompts/repo/spec-from-ticket.md)
  with each listed pick as a `Decided:` item: the pick as the rule, its
  `Ticket:` line, and the listed alternative as `Instead:`.
- Then step 2 of SKILL.md as written: `bouncer confirm <slug>`, one
  AskUserQuestion per decision (keep the agent's pick or take the other),
  edit `spec.md`, and `--by` only after their yes.

## 4. Prepare and judge the working tree

- Say the cost first (SKILL.md "Cost"), then `bouncer prepare <slug>`.
- No handout: the code is already there. `bouncer judge <slug> --repo . --audit`
  judges the working tree against the base plus the public and hidden suites
  and the existing suite. `--card verdict.svg` writes the exchange to post,
  with the agent's own last claim from its transcript.
- Relay the verdict as SKILL.md step 5 says. An `overfit` here often means a
  pick the person changed in step 3: one retry for the agent with the failing
  scenario keys only.
