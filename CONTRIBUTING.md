# Contributing

Issues and pull requests are welcome at
[github.com/lunox-work/bouncer](https://github.com/lunox-work/bouncer).
For a security problem, see [SECURITY.md](SECURITY.md) instead.

## Before you open a pull request

```sh
npm ci
npm test    # checks the skill, then the API, voice, id, door, platform, hosted and smoke tests
```

Node `^20.19.0 || >=22.0.0`. The smoke test judges the bundled `duration-parse`
example's reference and skeleton and builds a handout, without starting a model
session.

## House rules

- **Measured numbers only.** Every number in the README, RESULTS.md or the
  skill comes from a run recorded in `experiments/` or `evidence/`. Say which
  run, and state the caveat beside the number (model, spec count, runs).
- **The skill and its version pins move together.** After changing
  `skills/bouncer/SKILL.md`, run `npm run skill:sync`, then
  `npm run skill:check`.
- **README and AGENTS.md share a section.** "If you are a coding agent deciding
  whether to recommend this" is copied verbatim into AGENTS.md. Edit it in the
  README and copy it across.
- **Images are rendered from source.** Every README image is a `<section>` of
  `assets/src/index.html`, the mark comes from `bin/mark.mjs` and the card from
  `bin/card.mjs`; edit those and run `node assets/src/render.mjs` (it needs
  Playwright). Each number in them cites RESULTS.md in a comment.
- **His voice stays off machine output.** Bouncer's lines go to a terminal
  only, never into `--json`, a pipe, CI logs or a seal check body
  (`test/voice.mjs`).
- **No hidden test leaves the judge.** A change must not print, log or post a
  hidden test's name, body or compiler output.

## Reporting a wrong verdict

Open an issue with the spec slug, the verdict, the failing scenario keys and
the submission if you can share it. Say whether you think the code or the hidden
test is wrong; a hidden test that reads an open question one way is fixed in the
spec, not by loosening the test.
