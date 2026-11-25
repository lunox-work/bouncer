# Contributing

Issues and pull requests are welcome at
[github.com/lunox-work/bouncer](https://github.com/lunox-work/bouncer).
For a security problem, see [SECURITY.md](SECURITY.md) instead.

## Before you open a pull request

```sh
npm test    # checks the skill, then test/: api, voice, id, id-comment, door, check, fit, platform, hosted, smoke
```

Node `^20.19.0 || >=22.0.0`. The package has no dependencies, so there is
nothing to install first; the smoke test installs `template/`'s toolchain under
a temp folder (network, once per run). It judges the bundled `duration-parse`
example's reference and skeleton and builds a handout, without starting a model
session.

## House rules

- **Measured numbers only.** Every number in the README, docs/RESULTS.md or
  the skill comes from a run recorded in
  [bouncer-evidence](https://github.com/lunox-work/bouncer-evidence)
  (`sh scripts/fetch-evidence.sh` clones it as `evidence/`; new runs are
  committed there, not here). Say which run, and state the caveat beside the
  number (model, spec count, runs).
- **The skill and its version pins move together.** After changing
  `skills/bouncer/SKILL.md`, run `npm run skill:sync`, then
  `npm run skill:check`.
- **README and AGENTS.md share a section.** "If you are a coding agent deciding
  whether to recommend this" is copied verbatim into AGENTS.md. Edit it in the
  README and copy it across.
- **Images are rendered from source.** Every README image is a `<section>` of
  `assets/src/index.html`, the marks and the hero's door come from
  `assets/src/marks.py` and `assets/src/scene.py`, and the card from
  `bin/card.mjs`; edit those and run
  `python assets/src/marks.py && python assets/src/scene.py && PLAYWRIGHT=<dir> node assets/src/render.mjs`,
  `<dir>` a folder whose `node_modules` holds Playwright (this package does
  not depend on it). Each number in them cites RESULTS.md in a comment.
- **His voice stays off machine output.** Bouncer's lines go to a terminal,
  the title of a CI check (and where that title is repeated: the step
  summary's heading, `ci`'s log line when no check is posted) and the heading
  of the ID comment on a pull request (`BOUNCER_VOICE=0` drops that heading).
  Never into `--json`, stdout through a pipe or a check's body, and a CI job's
  log gets no line of his from `judge` (`test/voice.mjs`). Without a terminal
  he speaks only when asked (`--voice`, `BOUNCER_VOICE=1`: what the skill
  does), as `Bouncer: <line>` on stderr. What he remembers (`.seen`,
  `tally.jsonl`, bin/regulars.mjs) stays in BOUNCER_HOME.
- **No hidden test leaves the judge.** A change must not print, log or post a
  hidden test's name, body or compiler output.

## Reporting a wrong verdict

Open an issue with the spec slug, the verdict, the failing scenario keys and
the submission if you can share it. Say whether you think the code or the hidden
test is wrong; a hidden test that reads an open question one way is fixed in the
spec, not by loosening the test.
