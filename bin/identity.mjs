// Who this package is, to the Lunox platform and to the person.
// `client` is the platform's client id: the device sign-in's client_id,
// the token's scopes (account.mjs CLI_SCOPES), the key in the shared
// credentials file and `Lunox-Client-Version`. The platform knew this
// package as "duediligence" before it was renamed, so the id stays that.
// `cli` is the command messages tell the person to type; `pkg` is the
// npm package an upgrade installs.
export const IDENTITY = Object.freeze({ client: "duediligence", cli: "bouncer", pkg: "@lunox-work/bouncer" });
