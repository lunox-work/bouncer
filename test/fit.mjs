// `bouncer fit`'s static checks (bin/fit.mjs `detect`) on throwaway git
// repositories: no install, no suite run, no model. Each case is a shape the
// funnels met in a real repository (evidence/fit-funnel.mjs and
// evidence/fit-funnel-commits.mjs), named beside it.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { detect, globRegExp, namesRegExp, nearest, optionalExtras, pytestSetting, reader, stripJsonc } from "../bin/fit.mjs";

const ok = (name) => console.log(`ok ${name}`);
const scratch = mkdtempSync(join(tmpdir(), "bouncer-fit-"));
const DATE = "2026-01-02T03:04:05+00:00";
let count = 0;

/** A git repository holding `files` ({ path: text }) in one commit dated DATE. */
function repoOf(files) {
  const dir = join(scratch, `repo-${(count += 1)}`);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  const git = (...argv) => {
    const run = spawnSync("git", ["-C", dir, ...argv], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_DATE: DATE, GIT_COMMITTER_DATE: DATE } });
    assert.equal(run.status, 0, run.stderr);
  };
  git("init", "-q", "-b", "main");
  git("-c", "user.email=t@example.com", "-c", "user.name=t", "add", ".");
  git("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "-m", "base");
  return dir;
}
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const TS = { typescript: "5.9.0" };
const tsconfig = json({ compilerOptions: { strict: true } });
const fit = (files, pkg = ".") => detect({ repo: repoOf(files), pkg });

try {
  // globRegExp: workspace globs. vite's `packages/**/__tests__/**` crashed the first version.
  assert.ok(globRegExp("packages/*").test("packages/a"));
  assert.ok(!globRegExp("packages/*").test("packages/a/b"));
  assert.ok(globRegExp("packages/**").test("packages/a/b"));
  assert.ok(globRegExp("./apps/web/").test("apps/web"));
  assert.ok(globRegExp("playground/**").test("playground/resolve/utf8-bom-package"));
  assert.ok(globRegExp("packages/**/__tests__/**").test("packages/vite/src/node/__tests__/fixtures/a"));
  assert.ok(!globRegExp("packages/**/__tests__/**").test("packages/vite/src/node"));
  assert.ok(globRegExp("pkg-?").test("pkg-a") && !globRegExp("pkg-?").test("pkg-ab"));
  assert.ok(!globRegExp("a.b").test("axb"), "a dot is a dot");
  ok("globRegExp: *, **, ?, a leading ./ and a trailing /");

  // stripJsonc: comments and trailing commas go, a string holding /* or // stays (jotai's tsconfig paths).
  assert.deepEqual(JSON.parse(stripJsonc('{ // c\n "paths": { "jotai/*": ["./src/*.ts"] }, /* b */ "u": "http://h", "l": [1, 2,], "s": "q\\"//z",\n}')), {
    paths: { "jotai/*": ["./src/*.ts"] },
    u: "http://h",
    l: [1, 2],
    s: 'q"//z',
  });
  ok("stripJsonc: a tsconfig's comments and trailing commas, strings untouched");

  // vitest: a coverage include before the test include is not the test folder (ofetch, msw, valibot).
  {
    const found = fit({
      "package.json": json({ scripts: { test: "vitest run" }, devDependencies: { ...TS, vitest: "3.0.0" } }),
      "package-lock.json": "{}\n",
      "tsconfig.json": tsconfig,
      "vitest.config.ts": 'export default { test: { coverage: { include: ["src/**"] }, include: ["test/**/*.test.ts"] }, optimizeDeps: { include: ["lodash"] } };\n',
      "src/index.ts": "export const a = 1;\n",
      "test/unit/a.test.ts": "",
    });
    assert.equal(found.supported, true, found.reason);
    assert.equal(found.config.runner, "vitest");
    assert.equal(found.config.testDir, "test");
    assert.equal(found.config.testPattern, "*.test.ts");
    assert.equal(found.config.build, "tsc -p tsconfig.json --noEmit");
    assert.equal(found.config.packageManager, "npm");
    assert.deepEqual(found.facts.vitestInclude, ["src/**", "test/**/*.test.ts", "lodash"]);
  }
  ok("vitest: the include that names test files, not coverage's or optimizeDeps'");

  // vitest: tests in __tests__/, named by no include; and the runner from a test:* script (query-core's test:lib).
  {
    const found = fit({
      "package.json": json({ scripts: { "test:lib": "vitest", build: "tsc" }, devDependencies: { ...TS, vitest: "3.0.0" } }),
      "package-lock.json": "{}\n",
      "tsconfig.json": tsconfig,
      "__tests__/a.spec.tsx": "",
    });
    assert.equal(found.supported, true, found.reason);
    assert.equal(found.config.runner, "vitest");
    assert.equal(found.config.testDir, "__tests__");
    assert.equal(found.config.testPattern, "*.spec.tsx");
    assert.equal(found.facts.testScript, null);
  }
  ok("vitest: __tests__/ and a test:* script");

  // A workspace package with no test script and no config of its own, under the root's vitest config (effect).
  // One workspace's package.json starts with a byte-order mark (vite's playground): read, not fatal.
  {
    const files = {
      "package.json": json({ workspaces: ["packages/*"], devDependencies: { ...TS, vitest: "3.0.0" } }),
      "package-lock.json": "{}\n",
      "vitest.config.ts": 'export default { test: { projects: ["packages/*"] } };\n',
      "packages/core/package.json": json({ name: "core", scripts: { build: "tsc" } }),
      "packages/core/tsconfig.json": `﻿${tsconfig}`,
      "packages/core/test/a.test.ts": "",
      "packages/bom/package.json": `﻿${json({ name: "bom" })}`,
    };
    const found = fit(files, "packages/core");
    assert.equal(found.supported, true, found.reason);
    assert.equal(found.config.runner, "vitest");
    assert.equal(found.facts.vitestRootConfig, "vitest.config.ts");
    assert.equal(found.config.testDir, "packages/core/test");
    assert.deepEqual(found.facts.workspaces, ["packages/bom", "packages/core"]);
    const outside = fit(files, "packages/none");
    assert.equal(outside.supported, false);
    assert.match(outside.reason, /^no packages\/none\/package\.json/);
  }
  ok("a workspace package under the root's vitest config; a byte-order mark is read");

  // node:test over a tsconfig.test.json that has a byte-order mark and comments.
  {
    const found = fit({
      "package.json": json({ scripts: { test: "tsc -p tsconfig.test.json && node --test dist-test" }, devDependencies: TS }),
      "package-lock.json": "{}\n",
      "tsconfig.json": tsconfig,
      "tsconfig.test.json": '﻿{\n  // the test build\n  "compilerOptions": { "outDir": "dist-test", "rootDir": ".", },\n}\n',
      "test/a.test.ts": "",
    });
    assert.equal(found.supported, true, found.reason);
    assert.equal(found.config.runner, "node-test");
    assert.equal(found.config.outDir, "dist-test");
  }
  ok("node:test: a tsconfig.test.json with a byte-order mark, comments and a trailing comma");

  // No lockfile: npm resolves as of the commit's date (ky, fastify).
  {
    const found = fit({
      "package.json": json({ scripts: { test: "vitest" }, devDependencies: { ...TS, vitest: "3.0.0" } }),
      "tsconfig.json": tsconfig,
      "test/a.test.ts": "",
    });
    assert.equal(found.supported, true, found.reason);
    assert.equal(found.config.packageManager, "npm-dated");
    assert.equal(Date.parse(found.config.resolvedBefore), Date.parse(DATE), found.config.resolvedBefore);
    assert.equal(found.facts.lockfile, null);
  }
  ok("no lockfile: npm-dated, resolved before the commit's date");

  // TypeScript, or not. A package with no tsconfig of its own takes the root's (xstate), when that covers it.
  {
    const base = {
      "package.json": json({ workspaces: ["packages/*"], devDependencies: { ...TS, vitest: "3.0.0" } }),
      "package-lock.json": "{}\n",
      "packages/core/package.json": json({ name: "core", scripts: { test: "vitest run" } }),
      "packages/core/src/index.ts": "export const a = 1;\n",
      "packages/core/test/a.test.ts": "",
    };
    const rooted = fit({ ...base, "tsconfig.json": '{\n  "compilerOptions": { "noEmit": true }, // every package\n  "exclude": ["**/examples"]\n}\n' }, "packages/core");
    assert.equal(rooted.supported, true, rooted.reason);
    assert.equal(rooted.config.build, "tsc -p ../../tsconfig.json --noEmit");
    assert.equal(rooted.facts.tsconfig, "tsconfig.json");
    const covered = fit({ ...base, "tsconfig.json": json({ include: ["packages/*/src", "packages/*/test"] }) }, "packages/core");
    assert.equal(covered.supported, true, covered.reason);
    const elsewhere = fit({ ...base, "tsconfig.json": json({ include: ["src/**/*", "tests/**/*"] }) }, "packages/core");
    assert.equal(elsewhere.supported, false);
    assert.equal(elsewhere.reason, "no TypeScript: no packages/core/tsconfig.json, and the root tsconfig.json does not include packages/core");
    const solution = fit({ ...base, "tsconfig.json": json({ files: [], references: [{ path: "packages/core" }] }) }, "packages/core");
    assert.equal(solution.supported, false);
    assert.match(solution.reason, /the root tsconfig\.json only references other projects/);
    const none = fit(base, "packages/core");
    assert.equal(none.supported, false);
    assert.equal(none.reason, "no TypeScript: no packages/core/tsconfig.json");
  }
  ok("the root tsconfig.json for a package without one: used, refused when it does not cover the package or only references");

  // JavaScript is said as JavaScript (fastify: a typescript dependency for its type tests, no tsconfig).
  {
    const js = fit({
      "package.json": json({ scripts: { test: "borp" }, devDependencies: TS }),
      "package-lock.json": "{}\n",
      "lib/a.js": "",
      "lib/b.js": "",
      "test/a.test.js": "",
      "types/index.d.ts": "",
      "test/types/a.tst.ts": "",
    });
    assert.equal(js.supported, false);
    assert.equal(js.reason, "JavaScript, not TypeScript: no tsconfig.json, and 3 .js files to 1 .ts");
    const untyped = fit({ "package.json": json({ scripts: { test: "vitest" } }), "package-lock.json": "{}\n", "tsconfig.json": tsconfig, "src/a.ts": "", "src/b.ts": "", "x.js": "" });
    assert.equal(untyped.reason, "no TypeScript: no typescript dependency");
  }
  ok("a JavaScript package is called one; TypeScript sources with no typescript dependency are not");

  // A runner fit does not drive.
  {
    const ava = fit({ "package.json": json({ scripts: { test: "xo && ava" }, devDependencies: { ...TS, ava: "6.0.0" } }), "package-lock.json": "{}\n", "tsconfig.json": tsconfig, "test/a.test.ts": "" });
    assert.equal(ava.supported, false);
    assert.match(ava.reason, /^runner outside vitest, Jest and node:test over tsconfig\.test\.json: scripts\.test is "xo && ava"$/);
  }
  ok("a runner outside vitest, Jest and node:test is refused by name");

  // pytest: settings read from its configuration files, on one line.
  assert.deepEqual(pytestSetting("testpaths", ["[pytest]\ntestpaths = testing docs\n", null, '[tool.pytest.ini_options]\ntestpaths = ["tests", "more"]\n']), ["testing", "docs", "tests", "more"]);
  assert.deepEqual(pytestSetting("python_files", ['python_files = ["tests_*.py", "tests_*.ipynb"]\n']), ["tests_*.py", "tests_*.ipynb"]);
  assert.deepEqual(pytestSetting("python_files", ["nothing here"]), []);
  assert.ok(namesRegExp(["tests_*.py", "check_?.py"]).test("tests_tqdm.py"));
  assert.ok(namesRegExp(["tests_*.py", "check_?.py"]).test("check_a.py"));
  assert.ok(!namesRegExp(["tests_*.py"]).test("test_tqdm.py"));
  assert.deepEqual(optionalExtras('[project.optional-dependencies]\ntest = ["pytest"]\ndocs = ["sphinx"]\n\n[tool.x]\ny = 1\n'), ["test", "docs"]);
  ok("pytestSetting, namesRegExp and optionalExtras");

  // pytest's testpaths (pluggy keeps its tests in testing/), with a lockfile.
  {
    const found = fit({
      "pyproject.toml": '[project]\nname = "plug"\ndependencies = []\n',
      "tox.ini": "[pytest]\ntestpaths = testing\naddopts = -r a\n",
      "uv.lock": "",
      "src/plug/__init__.py": "",
      "testing/test_hooks.py": "",
    });
    assert.equal(found.supported, true, found.reason);
    assert.equal(found.config.runner, "pytest");
    assert.equal(found.config.testDir, "testing");
    assert.equal(found.config.testPattern, "test_*.py");
    assert.equal(found.config.packageManager, "uv");
    assert.deepEqual(found.config.pythonPath, ["src"]);
    assert.equal(found.facts.pytestConfig, "tox.ini [pytest]");
  }
  ok("pytest: testpaths from tox.ini");

  // pytest's python_files (tqdm's tests are tests_*.py), and no lockfile: uv resolves as of the commit's date.
  {
    const files = {
      "pyproject.toml": '[project]\nname = "bar"\n\n[project.optional-dependencies]\ntest = ["pytest"]\ndocs = ["sphinx"]\n\n[dependency-groups]\ndev = ["pytest"]\n\n[tool.pytest.ini_options]\npython_files = ["tests_*.py", "tests_*.ipynb"]\ntestpaths = ["tests"]\n',
      "bar/__init__.py": "",
      "tests/tests_bar.py": "",
      "tests/conftest.py": "",
    };
    const found = fit(files);
    assert.equal(found.supported, true, found.reason);
    assert.equal(found.config.testDir, "tests");
    assert.equal(found.config.testPattern, "{tests_*.py,test_*.py}", "the project's names, and this spec's own test_<slug>.py");
    assert.deepEqual(found.facts.pythonFiles, ["tests_*.py"]);
    assert.equal(found.config.packageManager, "uv-dated");
    assert.equal(Date.parse(found.config.resolvedBefore), Date.parse(DATE), found.config.resolvedBefore);
    assert.deepEqual(found.config.extras, ["test"]);
    assert.deepEqual(found.config.groups, ["dev"]);
    assert.deepEqual(found.config.pythonPath, ["."]);
    // Without python_files those files are not tests.
    const plain = fit({ ...files, "pyproject.toml": '[project]\nname = "bar"\n\n[tool.pytest.ini_options]\ntestpaths = ["tests"]\n' });
    assert.equal(plain.supported, false);
    assert.equal(plain.reason, "no test_*.py files under tests/, test/, src/");
    const none = fit({ "pyproject.toml": '[project]\nname = "bar"\n', "bar/__init__.py": "", "tests/test_bar.py": "" });
    assert.equal(none.reason, "no pytest: no pytest configuration and pytest is not a declared dependency");
  }
  ok("pytest: python_files names the test files; no lockfile is uv-dated with its test extras and groups");

  // The example tests bin/repo.mjs shows a writer: the nearest to the seam, by the names the project uses.
  {
    const dir = repoOf({
      "pyproject.toml": '[project]\nname = "bar"\n\n[tool.pytest.ini_options]\npython_files = ["tests_*.py"]\n',
      "uv.lock": "",
      "bar/__init__.py": "",
      "bar/core.py": "",
      "bar/util.py": "",
      "tests/tests_core.py": "from bar.core import run\n",
      "tests/tests_util.py": "import os\n",
      "tests/tests_misc.py": "import os\n",
      "tests/helpers.py": "from bar.core import run\n",
    });
    const { config } = detect({ repo: dir });
    const tree = reader(dir);
    assert.deepEqual(nearest(tree, config, ["bar/core.py"]), ["tests/tests_core.py"], "the test that imports the seam's module");
    assert.deepEqual(nearest(tree, config, ["bar/util.py"]), ["tests/tests_util.py", "tests/tests_core.py"], "named after it, then one importing its package");
    assert.deepEqual(nearest(tree, { ...config, testPattern: "test_*.py" }, ["bar/core.py"]), [], "by the default names this project has no tests");
    const ts = repoOf({
      "package.json": json({ scripts: { test: "vitest" }, devDependencies: { ...TS, vitest: "3.0.0" } }),
      "package-lock.json": "{}\n",
      "tsconfig.json": tsconfig,
      "src/parse.ts": "",
      "src/format.ts": "",
      "test/parse.test.ts": 'import { parse } from "../src/parse";\n',
      "test/format.test.ts": "",
      "test/other.test.ts": "",
    });
    assert.deepEqual(nearest(reader(ts), detect({ repo: ts }).config, ["src/format.ts"]), ["test/format.test.ts", "test/parse.test.ts"]);
  }
  ok("nearest: the existing tests closest to the seam, by python_files for pytest");
  console.log("fit passed");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
