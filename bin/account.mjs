// `login`, `whoami` and `logout` against the hosted platform
// (platform-client.mjs). Each takes its argv and the outside world as
// `deps`, so test/platform.mjs drives them against a fake platform with no
// real waiting; bin/login.mjs, whoami.mjs and logout.mjs run them.
//
// login is RFC 8628's device flow on the platform's Better Auth:
//   POST /api/auth/device/code  {client_id}                     → device_code, user_code, verification_uri(_complete), expires_in, interval
//   POST /api/auth/device/token {grant_type, device_code, client_id} → access_token (a session that may only mint this client's token)
//   GET  /api/v1/me, GET /api/v1/me/orgs                          (with that session)
//   POST /api/v1/orgs/:orgId/tokens/cli {client, label, scopes}  → { token, secret }: a 90-day lnx_ token; the session ends
// The token is saved, never printed. `scopes` is CLI_SCOPES[client]; a
// platform that does not know one of them (400 before `decisions:confirm`)
// is asked again without, which grants its default set.

import { spawn } from "node:child_process";
import { hostname as osHostname } from "node:os";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";

import { credentialFor, credentialsPath, platformUrl, PlatformError, request, saveCredential } from "./platform-client.mjs";

const GRANT = "urn:ietf:params:oauth:grant-type:device_code";
/**
 * The scopes each CLI asks for (sandbox-factory's CLI_CLIENTS, the most it
 * may hold). bouncer's include `decisions:confirm`, so `push` records a
 * spec confirmed here as confirmed; without it the platform keeps the spec
 * and answers `confirmation: "skipped_scope"`.
 */
export const CLI_SCOPES = {
  duediligence: ["workspace:read", "bounties:write", "specs:write", "decisions:confirm", "sandboxes:write", "submissions:write", "judge"],
};
const CONFIRM_SCOPE = "decisions:confirm";
const ADMIN_ROLES = new Set(["owner", "admin"]);

/** The process's own world; tests pass their own. */
export function defaultDeps() {
  return {
    env: process.env,
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
    isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    ask: async (question) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return await rl.question(question);
      } finally {
        rl.close();
      }
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    fetchImpl: fetch,
    openUrl,
    hostname: osHostname,
  };
}

/** The OS's browser opener, detached; a failure is only a missed convenience. */
function openUrl(url) {
  const [command, args] =
    process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", '""', url]] : ["xdg-open", [url]];
  try {
    spawn(command, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  } catch {
    // The URL is printed either way.
  }
}

/** Whether a held role (Better Auth joins several with commas) may mint a token. */
const isAdmin = (role) => String(role ?? "").split(",").some((one) => ADMIN_ROLES.has(one.trim()));
const describe = (org) => `${org.slug} (${org.name}, ${org.role}) ${org.id}`;

function options(argv, spec, usage) {
  try {
    return parseArgs({ args: argv, options: { ...spec, help: { type: "boolean", short: "h" } }, allowPositionals: false }).values;
  } catch (error) {
    throw new PlatformError(`${error.message}\n${usage}`);
  }
}

/** Runs one of the three, printing a PlatformError as one line on stderr. Answers the exit code. */
export async function run(command, argv, { client, cli = client, pkg = client, version }, deps = defaultDeps()) {
  const commands = { login, whoami, logout };
  try {
    return await commands[command](argv, { client, cli, pkg, version }, deps);
  } catch (error) {
    if (!(error instanceof PlatformError)) throw error;
    deps.err(`${cli} ${command}: ${error.message}\n`);
    return 1;
  }
}

/** Picks the workspace to mint in: --org, the only one an owner or admin holds, or a choice on a TTY. */
async function chooseOrg(orgs, wanted, { cli, deps }) {
  const eligible = orgs.filter((org) => isAdmin(org.role));
  const listing = (list) => list.map((org) => `  ${describe(org)}`).join("\n");
  if (wanted !== undefined) {
    const key = wanted.replace(/^@/, "").toLowerCase();
    const found = orgs.find((org) => org.id === wanted || org.slug.toLowerCase() === key);
    if (found === undefined) throw new PlatformError(`No workspace ${wanted} for this account. It has:\n${listing(orgs)}`);
    if (!isAdmin(found.role)) {
      throw new PlatformError(`You are ${found.role} in ${found.slug}; only its owners and admins can give ${cli} a token.`);
    }
    return found;
  }
  if (eligible.length === 1) return eligible[0];
  if (eligible.length === 0) {
    throw new PlatformError(
      orgs.length === 0
        ? "This account has no workspace yet. Create one in the platform's web app, then run login again."
        : `You are not an owner or admin of any workspace, and only they can give ${cli} a token. This account has:\n${listing(orgs)}`,
    );
  }
  if (!deps.isTTY) {
    throw new PlatformError(`This account can sign in to ${eligible.length} workspaces; name one with --org <handle|id>:\n${listing(eligible)}`);
  }
  deps.out(`\nWorkspaces you can sign ${cli} in to:\n${eligible.map((org, i) => `  ${i + 1}. ${describe(org)}`).join("\n")}\n`);
  for (let tries = 0; tries < 3; tries += 1) {
    const answer = (await deps.ask(`Workspace [1-${eligible.length}]: `)).trim();
    const index = Number(answer);
    if (Number.isInteger(index) && index >= 1 && index <= eligible.length) return eligible[index - 1];
    const named = eligible.find((org) => org.slug.toLowerCase() === answer.replace(/^@/, "").toLowerCase() || org.id === answer);
    if (named) return named;
  }
  throw new PlatformError("No workspace chosen.");
}

/** Polls the token endpoint at the server's interval, five seconds slower after each `slow_down`, until approval, denial or expiry. */
async function pollForSession(base, code, { client, cli, pkg, version, deps }) {
  let interval = Math.max(1, Number(code.interval) || 5) * 1000;
  const deadline = deps.now() + Math.max(1, Number(code.expires_in) || 900) * 1000;
  for (;;) {
    await deps.sleep(interval);
    if (deps.now() >= deadline) throw new PlatformError("The code expired before it was approved. Run login again.");
    try {
      const granted = await request({
        base,
        method: "POST",
        path: "/api/auth/device/token",
        body: { grant_type: GRANT, device_code: code.device_code, client_id: client },
        client,
        cli,
        pkg,
        version,
        fetchImpl: deps.fetchImpl,
      });
      if (typeof granted.access_token !== "string") throw new PlatformError("The platform approved the sign-in but sent no session.");
      return granted.access_token;
    } catch (error) {
      if (!(error instanceof PlatformError)) throw error;
      if (error.code === "authorization_pending") continue;
      if (error.code === "slow_down") {
        interval += 5000;
        continue;
      }
      // The platform's rate limiter answers a plain 429 while the code is
      // still good; ending here threw away a sign-in the person was about to
      // approve. Back off as for slow_down, or as long as Retry-After asks.
      if (error.status === 429) {
        interval = Math.max(interval + 5000, (Number(error.retryAfter) || 0) * 1000);
        continue;
      }
      if (error.code === "expired_token") throw new PlatformError("The code expired before it was approved. Run login again.");
      if (error.code === "access_denied") throw new PlatformError("The sign-in was denied in the browser. Nothing was saved.");
      if (error.code === "invalid_grant") throw new PlatformError("The code is no longer valid (already used, or unknown). Run login again.");
      throw error;
    }
  }
}

export async function login(argv, { client, cli = client, pkg = client, version }, deps) {
  const usage = `usage: ${cli} login [--platform <url>] [--org <handle|id>] [--open]`;
  const values = options(argv, { platform: { type: "string" }, org: { type: "string" }, open: { type: "boolean" } }, usage);
  if (values.help) {
    deps.out(
      `${usage}\n\nSigns ${cli} in to the Lunox platform (default ${platformUrl(undefined, {})}; LUNOX_PLATFORM_URL) with a code\n` +
        `you approve in the browser, and saves a workspace token in ${credentialsPath(deps.env)} (LUNOX_CREDENTIALS).\n` +
        `--org picks the workspace; --open opens the approval page.\n`,
    );
    return 0;
  }
  const base = platformUrl(values.platform, deps.env);
  const call = (options) => request({ base, client, cli, pkg, version, fetchImpl: deps.fetchImpl, ...options });
  const code = await call({ method: "POST", path: "/api/auth/device/code", body: { client_id: client } });
  if (typeof code.device_code !== "string" || typeof code.user_code !== "string") {
    throw new PlatformError(`${base} answered the sign-in request without a code.`);
  }
  const page = code.verification_uri_complete ?? code.verification_uri ?? `${base}/device`;
  const minutes = Math.round((Number(code.expires_in) || 900) / 60);
  deps.out(
    `To sign ${cli} in to ${base}, open this page and approve the code:\n\n  ${page}\n\n` +
      `  Code: ${code.user_code} (expires in ${minutes} minute${minutes === 1 ? "" : "s"})\n\n`,
  );
  if (values.open) deps.openUrl(page);
  deps.out("Waiting for approval...\n");
  const session = await pollForSession(base, code, { client, cli, pkg, version, deps });
  const asSession = (options) => call({ token: session, session: true, ...options });
  let minted;
  let me;
  let org;
  try {
    me = (await asSession({ path: "/api/v1/me" })).user;
    const orgs = (await asSession({ path: "/api/v1/me/orgs" })).organizations ?? [];
    org = await chooseOrg(orgs, values.org, { cli, deps });
    const label = String(deps.hostname() ?? "").trim().slice(0, 60);
    const mint = (scopes) =>
      asSession({
        method: "POST",
        path: `/api/v1/orgs/${encodeURIComponent(org.id)}/tokens/cli`,
        body: { client, ...(label === "" ? {} : { label }), ...(scopes === undefined ? {} : { scopes }) },
      });
    const wanted = CLI_SCOPES[client];
    try {
      minted = await mint(wanted);
    } catch (error) {
      // An older platform refuses a scope it does not know yet; its default set is what login always had.
      const unknownScope = error instanceof PlatformError && error.status === 400 && ["invalid_scope", "invalid_token_request"].includes(error.code);
      if (wanted === undefined || !unknownScope) throw error;
      minted = await mint(undefined);
    }
  } catch (error) {
    // Minting ends the session; a sign-in that stopped short ends it here, best effort.
    await call({ token: session, session: true, method: "POST", path: "/api/auth/sign-out", body: {} }).catch(() => {});
    throw error;
  }
  if (typeof minted?.secret !== "string" || !minted.secret.startsWith("lnx_")) {
    throw new PlatformError(`${base} answered without a workspace token.`);
  }
  const path = credentialsPath(deps.env);
  saveCredential(path, base, client, {
    token: minted.secret,
    organizationId: org.id,
    organizationHandle: org.slug,
    client,
    createdAt: minted.token?.createdAt ?? new Date(deps.now()).toISOString(),
    expiresAt: minted.token?.expiresAt ?? null,
  });
  const who = me ? `${me.name} <${me.email}>` : "you";
  const expiry = minted.token?.expiresAt ? `; it expires ${minted.token.expiresAt.slice(0, 10)}` : "";
  deps.out(`Signed in as ${who}, workspace ${org.name} (@${org.slug}) on ${base}.\nToken saved to ${path}${expiry}.\n`);
  const granted = minted.token?.scopes;
  if (CLI_SCOPES[client]?.includes(CONFIRM_SCOPE) && Array.isArray(granted) && !granted.includes(CONFIRM_SCOPE)) {
    deps.out(
      `This platform did not grant ${CONFIRM_SCOPE}: \`${cli} push\` posts specs with their decisions unconfirmed, to confirm\n` +
        "in the web app. Sign in again once the platform offers it.\n",
    );
  }
  return 0;
}

export async function whoami(argv, { client, cli = client, pkg = client, version }, deps) {
  const usage = `usage: ${cli} whoami [--platform <url>]`;
  const values = options(argv, { platform: { type: "string" } }, usage);
  if (values.help) {
    deps.out(`${usage}\n\nThe account, workspace and token expiry ${cli} is signed in with.\n`);
    return 0;
  }
  const base = platformUrl(values.platform, deps.env);
  const saved = credentialFor(credentialsPath(deps.env), base, client);
  if (saved === undefined) throw new PlatformError(`Not signed in to ${base}. Run \`${cli} login\`.`);
  const call = (path) => request({ base, token: saved.token, path, client, cli, pkg, version, fetchImpl: deps.fetchImpl });
  const { user } = await call("/api/v1/me");
  const { organization, role } = await call(`/api/v1/orgs/${encodeURIComponent(saved.organizationId)}`);
  const expires = saved.expiresAt ? `expires ${saved.expiresAt.slice(0, 10)}` : "does not expire";
  deps.out(
    [
      `user       ${user.name} <${user.email}>${user.username ? ` (@${user.username})` : ""}`,
      `workspace  ${organization.name} (@${organization.slug}), ${role}`,
      `platform   ${base}`,
      `token      ${cli}, ${expires}`,
      "",
    ].join("\n"),
  );
  return 0;
}

export async function logout(argv, { client, cli = client }, deps) {
  const usage = `usage: ${cli} logout [--platform <url>]`;
  const values = options(argv, { platform: { type: "string" } }, usage);
  if (values.help) {
    deps.out(`${usage}\n\nDeletes ${cli}'s saved token for the platform.\n`);
    return 0;
  }
  const base = platformUrl(values.platform, deps.env);
  const path = credentialsPath(deps.env);
  const saved = credentialFor(path, base, client);
  if (saved === undefined) {
    deps.out(`Not signed in to ${base}; nothing to do.\n`);
    return 0;
  }
  saveCredential(path, base, client, undefined);
  // The platform lets no API token revoke itself (token routes take a person's session), so this is local.
  const until = saved.expiresAt ? `until ${saved.expiresAt.slice(0, 10)}` : "until it is revoked";
  deps.out(
    `Signed out of ${base}: the token is deleted from ${path}.\n` +
      `The platform has no route for a token to revoke itself, so it stays valid ${until} unless an owner or\n` +
      `admin of @${saved.organizationHandle} revokes it in the platform's web app (the workspace's API tokens).\n`,
  );
  return 0;
}
