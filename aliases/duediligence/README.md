# duediligence

Renamed to [`@lunox-work/bouncer`](https://www.npmjs.com/package/@lunox-work/bouncer). The `duediligence` command runs `bouncer` with the same arguments and exit codes. `DUEDILIGENCE_*` environment variables are read as their `BOUNCER_*` names, an existing `~/.duediligence/` stays the data folder until `~/.bouncer/` exists, and `duediligence/api` re-exports `@lunox-work/bouncer/api`.

```sh
npx @lunox-work/bouncer help
```

Docs, issues and source: [github.com/lunox-work/bouncer](https://github.com/lunox-work/bouncer).
