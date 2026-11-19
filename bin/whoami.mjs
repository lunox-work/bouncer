#!/usr/bin/env node
// `bouncer whoami`: see account.mjs.
import { readFileSync } from "node:fs";
import { IDENTITY } from "./identity.mjs";
import { run } from "./account.mjs";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
process.exitCode = await run("whoami", process.argv.slice(2), { ...IDENTITY, version });
