#!/usr/bin/env node
// Whether a package of an existing repository can be a target (SKILL.md,
// step 0). Reads the repository at a commit, never its working tree: the
// lockfile and package manager, the workspaces, the runner (vitest, Jest,
// or node:test over a tsconfig.test.json build), TypeScript and the Node
// engine; or, for a Python package (pyproject.toml, setup.py or setup.cfg
// and no package.json), pytest, a tests folder and a frozen install
// (uv.lock, poetry.lock, requirements*.txt). Then, unless --no-run, stages that commit with its dependencies
// installed (lib.mjs `prepareBase`, kept for bin/repo.mjs), runs the
// package's existing suite once on a clone and records pass, fail and
// duration. Tests that fail there (network, services) are a count, not a
// reason to refuse: they become the baseline's known failures.
//
//   node bin/fit.mjs --repo <path> [--package <dir>] [--base <ref>] [--no-run]
//     [--seam exec --command "<argv>" | --seam http --start "<cmd>" [--healthcheck <path>]] [--boundary-build "<cmd>"]
//
// --seam exec|http asks whether the package can be checked at a black-box
// boundary instead of its exports: a command the suites run (split on
// spaces into an argv; the suites add their arguments) or a service the
// judge starts per suite (lib.mjs `boundaryOf`, bin/runners/boundary.mjs).
// It runs the boundary once on the staged base, in the package's folder,
// after --boundary-build: the service must answer its healthcheck (any
// status) within its timeout; the command must start (exit 127 or a spawn
// error is "not found"). `config.boundary` is what bin/repo.mjs records.
//
// Prints `supported` or `unsupported: <reason>`, then the findings as JSON.
// Exit 0 supported, 2 unsupported, 1 the check itself failed.

import { spawnSync } from "node:child_process";
import { join, posix, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  PACKAGE_MANAGERS,
  RUNNERS,
  args,
  discard,
  log,
  prepareBase,
  repoChain,
  runSuite,
  stage,
  testsOf,
  workdir,
} from "./lib.mjs";

/** A suite longer than this is too slow to run several times per spec. */
export const MAX_SUITE_MINUTES = 10;
const LOCKFILES = [
  ["package-lock.json", "npm"],
  ["npm-shrinkwrap.json", "npm"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
];
const TEST_FILE = /\.(test|spec)\.[cm]?tsx?$/;

const git = (repo, ...argv) =>
  spawnSync("git", ["-C", repo, ...argv], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

/**
 * JSON with comments and trailing commas (a tsconfig) as plain JSON. It
 * walks the text, so a `/*` or `//` inside a string stays: a pattern over
 * the whole text cut `"jotai/*": ["./src/*.ts"]` as a comment.
 */
export function stripJsonc(text) {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      const start = i;
      for (i += 1; i < text.length && text[i] !== '"'; i += 1) if (text[i] === "\\") i += 1;
      out += text.slice(start, i + 1);
    } else if (char === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      out += "\n";
    } else if (char === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 1;
    } else out += char;
  }
  // Outside strings now only: a comma before a closing bracket.
  let plain = "";
  for (let i = 0; i < out.length; i += 1) {
    if (out[i] === '"') {
      const start = i;
      for (i += 1; i < out.length && out[i] !== '"'; i += 1) if (out[i] === "\\") i += 1;
      plain += out.slice(start, i + 1);
    } else if (out[i] === "," && /^\s*[}\]]/.test(out.slice(i + 1))) continue;
    else plain += out[i];
  }
  return plain;
}

/** One commit of a repository, read through git: its files and their text. */
export function reader(repo, ref = "HEAD") {
  const top = git(repo, "rev-parse", "--show-toplevel");
  if (top.status !== 0) throw new Error(`${repo} is not inside a git repository`);
  const root = top.stdout.trim();
  const sha = git(root, "rev-parse", "--verify", `${ref}^{commit}`);
  if (sha.status !== 0) throw new Error(`${root}: no commit ${ref}`);
  const base = sha.stdout.trim();
  const files = git(root, "ls-tree", "-r", "--name-only", "-z", base).stdout.split("\0").filter(Boolean);
  const set = new Set(files);
  const text = (path) => (set.has(path) ? git(root, "show", `${base}:${path}`).stdout : null);
  const json = (path) => {
    // A byte-order mark is valid in a tsconfig and fatal to JSON.parse (vite).
    const body = text(path)?.replace(/^﻿/, "") ?? null;
    if (body === null) return null;
    try {
      return JSON.parse(body);
    } catch {
      // tsconfig files take comments and trailing commas.
      return JSON.parse(stripJsonc(body));
    }
  };
  return { root, base, files, has: (path) => set.has(path), text, json };
}

/** Workspace folders from package.json `workspaces` or pnpm-workspace.yaml, `dir/*` and `dir/**` expanded. */
function workspaces(tree) {
  const root = tree.json("package.json") ?? {};
  let globs = Array.isArray(root.workspaces) ? root.workspaces : (root.workspaces?.packages ?? []);
  const pnpm = tree.text("pnpm-workspace.yaml");
  if (pnpm !== null)
    globs = [...globs, ...[...pnpm.matchAll(/^\s*-\s*["']?([^"'\n]+?)["']?\s*$/gm)].map((match) => match[1])];
  const folders = new Set(
    tree.files.filter((path) => path.endsWith("/package.json")).map((path) => posix.dirname(path)),
  );
  const matches = (glob, folder) => globRegExp(glob).test(folder);
  const out = new Map();
  for (const folder of folders) {
    if (folder.split("/").includes("node_modules")) continue;
    const included = globs.some((glob) => !glob.startsWith("!") && matches(glob, folder));
    const excluded = globs.some((glob) => glob.startsWith("!") && matches(glob.slice(1), folder));
    if (included && !excluded) out.set(tree.json(`${folder}/package.json`)?.name, folder);
  }
  out.delete(undefined);
  return out;
}

/**
 * The workspace folders the package depends on, transitively, in build
 * order (dependencies first): the ones whose dist/ the package imports.
 */
function buildOrder(tree, pkg, byName) {
  const order = [];
  const seen = new Set();
  const visit = (folder) => {
    if (seen.has(folder)) return;
    seen.add(folder);
    const manifest = tree.json(`${folder === "." ? "" : `${folder}/`}package.json`) ?? {};
    const deps = { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies };
    for (const name of Object.keys(deps)) if (byName.has(name)) visit(byName.get(name));
    if (folder !== pkg) order.push(folder);
  };
  visit(pkg);
  return order;
}

/** The common folder of a glob's literal leading segments: `test/**\/*.test.ts` is `test`. */
/**
 * A workspace glob as a regular expression: `**` any number of folders,
 * `*` and `?` within one folder, everything else literal. vite's
 * `packages/**\/__tests__/**` crashed the hand-rolled version
 * (evidence/fit-funnel.mjs).
 */
export function globRegExp(glob) {
  const parts = glob.replace(/^\.\//, "").replace(/\/+$/, "").split("/");
  let body = "";
  parts.forEach((part, i) => {
    const sep = i === 0 ? "" : "/";
    if (part === "**") body += i === 0 ? "(?:[^/]+/)*" : i === parts.length - 1 ? "(?:/.+)?" : "(?:/[^/]+)*";
    else body += (body.endsWith("/)*") ? "" : sep) + part.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]");
  });
  return new RegExp("^" + body + "$");
}

/** The base commit's committer date, ISO 8601: what a lockless install resolves against. */
const commitDate = (tree) => git(tree.root, "show", "-s", "--format=%cI", tree.base).stdout.trim();

/** The names under pyproject.toml's [project.optional-dependencies]. */
export function optionalExtras(pyproject) {
  const block = /^\[project\.optional-dependencies\]\s*\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m.exec(pyproject)?.[1] ?? "";
  return [...block.matchAll(/^([A-Za-z0-9_.-]+)\s*=/gm)].map((match) => match[1]);
}

const globRoot = (glob) => {
  const parts = glob.replace(/^\.\//, "").split("/");
  const wild = parts.findIndex((part) => /[*?{[]/.test(part));
  return (wild === -1 ? parts : parts.slice(0, wild)).join("/");
};

/**
 * What the repository at `ref` offers for a package: either
 * `{ supported: true, config }`, where `config` is the toolchain.json
 * fields bin/repo.mjs starts from, or `{ supported: false, reason }`.
 * `facts` is everything found, for either.
 */
export function detect({ repo, pkg = ".", ref = "HEAD" }) {
  const tree = reader(resolve(repo), ref);
  const at = (path) => (pkg === "." ? path : `${pkg}/${path}`);
  const facts = { repo: tree.root, base: tree.base, package: pkg };
  const no = (reason) => ({ supported: false, reason, facts });

  const manifest = tree.json(at("package.json"));
  if (manifest === null && PYTHON_PROJECT.some((file) => tree.has(at(file)))) return detectPython(tree, pkg, facts, no);
  if (manifest === null) return no(`no ${at("package.json")} at ${tree.base.slice(0, 12)}`);
  const rootManifest = tree.json("package.json") ?? {};
  const lock = LOCKFILES.find(([file]) => tree.has(file));
  // No lockfile: npm resolves the manifest as of the commit's date
  // (`npm install --before`), so the same commit installs the same
  // versions on every run. 2 of 25 TypeScript libraries in
  // evidence/fit-funnel.mjs commit none.
  const [lockfile, manager] = lock ?? [null, "npm"];
  if (lock === undefined) facts.resolvedBefore = commitDate(tree);
  // `packageManager`, or npm's newer `devEngines.packageManager` (unjs/h3
  // names pnpm 12 there only, and pnpm 9 cannot read its lockfile).
  const engine = rootManifest.devEngines?.packageManager;
  const declaredText = rootManifest.packageManager ?? (engine && !Array.isArray(engine) && engine.name && engine.version ? `${engine.name}@${engine.version}` : "");
  const declared = /^([a-z]+)@([^+\s]+)/.exec(declaredText);
  facts.lockfile = lockfile;
  facts.packageManager = lock === undefined ? "npm-dated" : declared?.[1] === manager ? `${manager}@${declared[2]}` : manager;
  if (!PACKAGE_MANAGERS.includes(manager)) return no(`package manager ${manager} is not supported`);
  if (tree.has(".pnp.cjs") || /nodeLinker:\s*["']?pnp/.test(tree.text(".yarnrc.yml") ?? ""))
    return no("Yarn Plug'n'Play: no node_modules to stage");

  const byName = workspaces(tree);
  facts.workspaces = [...byName.values()].sort();
  if (pkg !== "." && !facts.workspaces.includes(pkg) && facts.workspaces.length > 0)
    return no(`${pkg} is not one of the workspaces: ${facts.workspaces.join(", ")}`);
  // Only folders with a build: the rest have nothing git does not hold.
  facts.buildFirst = buildOrder(tree, pkg, byName).filter(
    (folder) => tree.json(`${folder}/package.json`)?.scripts?.build !== undefined,
  );

  const deps = { ...rootManifest.devDependencies, ...rootManifest.dependencies, ...manifest.devDependencies, ...manifest.dependencies };
  facts.typescript = deps.typescript ?? null;
  // The package's own tsconfig.json, else the root's for a workspace package
  // that has none (xstate: one tsconfig at the root type-checks every
  // package). The build then checks the whole root project, the
  // repository's own check, which is slower than a package's.
  const ownTsconfig = tree.has(at("tsconfig.json"));
  const rootTsconfig = pkg !== "." && tree.has("tsconfig.json");
  if (facts.typescript === null || (!ownTsconfig && !rootTsconfig)) {
    // A JavaScript package is out of scope, not a discovery miss: say which
    // it is (fastify has a typescript dependency for its type tests only).
    const mine = tree.files.filter((path) => path.startsWith(at("")) && !path.includes("node_modules/"));
    const typed = mine.filter((path) => /\.[cm]?tsx?$/.test(path) && !/\.d\.[cm]?ts$/.test(path)).length;
    const plain = mine.filter((path) => /\.[cm]?jsx?$/.test(path)).length;
    if (plain > typed) return no(`JavaScript, not TypeScript: ${ownTsconfig || rootTsconfig ? "no typescript dependency" : "no tsconfig.json"}, and ${plain} .js files to ${typed} .ts`);
    return no(`no TypeScript: ${facts.typescript === null ? "no typescript dependency" : `no ${at("tsconfig.json")}`}`);
  }
  if (!ownTsconfig) {
    let root = null;
    try {
      root = tree.json("tsconfig.json");
    } catch {}
    // A solution file (`files: []` and references) checks nothing with `tsc -p`.
    if (root === null || (Array.isArray(root.files) && root.files.length === 0 && root.include === undefined))
      return no(`no TypeScript: no ${at("tsconfig.json")}, and the root tsconfig.json ${root === null ? "cannot be read" : "only references other projects"}`);
    // An `include` that starts elsewhere (jotai's is src/, tests/, benchmarks/) leaves the package unchecked.
    const covers = (glob) => {
      const from = globRoot(String(glob));
      return from === "" || from === "." || from === pkg || pkg.startsWith(`${from}/`) || from.startsWith(`${pkg}/`);
    };
    if (Array.isArray(root.include) && !root.include.some(covers))
      return no(`no TypeScript: no ${at("tsconfig.json")}, and the root tsconfig.json does not include ${pkg}`);
  }
  // As the build names it, from the package's folder.
  const tsconfigArg = ownTsconfig ? "tsconfig.json" : posix.relative(pkg, "tsconfig.json");
  facts.tsconfig = ownTsconfig ? at("tsconfig.json") : "tsconfig.json";
  facts.engine = manifest.engines?.node ?? rootManifest.engines?.node ?? null;
  facts.node = process.version;

  const testScript = manifest.scripts?.test ?? "";
  facts.testScript = testScript || null;
  const vitestConfig = ["vitest", "vite"]
    .flatMap((name) => ["ts", "mts", "js", "mjs", "cts", "cjs"].map((ext) => at(`${name}.config.${ext}`)))
    .find((path) => tree.has(path));
  // vitest is the runner when the test script names it, or any script does
  // (query-core's `test:lib`), or a vitest.config, or a vite.config with a
  // `test` block, or, for a workspace package with no config of its own,
  // the root's vitest config (effect). The runner calls vitest itself in the
  // package's folder, never the script.
  const rootVitest = pkg === "." ? undefined : ["vitest.config", "vitest.workspace", "vite.config"].flatMap((name) => ["ts", "mts", "js", "mjs"].map((ext) => `${name}.${ext}`)).find((path) => tree.has(path) && /vitest|\btest\s*:/.test(tree.text(path) ?? ""));
  const usesVitest =
    deps.vitest !== undefined &&
    (/\bvitest\b/.test(testScript) ||
      Object.values(manifest.scripts ?? {}).some((script) => /\bvitest\b/.test(String(script))) ||
      /vitest\.config/.test(vitestConfig ?? "") ||
      (vitestConfig !== undefined && /\btest\s*:/.test(tree.text(vitestConfig) ?? "")) ||
      (vitestConfig === undefined && !testScript && rootVitest !== undefined));
  if (usesVitest && vitestConfig === undefined && rootVitest !== undefined) facts.vitestRootConfig = rootVitest;
  const usesNodeTest = /\bnode\b[^&|;]*--test\b/.test(testScript) && tree.has(at("tsconfig.test.json"));
  const jestConfig = ["ts", "mts", "js", "mjs", "cts", "cjs", "json"].map((ext) => at(`jest.config.${ext}`)).find((path) => tree.has(path));
  const usesJest =
    deps.jest !== undefined && (/\bjest\b/.test(testScript) || jestConfig !== undefined || manifest.jest !== undefined);
  const config = {
    name: "repo",
    repo: tree.root,
    base: tree.base,
    package: pkg,
    packageManager: facts.packageManager,
    buildFirst: facts.buildFirst,
    ...(facts.resolvedBefore ? { resolvedBefore: facts.resolvedBefore } : {}),
  };
  const packageTests = tree.files.filter((path) => path.startsWith(at("")) && TEST_FILE.test(path) && !path.includes("node_modules/"));
  const firstWithTests = (folders) => folders.find((folder) => packageTests.some((path) => path.startsWith(`${at(folder)}/`)));
  /** `*.test.ts`, `*.test.tsx` or `*.test.{ts,tsx}`, by the files the folder holds (`spec` where it has no `test`). */
  const patternIn = (folder) => {
    const names = packageTests.filter((path) => path.startsWith(`${at(folder)}/`));
    const kind = names.some((path) => /\.test\./.test(path)) || names.length === 0 ? "test" : "spec";
    const exts = [...new Set(names.map((path) => new RegExp(`\\.${kind}\\.(\\w+)$`).exec(path)?.[1]).filter(Boolean))].sort();
    return exts.length > 1 ? `*.${kind}.{${exts.join(",")}}` : `*.${kind}.${exts[0] ?? "ts"}`;
  };

  if (usesVitest) {
    config.runner = "vitest";
    const source = vitestConfig === undefined ? "" : tree.text(vitestConfig);
    // Every `include: [...]` in the config, not only the test block's: a
    // coverage or optimizeDeps include comes first in many configs (ofetch,
    // msw, valibot in evidence/fit-funnel.mjs), so a glob counts only when
    // it names test files and its folder holds some.
    const globs = [...source.matchAll(/include\s*:\s*\[([^\]]*)\]/g)].flatMap((include) => [...include[1].matchAll(/["'`]([^"'`]+)["'`]/g)].map((match) => match[1]));
    facts.vitestInclude = globs.length > 0 ? globs : null;
    const roots = globs.filter((glob) => /\.(test|spec)\./.test(glob)).map(globRoot).filter((root) => root !== "");
    const folder = firstWithTests([...roots, "test", "tests", "__tests__", "src"]);
    if (folder === undefined) return no("no test folder: no include glob's folder, test/, tests/, __tests__/ or src/ holds *.test or *.spec files");
    config.testDir = at(folder);
    config.testPattern = patternIn(folder);
    // vitest does not type-check; the build is the package's own check.
    config.build = `tsc -p ${tree.has(at("tsconfig.test.json")) ? "tsconfig.test.json" : tsconfigArg} --noEmit`;
  } else if (usesNodeTest) {
    config.runner = "node-test";
    const tsconfig = tree.json(at("tsconfig.test.json"));
    const options = tsconfig?.compilerOptions ?? {};
    const parent = typeof tsconfig?.extends === "string" && tsconfig.extends.startsWith(".") ? tree.json(at(posix.normalize(tsconfig.extends))) : null;
    config.rootDir = options.rootDir ?? parent?.compilerOptions?.rootDir ?? ".";
    config.outDir = options.outDir ?? parent?.compilerOptions?.outDir;
    if (config.outDir === undefined) return no(`${at("tsconfig.test.json")} names no outDir; node --test runs its compiled output`);
    const folder = firstWithTests(["test", "tests", "__tests__", "src"]);
    if (folder === undefined) return no("no test files under test/, tests/, __tests__/ or src/");
    config.testDir = at(folder);
    config.testPattern = patternIn(folder);
    config.build = "tsc -p tsconfig.test.json";
  } else if (usesJest) {
    config.runner = "jest";
    facts.jestConfig = jestConfig ?? (manifest.jest !== undefined ? `${at("package.json")} "jest"` : null);
    const folder = firstWithTests(["test", "tests", "__tests__", "src"]);
    if (folder === undefined) return no("no test files under test/, tests/, __tests__/ or src/");
    config.testDir = at(folder);
    config.testPattern = patternIn(folder);
    // Jest's transform may not type-check; the build is the package's own
    // check, over the tsconfig its tests compile with where it has one.
    const tsconfig = ["tsconfig.test.json", "tsconfig.spec.json", "tsconfig.json"].find((name) => tree.has(at(name))) ?? tsconfigArg;
    config.build = `tsc -p ${tsconfig} --noEmit`;
  } else {
    return no(`runner outside vitest, Jest and node:test over tsconfig.test.json: scripts.test is ${JSON.stringify(testScript || null)}`);
  }
  return { supported: true, config, facts };
}

/** The names under pyproject.toml's `[dependency-groups]`. */
const dependencyGroups = (pyproject) => {
  const section = /^\[dependency-groups\]\s*\n([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(pyproject)?.[1] ?? "";
  return [...section.matchAll(/^([A-Za-z0-9_.-]+)\s*=/gm)].map((match) => match[1]);
};
/** What marks a Python project. */
const PYTHON_PROJECT = ["pyproject.toml", "setup.py", "setup.cfg"];
/** pytest's default for the files it collects from a folder, as this reads it. */
const PYTHON_FILES = ["test_*.py"];

/**
 * A pytest list setting (`testpaths`, `python_files`) from the texts of its
 * configuration files, ini or TOML, written on one line: the values, without
 * quotes.
 */
export function pytestSetting(name, texts) {
  return texts
    .flatMap((text) => [...String(text ?? "").matchAll(new RegExp(`^\\s*${name}\\s*=\\s*\\[?([^\\]\\n]*)\\]?`, "gm"))].flatMap((match) => match[1].split(/[\s,]+/)))
    .map((value) => value.replace(/["']/g, ""))
    .filter(Boolean);
}

/** File-name globs (`*`, `?`) as one RegExp over a base name. */
export const namesRegExp = (globs) => new RegExp(`^(?:${globs.map((glob) => glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]")).join("|")})$`);

/**
 * A Python package for pytest: a pytest configuration (pytest.ini,
 * `[tool.pytest.ini_options]` in pyproject.toml, `[tool:pytest]` in
 * setup.cfg, `[pytest]` in tox.ini) or pytest among its declared
 * dependencies, a tests folder of `test_*.py` files (or what its
 * `python_files` names), and a frozen install:
 * uv.lock, poetry.lock, or requirements*.txt (pip). Sources under `src/`
 * (a src layout) go first on the suites' path.
 */
function detectPython(tree, pkg, facts, no) {
  const at = (path) => (pkg === "." ? path : `${pkg}/${path}`);
  const pyproject = tree.text(at("pyproject.toml")) ?? "";
  const setupCfg = tree.text(at("setup.cfg")) ?? "";
  const requirements = tree.files
    .filter((path) => posix.dirname(path) === (pkg === "." ? "." : pkg) && /^requirements[^/]*\.txt$/.test(posix.basename(path)))
    .sort();
  const declared = [pyproject, setupCfg, ...requirements.map((path) => tree.text(path) ?? "")].some((text) => /\bpytest\b/.test(text));
  facts.language = "python";
  facts.pytestConfig = tree.has(at("pytest.ini"))
    ? at("pytest.ini")
    : /^\[tool\.pytest\.ini_options\]/m.test(pyproject)
      ? `${at("pyproject.toml")} [tool.pytest.ini_options]`
      : /^\[tool:pytest\]/m.test(setupCfg)
        ? `${at("setup.cfg")} [tool:pytest]`
        : /^\[pytest\]/m.test(tree.text(at("tox.ini")) ?? "")
          ? `${at("tox.ini")} [pytest]`
          : null;
  if (facts.pytestConfig === null && !declared) return no("no pytest: no pytest configuration and pytest is not a declared dependency");
  const lock = [
    ["uv.lock", "uv"],
    ["poetry.lock", "poetry"],
  ].find(([file]) => tree.has(at(file)));
  facts.lockfile = lock?.[0] ?? (requirements.length > 0 ? requirements.join(", ") : null);
  // No lockfile and no requirements: uv resolves pyproject.toml as of the
  // commit's date (`--exclude-newer`), with its test extras and groups, so
  // the same commit installs the same versions on every run. 8 of 25
  // Python libraries in evidence/fit-funnel.mjs commit no lockfile.
  if (facts.lockfile === null && pyproject === "") return no("no lockfile and no pyproject.toml: uv.lock, poetry.lock, requirements*.txt, or a pyproject.toml to resolve");
  facts.packageManager = lock?.[1] ?? (requirements.length > 0 ? "pip" : "uv-dated");
  if (facts.packageManager === "uv-dated") facts.resolvedBefore = commitDate(tree);
  const configs = [tree.text(at("pytest.ini")), tree.text(at("tox.ini")), pyproject, setupCfg];
  // The names pytest collects: its `python_files` where the project sets it
  // (tqdm's tests are tests_*.py), else test_*.py. Only .py names count.
  const named = pytestSetting("python_files", configs).filter((glob) => glob.endsWith(".py") && !glob.includes("/"));
  const names = named.length > 0 ? [...new Set(named)] : PYTHON_FILES;
  if (named.length > 0) facts.pythonFiles = names;
  const isTestFile = namesRegExp(names);
  const packageTests = tree.files.filter((path) => path.startsWith(at("")) && isTestFile.test(posix.basename(path)));
  // pytest's own `testpaths` first (pluggy keeps its tests in testing/).
  const testpaths = pytestSetting("testpaths", configs).map((path) => path.replace(/\/+$/, ""));
  const where = [...new Set([...testpaths, "tests", "test", "src"])];
  const folder = where.find((name) => packageTests.some((path) => path.startsWith(`${at(name)}/`)));
  if (folder === undefined) return no(`no ${names.join(" or ")} files under ${where.join("/, ")}/`);
  // The existing suite by the project's names, and this spec's own files, which are always test_<slug>.py.
  const all = [...new Set([...names, ...PYTHON_FILES])];
  const srcLayout = tree.files.some((path) => new RegExp(`^${at("src/")}[^/]+/__init__\\.py$`).test(path));
  const config = {
    name: "repo",
    repo: tree.root,
    base: tree.base,
    package: pkg,
    packageManager: facts.packageManager,
    buildFirst: [],
    runner: "pytest",
    testDir: at(folder),
    testPattern: all.length === 1 ? all[0] : `{${all.join(",")}}`,
    pythonPath: [srcLayout ? "src" : "."],
    ...(facts.packageManager === "pip" ? { requirements } : {}),
    ...(facts.packageManager === "uv" || facts.packageManager === "uv-dated" ? { groups: dependencyGroups(pyproject).filter((name) => /^(dev|tests?|testing)$/.test(name)) } : {}),
    ...(facts.packageManager === "uv-dated" ? { resolvedBefore: facts.resolvedBefore, extras: optionalExtras(pyproject).filter((name) => /^(dev|tests?|testing)$/.test(name)) } : {}),
  };
  return { supported: true, config, facts };
}

/** A toolchain's testPattern (`*` and `{a,b}`) as a RegExp over a file's base name. */
const testNames = (glob) => new RegExp(`^${glob.replace(/\./g, "\\.").replace(/\*/g, "[^/]*").replace(/\{([^}]*)\}/g, (_, alts) => `(?:${alts.split(",").join("|")})`)}$`);

/**
 * The existing test files nearest the seam, best first: a test that imports
 * a seam file, then one named after it, then one importing from its folder.
 */
export function nearest(tree, config, seam, limit = 3) {
  if (config.runner === "pytest") return nearestPython(tree, config, seam, limit);
  const stem = (path) => path.replace(/\.[cm]?[jt]sx?$/, "").replace(/\/index$/, "");
  const seams = seam.map(stem);
  const folders = seam.map((path) => posix.dirname(path));
  const pattern = testNames(config.testPattern);
  const scored = tree.files
    .filter((path) => path.startsWith(`${config.testDir}/`) && pattern.test(posix.basename(path)))
    .map((path) => {
      const imports = [...(tree.text(path) ?? "").matchAll(/from\s+["'](\.[^"']+)["']/g)].map((match) =>
        stem(posix.normalize(posix.join(posix.dirname(path), match[1]))),
      );
      const name = posix.basename(path).replace(/\.(test|spec)\.[cm]?tsx?$/, "");
      const score = imports.some((item) => seams.includes(item))
        ? 3
        : seams.some((item) => posix.basename(item) === name)
          ? 2
          : imports.some((item) => folders.includes(posix.dirname(item)))
            ? 1
            : 0;
      return { path, score };
    })
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const ranked = scored.filter((item) => item.score > 0);
  return (ranked.length > 0 ? ranked : scored).slice(0, ranked.length > 0 ? limit : 2).map((item) => item.path);
}

/**
 * The same for pytest: a test that imports the seam's module, then one
 * named after it (`test_<module>.py`, or as the project's `python_files`
 * names its tests: tqdm's `tests_<module>.py`), then one importing from its
 * package. The files are the ones config.testPattern takes.
 */
function nearestPython(tree, config, seam, limit) {
  const root = posix.join(config.package, config.pythonPath[0]);
  const moduleOf = (path) => posix.relative(root, path).replace(/(\/__init__)?\.py$/, "").split("/").join(".");
  const modules = seam.map(moduleOf);
  const packages = modules.map((name) => name.split(".").slice(0, -1).join(".")).filter(Boolean);
  const pattern = testNames(config.testPattern ?? "test_*.py");
  const scored = tree.files
    .filter((path) => path.startsWith(`${config.testDir}/`) && pattern.test(posix.basename(path)))
    .map((path) => {
      const text = tree.text(path) ?? "";
      const imports = [...text.matchAll(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm)].map((match) => match[1] ?? match[2]);
      const name = posix.basename(path).replace(/\.py$/, "").replace(/^tests?_|_tests?$/g, "");
      const score = imports.some((item) => modules.includes(item))
        ? 3
        : modules.some((item) => item.split(".").at(-1) === name)
          ? 2
          : imports.some((item) => packages.some((pkg) => item === pkg || item.startsWith(`${pkg}.`)))
            ? 1
            : 0;
      return { path, score };
    })
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const ranked = scored.filter((item) => item.score > 0);
  return (ranked.length > 0 ? ranked : scored).slice(0, ranked.length > 0 ? limit : 2).map((item) => item.path);
}

/** The package's existing suite once, on a clone of the prepared base tree: counts and duration. */
export function runExisting(config) {
  prepareBase(config);
  const chain = repoChain(config, null);
  const dir = stage(workdir("fit"), null, { chain, spec: false });
  const started = Date.now();
  try {
    const result = runSuite(dir, "existing", chain);
    const tests = testsOf(result);
    return {
      compiled: result.compiled,
      compileOutput: result.compileOutput || undefined,
      files: result.files.length,
      crashed: result.files.filter((file) => file.crashed).map((file) => file.file),
      passed: tests.filter((test) => test.ok).length,
      failed: tests.filter((test) => !test.ok).map((test) => test.id),
      seconds: Math.round((Date.now() - started) / 1000),
    };
  } finally {
    discard(dir);
  }
}

/**
 * The boundary --seam names, as toolchain.json `boundary` holds it, or
 * null without --seam; throws on a --seam without its command or start.
 */
export function boundaryOption(options) {
  if (options.seam !== "exec" && options.seam !== "http") return null;
  const build = typeof options["boundary-build"] === "string" ? { build: options["boundary-build"] } : {};
  if (options.seam === "exec") {
    if (typeof options.command !== "string") throw new Error("--seam exec needs --command \"<argv>\"");
    return { command: options.command.split(/\s+/).filter(Boolean), ...build };
  }
  if (typeof options.start !== "string") throw new Error("--seam http needs --start \"<command>\"");
  return { service: { start: options.start, healthcheck: typeof options.healthcheck === "string" ? options.healthcheck : "/" }, ...build };
}

/**
 * The boundary once on a clone of the prepared base, in the package's
 * folder, under bin/runners/boundary.mjs: whether the service answered or
 * the command started, and how long it took.
 */
export function runBoundary(config) {
  prepareBase(config);
  const chain = repoChain(config, null);
  const dir = stage(workdir("fit-boundary"), null, { chain, spec: false });
  const probe = config.boundary.service !== undefined
    ? `fetch(new URL(${JSON.stringify(config.boundary.service.healthcheck ?? "/")}, process.env.BOUNDARY_URL)).then((res) => console.log(JSON.stringify({ ready: true, status: res.status })), () => console.log(JSON.stringify({ ready: false })))`
    : `const [bin, ...argv] = JSON.parse(process.env.BOUNDARY_COMMAND); const run = require("node:child_process").spawnSync(bin, argv, { input: "", encoding: "utf8", timeout: 60000 }); console.log(JSON.stringify({ ready: run.error === undefined && run.status !== 127, exit: run.status, error: run.error?.code }))`;
  const started = Date.now();
  try {
    const run = spawnSync(process.execPath, [join(RUNNERS, "boundary.mjs"), JSON.stringify(config.boundary), "--", process.execPath, "-e", probe], {
      cwd: join(dir, config.package),
      encoding: "utf8",
    });
    const line = run.stdout.trim().split("\n").at(-1) ?? "";
    const found = line.startsWith("{") ? JSON.parse(line) : { ready: false };
    return { ...found, seconds: Math.round((Date.now() - started) / 100) / 10, ...(found.ready ? {} : { output: run.stderr.trim().slice(-2000) }) };
  } finally {
    discard(dir);
  }
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { options } = args();
  if (typeof options.repo !== "string") {
    console.error('usage: node bin/fit.mjs --repo <path> [--package <dir>] [--base <ref>] [--no-run] [--seam exec --command "<argv>" | --seam http --start "<cmd>" [--healthcheck <path>]] [--boundary-build "<cmd>"]');
    process.exit(1);
  }
  let found;
  try {
    const boundary = boundaryOption(options);
    found = detect({ repo: options.repo, pkg: options.package ?? ".", ref: options.base ?? "HEAD" });
    if (found.supported && boundary !== null) found.config.boundary = boundary;
    if (found.supported && options["no-run"] !== true) {
      log(`${found.config.package}: staging ${found.config.base.slice(0, 12)} and running its existing suite`);
      found.suite = runExisting(found.config);
      // ts-jest type-checks each test file itself: a project-wide tsc that
      // fails on a clean install is no check to keep.
      if (!found.suite.compiled && found.config.runner === "jest" && found.config.build !== undefined) {
        found.facts.buildDropped = `${found.config.build}: ${found.suite.compileOutput?.split("\n")[0] ?? ""}`;
        delete found.config.build;
        found.suite = runExisting(found.config);
      }
      if (!found.suite.compiled) {
        found.supported = false;
        found.reason = `the existing suite does not build on a clean install: ${found.suite.compileOutput?.split("\n")[0] ?? ""}`;
      } else if (found.suite.seconds > MAX_SUITE_MINUTES * 60) {
        found.supported = false;
        found.reason = `the existing suite takes ${Math.round(found.suite.seconds / 60)} minutes, over ${MAX_SUITE_MINUTES}`;
      }
      if (found.supported && boundary !== null) {
        found.facts.boundary = runBoundary(found.config);
        if (!found.facts.boundary.ready) {
          found.supported = false;
          found.reason =
            boundary.service !== undefined
              ? `the service did not answer ${boundary.service.healthcheck} on the staged base`
              : `the command ${boundary.command.join(" ")} did not start on the staged base`;
        }
      }
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  console.log(found.supported ? "supported" : `unsupported: ${found.reason}`);
  if (found.suite !== undefined)
    console.log(
      `existing suite: ${found.suite.passed} passed, ${found.suite.failed.length} failed, ${found.suite.crashed.length} file(s) crashed, ${found.suite.seconds} s`,
    );
  console.log(JSON.stringify({ ...found.facts, config: found.config, suite: found.suite }, null, 2));
  process.exit(found.supported ? 0 : 2);
}
