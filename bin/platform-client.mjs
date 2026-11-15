// The hosted platform (sandbox-factory, platform.lunox.work) as this CLI
// talks to it: the base URL, the shared credentials file, one request
// function on `fetch` (so duediligence keeps no runtime dependency), and
// the resend a retryable 409 asks for. Nothing here runs unless a platform
// command (`login`, `whoami`, `logout`, `push`, `ci --platform`) is called;
// every other command stays local. Not named platform.mjs, which is
// the host-OS layer.
//
// Credentials: `~/.lunox/credentials` (LUNOX_CREDENTIALS moves it), JSON,
// mode 600 in a 700 folder, written whole through a rename. carveout shares
// the file, so each CLI keeps its own entry under the platform's URL:
//
//   { "https://platform.lunox.work": {
//       "duediligence": { token, organizationId, organizationHandle, client, createdAt, expiresAt },
//       "carveout": { ... } } }
//
// A token is minted for one client with that client's scopes, so the two
// CLIs never share one; writing an entry keeps every other.

import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const DEFAULT_PLATFORM = "https://platform.lunox.work";
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export class PlatformError extends Error {
  /**
   * `retryable`: the platform kept what was sent and asks for it again
   * (409 `run_limit`, 429 `rate_limited`). `retryAfter`: seconds from the
   * `Retry-After` header. `body`: the parsed error body.
   */
  constructor(message, { status, code, retryable = false, retryAfter, body } = {}) {
    super(message);
    this.name = "PlatformError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.retryAfter = retryAfter;
    this.body = body;
  }
}

/** `Retry-After` as seconds: a count, or an HTTP date measured from `now`; undefined when absent or unreadable. */
export function retryAfterSeconds(header, now = Date.now()) {
  if (header === null || header === undefined || String(header).trim() === "") return undefined;
  const text = String(header).trim();
  if (/^\d+$/.test(text)) return Number(text);
  const at = Date.parse(text);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - now) / 1000));
}

/** When a refusal says to come back: its body's `resetsAt` or `retryAt`, else in `Retry-After` seconds. */
function resetOf(body, retryAfter) {
  const named = body?.resetsAt ?? body?.retryAt;
  if (typeof named === "string" && !Number.isNaN(Date.parse(named))) return new Date(named).toISOString();
  return retryAfter === undefined ? undefined : `in ${retryAfter} s`;
}

/** The quota kinds a 429 `quota_exceeded` names, as a person reads them. */
const QUOTA_KINDS = {
  model_tokens: "monthly model-token limit (runs that call a model: sizing, respec, prepare, retry)",
  evaluator_seconds: "monthly evaluator time (builds, imports and grading)",
};

/**
 * The message for the refusals a person must act on rather than repeat:
 * the month's quota, a rate limit, the wrong kind of credential, a missing
 * scope. Undefined for any other, which keeps the API's own words.
 */
function refusalMessage({ code, body, retryAfter, client }) {
  if (code === "quota_exceeded") {
    const kind = QUOTA_KINDS[body?.kind] ?? QUOTA_KINDS.model_tokens;
    const figures = typeof body?.used === "number" && typeof body?.limit === "number" ? ` (${body.used} of ${body.limit})` : "";
    const reset = resetOf(body, retryAfter);
    return `The workspace has used its ${kind}${figures}. It resets ${reset ?? "at the start of next month (UTC)"}; nothing was queued, and sending it again before then is refused the same way.`;
  }
  if (code === "rate_limited") {
    const reset = resetOf(body, retryAfter);
    return `Rate limited${typeof body?.limit === "number" ? ` (${body.limit} attempts a day${body?.scope ? `, per ${body.scope}` : ""})` : ""}: try again ${reset === undefined ? "later" : reset.startsWith("in ") ? reset : `after ${reset}`}.${body?.retryable ? " What was sent is kept." : ""}`;
  }
  if (code === "workspace_credential")
    return "This route takes a contributor credential, not a workspace's: an lnxc_ token made on the web app's Contributions page (Authorization: Bearer lnxc_...), or a contributor sign-in at /mcp/contribute.";
  if (code === "contributor_credential")
    return `This is a contributor credential (lnxc_): it reaches only your own contributions, never a workspace. Sign in with a workspace token: \`${client} login\`.`;
  if (code === "insufficient_scope") {
    const said = typeof body?.error === "string" ? `${body.error} ` : "";
    return `${said}The sign-in predates that scope: run \`${client} login\` again (in Claude Code, sign the MCP server in again through /mcp).`;
  }
  return undefined;
}

/** `--platform`, else LUNOX_PLATFORM_URL, else production; no trailing slash. HTTPS, or plain HTTP to this machine only. */
export function platformUrl(given, env = process.env) {
  const raw = given ?? env.LUNOX_PLATFORM_URL ?? DEFAULT_PLATFORM;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new PlatformError(`${raw} is not a URL.`);
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK.has(url.hostname))) {
    throw new PlatformError(`${raw}: the platform must be https:// (plain http only on localhost).`);
  }
  url.search = "";
  url.hash = "";
  return url.href.replace(/\/+$/, "");
}

export function credentialsPath(env = process.env) {
  return env.LUNOX_CREDENTIALS ?? join(homedir(), ".lunox", "credentials");
}

/** The whole file, `{}` when there is none. A file that is not a JSON object is refused, never overwritten. */
export function readCredentials(path) {
  if (!existsSync(path)) return {};
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new PlatformError(`${path} is not valid JSON (${error.message}); fix or remove it.`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PlatformError(`${path} does not hold a JSON object; fix or remove it.`);
  }
  return parsed;
}

/** Writes the file whole: a 600 temp file beside it, renamed over it. Removes it when nothing is left. */
export function writeCredentials(path, all) {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
  }
  if (Object.keys(all).length === 0) {
    rmSync(path, { force: true });
    return;
  }
  const temp = join(dir, `.credentials-${process.pid}-${randomBytes(6).toString("hex")}.tmp`);
  try {
    writeFileSync(temp, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    chmodSync(temp, 0o600);
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

/** This client's entry for a platform, or undefined. */
export function credentialFor(path, base, client) {
  const entry = readCredentials(path)[base]?.[client];
  return entry && typeof entry.token === "string" ? entry : undefined;
}

/** Sets (or, with `entry` undefined, removes) this client's entry, keeping every other. */
export function saveCredential(path, base, client, entry) {
  const all = readCredentials(path);
  const forBase = { ...(all[base] ?? {}) };
  if (entry === undefined) delete forBase[client];
  else forBase[client] = entry;
  if (Object.keys(forBase).length === 0) delete all[base];
  else all[base] = forBase;
  writeCredentials(path, all);
}

/** The minimum version a 426 names, wherever the body puts it. */
function minimumOf(body) {
  const named = body?.minimumVersion ?? body?.minimum_version ?? body?.minimum;
  if (typeof named === "string") return named;
  return /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/.exec(body?.error ?? "")?.[0];
}

/**
 * One call to the platform's API. Sends the token as a bearer, the client
 * and its version as `User-Agent` and `Lunox-Client-Version`
 * (`<client>/<version>`), and JSON. Answers the parsed body; throws a
 * PlatformError whose message says what to do: 401 → sign in again, 426 →
 * upgrade, `quota_exceeded` / `rate_limited` → when it resets,
 * `workspace_credential` / `contributor_credential` → which kind of
 * credential the route takes, `insufficient_scope` → sign in again;
 * otherwise the API's own `{ error, code }`. `session` marks the
 * token as a device sign-in's session rather than a saved API token.
 */
export async function request({ base, token, session = false, method = "GET", path, body, client, version, fetchImpl = fetch }) {
  const headers = {
    Accept: "application/json",
    "User-Agent": `${client}/${version}`,
    "Lunox-Client-Version": `${client}/${version}`,
  };
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let response;
  try {
    response = await fetchImpl(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new PlatformError(`Could not reach ${base}: ${error.cause?.message ?? error.message}`);
  }
  const text = await response.text();
  let parsed;
  try {
    parsed = text === "" ? undefined : JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  if (response.ok) return parsed ?? {};
  const status = response.status;
  const code = typeof parsed?.code === "string" ? parsed.code : typeof parsed?.error === "string" && !parsed.error.includes(" ") ? parsed.error : undefined;
  if (status === 426) {
    const minimum = minimumOf(parsed);
    throw new PlatformError(
      `${base} needs a newer ${client}${minimum ? `: upgrade to at least ${minimum}` : ""} (this is ${version}). npm i -g ${client}@latest`,
      { status, code },
    );
  }
  const retryAfter = retryAfterSeconds(response.headers?.get?.("retry-after"));
  const details = { status, code, retryable: parsed?.retryable === true, retryAfter, body: parsed };
  const refusal = refusalMessage({ code, body: parsed, retryAfter, client });
  if (refusal !== undefined) throw new PlatformError(refusal, details);
  if (status === 401 && token !== undefined) {
    const what = session ? "The browser sign-in" : "The saved sign-in";
    throw new PlatformError(`${what} for ${base} is no longer valid (expired or revoked). Run \`${client} login\` again.`, {
      status,
      code,
    });
  }
  const said = parsed?.error_description ?? parsed?.error ?? parsed?.message;
  throw new PlatformError(
    typeof said === "string" ? `${said}${code && code !== said ? ` (${code})` : ""}` : `${method} ${path}: HTTP ${status}`,
    details,
  );
}

/**
 * `send()` again while the platform answers 409 with `retryable: true`
 * (the active-run limit: the submission is kept, the same files queue it),
 * after its `Retry-After` (else `fallbackSeconds`, capped at `maxWaitSeconds`),
 * up to `attempts` sends in all. Any other error, a 429 included (a quota
 * or rate limit says when it resets, and is not looped on), is thrown at once.
 */
export async function sendRetrying(send, { sleep, attempts = 4, fallbackSeconds = 30, maxWaitSeconds = 300, onWait = () => {} }) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await send();
    } catch (error) {
      if (!(error instanceof PlatformError) || error.status !== 409 || error.retryable !== true) throw error;
      if (attempt >= attempts) {
        error.message = `${error.message} Still refused after ${attempts} attempts; run it again later.`;
        throw error;
      }
      const seconds = Math.min(maxWaitSeconds, Math.max(1, error.retryAfter ?? fallbackSeconds));
      onWait(seconds, attempt, error);
      await sleep(seconds * 1000);
    }
  }
}
