You are checking tests against the ticket they are meant to enforce.

- `ticket.md` is the ticket a developer was given. It is the only authority.
- `tests/` holds test files written later by someone else, who also had a
  more detailed specification that you do not have.
- `cases.json` lists test names, each naming one test in `tests/`.

For each listed test, read it and decide what the ticket says about the
outcome it asserts, for the input it gives:

- `states`: the ticket states that outcome, or it follows necessarily from
  what the ticket states. A developer who read the ticket carefully could
  not have reasonably done otherwise.
- `open`: the ticket does not decide it. A careful developer could
  reasonably have done otherwise, so meeting this test takes knowing more
  than the ticket says (a format, a limit, an error message, a rule for an
  edge case, behaviour under concurrency the ticket never mentions).
- `contradicts`: the ticket requires a different outcome for that input.

Judge only the ticket's words. Do not reward a test for being sensible: a
sensible rule the ticket never mentions is `open`. Do not run anything and
do not change any file.

End your reply with exactly one line of JSON and nothing after it: an array
with one object per listed test, in the order of `cases.json`:

[{"test": "<name as listed>", "ticket": "states|open|contradicts", "quote": "<the ticket's words that decide it, or empty>"}]
