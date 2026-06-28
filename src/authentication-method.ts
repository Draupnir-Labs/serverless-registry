import { Env } from "..";
import { newRegistryTokens } from "./token";
import { UserAuthenticator } from "./user";
import type { AuthenticatorCredentials } from "./user";
import { errorString } from "./utils";

// Shape of an entry in READONLY_CREDENTIALS_JSON. `id` is optional and falls
// back to `username`; both must be non-empty strings. Entries missing username
// or password are dropped with a warning so one bad entry cannot open an
// unintended credential.
type ReadonlyCredentialEntry = {
  id?: unknown;
  username?: unknown;
  password?: unknown;
};

// Parses READONLY_CREDENTIALS_JSON into pull-only AuthenticatorCredentials.
// Returns an empty array on any parse or validation failure for the whole
// document, so a malformed config fails closed (no read-only creds) rather
// than silently admitting a partial credential set.
function parseReadonlyCredentialsJson(raw: string): AuthenticatorCredentials[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`READONLY_CREDENTIALS_JSON is not valid JSON: ${errorString(err)}`);
    return [];
  }

  if (!Array.isArray(parsed)) {
    console.error("READONLY_CREDENTIALS_JSON must be a JSON array");
    return [];
  }

  const credentials: AuthenticatorCredentials[] = [];
  for (const entry of parsed as ReadonlyCredentialEntry[]) {
    if (typeof entry !== "object" || entry === null) {
      console.error("READONLY_CREDENTIALS_JSON entry is not an object, skipping");
      continue;
    }

    const username = typeof entry.username === "string" ? entry.username : "";
    const password = typeof entry.password === "string" ? entry.password : "";
    const id = typeof entry.id === "string" && entry.id.length > 0 ? entry.id : username;

    if (username.length === 0 || password.length === 0) {
      console.error("READONLY_CREDENTIALS_JSON entry missing username or password, skipping");
      continue;
    }

    credentials.push({ id, username, password, capabilities: ["pull"] });
  }

  return credentials;
}

export async function authenticationMethodFromEnv(env: Env) {
  if (env.JWT_REGISTRY_TOKENS_PUBLIC_KEY) {
    return await newRegistryTokens(env.JWT_REGISTRY_TOKENS_PUBLIC_KEY);
  }

  const hasBasicCreds =
    (env.USERNAME && env.PASSWORD) || (env.READONLY_USERNAME && env.READONLY_PASSWORD) || env.READONLY_CREDENTIALS_JSON;

  if (!hasBasicCreds) {
    console.error(
      "Either env.JWT_REGISTRY_TOKENS_PUBLIC_KEY must be set, or both env.USERNAME and env.PASSWORD, or both env.READONLY_USERNAME and env.READONLY_PASSWORD, or env.READONLY_CREDENTIALS_JSON must be set.",
    );
    return undefined;
  }

  const credentials: AuthenticatorCredentials[] = [];

  if (env.USERNAME && env.PASSWORD) {
    credentials.push({
      id: env.USERNAME,
      username: env.USERNAME,
      password: env.PASSWORD,
      capabilities: ["pull", "push"],
    });
  }

  if (env.READONLY_USERNAME && env.READONLY_PASSWORD) {
    credentials.push({
      id: env.READONLY_USERNAME,
      username: env.READONLY_USERNAME,
      password: env.READONLY_PASSWORD,
      capabilities: ["pull"],
    });
  }

  if (env.READONLY_CREDENTIALS_JSON) {
    credentials.push(...parseReadonlyCredentialsJson(env.READONLY_CREDENTIALS_JSON));
  }

  if (credentials.length === 0) {
    console.error(
      "Authentication was configured but produced no valid credentials. Check READONLY_CREDENTIALS_JSON or the USERNAME/PASSWORD env vars.",
    );
    return undefined;
  }

  return new UserAuthenticator(credentials);
}

export { parseReadonlyCredentialsJson };
