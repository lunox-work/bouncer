# independent-test

Renamed to [`@lunox-work/bouncer`](https://www.npmjs.com/package/@lunox-work/bouncer). The `independent-test` command runs `bouncer` with the same arguments and exit codes. `INDEPENDENT_TESTS_*` and `DUEDILIGENCE_*` environment variables are read as their `BOUNCER_*` names, and an existing `~/.independent-tests/` or `~/.duediligence/` stays the data folder until `~/.bouncer/` exists.

```sh
npx @lunox-work/bouncer help
```

Docs, issues and source: [github.com/lunox-work/bouncer](https://github.com/lunox-work/bouncer).
