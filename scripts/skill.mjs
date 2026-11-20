#!/usr/bin/env node
// The repository's agent skills (skills/<name>/SKILL.md) as the Agent Skills
// format (agentskills.io/specification).
//
//   node scripts/skill.mjs check            the rules below; exit 1 on any
//   node scripts/skill.mjs sync             write package.json's version into
//                                           the pins and copy the spec
//                                           prompts into the skill
//                                           (npm `version` hook)
//   node scripts/skill.mjs pack [--offline] one zip per skill in dist-skills/
//   node scripts/skill.mjs plugin-branch [--push] [--rev <rev>]
//                                           commit the plugin's files to the
//                                           claude-plugin branch
//
// One Claude Code plugin (PLUGINS): `bouncer-verify`, the local skill with no
// MCP server, so installing it asks for no sign-in. The hosted plugin
// (`bouncer-hosted`, the `lunox` MCP server with the hosted and contributor
// skills) was removed on 2026-11-20: no MCP server for now; git history has
// it. Every skill belongs to exactly one plugin. marketplace.json lists it,
// fetched from its folder on the claude-plugin branch.
//
// check: `name` matches its folder (lowercase, digits, single hyphens, at
// most 64), `description` 1 to 1024 characters without < or >, written as
// `description: >-` (a ": " in a plain multi-line value breaks the skills
// CLI), `compatibility` at most 500, the body at most 500 lines, no symlinks,
// every relative link in SKILL.md and references/*.md resolves inside the
// skill's folder, every `<package>@x.y.z` pin and every plugin manifest
// carries package.json's version, and marketplace.json lists exactly
// PLUGINS. There is no `.mcp.json`: the plugin bundles no MCP server. It also refuses
// the plugin directory's scanner traps (SCANNER_TRAPS) in every skill file.
//
// pack: a zip holding one top-level folder named after the skill, with
// SKILL.md at its root. It refuses a pin that npm does not serve yet
// (publish first), unless --offline.
//
// plugin-branch: the Claude plugin directory scans every file in the plugin
// folder, and on main that folder is the whole repository (CLI source,
// lockfile, tests, experiments). The directory tracks the claude-plugin
// branch instead: each plugin in its own folder (what the directory reads:
// .claude-plugin/plugin.json, LICENSE, skills/, README.md). Each README.md is written
// from its plugin.json, its skills' frontmatter and .claude-plugin/data.md
// (what is sent where, for the directory's data-handling review; the
// directory requires a README). One commit per change on top of origin's
// branch, from HEAD or --rev. Builds the commit without touching the working
// tree, index or any ref; --push sends it to origin. CI runs it on push to
// main.

import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS = join(ROOT, "skills");
const PKG = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
/** The skill, plugin and command name: the npm name without its scope. */
const NAME = PKG.name.replace(/^@[^/]+\//, "");
const PIN = new RegExp(`(?<![\\w@/.-])${PKG.name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}@(\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?)`, "g");
const MARKETPLACE = ".claude-plugin/marketplace.json";
const PLUGIN_BRANCH = "claude-plugin";
/** The GitHub repository marketplace sources fetch the plugin branch from. */
const REPO = "lunox-work/bouncer";
/**
 * The two plugins. `dir` is the plugin's folder on the plugin branch ("" for
 * its root), `manifest` its plugin.json on main, `mcp` whether it carries
 * .mcp.json. Each has a folder of its own: the Claude plugin directory scans
 * a submission's whole folder, so a plugin at the root would carry the other
 * one's files, MCP server included.
 */
const PLUGINS = [
  // `bouncer-verify`, not `bouncer`: the Claude plugin directory holds the name
  // "bouncer" for an existing publisher of that name (validation, 2026-11-20).
  // The skill inside is still `bouncer`; displayName "bouncer" is held too, so
  // it reads "bouncer verify", like "bouncer hosted".
  { name: `${NAME}-verify`, dir: `${NAME}-verify`, manifest: ".claude-plugin/plugin.json", skills: [NAME], mcp: false },
];
const MANIFESTS = [...PLUGINS.map((plugin) => plugin.manifest), MARKETPLACE];
/** The marketplace entry's `source` for a plugin: the plugin branch, at its root or in the plugin's folder. */
function marketSource(plugin) {
  return plugin.dir === ""
    ? { source: "github", repo: REPO, ref: PLUGIN_BRANCH }
    : { source: "git-subdir", url: REPO, path: plugin.dir, ref: PLUGIN_BRANCH };
}
/**
 * Patterns the Claude plugin directory's scanner holds a plugin for (found
 * 2026-11-12 by bisecting): a line that starts with the word "pass" reads as
 * the `pass` password manager; `fetch` or `eval` beside "a module loaded from
 * a URL" reads as download-and-run; skills name the repository as
 * "lunox-work/bouncer on GitHub", never by a github.com URL.
 */
const SCANNER_TRAPS = [
  { test: (text) => /^[\s>*|-]*(\d+\.\s+)?pass\b/im.test(text), why: 'a line starts with "pass" (reflow or reword)' },
  { test: (text) => /`(fetch|eval)`/.test(text) && /module loaded from a URL/i.test(text), why: "`fetch`/`eval` with \"a module loaded from a URL\"" },
  { test: (text) => /github\.com/i.test(text), why: 'a github.com URL (write "lunox-work/bouncer on GitHub")' },
];
/**
 * The plugin's one MCP server (plugin-root .mcp.json, as Claude Code plugins
 * declare them). The platform also still serves it at /mcp/duediligence, the
 * package's name before the rename, for plugins installed then.
 */
const MCP_URL = "https://platform.lunox.work/mcp/bouncer";
/**
 * The prompts this session reads itself (the spec-drafting rules), mirrored
 * into the skill's folder so the plugin carries every instruction it gives
 * Claude: prompts/<path>/spec-from-ticket.md is copied to
 * skills/bouncer/references/prompts/<path>/spec-from-ticket.md by
 * `sync`, and `check` fails when a copy differs or is missing. The other
 * prompts brief the sessions the CLI starts, and stay in the package only.
 */
const PROMPTS = join(ROOT, "prompts");
const BUNDLED_PROMPT = "spec-from-ticket.md";
const BUNDLED_INTO = join(SKILLS, NAME, "references", "prompts");

/** [source, copy] for each prompt the skill carries. */
function bundledPrompts() {
  if (!existsSync(PROMPTS)) return [];
  return walk(PROMPTS)
    .filter((path) => path.endsWith(`/${BUNDLED_PROMPT}`))
    .sort()
    .map((path) => [path, join(BUNDLED_INTO, relative(PROMPTS, path))]);
}

function checkBundledPrompts() {
  const problems = [];
  const want = new Set();
  for (const [source, copy] of bundledPrompts()) {
    want.add(copy);
    if (!existsSync(copy)) problems.push(`${relative(ROOT, copy)}: missing (npm run skill:sync)`);
    else if (readFileSync(copy, "utf8") !== readFileSync(source, "utf8")) {
      problems.push(`${relative(ROOT, copy)}: differs from ${relative(ROOT, source)} (npm run skill:sync)`);
    }
  }
  if (existsSync(BUNDLED_INTO)) {
    for (const copy of walk(BUNDLED_INTO)) {
      if (!want.has(copy)) problems.push(`${relative(ROOT, copy)}: no prompt in prompts/ (remove it)`);
    }
  }
  return problems;
}

/** Top-level YAML keys of the frontmatter, folded the way YAML folds plain and `>` scalars. */
function frontmatter(text) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) return null;
  const fields = {};
  let key = null;
  for (const line of match[1].split("\n")) {
    const top = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (top) {
      key = top[1];
      fields[key] = /^[>|][+-]?$/.test(top[2]) ? "" : top[2];
    } else if (key && /^\s/.test(line)) {
      fields[key] = `${fields[key]} ${line.trim()}`.trim();
    }
  }
  for (const k of Object.keys(fields)) fields[k] = fields[k].replace(/^(["'])(.*)\1$/, "$2");
  return { fields, body: text.slice(match[0].length) };
}

function skills() {
  return existsSync(SKILLS) ? readdirSync(SKILLS).filter((name) => existsSync(join(SKILLS, name, "SKILL.md"))) : [];
}

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stat = lstatSync(path);
    return stat.isDirectory() && !stat.isSymbolicLink() ? walk(path) : [path];
  });
}

function check() {
  const problems = [];
  const names = skills();
  if (names.length === 0) problems.push("skills/: no <name>/SKILL.md");
  for (const name of names) {
    const dir = join(SKILLS, name);
    const text = readFileSync(join(dir, "SKILL.md"), "utf8");
    const parsed = frontmatter(text);
    const at = `skills/${name}/SKILL.md`;
    if (!parsed) {
      problems.push(`${at}: no frontmatter`);
      continue;
    }
    const { fields, body } = parsed;
    if (fields.name !== name) problems.push(`${at}: name "${fields.name}" is not its folder's name`);
    if (!/^description: >-$/m.test(text.slice(0, text.indexOf("\n---", 3)))) problems.push(`${at}: write the description as \`description: >-\``);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) || name.length > 64) problems.push(`${at}: folder name breaks the name rule`);
    const description = fields.description ?? "";
    if (description.length < 1 || description.length > 1024) problems.push(`${at}: description is ${description.length} characters (1 to 1024)`);
    if (/[<>]/.test(description)) problems.push(`${at}: description holds < or >`);
    if ((fields.compatibility ?? "").length > 500) problems.push(`${at}: compatibility is over 500 characters`);
    const lines = body.split("\n").length;
    if (lines > 500) problems.push(`${at}: body is ${lines} lines (at most 500; move detail to references/)`);
    for (const path of walk(dir)) {
      if (lstatSync(path).isSymbolicLink()) problems.push(`${relative(ROOT, path)}: a symlink`);
    }
    const references = join(dir, "references");
    const linked = [join(dir, "SKILL.md"), ...(existsSync(references) ? readdirSync(references).filter((f) => f.endsWith(".md")).map((f) => join(references, f)) : [])];
    for (const file of linked) {
      const where = relative(ROOT, file);
      for (const [, target] of readFileSync(file, "utf8").matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
        if (/^[a-z]+:/i.test(target)) continue;
        const path = resolve(dirname(file), target);
        if (!path.startsWith(dir + "/")) problems.push(`${where}: link ${target} leaves the skill's folder`);
        else if (!existsSync(path)) problems.push(`${where}: link ${target} does not exist`);
      }
    }
    for (const file of walk(dir).filter((path) => path.endsWith(".md"))) {
      const content = readFileSync(file, "utf8");
      for (const trap of SCANNER_TRAPS) if (trap.test(content)) problems.push(`${relative(ROOT, file)}: ${trap.why}`);
    }
    for (const [pin, version] of text.matchAll(PIN)) {
      if (version !== PKG.version) problems.push(`${at}: ${pin} is not package.json's ${PKG.version} (npm run skill:sync)`);
    }
  }
  problems.push(...checkPlugins(names));
  problems.push(...checkMcp());
  problems.push(...checkBundledPrompts());
  return problems;
}

/** Each plugin's manifest, its marketplace entry, and every skill in exactly one plugin. */
function checkPlugins(names) {
  const problems = [];
  const market = readJson(MARKETPLACE);
  if (!market) problems.push(`${MARKETPLACE}: missing`);
  const owner = new Map();
  for (const plugin of PLUGINS) {
    const manifest = readJson(plugin.manifest);
    if (!manifest) problems.push(`${plugin.manifest}: missing`);
    else if (manifest.name !== plugin.name || manifest.version !== PKG.version) problems.push(`${plugin.manifest}: name is not ${plugin.name} or version is not package.json's`);
    const listed = market?.plugins?.find((p) => p.name === plugin.name);
    if (market && !listed) problems.push(`${MARKETPLACE}: no plugin named ${plugin.name}`);
    else if (listed) {
      if (listed.version !== undefined && listed.version !== PKG.version) problems.push(`${MARKETPLACE}: ${plugin.name}'s version is not package.json's`);
      const want = marketSource(plugin);
      if (JSON.stringify(listed.source) !== JSON.stringify(want)) problems.push(`${MARKETPLACE}: ${plugin.name}'s source must be ${JSON.stringify(want)}`);
    }
    for (const skill of plugin.skills) {
      if (!names.includes(skill)) problems.push(`${plugin.name}: no skills/${skill}/SKILL.md`);
      if (owner.has(skill)) problems.push(`skills/${skill}: in both ${owner.get(skill)} and ${plugin.name}`);
      owner.set(skill, plugin.name);
    }
  }
  for (const listed of market?.plugins ?? []) {
    if (!PLUGINS.some((plugin) => plugin.name === listed.name)) problems.push(`${MARKETPLACE}: ${listed.name} is not one of ${PLUGINS.map((p) => p.name).join(", ")}`);
  }
  for (const name of names) if (!owner.has(name)) problems.push(`skills/${name}: in no plugin (scripts/skill.mjs PLUGINS)`);
  return problems;
}

/** No `.mcp.json`: the plugin bundles no MCP server for now (2026-11-20). */
function checkMcp() {
  const path = join(ROOT, ".mcp.json");
  if (existsSync(path)) return [".mcp.json: the plugin bundles no MCP server for now; remove it"];
  return [];
}

/** How `.mcp.json` was checked while the hosted plugin bundled one; kept for when it comes back. */
// eslint-disable-next-line no-unused-vars
function checkMcpServer() {
  const path = join(ROOT, ".mcp.json");
  if (!existsSync(path)) return [".mcp.json: missing (the plugin's lunox MCP server)"];
  let mcp;
  try {
    mcp = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return [`.mcp.json: not valid JSON (${error.message})`];
  }
  const want = `{ "mcpServers": { "lunox": { "type": "http", "url": "${MCP_URL}" } } }`;
  const servers = mcp?.mcpServers;
  const keys = (value) => (value !== null && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).sort().join(",") : null);
  if (keys(mcp) !== "mcpServers" || keys(servers) !== "lunox") return [`.mcp.json: must declare exactly the lunox server: ${want}`];
  const { lunox } = servers;
  if (keys(lunox) !== "type,url" || lunox.type !== "http" || lunox.url !== MCP_URL) return [`.mcp.json: lunox must be ${want}`];
  return [];
}

function readJson(path) {
  const full = join(ROOT, path);
  return existsSync(full) ? JSON.parse(readFileSync(full, "utf8")) : null;
}

function sync() {
  if (existsSync(BUNDLED_INTO)) rmSync(BUNDLED_INTO, { recursive: true });
  for (const [source, copy] of bundledPrompts()) {
    mkdirSync(dirname(copy), { recursive: true });
    writeFileSync(copy, readFileSync(source));
  }
  for (const name of skills()) {
    const path = join(SKILLS, name, "SKILL.md");
    const text = readFileSync(path, "utf8");
    const next = text.replace(PIN, `${PKG.name}@${PKG.version}`);
    if (next !== text) writeFileSync(path, next);
  }
  for (const path of MANIFESTS) {
    const json = readJson(path);
    if (!json) continue;
    if (json.version !== undefined) json.version = PKG.version;
    for (const plugin of json.plugins ?? []) if (PLUGINS.some((p) => p.name === plugin.name)) plugin.version = PKG.version;
    writeFileSync(join(ROOT, path), `${JSON.stringify(json, null, 2)}\n`);
  }
}

function pack(offline) {
  const problems = check();
  if (problems.length > 0) return problems;
  if (!offline) {
    const view = spawnSync("npm", ["view", `${PKG.name}@${PKG.version}`, "version"], { encoding: "utf8" });
    if (view.status !== 0 || view.stdout.trim() !== PKG.version) {
      return [`${PKG.name}@${PKG.version} is not on npm yet: publish it first, or pass --offline`];
    }
  }
  const out = join(ROOT, "dist-skills");
  mkdirSync(out, { recursive: true });
  for (const name of skills()) {
    const zip = join(out, `${name}-${PKG.version}.zip`);
    rmSync(zip, { force: true });
    const result = spawnSync("zip", ["-r", "-X", "-q", zip, name, "-x", "*.DS_Store", "-x", "*/Thumbs.db"], {
      cwd: SKILLS,
      stdio: "inherit",
    });
    if (result.error || result.status !== 0) return [`zip failed for ${name}${result.error ? `: ${result.error.message}` : ""}`];
    const plugin = PLUGINS.find((p) => p.skills.includes(name));
    console.log(`${relative(ROOT, zip)}${plugin ? ` (plugin ${plugin.name})` : ""}`);
  }
  return [];
}

/** Files every plugin carries from main, at the same path in its folder. `.mcp.json` only where `mcp`. */
const PLUGIN_FILES = [".claude-plugin/icon.png", "LICENSE"];
// plugin.json fields the directory's listing reads. Claude Code accepts them
// (2.1.329's `claude plugin validate` checks only that each is https:// or
// mailto:), so the branch's plugin.json keeps them, and its README repeats
// them as links for readers.
const LISTING_LINKS = { privacyPolicyUrl: "Privacy", termsOfServiceUrl: "Terms", documentationUrl: "Documentation", supportUrl: "Support" };

function git(args, env = {}) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", env: { ...process.env, ...env } });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${(result.stderr || "").trim()}`);
  return result.stdout.trim();
}

/** A file at `rev`, or null when it is not there. */
function show(rev, path) {
  const result = spawnSync("git", ["show", `${rev}:${path}`], { cwd: ROOT, encoding: "utf8" });
  return result.status === 0 ? result.stdout : null;
}

/** A plugin's README on the branch: what it does, its skills, how to install it, what each needs, what is sent where. */
function pluginReadme(plugin, rev) {
  const manifest = JSON.parse(show(rev, plugin.manifest));
  const market = JSON.parse(show(rev, MARKETPLACE));
  const lines = [`# ${manifest.name}`, "", manifest.description, "", "## Skills", ""];
  const needs = [];
  for (const name of plugin.skills) {
    const { fields } = frontmatter(show(rev, `skills/${name}/SKILL.md`));
    lines.push(`- **${fields.name}**: ${fields.description}`, "");
    if (fields.compatibility) needs.push(`- **${fields.name}**: ${fields.compatibility}`, "");
  }
  // Example prompts (.claude-plugin/examples.md): the directory asks for at least three that work.
  const examples = show(rev, ".claude-plugin/examples.md");
  if (examples !== null) lines.push("## Examples", "", examples.trim(), "");
  lines.push("## Install", "", "```sh", `claude plugin marketplace add ${REPO}`);
  lines.push(`claude plugin install ${manifest.name}@${market.name}`, "```", "");
  const others = PLUGINS.filter((other) => other !== plugin);
  for (const other of others) {
    const entry = market.plugins?.find((p) => p.name === other.name);
    if (entry) lines.push(`The same marketplace has \`${other.name}\`: ${entry.description}`, "");
  }
  if (needs.length > 0) lines.push("## Requirements", "", ...needs);
  const mcp = show(rev, ".mcp.json");
  const hosted = mcp === null ? undefined : JSON.parse(mcp).mcpServers?.lunox?.url;
  if (plugin.mcp && hosted) {
    lines.push("## Hosted mode", "", `The plugin bundles the \`lunox\` MCP server, Lunox's hosted platform at ${hosted}.`);
    lines.push("Claude Code signs in to it on first use (`/mcp`).");
    lines.push(`Without the plugin: \`claude mcp add --transport http lunox ${hosted}\`; other MCP clients take the`);
    lines.push("same URL as a remote HTTP server.", "");
  } else if (!plugin.mcp) {
    lines.push("## No sign-in", "", "The plugin bundles no MCP server: installing it asks for no sign-in, and its skill runs on the machine.", "");
  }
  // Links before Data: the directory takes the first privacy link in the README as the plugin's policy.
  const links = Object.entries(LISTING_LINKS).filter(([key]) => manifest[key]);
  if (links.length > 0) lines.push("## Links", "", ...links.map(([key, label]) => `- [${label}](${manifest[key]})`), "");
  const data = show(rev, ".claude-plugin/data.md");
  if (data !== null) lines.push("## Data", "", data.trim(), "");
  const layout = PLUGINS.map((p) => `\`${p.name}\` ${p.dir === "" ? "at its root" : `in ${p.dir}/`}`).join(", ");
  lines.push("## Source", "", `This branch holds only the plugins' files: ${layout}. The CLI, its documentation and the`);
  lines.push(`skills' source are on the main branch of ${manifest.repository}. License: ${manifest.license}.`, "");
  return lines.join("\n");
}

/** Writes `content` as a blob and adds it to the scratch index at `path`. */
function addBlob(env, path, content) {
  const blob = spawnSync("git", ["hash-object", "-w", "--stdin"], { cwd: ROOT, input: content, encoding: "utf8" });
  if (blob.status !== 0) throw new Error(`git hash-object: ${blob.stderr.trim()}`);
  git(["update-index", "--add", "--cacheinfo", `100644,${blob.stdout.trim()},${path}`], env);
}

/** Adds `path` as of `rev` to the scratch index at `to`. */
function addFromRev(env, rev, path, to) {
  const [mode, type, object] = git(["ls-tree", rev, "--", path]).split(/\s+/);
  if (!object) throw new Error(`${path}: not in ${rev}`);
  if (type === "tree") git(["read-tree", `--prefix=${to}/`, object], env);
  else git(["update-index", "--add", "--cacheinfo", `${mode},${object},${to}`], env);
}

function pluginBranch(push, rev) {
  const scratch = mkdtempSync(join(tmpdir(), "plugin-branch-"));
  try {
    const env = { GIT_INDEX_FILE: join(scratch, "index") };
    git(["read-tree", "--empty"], env);
    for (const plugin of PLUGINS) {
      const at = (path) => (plugin.dir === "" ? path : `${plugin.dir}/${path}`);
      const files = [...PLUGIN_FILES, ...(plugin.mcp ? [".mcp.json"] : []), ...plugin.skills.map((name) => `skills/${name}`)];
      for (const path of files) addFromRev(env, rev, path, at(path));
      const manifest = JSON.parse(show(rev, plugin.manifest) ?? "null");
      if (!manifest) return [`${plugin.manifest}: not in ${rev}`];
      addBlob(env, at(".claude-plugin/plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`);
      addBlob(env, at("README.md"), pluginReadme(plugin, rev));
    }
    const tree = git(["write-tree"], env);
    const remote = spawnSync("git", ["fetch", "--quiet", "origin", PLUGIN_BRANCH], { cwd: ROOT }).status === 0;
    const parent = remote ? git(["rev-parse", "FETCH_HEAD"]) : null;
    if (parent && git(["rev-parse", `${parent}^{tree}`]) === tree) {
      console.log(`${PLUGIN_BRANCH}: up to date at ${parent.slice(0, 7)}`);
      return [];
    }
    const head = git(["rev-parse", "--short", rev]);
    const layout = PLUGINS.map((p) => `${p.name} at ${p.dir === "" ? "the root" : `${p.dir}/`}`).join(", ");
    const message = `Plugin files from main ${head}\n\n${layout}; built by scripts/skill.mjs plugin-branch.`;
    const commit = git(["commit-tree", tree, ...(parent ? ["-p", parent] : []), "-m", message]);
    if (push) git(["push", "--quiet", "origin", `${commit}:refs/heads/${PLUGIN_BRANCH}`]);
    console.log(`${PLUGIN_BRANCH}: ${commit.slice(0, 7)} from main ${head}${push ? ", pushed" : " (not pushed; add --push)"}`);
    if (!push) for (const line of git(["ls-tree", "-r", "--name-only", tree]).split("\n")) console.log(`  ${line}`);
    return [];
  } catch (error) {
    return [error.message];
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const [command, ...args] = process.argv.slice(2);
let problems;
if (command === "check") problems = check();
else if (command === "sync") (sync(), (problems = check()));
else if (command === "pack") problems = pack(args.includes("--offline"));
else if (command === "plugin-branch") {
  const at = args.indexOf("--rev");
  problems = pluginBranch(args.includes("--push"), at === -1 ? "HEAD" : args[at + 1]);
}
else {
  console.error("usage: node scripts/skill.mjs check | sync | pack [--offline] | plugin-branch [--push] [--rev <rev>]");
  process.exit(1);
}
for (const problem of problems) console.error(problem);
if (problems.length === 0 && command === "check") console.log(`skills: ${skills().join(", ")} ok`);
process.exit(problems.length > 0 ? 1 : 0);
