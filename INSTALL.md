# Install Bouncer

Pick your agent. Each way takes under a minute.

You need Node 20.19 or later, and the login you already use: Claude Code,
Codex, or an `ANTHROPIC_API_KEY`. Nothing else. The skill fetches its CLI
through npx the first time (about 1 MB), at the version it was written for.

## Claude Code

Type these as two separate prompts:

```
/plugin marketplace add lunox-work/bouncer
```

```
/plugin install bouncer-verify@bouncer
```

The plugin also brings the list up for you: when a session that changed
code hands back, you don't have to remember to ask. `bouncer offer off`
stops it.

## Codex

```sh
codex plugin marketplace add lunox-work/bouncer
codex plugin add bouncer-verify@bouncer
```

Start a new thread after it installs.

## Cursor, Gemini CLI, OpenCode, Copilot and 40+ others

```sh
npx skills add lunox-work/bouncer -g
```

It asks which agents to add him to. To skip the question, name them:
`npx skills add lunox-work/bouncer -g -a cursor -y`.

## Any agent: let it install him

Paste this into your agent:

```text
Install the Bouncer skill from https://github.com/lunox-work/bouncer. Follow its INSTALL.md.
```

If you are that agent: use the section above for the agent you are. If none
fits, copy the folder `skills/bouncer/` from this repository into your skills
folder. Then tell the person to ask "is this really done?" the next time you
say you are done.

## Check it works

When your agent says it is done, ask it: **_"is this really done?"_**

You get the list of decisions your agent made without asking you, in
seconds. Ask for a verdict when you want pass or fail
([README](README.md#how-to-use-him)).

## Update or remove

| Agent       | Update                                     | Remove                                       |
| ----------- | ------------------------------------------ | -------------------------------------------- |
| Claude Code | `/plugin marketplace update bouncer`       | `/plugin uninstall bouncer-verify@bouncer`   |
| Codex       | `codex plugin marketplace upgrade bouncer` | `codex plugin remove bouncer-verify@bouncer` |
| skills CLI  | `npx skills update bouncer -g`             | `npx skills remove bouncer -g`               |

Your specs and runs stay in `~/.bouncer/` until you delete that folder.

Only install Bouncer from `lunox-work/bouncer` on GitHub or
`@lunox-work/bouncer` on npm.
