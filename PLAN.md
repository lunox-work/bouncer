# Plan: a bouncer you meet in the first minute

Status: proposal, 2026-11-19. Replaces the hosted-MCP plan of 2026-11-12, whose
phases 1 and 2 landed; its two unshipped items are under
[Carried over](#carried-over). Delete this file when it lands.

Sources: this repository at a69ab1d (0.7.0), RESULTS.md, and Roshan's Notion
note "Look through duediligence readme" (V1 keywords and About box, V2
teardown, V3 the bouncer persona).

## Progress (2026-11-19, local commits on main, not pushed or published)

Landed: the persona's lines (bin/voice.mjs: judge, prepare, CI title), the
mark and every README image redrawn (assets/src/), `judge --card`, the README
in his voice with docs/REFERENCE.md, the skill split (SKILL.md 149 lines,
references/, `bouncer-hosted` as its own plugin), `bouncer door`, `bouncer id`,
the after-the-fact flow (skills/bouncer/references/check.md), the CLI help
tidy-up.

A second pass the same day: the mark and the hero were redrawn (the first try,
a floating visor and a dot chart, had no character; see [The look](#the-look)),
and `door`, `id` and `--card` were fixed for long transcripts, large diffs
and Windows.

Measured, and what it changed:

- **Phase 0 failed its gate** (evidence/DOOR.md): any rule fired on 8.7% of
  127 real sessions that claimed done, and a model-judged check upheld 1 of 50
  firings. Per the kill rule the door is not the hero, and it ships as a report
  only: no Stop hook, no voice on its findings, never blocks.
- **Phase 2 (the ID check) is the hero**: on a 10-run sample, a failing
  decision was in the list for 10 of 10 rejected runs (25 of 28 scenarios),
  16 s median, $0.07 a run (over the $0.05 bar), model-judged
  (evidence/ID.md). A blind full pass over the 75 rejected runs is next, then
  its reach steps (other languages, a pull-request comment).

Not done, each needing a decision or an outside action: push and publish
(npm 0.8.0 needs the passkey; the plugin branch rebuilds on push); the About
box topics and the social preview (hero.png); phase 3's gate (same verdicts on
the 11 replayed commits, run through check.md); phase 5's fit funnel, which
runs 50 third-party test suites on this machine; the evidence move to a
separate repository; `prepare --hosted` and `judge --platform`.

## Where it stands

**Capability: strong and narrow.** The method is measured further than any
comparable skill: about 3,000 graded runs, a blind referee that upholds 95 of
100 rejections, 3 of 289 false rejects against an outside oracle, four
languages, CI from a sealed suite. Limits that cost reach:

- Nothing happens until a spec is drafted, confirmed and prepared: $1–4, 10–25
  minutes and a person's answers before the first verdict.
- The flow starts before the code is written. The moment people feel the pain
  is after it, when the agent has just said "all tests pass".
- Scope is one module or one package change under an hour. Jest and pytest
  repositories have little evidence, and nobody has measured how often `fit`
  says `supported` on repositories people actually have.
- The person's confirmation time is still "median minutes pending".

**The verdict stays narrow by design** (decided 2026-11-19). Both attempts to
reach more people by loosening the method failed: the door (1 of 50 firings
upheld) and suites from an unconfirmed draft (0 of 11). Reach comes from the
way in, never from a weaker verdict:

- The ID check is the wide product: a ticket and a diff, no spec, no `fit`, no
  test runner (phase 2, [Reach](#reach-the-id-check-outside-typescript-and-on-pull-requests)).
- One more audience the narrow shape already fits: people grading someone
  else's work (a contractor task, a candidate exercise, a bounty). They write
  the task before the code exists and the wait costs them nothing
  ([The repository](#the-repository)).
- The `fit` funnel, which measures how narrow it is before anything is fixed
  (phase 5).

Not in this plan: a cheaper verdict tier, more than one package per change, or
more languages for the full pipeline ahead of the funnel.

**Virality: low today, for product-shape reasons, not copy.** 0 stars, 0 forks.

| what caveman, ponytail and graphify have    | bouncer today                                                      |
| ------------------------------------------- | ------------------------------------------------------------------ |
| An effect you see seconds after install     | First effect after 10–25 minutes and a paid model run              |
| Output worth a screenshot                   | `duration-parse: overfit. Public 22/22, hidden 38/39.`             |
| Always on once installed                    | Runs only when asked, with a slug                                  |
| A persona from the first line of the README | Name only: the hero is a chart, the persona README is in Notion    |
| A README of about 135 lines                 | 591 lines, 6,561 tracked files (3,914 under `experiments/`)        |
| A wave to ride (a meme, a famous post)      | The wave exists (agents overclaiming "done"), the repo isn't on it |

What it has that they lack: numbers that survive a hostile reader, and a
persona that maps to the mechanism one to one. The plan is to move the first
meeting with him from minute 25 to minute 1 without touching the method.

## The persona

He is the product, not a mascot beside it. Every line he says names a check
that ran.

**The club.** The person is the owner and writes the guest list (the confirmed
spec). The dress code is posted at the door (the public suite). He holds the
list and never shows it (the hidden suite). The agent is the one in the queue
who is sure he's on it. A retry is "go home and change". `promote` makes a
regular.

**The queue.** Each stereotype is a failure class with its measured count, so
the joke and the evidence are the same sentence:

| at the rope              | what the agent did                                    | measured                                          |
| ------------------------ | ----------------------------------------------------- | ------------------------------------------------- |
| "I'm on the list."       | Reported its own tests green                          | 105 of 105 said so; 75 were wrong                 |
| The homemade ID          | Wrote the tests that vouch for its own guesses        | 66 of 74 failing own tests assert an open reading |
| "I know the owner."      | Decided something the ticket never said, as if it had | 14 of 15 escrow-split runs, the same guess        |
| The outfit change        | Hard-coded the public inputs                          | 21 of 21 rejected (Haiku)                         |
| The plus-twelve          | Changed files outside the allowed paths               | 0 of 262 in a repository                          |
| Writing on his clipboard | Edited a test, a lockfile or the harness              | 0 of 2,522 sandboxed runs                         |
| The smooth one           | A strong model told to game it                        | Got in 20 of 20 on two of four specs              |

The last row stays in. "Some nights the smooth one gets in" is the honest
loss, and it is why people will believe the other six.

**His lines.** The machine word never changes; agents and CI parse it. His
line is added beside it, on a terminal only.

| machine output                          | he says                                   |
| --------------------------------------- | ----------------------------------------- |
| `passed`                                | You're in.                                |
| `overfit`, keys                         | Not tonight. `boundary-2`                 |
| `incomplete`                            | Not dressed for it.                       |
| `regressed`                             | You broke something on the way in.        |
| `refused`                               | You don't write on my clipboard.          |
| outside the allowed paths               | Just you. Not your twelve friends.        |
| retry `passed`                          | One fix. You're in.                       |
| retry `overfit`                         | Same shoes.                               |
| exit 3, spec not confirmed              | No list tonight. Ask the owner.           |
| exit 1, hidden suite changed            | Someone touched my list. Nobody gets in.  |
| door: a test deleted, skipped, weakened | Crossing a name off doesn't put yours on. |
| door: "tests pass", no test ran         | You never queued.                         |
| door: only tests the agent wrote        | That ID's homemade.                       |

**Voice rules.** Short. Never more than the rule key: he doesn't explain the
list. He turns down the claim, never the person. No line without a check
behind it, no line in `--json`, a seal check body, a pipe or CI logs.

**Name and pronouns** (decided 2026-11-19: as Ponytail and Caveman do).
Ponytail narrates its character as "he" and "him" ("You know him."); Caveman
uses no pronoun and makes the name the subject ("Caveman make your AI agent say
less"). So: "he" and "him" in narration, "Bouncer" capitalised as the subject
where the product acts, never "it" for the character. The command and the
package stay lowercase `bouncer`.

**The repeatable format** is the two-line exchange already in Roshan's hero:
the agent's real sentence, then his. It is the one people will fill in with
their own agent's overclaims, which is why phase 4 makes it one command.

## The look

Roshan's hero proves the idea: the two-line exchange, the rope, "Not tonight."
It is redrawn, not restored. Its source never reached origin, it says
duediligence, and the figure is a scene that does not shrink to a mark.

**What the two references do** (their READMEs and assets, read 2026-11-19).
Borrow the mechanics, not the looks:

- A mark you can draw from memory, in one colour, kept apart from every stat
  image: Ponytail's inked face at 220 px with light and dark files, Caveman's
  pixel rock beside the wordmark.
- The mark built from the product's own material in the hero: Ponytail's face
  is set in code.
- One card template for every image: a mono caps line quoting the task, a
  two-clause headline with the name in the accent ("Your agent reaches for a
  library. Ponytail reaches for the browser."), one large contrast number,
  real output underneath.
- A small inline mark reused in table headers: Caveman's rock, an animated
  SVG.

**Bouncer's set.** Sources in `assets/src/`, rebuilt by
`assets/src/render.mjs`, every number citing RESULTS.md in a comment.

| asset              | what it is                                                                                                                                                                                                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The mark           | Him as a figure: no neck, shoulders edge to edge, a small bald head, wraparound sunglasses, arms crossed, the coiled earpiece. One colour, light and dark files, from one source (`bin/mark.mjs`) that the icon and the card also draw from. Replaces the check-card icon. |
| The banner         | The mark beside "Bouncer", for the top of the README.                                                                                                                                                                                                                      |
| The hero: the door | A club called DONE in neon. He fills its doorway; outside the rope a small agent holds up an ID, "ALL TESTS PASS, issued by: me". Headline and the two-line exchange beside it. Also the social preview. The 105 runs are drawn as dots on the runs card.                  |
| The stamp          | A club hand stamp, NOT TONIGHT and YOU'RE IN, set slightly off square. On every card, on `--card`, and usable as a sticker.                                                                                                                                                |
| The list           | His clipboard: scenario keys as guest-list rows, hidden tests as redaction bars, ticked or struck. "He never shows it" in one look.                                                                                                                                        |
| The cards          | One template, five cards: before and after (escrow-split), the verdict (re-recorded with the `bouncer` command), the queue's seven stereotypes, the runs, how it works (door, ID, list).                                                                                   |
| The rope           | An 18 px inline SVG for table headers and the verdict line. On `passed` the rope drops: one whole-object move, no spin.                                                                                                                                                    |
| The terminal mark  | Three lines of Unicode or fewer, printed with his line on a terminal, so a screenshot of a verdict carries him.                                                                                                                                                            |

- **Palette.** Night black, paper white, velvet-rope red as the one accent,
  green only for "in". Not the Lunox gradient, not Ponytail's blue to pink.
  Space Grotesk and DM Mono stay (already in `assets/src/fonts/`).
- **Method.** Hand-written SVG and HTML, no generated images: every asset can
  be rebuilt and edited, and nothing reads as stock illustration.
- **Order.** Three variants of the mark first, mocked in the README header at
  real size, light and dark, with a 16, 32 and 64 px strip. One is chosen, then
  the rest of the set is drawn from it. Done twice: the first choice, his head
  in three features, read as a floating visor and was replaced by the figure.
- **One card template, two users.** The README cards and `judge --card` come
  from the same function (`bin/card.mjs`, no dependency), so a card someone
  posts looks like the ones in the README.
- **The plugin directory's icon is set once.** The draft was saved on
  2026-11-12 with the check-card icon: check whether the draft can be
  discarded and filed again before counting on the new mark there.
- **Gates.** The mark is identifiable at 16 px (the figure holds at 32 px; at
  16 px only the shoulders and head outline is left). It can be redrawn from
  memory in three strokes (the figure takes more: shoulders, head, shades,
  arms). No asset contains "duediligence". Each image is checked at
  880 px (README width), at 375 px and as a 1280×640 social crop. Beside
  Ponytail's and Caveman's marks it shares no technique: no brush ink, no
  pixel grid.
- **Fallback.** Not needed: the hero is no longer the queue, and the runs card
  draws the 105 as a dot grid.

## Capability

Each phase has a gate registered before it is built, and a kill rule. Evidence
comes from the archive and `evidence/in-repo*` first; no new model run where a
stored one answers.

### 0. Measure the door before building it

The archive shows 0 of 2,522 sandboxed runs touching a test, so it cannot say
how often the cheap, obvious rejections happen in real work.

- Corpus: finished agent sessions in real repositories (local Claude Code
  transcripts, with their diffs) plus public agent-authored pull requests.
- Count, with no model: the final message claims tests pass or the task is
  done; no test command ran after the last edit; a test was deleted, skipped or
  had assertions removed; harness or config edited; a `TODO` or
  `not implemented` left in changed lines.
- **Gate:** at least one rule fires on 10% or more of sessions that claim
  done, and a hand check of 50 firings upholds 90%.
- **Kill:** under 10%, the door stays a quiet hook and phase 1 is not the hero;
  phase 2 is.

### 1. The door: `bouncer` with no arguments, and a Stop hook

No model, no spec, under 2 seconds. It reads the diff and, when there is one,
the session transcript, and gives one line and a reason.

- Build it from what exists: the `refused` path rules (`HARNESS_FILES`,
  bin/lib.mjs) and the transcript scan behind `judge --audit`. The door is
  bouncer's own: any language, no dependency.
- Decided 2026-11-19: for TypeScript, the door also calls `carveout gate` when
  carveout is installed, for the rules it already has (rewritten assertions,
  new mocks of the module under test, suppressions), and reports its holds in
  his voice. Without carveout the door says nothing about it and runs its own
  rules. carveout-gate stays a carveout skill.
- The plugin gains `hooks/hooks.json`: a Stop hook that runs the door when the
  agent's last message claims completion, and blocks the stop with his line
  and the reason, once per stop (honour `stop_hook_active`). Off with
  `BOUNCER_DOOR=0`. Check the hook contract against the current Claude Code
  docs before writing it.
- A clean door prints the way in, not a pass: "Dress code's fine. The list is
  another matter: `bouncer check`."
- **Gate:** on phase 0's corpus, 2% or fewer false stops on clean sessions; 0
  model calls and 0 network (test, as test/api.mjs does for `./api`).

### 2. The ID check: what the ticket left open and what the agent picked

The 2026-10-28 check already measured this: the culprit is in the list for 59
of 61 rejected runs, at about 10 items a run, 17% wrong by the spec, and the
model's risk label is worse than chance. So it is a list of questions, never
"bugs found", unranked.

- `bouncer id [--from <issue>]`: ticket plus diff in, "9 things your ticket
  never said. Your agent picked for you." out, each with what the diff chose.
- The person's keep or change per item is the confirmation: answers are
  written as `Decided:` lines with `Ticket:` and `Instead:`, so step 2 of the
  skill needs no second pass.
- **Gate:** list in 60 seconds and $0.05 or less; on the 105 stored runs the
  culprit stays in the list for 90% or more of rejected runs; median person
  time to answer 3 minutes or less, which also fills the "minutes pending" row.
- **Kill:** if answers need a second confirmation pass more than 1 time in 5,
  keep it as a reader, not as the confirm step.

#### Reach: the ID check outside TypeScript and on pull requests

Added 2026-11-19. Nothing in `bouncer id` is tied to a language, a test runner
or the one-module scope, but its evidence is 10 runs, all TypeScript, judged
by a model that was not blind. No claim wider than that until these pass, in
this order:

1. The blind pass over the 75 rejected runs, judged on another model, holds
   the 90% gate above.
2. Other languages. The archive cannot answer this: evidence/languages has 24
   runs and 2 rejections. Run loose tickets in Python, Go and Rust until there
   are at least 20 rejected runs, one at a time, in a new folder (`grade`
   rewrites results.jsonl).
3. The pull-request form: a workflow step that runs `bouncer id` on a pull
   request's linked issue and its diff and posts the list as one comment,
   edited in place on each push. Questions, unranked, never "bugs found", and
   never a failing check. It is the always-on surface the door could not be.

- **Gate:** on the non-TypeScript runs, a failing decision is in the list for
  90% or more of rejected runs, judged blind, at the same time and cost bars.
  For the comment: on the 11 replayed commits, one comment per pull request, 0
  hidden test names, and no change to any check's status.
- **Kill:** under 90% outside TypeScript, the README says "TypeScript" beside
  the ID check and the comment ships for TypeScript repositories only.

### 3. One command after the fact: `bouncer check`

The viral moment is "it just said done". Today the skill starts before the
code exists.

- `bouncer check [--from <issue>]` in a checkout: `fit`, point at the package
  the diff touches, the ID check as confirmation, `prepare`, then
  `judge --repo` on the working tree. One slug, chosen for the person.
- Cut the wait: the reference needs only the spec and the skeleton, so write
  it alongside the two suite writers, two sessions at a time and never more
  (confirm the order in bin/generate.mjs and bin/calibrate.mjs first). Print
  what is happening in his voice while it runs.
- A second, cheaper tier for when 10 minutes is too long is not in this plan:
  every shortcut tried so far (suites from an unconfirmed draft: 0 of 11)
  failed.
- **Gate:** the same verdict as today's pipeline on the 11 replayed commits (8
  of 11) and on ufo and pathe; median wall time from command to verdict 8
  minutes or less, person time included.

### 4. The verdict people post

- `judge` and `check` on a terminal print his line above the unchanged output.
  `--plain`, `NO_COLOR`, a pipe and `--json` print today's bytes exactly
  (snapshot test).
- `--card <file.svg>`: the two-line exchange with the agent's own last
  sentence (from the transcript, or `--claim "<text>"`), his line, the
  scenario key, counts and `hiddenSha256`. No hidden test name ever, the same
  rule as the CI check. SVG so it needs no browser to render.
- The CI check's title becomes his line; the body is unchanged.
- A README badge for repositories that judge pull requests with a seal:
  "bouncer on the door". Each repository that adds it is an install link.
- **Gate:** 0 hidden test names in any card across the 66 stored CI logs and
  checks; exit codes and JSON identical before and after.

### 5. More repositories get past `fit`

- Run `fit` on 50 popular TypeScript and Python repositories, one at a time
  (memory rule: check `memory_pressure` first). Publish the funnel: supported,
  and each unsupported reason with its count.
- Fix the top two reasons. Likely candidates from Scope: suites over ten
  minutes, and repositories visible only through a running service (the judge
  runs `--seam http`; no brief writes those suites yet).
- Add evidence where it is thin: Jest and pytest repositories.
- **Gate:** the funnel is in RESULTS.md, and `supported` rises by at least 10
  points after the two fixes.

### Carried over

From the 2026-11-12 plan, still unshipped: `prepare --hosted` and
`judge --platform <submission>`. Independent of everything above.

## The skill

`skills/bouncer/SKILL.md` is 328 lines. An agent reads 53 lines of toolchain
JSON and 67 lines of platform API before it reaches step 1, and the
description triggers on "hidden suite" wording, not on what people say.

- **Description.** Lead with the moment: the agent says it's done or that
  tests pass and the person doubts it; "check my agent's work"; "bounce this";
  "is this really done"; grading a contractor's or candidate's submission.
  Keep it under 1,024 characters and as `description: >-`.
- **Shape.** SKILL.md at 150 lines or fewer: the door, the ID check, the five
  steps, the verdict table with his lines, the "you are not blind" rule. Move
  the rest to references read on demand: `references/toolchains.md` (exec,
  http, native languages), `references/repository.md` (fit, repo, seams,
  promote, CI seal), `references/verdicts.md`.
- **Hosted mode leaves this skill.** It becomes `skills/bouncer-hosted/`, as
  carveout was split in two. The local skill keeps one line pointing to it.
- **Hosted mode leaves this plugin** (decided 2026-11-19). The marketplace
  lists two plugins: `bouncer` with no MCP server, so installing it asks for
  no sign-in, and `bouncer-hosted` with `.mcp.json`, the `bouncer-hosted` and
  `lunox-contribute` skills. `scripts/skill.mjs` builds both onto the
  `claude-plugin` branch and `check` covers both; PRIVACY.md and
  `.claude-plugin/data.md` say which plugin reaches the platform.
- **Voice in the skill.** The agent relays his line with the verdict, then
  plain facts. It never softens a verdict, never invents a line, and never
  uses the voice while asking the person to confirm decisions.
- **Entry points.** `/bouncer` runs the door, then offers `check`. Asking for
  hidden tests for a ticket runs the existing flow from step 1.
- **Gates:** a trigger set of 20 prompts that should load it and 20 that
  should not, 90% or better each way (skill-creator's description eval); a
  fresh agent given only the skill folder takes duration-parse from confirm to
  verdict with 0 audit findings; `scripts/skill.mjs check` passes; the plugin
  directory validator still shows 0 warnings and 0 holds (no wrapped line
  starting with "pass").

## The repository

- **README.** Land Roshan's V3 text on the new name: "You know him." intro,
  Real catches, How it compares, the FAQ in voice, the "Not for:" line, with
  the images from [The look](#the-look). Target 200 lines or fewer; Layout,
  hosted sign-in, CI detail and the full pipeline move to `docs/REFERENCE.md`.
  The agent section stays verbatim with AGENTS.md. Every number still traces
  to RESULTS.md.
- **A section for people grading someone else's work** (added 2026-11-19):
  a contractor task, a candidate exercise, a bounty. Below the catches, never
  the hero, so the launch tells one story. It says what they already do (write
  the task first) and what he adds (a list the submitter never sees), and
  points to `bouncer-hosted`. The skill description already triggers on it.
- **V3's images are not restored.** Its source never reached origin (only
  `main` and `claude-plugin` are there), and the Notion page holds PNGs that
  still say duediligence. They are redrawn under [The look](#the-look).
- **One tagline everywhere:** README, About box, npm, plugin.json. Proposal:
  "Your agent says it's on the list. He checks." with Roshan's keyword line
  under it ("Verify your coding agent's work with tests it never saw").
- **About box.** Drop the `due-diligence` topic. Add from Roshan's V1 list:
  `codex`, `cursor`, `swe-bench`, `reward-hacking`, `tdd`,
  `spec-driven-development`, `llm-evaluation`, `vibe-coding` (GitHub allows
  20). Upload the hero as the social preview.
- **Weight.** Move `experiments/` (3,914 files) and `runs/` to a
  `bouncer-evidence` repository, linked from RESULTS.md; keep `evidence/`
  write-ups and the scripts. `npx skills add` and the plugin marketplace both
  clone this repository.
- **Trust files.** Add Roshan's SECURITY.md and CONTRIBUTING.md; turn on
  private vulnerability reporting.
- **Leftovers.** `bouncer where` still prints `~/.duediligence` on a machine
  that has one, with no word about why: print the reason once. Fold `referee`,
  `red-team-audit`, `import-archive` and `grade` under `bouncer evidence …` so
  help shows the nine commands a person uses.

## Order

1. Phase 0 (a count, no build) and the three mark variants, in parallel:
   neither needs new capability.
2. The rest of the look, then the README landing with it.
3. The skill split and description, with its trigger gate.
4. Phase 4's terminal lines (small, and everything after shows them).
5. Phase 1 or phase 2 first, as phase 0 decides; then phase 3. Phase 2's
   reach steps follow its blind pass and do not hold the launch.
6. Phase 5 and the evidence move.
7. Launch only after phases 1–4: the author's own r/ClaudeCode post with the
   two-line exchange, then Show HN. No post before the door exists; the first
   visitor has to meet him in a minute.

## Decisions

All decided 2026-11-19, none open: the door is bouncer's own and calls
`carveout gate` when installed (phase 1); name and pronouns follow Ponytail
and Caveman (The persona); the images are redrawn (The look); the lunox MCP
server moves to a second plugin, `bouncer-hosted` (The skill); the verdict
stays narrow and reach comes from the ID check, the grading audience and the
funnel (Where it stands).
