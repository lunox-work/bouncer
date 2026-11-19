#!/usr/bin/env node
// `bouncer push <slug>`: see hosted.mjs.
import { readFileSync } from "node:fs";
import { IDENTITY } from "./identity.mjs";
import { run } from "./hosted.mjs";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
process.exitCode = await run("push", process.argv.slice(2), { ...IDENTITY, version });
