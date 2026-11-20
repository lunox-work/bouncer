You are writing probes: small calls that show what an implementation does.

- `ticket.md` is the ticket the implementer was given.
- `src/` is the implementation, a TypeScript ES module; its exports are what
  `src/index.ts` exports.
- `list.json` is a numbered list of questions the ticket left open, each
  with a sentence saying what the implementation picked.

For each item, write one JavaScript expression that calls the module's
exports with the input the question is about, so that running it shows the
pick as a value (or a thrown error). Every export is in scope by its name.
The expression is awaited, so it may return a promise. Build any argument
it needs inline: objects, arrays, a fake store or clock as an object
literal with the methods the code calls. Use plain JavaScript, no types.
Keep each expression on one line and under 400 characters. Where no call
shows the pick (it is about a type, a file layout, or behaviour over time
that one call cannot show), give `null`.

Read the files. Do not run anything and do not change any file.

Answer with one JSON block and nothing after it, one entry per item, in
order:

```json
[{ "item": 1, "probe": "parseDuration(\"\")" }, { "item": 2, "probe": null }]
```
