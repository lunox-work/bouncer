You are checking an implementation's ID against its ticket.

- `ticket.md` is the ticket the implementer was given.
- `diff.patch` is the change it made.

A ticket leaves things open: inputs it never mentions, edge cases, errors,
limits, orders, formats, what happens on empty or zero or a duplicate. The
implementer had to pick an answer for each one it met, usually without
saying so. List those picks.

Read both files. Do not run anything and do not change any file.

For each question the ticket leaves open and the diff answers:

- `question`: the open question, in one plain sentence ("What does a $0
  bounty release?").
- `ticket`: the ticket sentence closest to it, quoted exactly, or `silent`
  when the ticket says nothing about it.
- `chose`: what the diff does, in one sentence, concrete ("Records a release
  of amount 0.").
- `where`: the file and line in the diff where that choice is made.
- `instead`: the most common other answer a careful developer might pick.

Rules:

- Only questions the ticket really leaves open. Something the ticket states
  is not a pick, even when the diff gets it wrong.
- Only picks the diff makes. A question the diff never meets is not on the
  list.
- Do not rank them and do not say which pick is wrong: the person decides.
- Twelve at most; when there are more, keep the ones a caller is most likely
  to meet.

Answer with one JSON block and nothing after it:

```json
[{ "question": "...", "ticket": "...", "chose": "...", "where": "src/x.ts:42", "instead": "..." }]
```
