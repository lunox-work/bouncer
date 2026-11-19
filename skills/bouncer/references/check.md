# After the fact: the agent already says it's done

The usual flow writes the list before the code. When the code exists and the
person doubts the agent's "done" or "all tests pass", run this instead. It
reuses steps 1–5 of SKILL.md and the repository target
([repository.md](repository.md)); nothing here skips the person's
confirmation.

**One command does all of it:** `bouncer check [--from <issue> | --ticket <file>]`
in the checkout runs steps 1 to 4 below in order, picks the base, the
package and the seam from the change (`--base`, `--package`, `--seam`
override), drafts `spec.md` from the ticket and the list, and stops with
exit 3 for step 3's confirmation. Put the decisions to the person as step 3
says, record `--by`, then run `bouncer check` again: it prepares and
judges. The steps below are what it runs, for when one needs doing by hand.

## 1. The door (no model, seconds)

`bouncer door` in the checkout reads the agent's session transcript (the
newest for this folder, or `--transcript <file>`) and, in a TypeScript
checkout with carveout installed, `carveout gate`. It lists what is worth a
look: no test run after the last edit, tests skipped, weakened or deleted, the
last test run red, only tests the agent wrote, a TODO left in code. It never
turns work away: measured on real sessions its rules were rarely right
(evidence/DOOR.md), so put each finding to the person as a question, without
his voice. Then go on.

## 2. Fit and point the spec at the change

- The package the diff touches: `bouncer fit --repo . --package <dir>`. Stop
  on `unsupported` and say why.
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
