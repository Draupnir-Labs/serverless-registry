import { errorString } from "./utils";
import type { Env } from "../index";

// Parsed read target. `repository` may contain slashes (e.g. "library/ubuntu")
// because the itty-router `:name+` param allows them. `kind` is the route family
// used for analytics grouping.
export type ReadTarget = {
  repository: string | null;
  kind: "ping" | "catalog" | "manifest" | "blob" | "referrers" | "tags";
};

// Parses a v2 registry path into a read target, or returns null for paths that
// are not content-read routes (push/upload/GC lifecycle). The repository is
// reconstructed by splitting on the known route keyword rather than assuming a
// single path segment, so namespaced repositories keep their slashes.
export function parseReadPath(pathname: string): ReadTarget | null {
  if (pathname === "/v2/" || pathname === "/v2") {
    return { repository: null, kind: "ping" };
  }
  if (pathname === "/v2/_catalog") {
    return { repository: null, kind: "catalog" };
  }
  if (!pathname.startsWith("/v2/")) {
    return null;
  }

  const segments = pathname.slice("/v2/".length).split("/");

  const manifestIdx = segments.indexOf("manifests");
  if (manifestIdx !== -1) {
    const repository = segments.slice(0, manifestIdx).join("/");
    return { repository: repository.length > 0 ? repository : null, kind: "manifest" };
  }

  const referrersIdx = segments.indexOf("referrers");
  if (referrersIdx !== -1) {
    const repository = segments.slice(0, referrersIdx).join("/");
    return { repository: repository.length > 0 ? repository : null, kind: "referrers" };
  }

  const tagsIdx = segments.indexOf("tags");
  if (tagsIdx !== -1) {
    const repository = segments.slice(0, tagsIdx).join("/");
    return { repository: repository.length > 0 ? repository : null, kind: "tags" };
  }

  const blobsIdx = segments.indexOf("blobs");
  if (blobsIdx !== -1) {
    // /v2/<repo>/blobs/uploads/<uuid> is upload lifecycle, not a content read.
    if (segments[blobsIdx + 1] === "uploads") {
      return null;
    }
    const repository = segments.slice(0, blobsIdx).join("/");
    return { repository: repository.length > 0 ? repository : null, kind: "blob" };
  }

  return null;
}

// Records a read into the ANALYTICS D1 binding, fire-and-forget. No-op when the
// ANALYTICS binding is absent, the method is not a read, or the path is not a
// read route. Insert failures are caught and logged so analytics can never
// break a pull.
export function recordRead(
  env: Env,
  context: ExecutionContext | undefined,
  request: Request,
  response: Response,
  credentialId: string,
): void {
  if (!env.ANALYTICS) return;
  if (request.method !== "GET" && request.method !== "HEAD") return;

  const url = new URL(request.url);
  const target = parseReadPath(url.pathname);
  if (!target) return;

  const bytes = Number.parseInt(response.headers.get("Content-Length") ?? "0", 10) || 0;
  const statement = env.ANALYTICS.prepare(
    "INSERT INTO reads (credential_id, method, path, repository, kind, status, bytes, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(
    credentialId,
    request.method,
    url.pathname,
    target.repository,
    target.kind,
    response.status,
    bytes,
    Date.now(),
  );

  const task = (async () => {
    try {
      await statement.run();
    } catch (err) {
      console.error(`analytics: failed to record read for ${credentialId}: ${errorString(err)}`);
    }
  })();

  if (context) {
    context.waitUntil(task);
  }
}
