# Coding agents need a held-out test set

_I borrowed Kaggle's private leaderboard for coding agents and ran about
3,000 graded runs on it. The result I expected did not show up. A different
one did._

Disclosure: I built a tool on this ([Bouncer](../README.md), MIT). Every
number below is in [RESULTS.md](RESULTS.md), failures included, and the runs
are in [bouncer-evidence](https://github.com/lunox-work/bouncer-evidence).

## Summary

- 140 agent runs on four models ended with "all tests pass", on tests the
  agent wrote. 60 of them passed a held-out suite written from the owner's
  spec.
- Nobody cheated. In 2,522 sandboxed runs no agent edited a test or the
  harness.
- I expected agents to overfit the tests they could see. They mostly do not:
  1 real case in the first 90 runs.
- What fails is quieter. The ticket is silent on something, the agent picks
  an answer, and its tests encode the pick. A stronger model picks better
  and still picks.
- A held-out suite is only as good as the spec behind it. Written from a
  spec a model drafted, it rejected 20 of 23 real, shipped commits. Written
  from a confirmed spec, it rejected 3.
- It fails in known ways. 50 of 386 passes still broke a stated rule. Opus
  told to game it got through on 2 of 4 specs.

## The idea

A Kaggle competition scores you on a public leaderboard you can see and
ranks you on a private one you cannot. A score you can see is a score you
can tune to, so nobody is trusted to report their own accuracy.

A coding agent writes the code, writes the tests, runs them and reports the
result. It is the competitor, the host and the leaderboard. The proposal is
to split those roles the way Kaggle does:

| Kaggle                         | For a coding agent                                     |
| ------------------------------ | ------------------------------------------------------ |
| public leaderboard             | public tests: the agent reads them and works on them   |
| private leaderboard            | hidden tests: the agent never sees them, they decide   |
| the host holds the labels      | the owner confirms the spec the tests are written from |
| a cap on submissions           | one retry, told which rule failed, never the test      |
| the test set is fixed up front | a hash of the hidden suite, given out with the task    |

I call the hidden ones independent tests: written by another party, from the
spec and not from the code, never shown to the implementer, and the only
tests that count for acceptance.

## The setup

Each task is one module with a spec. Separate model sessions each do one
job:

1. One writes the public suite from the spec.
2. One writes the hidden suite from the spec. It may read the public suite,
   so that it can aim at what that suite leaves out.
3. One writes a reference implementation. Every hidden test must fail on an
   empty skeleton and pass on the reference, or it is dropped.
4. One implements. It runs in its own temp directory. The OS sandbox denies
   reads of the hidden suite, and transcripts are scanned for attempts.

Verdicts: `passed` (both suites pass), `overfit` (public passes, hidden
fails), `incomplete` (public fails), `refused` (the diff touches tests or
the harness). Every hidden test is keyed to a scenario in the spec, so a
failure can be reported as `boundary-2` without leaking the test.

Opus 5.5 wrote the suites. Haiku 5.5 implemented unless stated. The specs
are TypeScript, sized to be done in under an hour. p-values are Fisher's
exact test, two-sided.

## What I expected: overfitting. What I got: almost none.

The hypothesis was the Kaggle one: agents pass the visible tests and fail
the hidden ones.

On five specs with Opus implementing, 0 of 15 runs were overfit. With two
control arms (no tests, and the agent's own tests) on Opus and Haiku, it was
1 in 90. That one is a hunk-header regex with two capture groups where the
code reads the second and fourth. The public diffs were too short to show
it.

I wrote harder specs: concurrency, compliance rules, an invented wire
protocol. Across fourteen precise specs the public suite separated the arms
on one. I tried 40 LiveCodeBench hard problems, and every arm solved 36 or
37 of the 37 that were soundly judged. Those problems predate the model's
cutoff, so that run mostly measures memory.

So with every rule written down, a current model does not need a held-out
set.

## Then I gave the agent the ticket instead of the spec

Seven tasks from my own backlog, each with two briefs: the precise spec the
suites were written from, and the ticket as it was first written. One ticket
asks for a list "as CSV" and says nothing more about the format. Same
suites, 15 runs per cell, counting runs that pass everything:

| the agent reads  | with the public suite |  no tests | its own tests |
| ---------------- | --------------------: | --------: | ------------: |
| the loose ticket |              81 / 105 |  30 / 105 |      30 / 105 |
| the precise spec |              95 / 105 | 100 / 105 |      98 / 105 |

From the ticket, the agent's own tests added nothing over no tests at all.
All 105 of those self-tested runs ended green on their own tests, and the
hidden suite rejected 75.

On the statistics: 81 against 30 is p < 1e-11 over runs, but runs of one
ticket are not independent. By ticket, the public suite is better on 5,
level on 2 and worse on none (sign test p = 0.06). Treat it as seven
tickets, not 105 samples.

## The failures are guesses

A referee on another model (Fable 5.1), given only the spec, the failing
code and one anonymised test, upheld all 75 rejections. Asked instead what
the ticket itself requires, it found 4 runs that broke something the ticket
states. The other 71 failed only on what the ticket leaves open.

Concretely:

- A ticket about splitting a payment does not say what a $0 payment does.
  One run wrote 21 tests of its own, all passing, and failed 3 of 46 hidden
  tests. 14 of 15 runs on that ticket failed the same scenario.
- A ticket about invite codes does not mention concurrent calls. Every run
  without the public suite issued duplicate codes when two were requested at
  once over a slow store. No run with it did.
- "As CSV" does not say BOM, CRLF, header names or formula escaping. Nothing
  passed, in any arm.

The agent's tests are not wrong. They are consistent with the code, because
the same reading of the ticket produced both. That correlation is the
problem, and no amount of extra self-written tests removes it.

## Stronger models

The same seven tickets, five runs per model, ticket only, own tests:

| model      | own tests green | rejected by the hidden suite | passed, given the public suite |
| ---------- | --------------: | ---------------------------: | -----------------------------: |
| Haiku 5.5  |           35/35 |                        26/35 |                          26/35 |
| Sonnet 5.5 |           35/35 |                        19/35 |                          25/35 |
| Opus 5.5   |           35/35 |                        20/35 |                          26/35 |
| Fable 5.2  |           35/35 |                        15/35 |                          35/35 |

Three tickets fail every run of all four models from the ticket alone.
Which legacy spellings map to which status is not something a model can
derive. It is a decision somebody made and did not write down.

## The held-out labels have to come from a person

This is where the Kaggle analogy breaks, and it is the main finding.

Kaggle's hidden labels are facts. For a ticket, the "label" for a $0
payment is a decision in the owner's head. If a model drafts the spec and
another model writes hidden tests from it, the result is a second guess
graded against a first guess.

I measured that on real code. I replayed 23 commits from three repositories
(one of mine, and unjs/ufo and unjs/pathe). The ticket is the commit
message. A blind session drafts the spec and never sees the diff. Then the
real, shipped commit is judged by the hidden suite.

| hidden suite written from       | real commits that pass |
| ------------------------------- | ---------------------: |
| the spec a model drafted        |                3 of 23 |
| the same spec, after confirming |               20 of 23 |

Most drafted decisions are fine: 165 of 243 survived confirmation. But 16 of
18 drafts had at least one that did not, and one is enough to reject correct
code. When the spec and the judge disagree, feedback is useless: 0 of 72
retries passed.

The 3 confirmed commits that still failed did so on six hidden tests. Two of
the six are real defects in my own shipped code: names are looked up in a
plain object, so a priority named `constructor` resolves to a function. Two
hold the code to words its developer confirmed. Two are false rejects on a
question the spec leaves open.

A caveat that matters: the confirmer in that replay was a model session
playing the developer, shown the real diff. I have not measured how long a
person takes, or how well a hurried one does.

## Is the judge any good?

A hidden suite written by a model deserves suspicion, so I checked it
against judges I did not write.

- HumanEval+ with EvalPlus labels, 1,240 solutions: the generated suites
  accepted 4.8% of wrong solutions, against 15.0% for HumanEval's original
  tests, and rejected 3 of 289 correct ones. That excludes two tasks the
  suite and the oracle read differently. With them it is 7.7% against 17.5%,
  and 23 of 314.
- `git apply` as an oracle for a patch-apply spec: the reference agreed on
  all 7,533 judged cases from real history. One submission passed both
  suites and disagreed with git, on a rename without hunks.
- Maintainers' own tests on 11 ufo and pathe commits: 151 of 152 runs from a
  confirmed spec passed every test the maintainers added for that change.
- Mutation: of 1,442 single-edit mutants of the references, the public suite
  killed 75.6% and both suites together 79.2%. Of the public suite's
  survivors that matter to the spec, the hidden suite kills about 30%. That
  is the weakest of these four checks.

## Where it breaks

- A pass is not correctness. I judged 386 passes again with a suite Codex
  wrote, then put each disagreement to two blind referees on different model
  families. 50 passes break a rule the spec states. Nearly all are on 3 of
  the 26 specs, and it is a lower bound.
- A strong adversary gets through. Opus 5.5, told to pass the public suite
  with the least general code, was rejected 20 of 20 times on two specs and
  0 of 20 on two others. It never hard-coded an input. It wrote small
  general code, skipped the rules no public test reached, and listed them in
  its summary. A second hidden suite from another model family caught 17 of
  those 20. One from the same family caught 10.
- Public tests can cause the overfit they are meant to expose. On the CSV
  spec, agents with the public suite passed 6 of 15 and agents with no tests
  passed 14 of 15. The public tests go green with `String(n)`, which prints
  `1e+21` where the spec says plain digits, and the agents stopped at green.
- The suite carries its writer's assumptions. A hidden test written against
  a TypeScript reference expected `1e400` to be refused, as `JSON.parse`
  reads it. A Go port read it as an integer and failed. The spec did not
  say.
- Rule-based detection went nowhere. Six no-model rules for "this session
  should not have claimed done" fired on 8.7% of 127 real sessions, and 1 of
  50 firings held up.
- It costs $1–4 and 10–25 minutes of Opus per spec, plus the owner's time.

## "Isn't this just..."

**A holdout set, or Goodhart's law?** Yes. Nothing here is new as an idea.
What is odd is that coding agents ship without it, and that "tests pass" is
read as a result when the party reporting it wrote the tests.

**Acceptance tests written by QA?** Also yes. It is separation of duties.
The difference now is cost: a second party is a few dollars, not a second
team.

**Fixed by writing a better spec?** For the agent, yes: with the precise
spec, no arm needed any tests (95, 100 and 98 of 105). But tickets are not
written like that, and the author cannot see which gaps matter until
something lists them.

**One LLM grading another?** That is the 3 of 23 result. Without a person
confirming the spec it is exactly that, and it does not work.

## A cheaper version

The full check is too slow for every change. But the failures start at
decisions the ticket left open, and those can be listed without writing a
test.

One session reads the ticket and the diff and lists what the ticket never
said and what the code chose. Median: 12 items, 17 seconds, $0.06.

I ran it on the 75 rejected runs. A judge holding the spec and the list, but
not the diff or the grades, named a wrong pick in 57. Of the picks it called
wrong, 70 of 70 were on scenarios that failed. It flagged none of 306
passing ones.

Two caveats. The list covers failing scenarios no better than passing ones
(86% against 88%), so it says what to look at, not that something is wrong.
And the judge is a model standing in for an owner who knows what they
meant. I also tried executing each pick against the code to sharpen it. That
did slightly worse, 55 with 3 false alarms, so it stays a list.

## Threats to validity

- The headline rests on seven tickets from one person's backlog.
- A model wrote the hidden suites, and models refereed them. The outside
  oracles above are the only checks whose ground truth does not come from a
  model.
- Mostly TypeScript, one module or one package, under an hour of work.
  Nothing on UI, network calls or changes across packages.
- Confirmation by a person is barely measured: two pilot cases, and no
  timings.
- No public benchmark newer than the models was available, so the benchmark
  runs say little.
- Three outside studies report the same gap from other directions. They are
  summarised in [REFERENCE.md](REFERENCE.md#outside-evidence). None of them
  tests a hidden suite written from a confirmed spec.

## Data and code

The runs, scripts and hand classifications are in
[bouncer-evidence](https://github.com/lunox-work/bouncer-evidence). The
dated write-ups, dead ends included, are in its
[FINDINGS.md](https://github.com/lunox-work/bouncer-evidence/blob/main/archive/FINDINGS.md).
The tool is [Bouncer](../README.md): a CLI and an agent skill that run on
your own Claude Code login, Codex login or API key, with no telemetry.

If the method is wrong somewhere, I would like to know where.
