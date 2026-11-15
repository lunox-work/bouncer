// The commitment hash: one sha256 over a spec's hidden suite as the judge
// uses it, so a graded party can check the suite was fixed before they
// submitted. bin/prepare.mjs records it in prepared.json, bin/handout.mjs
// shows it in BRIEF.md and handout.json, bin/judge.mjs recomputes it and
// refuses on a mismatch, bin/promote.mjs prints it at reveal, and a seal
// (bin/seal.mjs) carries it in seal.json. bin/commitment.mjs records and
// checks it per spec; this module only computes it, from a folder or from
// files in memory, and reads nothing else (no DUEDILIGENCE_HOME, no HOME).
//
// What is hashed, from a folder laid out as specs/<slug>/ (or an unpacked
// seal): a manifest of lines in `sha256sum` format, `<hex>  <path>\n`,
//   - one per file under tests/private/, every depth, `.DS_Store` skipped,
//     sorted by the UTF-8 bytes of the path: the hex the sha256 of its
//     bytes, the path `tests/private/<rel>` with `/` separators;
//   - then one line for the kept test ids: the hex the sha256 of
//     JSON.stringify(calibration.kept sorted) (UTF-8), the path
//     `calibration.kept`;
//   - only for a spec at a black-box seam, a last line for what the suites
//     call (toolchain.json `boundary`: the command, or the service's start,
//     healthcheck and build), since changing it changes what the hidden
//     suite tests: the hex the sha256 of its JSON with keys sorted at every
//     level, the path `toolchain.boundary`. A spec without one hashes as
//     before.
// hiddenSha256 is the sha256 of the manifest's UTF-8 bytes, lowercase hex.
// By hand:
//   (cd specs/<slug> && find tests/private -type f ! -name .DS_Store | LC_ALL=C sort | xargs shasum -a 256
//    && printf '%s  calibration.kept\n' "$(jq -cj '.kept | sort' calibration.json | shasum -a 256 | cut -c1-64)"
//    && printf '%s  toolchain.boundary\n' "$(jq -cjS '.boundary' toolchain.json | shasum -a 256 | cut -c1-64)") | shasum -a 256
// (the last printf only when toolchain.json has a boundary)
// (jq sorts by code point and JS by UTF-16 unit; the two agree unless an id
// holds characters beyond the BMP.)
//
// The platform's handout (sandbox-factory) shows a hash with a
// `hiddenSha256Version`. Version 2 is stagedHiddenSha256 below: the same
// manifest over the hidden tests alone, each at the path the judge stages
// it at, taken as given, then `calibration.kept` over those paths sorted,
// and no boundary line. For a version built in the platform's layout every
// path is `tests/private/<rel>`, which is hiddenSha256 with the paths as the
// kept ids; for an uploaded folder (a carveout hand-off) the paths are the
// folder's own. Version 1 (versions built before) hashed every file the
// build kept as private, so it cannot be recomputed from the hidden tests:
// handoutCommitment compares only a version 2 hash, and says so otherwise.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const sha = (data) => createHash("sha256").update(data).digest("hex");
const byBytes = (a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path));
/** A JSON value with every object's keys sorted, as `jq -S` writes it. */
const sorted = (value) =>
  Array.isArray(value)
    ? value.map(sorted)
    : value !== null && typeof value === "object"
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]))
      : value;

/** Every file under `dir`, relative with `/`, sorted; none when it does not exist. */
function filesUnder(dir) {
  const out = [];
  const walk = (at, rel) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(join(at, entry.name), path);
      else out.push(path);
    }
  };
  if (existsSync(dir)) walk(dir, "");
  return out.sort();
}

/**
 * The spec as hashed: its hidden files (`tests/private/<rel>` → bytes),
 * calibration.json and toolchain.json parsed (or undefined), from a folder
 * or from a file map of the same layout: a Map or object keyed by paths
 * relative to the spec folder with `/`, each a string (UTF-8) or bytes.
 */
function specOf(source) {
  if (typeof source === "string") {
    const json = (name) => (existsSync(join(source, name)) ? JSON.parse(readFileSync(join(source, name), "utf8")) : undefined);
    const hidden = join(source, "tests", "private");
    return {
      hidden: filesUnder(hidden).map((rel) => ({ rel, bytes: () => readFileSync(join(hidden, ...rel.split("/"))) })),
      calibration: json("calibration.json"),
      toolchain: json("toolchain.json"),
    };
  }
  if (source === null || typeof source !== "object")
    throw new TypeError("hiddenManifest: pass a spec folder or a file map ({ 'tests/private/<file>': contents, ... })");
  const entries = source instanceof Map ? [...source.entries()] : Object.entries(source);
  const text = (value) => (typeof value === "string" ? value : Buffer.from(value).toString("utf8"));
  const json = (name) => {
    const found = entries.find(([path]) => path === name);
    return found === undefined ? undefined : JSON.parse(text(found[1]));
  };
  return {
    hidden: entries
      .filter(([path]) => path.startsWith("tests/private/"))
      .map(([path, value]) => ({ rel: path.slice("tests/private/".length), bytes: () => value })),
    calibration: json("calibration.json"),
    toolchain: json("toolchain.json"),
  };
}

/**
 * The manifest hiddenSha256 is the hash of (see above), from a spec folder
 * or a file map. `kept` defaults to calibration.json's.
 */
export function hiddenManifest(source, kept) {
  const spec = specOf(source);
  const ids = kept ?? spec.calibration?.kept ?? [];
  const lines = spec.hidden
    .filter((file) => file.rel.split("/").at(-1) !== ".DS_Store")
    .map((file) => ({ path: `tests/private/${file.rel}`, hex: sha(file.bytes()) }));
  lines.sort(byBytes).push({ path: "calibration.kept", hex: sha(JSON.stringify([...ids].sort())) });
  const boundary = spec.toolchain?.boundary;
  if (boundary !== undefined) lines.push({ path: "toolchain.boundary", hex: sha(JSON.stringify(sorted(boundary))) });
  return lines.map((line) => `${line.hex}  ${line.path}\n`).join("");
}

/** The commitment hash of the hidden suite in a spec folder (specs/<slug>/ or an unpacked seal) or a file map. */
export const hiddenSha256 = (source, kept) => sha(hiddenManifest(source, kept));

/** `[path, bytes]` pairs of a Map, an object or an array of `{ path, bytes | text }`, as given. */
function stagedEntries(files) {
  if (files instanceof Map) return [...files.entries()];
  if (Array.isArray(files)) return files.map((file) => [file.path, file.bytes ?? file.text]);
  if (files !== null && typeof files === "object") return Object.entries(files);
  throw new TypeError("stagedHiddenSha256: pass the hidden tests as { '<staged path>': contents } or [{ path, bytes }]");
}

/**
 * The version 2 manifest (the platform's `hiddenSha256Version: 2`): one
 * line per hidden test at the path the judge stages it at, as given (`/`
 * separators, no `.DS_Store` filtering: pass the tests and nothing else),
 * sorted by the paths' UTF-8 bytes, then `calibration.kept` over the
 * sorted paths. Contents are strings (UTF-8) or bytes.
 */
export function stagedHiddenManifest(files) {
  const lines = stagedEntries(files).map(([path, value]) => {
    if (typeof path !== "string" || path === "" || path.includes("\\")) throw new TypeError(`stagedHiddenManifest: ${JSON.stringify(path)} is not a staged path`);
    return { path, hex: sha(value) };
  });
  if (lines.length === 0) return "";
  const kept = lines.map((line) => line.path).sort();
  lines.sort(byBytes).push({ path: "calibration.kept", hex: sha(JSON.stringify(kept)) });
  return lines.map((line) => `${line.hex}  ${line.path}\n`).join("");
}

/** The version 2 commitment hash over hidden tests at their staged paths; null with none, as the platform shows it. */
export function stagedHiddenSha256(files) {
  const manifest = stagedHiddenManifest(files);
  return manifest === "" ? null : sha(manifest);
}

/** The commitment versions handoutCommitment can recompute. */
export const HIDDEN_SHA256_VERSIONS = [2];

/**
 * A platform handout's commitment (`{ hiddenSha256, hiddenSha256Version }`)
 * against the hidden tests you hold at their staged paths:
 * `{ comparable, match, expected, actual, reason }`. Only a version 2 hash
 * is compared; any other (1, or one newer than this duediligence) answers
 * `comparable: false` with the reason, never a mismatch.
 */
export function handoutCommitment(handout, files) {
  const expected = handout?.hiddenSha256 ?? null;
  const version = handout?.hiddenSha256Version ?? 1;
  if (!HIDDEN_SHA256_VERSIONS.includes(version)) {
    return {
      comparable: false,
      match: null,
      expected,
      actual: null,
      reason:
        version === 1
          ? "hiddenSha256Version 1: hashed over every private file the build kept, not recomputable from the hidden tests; not compared"
          : `hiddenSha256Version ${version} is newer than this duediligence computes (${HIDDEN_SHA256_VERSIONS.join(", ")}); not compared`,
    };
  }
  const actual = stagedHiddenSha256(files);
  const match = actual === expected;
  return {
    comparable: true,
    match,
    expected,
    actual,
    reason: match ? "the hidden tests are the ones the handout committed to" : "the hidden tests differ from the ones the handout committed to",
  };
}
