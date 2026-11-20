- "My agent says the CSV import is done and its tests pass. Check its work
  against the ticket." The skill drafts a spec from the ticket for you to
  confirm, writes a hidden suite the agent never saw, and gives a verdict:
  passed, overfit, incomplete, regressed or refused.
- "Turn this ticket into a spec I confirm, then write tests for it that the
  implementing agent can't see." The skill writes a public suite for the
  agent and keeps a calibrated hidden suite for judging.
- "Grade the candidate's submission in `./submission` against the
  `duration-parse` spec." The skill judges the folder against the hidden
  suite and explains the verdict.
