#!/usr/bin/env node
// A second hidden suite for a prepared spec, from another writer, for
// grading someone else's work (RESULTS.md "Red team": against Opus told to
// game, the hidden suite let 20 of 20 through on two specs, and a second,
// independently written suite caught 17 of them). Opt-in: it costs one more
// writer session and roughly doubles false rejects (on HumanEval+, 3 of 289
// right solutions for one suite, 6 of 289 for either of two).
//
//   bouncer second <slug> [--backend codex-cli|claude-cli|anthropic-api] [--model <id>] [--force]
//
// The spec must be confirmed and calibrated. A sibling spec,
// specs/<slug>-second/, gets the same spec.md, confirmation, toolchain,
// skeleton, public suite and reference; generate.mjs then writes only its
// hidden suite, in a session on --backend (default codex-cli; without a
// Codex login it refuses unless --backend is given) and --model (default, on
// claude-cli, claude-sonnet-5-5: a different model from the first writer).
// Another model family matters: on the 20 Opus gaming passes Codex's suite
// rejected 17, a Sonnet-written one 10 (evidence/second-writer.json); on 13
// honest passes missing a stated rule, 13 and 0 (evidence/passed-second.json).
// Calibration runs on the spec's reference with no new session (every
// hidden test must fail on the skeleton and pass the reference), and the
// hash is committed in its own prepared.json. From then on `judge <slug>`
// also runs the second suite, and a submission passes only when it clears
// both. New-module specs only.
//
// Exit 0 written, 1 refused or failed.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { recordCommitment } from "./commitment.mjs";
import { confirmation } from "./confirm.mjs";
import { args, codexSignedIn, count, discard, judge, log, readJson, runSuite, specDir, stage, testsOf, toolchainOf, workdir, writeJson } from "./lib.mjs";

const BIN = dirname(fileURLToPath(import.meta.url));

export const secondOf = (slug) => `${slug}-second`;

/** The second suite's calibration, as calibrate.mjs records one, with the spec's reference standing in for a reference session. */
export function calibrateOnReference(slug) {
  const chain = toolchainOf(slug);
  const dir = stage(workdir(`${slug}-calibrate`), slug, { skeleton: true, publicTests: true, hiddenTests: true });
  let onSkeleton;
  try {
    onSkeleton = runSuite(dir, "private", chain);
  } finally {
    discard(dir);
  }
  if (!onSkeleton.compiled) return { slug, status: "dropped", reason: "The hidden suite does not compile against the skeleton." };
  const crashed = new Set(onSkeleton.files.filter((file) => file.crashed).map((file) => file.file));
  const dropped = [...crashed].map((file) => ({ id: `${file} :: *`, reason: "The file crashes on the skeleton instead of failing a test." }));
  for (const test of testsOf(onSkeleton)) if (test.ok || test.skipped) dropped.push({ id: test.id, reason: test.skipped ? "Skipped." : "Passes on the skeleton." });
  const judged = judge(slug, join(specDir(slug), "reference", "src"));
  const onReference = new Map(testsOf(judged.hidden).map((test) => [test.id, test]));
  const ids = testsOf(onSkeleton).map((test) => test.id);
  const out = new Set(dropped.map((item) => item.id));
  for (const id of ids)
    if (!out.has(id) && onReference.get(id)?.ok !== true) dropped.push({ id, reason: `The reference cannot satisfy it: ${onReference.get(id)?.error?.message.split("\n")[0] ?? "it did not run"}` });
  const gone = new Set(dropped.map((item) => item.id));
  const kept = ids.filter((id) => !gone.has(id) && !crashed.has(id.split(" :: ")[0]));
  const publicIds = testsOf(judged.public).map((test) => test.id);
  return {
    slug,
    status: kept.length > 0 ? "ok" : "dropped",
    reason: kept.length > 0 ? null : "No hidden test survived calibration.",
    publicIds,
    publicFailingOnReference: testsOf(judged.public).filter((test) => !test.ok).map((test) => test.id),
    hiddenWritten: ids.length,
    kept,
    dropped,
    reference: { source: "the first suite's reference, no session (bin/second.mjs)", public: count(judged.public, publicIds), hidden: count(judged.hidden, kept) },
  };
}

const isMain = process.argv[1]?.endsWith("second.mjs");
if (isMain) {
  const { options, rest } = args();
  const [slug] = rest;
  if (slug === undefined) {
    console.error("usage: bouncer second <slug> [--backend codex-cli|claude-cli|anthropic-api] [--model <id>] [--force]");
    process.exit(1);
  }
  const from = specDir(slug);
  const to = specDir(secondOf(slug));
  if (toolchainOf(slug).name === "repo") {
    console.error(`${slug}: a second suite takes a new-module spec for now.`);
    process.exit(1);
  }
  if (readJson(join(from, "calibration.json"), null)?.status !== "ok") {
    console.error(`${slug}: not calibrated; prepare it first.`);
    process.exit(1);
  }
  // An archive spec (bin/import-archive.mjs) was confirmed there, before the hash existed.
  if (!confirmation(slug).ok && readJson(join(from, "imported.json"), null) === null) {
    console.error(`${slug}: not confirmed as it stands; confirm it first (SKILL.md step 2).`);
    process.exit(1);
  }
  if (existsSync(join(to, "calibration.json")) && options.force !== true) {
    console.error(`${secondOf(slug)} exists; --force writes it again.`);
    process.exit(1);
  }
  // Another model family, or the person's explicit choice: a Claude-written
  // second suite caught 0 of 13 honest misses Codex's caught all of, and 10
  // of 20 gaming passes against 17 (evidence/passed-second.json,
  // evidence/second-writer.json).
  // The codex-cli backend installs its own pinned CLI (bin/backends.mjs); what
  // it needs is the person's Codex login, not a `codex` on PATH (the ChatGPT
  // app and the VS Code extension ship one that is not on PATH).
  if (typeof options.backend !== "string" && !codexSignedIn()) {
    console.error(
      [
        `${slug}: no Codex login here (~/.codex/auth.json, or OPENAI_API_KEY), and the second writer should be another model family.`,
        "A second suite written by Sonnet 5.5 caught 0 of the 13 passes that missed a stated rule which Codex's suite caught, and 10 of 20 gaming passes against Codex's 17.",
        "Sign in to Codex (codex login, or the ChatGPT app), or pass --backend claude-cli to accept a Claude writer anyway.",
      ].join("\n"),
    );
    process.exit(1);
  }
  const backend = typeof options.backend === "string" ? options.backend : "codex-cli";
  const model = typeof options.model === "string" ? options.model : backend === "claude-cli" ? "claude-sonnet-5-5" : undefined;
  rmSync(to, { recursive: true, force: true });
  for (const part of ["spec.md", "ticket.md", "confirmed.json", "toolchain.json", "skeleton", "tests/public", "reference"])
    if (existsSync(join(from, part))) cpSync(join(from, part), join(to, part), { recursive: true });
  log(secondOf(slug), `hidden suite on ${backend}${model ? ` (${model})` : ""}`);
  const env = { ...process.env, BOUNCER_BACKEND: backend, ...(model ? { BOUNCER_HIDDEN_MODEL: model } : {}) };
  const generated = spawnSync(process.execPath, [join(BIN, "generate.mjs"), secondOf(slug)], { stdio: "inherit", env });
  if (generated.status !== 0 || !existsSync(join(to, "tests", "private"))) {
    console.error(`${secondOf(slug)}: the second writer wrote no hidden suite.`);
    process.exit(1);
  }
  const record = calibrateOnReference(secondOf(slug));
  // The model the session ran on: without --model, Codex takes the person's own setting.
  const ran = readJson(join(to, "generation.json"), null)?.private?.sessions?.at(-1)?.model ?? null;
  writeJson(join(to, "calibration.json"), { ...record, writer: { backend, model: model ?? ran }, of: slug });
  if (record.status !== "ok") {
    console.error(`${secondOf(slug)}: ${record.reason}`);
    process.exit(1);
  }
  const { hiddenSha256 } = recordCommitment(secondOf(slug), "second");
  console.log(`${secondOf(slug)}: kept ${record.kept.length} of ${record.hiddenWritten} hidden tests; sha256 ${hiddenSha256}. judge ${slug} now runs both suites.`);
}
