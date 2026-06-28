/**
 * The core server that runs on a Cloudflare worker.
 */

import { Router } from "itty-router";
import { AuthErrorResponse, InternalError } from "./src/errors";
import v2Router from "./src/router";
import { authenticationMethodFromEnv } from "./src/authentication-method";
import { recordRead } from "./src/analytics";
import { Registry } from "./src/registry/registry";
import { R2Registry } from "./src/registry/r2";

// A full compatibility mode means that the r2 registry will try its best to
// help the client on the layer push. See how we let the client push layers with chunked uploads for more information.
type PushCompatibilityMode = "full" | "none";

export interface Env {
  REGISTRY: R2Bucket;
  ENVIRONMENT: string;
  JWT_REGISTRY_TOKENS_PUBLIC_KEY?: string;
  USERNAME?: string;
  PASSWORD?: string;
  READONLY_USERNAME?: string;
  READONLY_PASSWORD?: string;
  // JSON array of read-only pull credentials: [{"id":"ci","username":"...","password":"..."}, ...].
  // `id` is optional and falls back to `username`. Lets reads be attributed to a
  // specific credential in analytics. Each entry is pull-only.
  READONLY_CREDENTIALS_JSON?: string;
  PUSH_COMPATIBILITY_MODE?: PushCompatibilityMode;
  REGISTRIES_JSON?: string; // should be in the format of RegistryConfiguration[];
  // Optional D1 binding for read attribution analytics. When present, every
  // authenticated pull is recorded fire-and-forget into the `reads` table.
  // See migrations/0001_create_reads_table.sql.
  ANALYTICS?: D1Database;
  REGISTRY_CLIENT: Registry;
}

const router = Router();

/**
 * V2 Api
 */
router.all("/v2/*", v2Router.fetch);

router.all("*", () => new Response("Not Found.", { status: 404 }));

export default {
  async fetch(request: Request, env: Env, context?: ExecutionContext) {
    if (!ensureConfig(env)) {
      return new AuthErrorResponse(request);
    }

    const authMethod = await authenticationMethodFromEnv(env);
    if (!authMethod) {
      return new AuthErrorResponse(request);
    }

    const credentials = await authMethod.checkCredentials(request);
    if (!credentials.verified) {
      console.warn(`Not Authorized. authmode=${authMethod.authmode}. verified=false`);
      return new AuthErrorResponse(request);
    }

    // Stable identifier of the credential that authenticated this request, used
    // to attribute reads in analytics. Falls back to the username, then to
    // "unknown" for auth modes that do not set either (e.g. JWT without an id).
    const credentialId = credentials.payload?.credential_id ?? credentials.payload?.username ?? "unknown";

    env.REGISTRY_CLIENT = new R2Registry(env);
    try {
      // Dispatch the request to the appropriate route
      const res = await router.fetch(request, env, context);
      // Fire-and-forget read attribution. No-op when ANALYTICS is unbound or the
      // request is not a content read, and swallows insert failures so analytics
      // can never break a pull.
      recordRead(env, context, request, res, credentialId);
      return res;
    } catch (err) {
      if (err instanceof Response) {
        console.warn(`${request.method} ${err.status} ${err.url}`);
        return err;
      }

      // Unexpected error
      if (err instanceof Error) {
        console.error(
          "An error has been thrown by the router:\n",
          `${err.name}: ${err.message}: ${err.cause}: ${err.stack}`,
        );
        return new InternalError();
      }

      console.error(
        "An error has been thrown and is neither a Response or an Error, JSON.stringify() =",
        JSON.stringify(err),
      );
      return new InternalError();
    }
  },
} satisfies ExportedHandler<Env>;

const ensureConfig = (env: Env): boolean => {
  if (!env.REGISTRY) {
    console.error(
      "env.REGISTRY is not setup. Please setup an R2 bucket and add the binding in your wrangler config file. Try 'npx wrangler --env production r2 bucket create r2-registry'",
    );
    return false;
  }

  return true;
};
